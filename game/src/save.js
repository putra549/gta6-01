// The save file: one JSON record in localStorage holding cash, story progress and
// where Reyes was standing. Saving happens on mission completion, on pause and every
// few seconds of play; Continue on the title screen reads it back. Storage failures
// (private mode, quota) are swallowed — the game simply runs unsaved.

import { SAVE_KEY } from './config.js';

/** Write the save record; returns true when it landed. */
export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, ...data }));
    return true;
  } catch {
    return false;
  }
}

/** Read the save record, or null when there is none worth loading. */
export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || typeof data.cash !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

/** True when a loadable save exists (drives the Continue button). */
export function hasSave() {
  return readSave() !== null;
}

/** Forget the save (Start New Game). */
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to forget */
  }
}
