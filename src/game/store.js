// IndexedDB plumbing for the game profile and Lenses. Everything here is thin:
// the real logic lives in the pure modules next door, this only loads docs,
// saves them and queues the change with the sync engine (`localChange`).
//
// Docs:
//   settings / game-profile   the game profile (see profile.js)
//   lenses   / <lensId>       one Lens per id (see lens.js)

import { emptyProfile, mergeProfiles, normaliseProfile } from './profile.js';
import { normaliseLens } from './lens.js';
import { state } from '../app/state.js';

export const PROFILE_COLLECTION = 'settings';
export const PROFILE_ID = 'game-profile';
export const LENS_COLLECTION = 'lenses';
export const LENS_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function loadDoc(store, collection, id) {
  try {
    const row = await store.get('docs', [collection, id]);
    return row && row.doc ? row.doc : null;
  } catch {
    return null;
  }
}

/** The game profile: local copy, else an empty one. Never throws. */
export async function loadProfile(store) {
  if (!store) return emptyProfile();
  return normaliseProfile(await loadDoc(store, PROFILE_COLLECTION, PROFILE_ID));
}

/** Save locally and queue for sync when both store and engine are there. */
export async function saveProfile(store, sync, profile) {
  const doc = normaliseProfile(profile);
  if (!store) return doc;
  const existing = await store.get('docs', [PROFILE_COLLECTION, PROFILE_ID]);
  const record = { collection: PROFILE_COLLECTION, id: PROFILE_ID, doc, rev: (existing && existing.rev) ?? null, updatedAt: new Date().toISOString() };
  if (sync && typeof sync.localChange === 'function') {
    // localChange writes the same record shape and queues the outbox entry.
    try {
      return await sync.localChange(PROFILE_COLLECTION, PROFILE_ID, doc);
    } catch {
      /* fall through to a plain local write */
    }
  }
  await store.put('docs', record);
  return record;
}

/** Merge a copy pulled from the server into the local one. */
export async function mergeRemoteProfile(store, remote, prefer = 'right') {
  const local = await loadProfile(store);
  return mergeProfiles(local, normaliseProfile(remote), prefer);
}

/** Every saved Lens. A missing store is an empty list. */
export async function loadLenses(store) {
  if (!store || typeof store.getAll !== 'function') return [];
  try {
    const rows = await store.getAll('docs', 'collection', LENS_COLLECTION);
    return rows.filter((row) => row && row.doc && !row.deleted).map((row) => normaliseLens(row.doc));
  } catch {
    return [];
  }
}

/** Save a Lens. The id is kept safe so it is a valid sync id. */
export async function saveLens(store, sync, lens) {
  const doc = normaliseLens(lens);
  if (!LENS_ID.test(doc.id)) doc.id = 'default';
  if (!store) return doc;
  const existing = await store.get('docs', [LENS_COLLECTION, doc.id]);
  const record = { collection: LENS_COLLECTION, id: doc.id, doc, rev: (existing && existing.rev) ?? null, updatedAt: new Date().toISOString() };
  if (sync && typeof sync.localChange === 'function') {
    try {
      return await sync.localChange(LENS_COLLECTION, doc.id, doc);
    } catch {
      /* fall through to a plain local write */
    }
  }
  await store.put('docs', record);
  return doc;
}

/** The Lens in use: the preferred one when it exists, else the first saved. */
export function pickActiveLens(lenses = [], preferredId) {
  const list = (lenses || []).map((lens) => normaliseLens(lens));
  if (!list.length) return null;
  return list.find((lens) => lens.id === preferredId) || list[0];
}

// The chosen Lens is a device + account preference, and it is also kept on
// `state` so a screen that is already drawn agrees with the next one.
export const ACTIVE_LENS_META = 'active-lens';

/** Remember which Lens the user chose. `null` goes back to the first saved. */
export async function setActiveLens(store, lensId, { sync = null } = {}) {
  const id = lensId ? String(lensId) : null;
  if (typeof state !== 'undefined' && state) state.activeLensId = id;
  if (!store) return id;
  try {
    await store.put('meta', { key: ACTIVE_LENS_META, value: id });
  } catch {
    /* a device without a working meta store still keeps the choice in state */
  }
  void sync;
  return id;
}

/**
 * Load the active Lens for a screen. Prefers the saved choice, then the Lens
 * on `state`, then the first saved Lens, then the default.
 * Returns `{lens, id, lenses}` so the picker can list the others.
 */
export async function loadActiveLens(store, { fallback = null } = {}) {
  let lenses = [];
  try {
    lenses = await loadLenses(store);
  } catch {
    lenses = [];
  }
  let saved = null;
  try {
    const row = store ? await store.get('meta', ACTIVE_LENS_META) : null;
    saved = (row && row.value) || null;
  } catch {
    saved = null;
  }
  const preferred = saved || (typeof state !== 'undefined' && state && state.activeLensId) || null;
  const chosen = pickActiveLens(lenses, preferred) || (typeof state !== 'undefined' && state && state.activeLens ? normaliseLens(state.activeLens) : null) || fallback;
  const lens = chosen ? normaliseLens(chosen) : null;
  if (typeof state !== 'undefined' && state && lens) state.activeLens = lens;  return { lens, id: lens ? lens.id : preferred, lenses };
}
