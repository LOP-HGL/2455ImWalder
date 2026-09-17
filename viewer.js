// Import Supabase Client
import { getJsonFromStorage, getImageUrl, getCurrentProject, getProjects } from './supabase-client.js';

class PDFViewer {
    constructor() {
        this.viewer = OpenSeadragon({
            id: "viewer",
            prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
            showNavigationControl: true,
            navigationControlAnchor: OpenSeadragon.ControlAnchor.TOP_LEFT,
            showZoomControl: false,
            showHomeControl: false,
            showFullPageControl: false,
            showRotationControl: false,
            showSequenceControl: false,
            showNavigator: false,
            defaultZoomLevel: 1,
            maxZoomPixelRatio: 2,
            minZoomImageRatio: 0.0001,
            minZoomLevel: 0.01,
            maxZoomLevel: 10,
            immediateRender: true,
            visibilityRatio: 0.0,
            constrainDuringPan: false,
            homeFillsViewer: true,
            navigatorAutoFade: false,
            navigatorHeight: 200,
            navigatorWidth: 200,
            autoResize: true
        });
        
        this.metadata = null;
        this.teamData = null;
        this.totalBounds = null;
        this.currentParticipant = null;
        this.currentProject = null;
        
        // Warte auf das Laden der Konfiguration, bevor die Daten geladen werden
        window.addEventListener('supabase-config-loaded', () => {
            this.loadData();
        });
        
        // Falls die Konfiguration bereits geladen wurde, lade die Daten sofort
        setTimeout(() => {
            const project = getCurrentProject();
            if (project) {
                this.loadData();
            }
        }, 100);
    }

    async loadData() {
        try {
            // Prüfen, ob die Daten bereits geladen wurden
            if (this.metadata) {
                return;
            }
            
            // Aktuelles Projekt abrufen
            this.currentProject = getCurrentProject();
            if (!this.currentProject) {
                console.error('Kein Projekt gefunden. Warte auf Konfiguration...');
                return;
            }
            
            console.log('Lade Daten für Projekt:', this.currentProject.id);

            // Projekt-Umschalter befüllen
            this.createProjectSwitcher();

            // Metadaten aus Supabase abrufen
            const metadataPath = `${this.currentProject.paths.outputTiles}/metadata.json`;
            const metadata = await getJsonFromStorage(metadataPath);
            
            // Teams-Daten aus Supabase abrufen
            const teamsData = await getJsonFromStorage(this.currentProject.paths.teamsFile);
            
            // Process the data
            this.metadata = metadata;
            this.teamData = teamsData;
            
            console.log('Loaded metadata:', this.metadata);
            console.log('Loaded team data:', this.teamData);
            
            // Zeige Projekttitel
            document.getElementById('project-title').textContent = this.teamData.project_title;
            
            this.createNavigation();
            // Lade den ersten Teilnehmer standardmäßig
            const firstParticipantId = Object.keys(this.metadata.participants)[0];
            this.loadParticipant(firstParticipantId);
        } catch (error) {
            console.error('Error initializing viewer:', error);
        }
    }

    createProjectSwitcher() {
        const select = document.getElementById('project-switcher');
        const container = document.getElementById('project-switcher-container');
        const navMenu = document.getElementById('nav-menu');
        if (!select || !container) return;

        // Nur fertig verarbeitete Projekte anzeigen; das aktuelle Projekt immer einschließen.
        const projects = getProjects().filter(
            p => p.status === 'ready' || !p.status || p.id === this.currentProject.id
        );

        // Umschalter ausblenden, wenn es nur ein Projekt gibt (oberer Abstand wandert dann
        // auf das Navigationsmenü).
        if (projects.length <= 1) {
            container.style.display = 'none';
            if (navMenu) navMenu.style.marginTop = '80px';
            return;
        }
        container.style.display = '';
        if (navMenu) navMenu.style.marginTop = '0';

        select.innerHTML = '';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name || project.id;
            if (project.id === this.currentProject.id) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.onchange = () => {
            const params = new URLSearchParams(window.location.search);
            params.set('project', select.value);
            window.location.search = params.toString();
        };
    }

    createNavigation() {
        const navMenu = document.getElementById('nav-menu');
        navMenu.innerHTML = '';

        Object.values(this.metadata.participants)
            .sort((a, b) => parseInt(a.id) - parseInt(b.id))
            .forEach(participant => {
                const item = document.createElement('div');
                item.className = 'nav-item';
                
                const teamInfo = this.teamData.teams[participant.id];
                item.innerHTML = `
                    <span class="team-id">TN${participant.id}</span>
                    <span class="team-separator"> - </span>
                    <span class="team-short">${teamInfo ? teamInfo.shortname : ''}</span>
                `;
                
                if (participant.id === this.currentParticipant) {
                    item.classList.add('active');
                }
                
                item.onclick = () => this.loadParticipant(participant.id);
                navMenu.appendChild(item);
            });
    }

    loadParticipant(participantId) {
        if (this.currentParticipant === participantId) return;
        this.currentParticipant = participantId;
        
        // Update active state in navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.querySelector('.team-id').textContent === `TN${participantId}`) {
                item.classList.add('active');
            }
        });

        // Update team name display
        const teamInfo = this.teamData.teams[participantId];
        if (teamInfo) {
            document.getElementById('team-name').textContent = teamInfo.fullname;
        }

        // Clear existing content
        this.viewer.world.removeAll();
        
        // Load participant's pages
        const participant = this.metadata.participants[participantId];
        this.createGrid(participant.pages);
    }

    createGrid(pages) {
        if (!pages || !pages.length) return;

        // Gruppiere Seiten nach Position
        const pagesByPosition = new Map();
        pages.forEach(page => {
            if (!pagesByPosition.has(page.position)) {
                pagesByPosition.set(page.position, page);
            }
        });

        // Sortiere Positionen
        const sortedPositions = Array.from(pagesByPosition.keys()).sort((a, b) => a - b);
        const numDocs = sortedPositions.length;

        // Berechne Grid-Layout. Spaltenzahl kommt aus dem Projekt (teams.json:
        // grid_columns); Fallback auf bisheriges Verhalten (bis zu 4 nebeneinander).
        const configuredCols = parseInt(this.teamData && this.teamData.grid_columns);
        const cols = (configuredCols && configuredCols > 0)
            ? Math.min(configuredCols, numDocs)
            : (numDocs <= 4 ? numDocs : 4);
        const rows = Math.ceil(numDocs / cols);
        
        // Skalierungsfaktor für die Viewport-Koordinaten
        const viewportScale = 0.001;
        // Definiere einen kleinen Abstand zwischen den PDFs
        const spacing = viewportScale * 100; // Kleiner Abstand, skaliert mit viewportScale
        
        // Berechne die maximale Breite und Höhe aller PDFs
        let maxWidth = 0;
        let maxHeight = 0;
        pagesByPosition.forEach(page => {
            maxWidth = Math.max(maxWidth, page.width);
            maxHeight = Math.max(maxHeight, page.height);
        });

        // Skaliere die Dimensionen
        maxWidth *= viewportScale;
        maxHeight *= viewportScale;

        // Berechne die Gesamtgröße des Grids mit Abständen
        const totalWidth = cols * maxWidth + (cols - 1) * spacing;
        const totalHeight = rows * maxHeight + (rows - 1) * spacing;

        // Speichere die Gesamtgrenzen
        this.totalBounds = new OpenSeadragon.Rect(0, 0, totalWidth, totalHeight);

        // Entferne alten Home-Handler
        this.viewer.removeHandler('home');
        
        // Setze neuen Home-Handler
        this.viewer.addHandler('home', () => {
            this.viewer.viewport.fitBounds(this.totalBounds, true);
        });

        // Füge jedes PDF zum Viewer hinzu
        sortedPositions.forEach((position, index) => {
            const page = pagesByPosition.get(position);
            const col = index % cols;
            const row = Math.floor(index / cols);
            
            const tileSource = {
                height: page.height,
                width: page.width,
                tileSize: 512,
                participantId: this.currentParticipant,
                position: page.position,
                projectPaths: this.currentProject.paths,
                getTileUrl: function(level, x, y) {
                    const invertedLevel = this.maxLevel - level;
                    const participantId = String(this.participantId).padStart(2, '0');
                    const position = this.position < 10 ? 
                        String(this.position).padStart(2, '0') : 
                        String(this.position).padStart(3, '0');
                    const tileName = `TN${participantId}_${position}_level_${invertedLevel}_tile_${x}_${y}.png`;
                    const tilePath = `${this.projectPaths.outputTiles}/${tileName}`;
                    return getImageUrl(tilePath);
                },
                maxLevel: Math.ceil(Math.log2(Math.max(page.width, page.height) / 512)),
                minLevel: 0,
                getLevelScale: function(level) {
                    return 1 / Math.pow(2, this.maxLevel - level);
                }
            };

            const x = col * (maxWidth + spacing);
            const y = row * (maxHeight + spacing);

            this.viewer.addTiledImage({
                tileSource: tileSource,
                x: x,
                y: y,
                width: maxWidth,
                success: function(event) {
                    console.log(`PDF ${position} placed at ${x},${y}`);
                }
            });
        });

        // Initiale Ansicht einstellen
        setTimeout(() => {
            this.viewer.viewport.fitBounds(this.totalBounds, true);
            
            // Zoom-Handler
            this.viewer.removeHandler('zoom');
            this.viewer.addHandler('zoom', () => {
                const currentZoom = this.viewer.viewport.getZoom();
                if (currentZoom < this.viewer.viewport.getMinZoom()) {
                    this.viewer.viewport.fitBounds(this.totalBounds, true);
                }
            });
        }, 100);
    }
}

// Initialize the viewer
document.addEventListener('DOMContentLoaded', () => {
    new PDFViewer();
}); 