// Persistence for registered people and settings (browser localStorage).
const PEOPLE_KEY = 'facecog.people.v1';
const SETTINGS_KEY = 'facecog.settings.v1';
const DESCRIPTOR_LENGTH = 128;

export const DEFAULT_SETTINGS = { detector: 'tiny', threshold: 0.5 };

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function isValidPerson(p) {
  return (
    p &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    p.name.trim() !== '' &&
    Array.isArray(p.descriptors) &&
    p.descriptors.every(
      (d) => Array.isArray(d) && d.length === DESCRIPTOR_LENGTH && d.every((v) => typeof v === 'number'),
    )
  );
}

function normalizePerson(p) {
  return {
    id: p.id,
    name: p.name.trim(),
    descriptors: p.descriptors,
    thumb: typeof p.thumb === 'string' && p.thumb.startsWith('data:image/') ? p.thumb : '',
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
  };
}

export function loadPeople() {
  const data = readJSON(PEOPLE_KEY, []);
  return Array.isArray(data) ? data.filter(isValidPerson).map(normalizePerson) : [];
}

/** Throws if storage is full or unavailable, so callers can tell the user. */
export function savePeople(people) {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
}

export function loadSettings() {
  const s = readJSON(SETTINGS_KEY, {});
  return {
    detector: s.detector === 'ssd' ? 'ssd' : 'tiny',
    threshold: Number.isFinite(s.threshold) ? s.threshold : DEFAULT_SETTINGS.threshold,
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function exportPeople(people) {
  return JSON.stringify({ app: 'facecog', version: 1, exportedAt: new Date().toISOString(), people }, null, 2);
}

/** Parses an export file; returns the valid people it contains. */
export function parseImport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.people;
  if (!Array.isArray(list)) throw new Error('Format file tidak dikenali');
  return list.filter(isValidPerson).map(normalizePerson);
}
