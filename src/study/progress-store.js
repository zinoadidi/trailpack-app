// Study store: mastery progress, the trail plan, mixer settings and the bite
// history, stored as sync docs. Everything that decides anything lives in the
// pure modules next door (`mastery.js`, `trail.js`, `mixer-settings.js`,
// `session.js`); this file only loads and saves.
//
// Docs:
//   progress / p_<factId>    one mastery doc per fact (see mastery.js)
//   plans    / trail_<packId> the trail for a pack (see trail.js)
//   attempts / <biteId>      one bite's answers (see session.js)
//   settings / mixer         the Session Mixer settings
//   settings / study         `{lastBiteAt, lastDay, typesSeen}` for the mixer history

import { state } from '../app/state.js';
import { normaliseProgress, newProgress } from './mastery.js';
import { normalisePlan } from './trail-normalise.js';
import { defaultSettings } from './mixer-settings.js';

export const PROGRESS = 'progress';
export const PLAN = 'plans';
export const ATTEMPT = 'attempts';
export const SETTINGS = 'settings';
export const MIXER_ID = 'mixer';
export const STUDY_ID = 'study';

export function progressId(factId) {
  return ('p_' + String(factId || 'fact')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

async function readDoc(store, collection, id) {
  if (!store) return null;
  try {
    const row = await store.get('docs', [collection, id]);
    return row && row.doc && !row.deleted ? row.doc : null;
  } catch {
    return null;
  }
}

async function allDocs(store, collection) {
  if (!store || typeof store.getAll !== 'function') return [];
  try {
    const rows = await store.getAll('docs', 'collection', collection);
    return rows.filter((row) => row && row.doc && !row.deleted).map((row) => row.doc);
  } catch {
    return [];
  }
}

async function writeDoc(store, sync, collection, id, doc) {
  if (!store) return doc;
  if (sync && typeof sync.localChange === 'function') {
    try {
      return await sync.localChange(collection, id, doc);
    } catch {
      /* too large or busy: write locally below */
    }
  }
  const existing = await store.get('docs', [collection, id]).catch(() => null);
  await store.put('docs', { collection, id, doc, rev: (existing && existing.rev) ?? null, deleted: 0, updatedAt: Date.now(), dirty: 1 });
  return doc;
}

/** Every progress doc for this pack, keyed by fact id. */
export async function loadProgress(packId = null, store = state.store) {
  const docs = await allDocs(store, PROGRESS);
  const out = {};
  for (const doc of docs) {
    if (packId && doc.packId && doc.packId !== packId) continue;
    const p = normaliseProgress(doc, doc.factId);
    out[p.factId] = p;
  }
  return out;
}

export async function saveProgress(progress, { store = state.store, sync = state.sync } = {}) {
  const doc = { ...progress, updatedAt: Date.now() };
  await writeDoc(store, sync, PROGRESS, progressId(doc.factId), doc);
  return doc;
}

export async function saveProgressMany(list, opts = {}) {
  const out = [];
  for (const progress of list) out.push(await saveProgress(progress, opts));
  return out;
}

/**
 * The progress map for a pack, with a blank doc for every fact that has none.
 * A pack with no progress yet gives every fact a `new` doc, which is what the
 * Trail gate and the readiness score read.
 */
export function withBlank(progress, facts = []) {
  const out = { ...(progress || {}) };
  for (const fact of facts) {
    if (!out[fact.id]) out[fact.id] = newProgress(fact.id, { packId: fact.packId || null });
  }
  return out;
}

// ------------------------------------------------------------------- trail

export async function loadPlan(packId, store = state.store) {
  const doc = await readDoc(store, PLAN, planDocId(packId));
  return normalisePlan(doc, packId);
}

export async function savePlan(trail, { store = state.store, sync = state.sync } = {}) {
  const doc = { ...trail, updatedAt: new Date().toISOString() };
  await writeDoc(store, sync, PLAN, doc.id || planDocId(doc.packId), doc);
  return doc;
}

export function planDocId(packId) {
  return ('trail_' + String(packId || 'pack')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

// ---------------------------------------------------------------- attempts

export async function saveAttempts(doc, { store = state.store, sync = state.sync } = {}) {
  if (!doc || !doc.biteId) return null;
  await writeDoc(store, sync, ATTEMPT, doc.biteId, doc);
  return doc;
}

/** The newest bites first, for the Lens and the Exports feeding. */
export async function loadAttempts({ limit = 100, store = state.store } = {}) {
  const docs = await allDocs(store, ATTEMPT);
  return docs.sort((a, b) => Number(b.endedAt || b.startedAt || 0) - Number(a.startedAt || a.endedAt || 0)).slice(0, limit);
}

// --------------------------------------------------------------- settings

export async function loadMixerSettings(store = state.store) {
  const doc = await readDoc(store, SETTINGS, MIXER_ID);
  return { ...defaultSettings(), ...(doc || {}) };
}

export async function saveMixerSettings(settings, { store = state.store, sync = state.sync } = {}) {
  const doc = { ...settings, updatedAt: new Date().toISOString() };
  await writeDoc(store, sync, SETTINGS, MIXER_ID, doc);
  return doc;
}

export async function loadStudyMeta(store = state.store) {
  const doc = await readDoc(store, SETTINGS, STUDY_ID);
  return { lastBiteAt: null, lastDay: null, typesSeen: [], recentTypes: [], ...(doc || {}) };
}

/** Remember the last bite's types so the next mix prefers what is not stale. */
export async function saveStudyMeta(meta, { store = state.store, sync = state.sync } = {}) {
  const doc = { ...meta, typesSeen: (meta.typesSeen || []).slice(-24) };
  await writeDoc(store, sync, SETTINGS, STUDY_ID, doc);
  return doc;
}
