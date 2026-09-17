// Supabase Client für das Frontend
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.38.4/+esm';

const BUCKET = 'projects';
const REGISTRY_PATH = 'projects-config.json';

// Konfiguration laden
let supabase;
let config;     // Bootstrap: { supabaseUrl, supabaseAnonKey, projects?, defaultProject? }
let registry;   // Dynamische Projekt-Registry aus Supabase: { projects, defaultProject }

// Funktion zum Laden der Konfiguration
async function loadConfig() {
  try {
    // Bootstrap-Konfiguration aus der lokalen projects-config.json (nur supabaseUrl +
    // supabaseAnonKey nötig; ältere Dateien mit projects[] dienen als Fallback).
    const response = await fetch(`./projects-config.json?t=${Date.now()}`);
    config = await response.json();

    // Supabase Client initialisieren
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

    // Zwei Modi:
    // - Single-Project (config.singleProject === true): genau ein fest eingebackenes
    //   Projekt, KEINE Registry, KEIN Umschalter. Für eigenständige Websites pro
    //   Studienauftrag (kein Wechsel zwischen Projekten möglich).
    // - Multi-Project (Standard): Projektliste dynamisch aus Supabase, mit Umschalter.
    if (!config.singleProject) {
      await loadRegistry();
    }

    // Event auslösen, wenn die Konfiguration geladen ist
    window.dispatchEvent(new CustomEvent('supabase-config-loaded'));
  } catch (error) {
    console.error('Fehler beim Laden der Konfiguration:', error);
  }
}

async function loadRegistry() {
  try {
    const url = `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${REGISTRY_PATH}?t=${Date.now()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.projects) && data.projects.length) {
        registry = data;
      }
    }
  } catch (error) {
    console.warn('Registry konnte nicht aus Supabase geladen werden, nutze lokale Konfiguration.', error);
  }
}

// Konfiguration laden
loadConfig();

// Funktion zum Abrufen einer Datei aus dem Storage
async function getFileFromStorage(path) {
  if (!supabase) {
    await new Promise(resolve => {
      window.addEventListener('supabase-config-loaded', resolve, { once: true });
    });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error) {
    console.error('Error downloading file:', error);
    throw error;
  }

  return data;
}

// Funktion zum Abrufen einer JSON-Datei aus dem Storage.
// Lädt über die öffentliche URL mit Cache-Buster, damit nach einer erneuten Verarbeitung
// immer die aktuelle Datei geladen wird (kein veraltetes metadata.json / teams.json).
async function getJsonFromStorage(path) {
  if (!config) {
    await new Promise(resolve => {
      window.addEventListener('supabase-config-loaded', resolve, { once: true });
    });
  }

  const url = `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fehler beim Laden von ${path}: ${res.status}`);
  }
  return res.json();
}

// Funktion zum Abrufen einer Bild-URL aus dem Storage
function getImageUrl(path) {
  if (!supabase) {
    console.error('Supabase client not initialized');
    return '';
  }

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

// Liefert alle bekannten Projekte. Im Single-Project-Modus ausschließlich das fixierte
// Projekt aus der lokalen Config; sonst die Registry aus Supabase (Fallback: lokale Liste).
function getProjects() {
  if (config && config.singleProject && config.projects) return config.projects;
  if (registry && registry.projects) return registry.projects;
  if (config && config.projects) return config.projects;
  return [];
}

// Liefert die Standard-Projekt-ID.
function getDefaultProjectId() {
  if (registry && registry.defaultProject) return registry.defaultProject;
  if (config && config.defaultProject) return config.defaultProject;
  const projects = getProjects();
  return projects.length ? projects[0].id : null;
}

// Funktion zum Abrufen des aktuellen Projekts (berücksichtigt ?project=<id> in der URL)
function getCurrentProject() {
  const projects = getProjects();
  if (!projects.length) {
    console.error('Keine Projekte in der Konfiguration gefunden');
    return null;
  }

  const requested = new URLSearchParams(window.location.search).get('project');
  const targetId = requested || getDefaultProjectId();

  return projects.find(project => project.id === targetId) || projects[0];
}

export {
  supabase,
  getFileFromStorage,
  getJsonFromStorage,
  getImageUrl,
  getCurrentProject,
  getProjects,
};
