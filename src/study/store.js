// Pack store: the IndexedDB plumbing for the Library. Everything that decides
// what to store lives in the pure modules next door (`library.js`, `pack.js`);
// this file only reads and writes docs and queues them with the sync engine.
//
// Docs:
//   packs   / <packId>      the Pack (sources, status, review)
//   topics  / <topicId>     one topic per doc
//   facts   / <factId>      one fact per doc (variants live inside it)
//   meta    / active-pack   {id} of the pack the Trail is studying
//   meta    / review-<id>   the draft being reviewed (topics, facts, edits)
//
// Source text is not a doc: it lives in the `files` store and on the server
// through `/sync/files`, so a big document never pushes a doc over 1 MB.

import { state } from '../app/state.js';
import { deletionPlan } from './hygiene.js';
import { PROGRESS, ATTEMPT, progressId } from './progress-store.js';

export const PACK = 'packs';
export const TOPIC = 'topics';
export const FACT = 'facts';

async function loadDoc(store, collection, id) {
  try {
    const row = await store.get('docs', [collection, id]);
    return row && row.doc && !row.deleted ? row.doc : null;
  } catch {
    return null;
  }
}

async function allDocs(store, collection) {
  if (!store) return [];
  try {
    const rows = await store.getAll('docs', 'collection', collection);
    return rows.filter((row) => row && row.doc && !row.deleted).map((row) => row.doc);
  } catch {
    return [];
  }
}

async function putDoc(store, sync, collection, id, doc) {
  if (!store) return doc;
  if (sync && typeof sync.localChange === 'function') {
    try {
      await sync.localChange(collection, id, doc);
      return doc;
    } catch {
      /* doc too large or engine busy: write locally below */
    }
  }
  const existing = await store.get('docs', [collection, id]);
  await store.put('docs', { collection, id, doc, rev: (existing && existing.rev) ?? null, deleted: 0, updatedAt: Date.now(), dirty: 1 });
  return doc;
}

async function removeDoc(store, sync, collection, id) {
  if (!store) return;
  if (sync && typeof sync.localChange === 'function') {
    try {
      await sync.localChange(collection, id, null);
      return;
    } catch {
      /* fall through */
    }
  }
  await store.delete('docs', [collection, id]);
}

/** Every Pack, newest first. */
export async function listPacks(store = state.store) {
  const packs = await allDocs(store, PACK);
  if (store) {
    const known = new Set(packs.map((pack) => pack.id));
    const rows = await store.getAll('meta');
    for (const row of rows) {
      const pack = row.value?.pack;
      if (pack?.id && pack.status === 'draft' && row.key === 'draft-' + pack.id && !known.has(pack.id)) {
        packs.push(pack);
        known.add(pack.id);
      }
    }
  }
  return packs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function loadPack(store, id) {
  return loadDoc(store || state.store, PACK, id);
}

export async function savePack(pack, { store = state.store, sync = state.sync } = {}) {
  const doc = { ...pack, updatedAt: new Date().toISOString() };
  await putDoc(store, sync, PACK, doc.id, doc);
  return doc;
}

export async function deletePackDocs(packId, { store = state.store, sync = state.sync } = {}) {
  const topics = await loadTopics(store, packId);
  const facts = await loadFacts(store, packId);
  await deleteFactDocs(facts.map((fact) => fact.id), { store, sync, allFacts: facts, skipAttempts: true });
  for (const topic of topics) await removeDoc(store, sync, TOPIC, topic.id);
  await removeDoc(store, sync, PACK, packId);
  const active = await activePackId(store);
  if (active === packId) await setActivePack(null, { store });
  const draft = await loadDraft(store, packId);
  if (draft) await clearDraft(packId, { store });
}

export async function loadTopics(store, packId) {
  const topics = (await allDocs(store || state.store, TOPIC)).filter((topic) => topic.packId === packId);
  return topics.sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function loadFacts(store, packId) {
  return (await allDocs(store || state.store, FACT)).filter((fact) => fact.packId === packId);
}

export async function saveTopic(topic, { store = state.store, sync = state.sync } = {}) {
  return putDoc(store, sync, TOPIC, topic.id, topic);
}

export async function saveFact(fact, { store = state.store, sync = state.sync } = {}) {
  return putDoc(store, sync, FACT, fact.id, fact);
}

export async function deleteTopicDocs(ids, { store = state.store, sync = state.sync } = {}) {
  for (const id of ids) await removeDoc(store, sync, TOPIC, id);
}

/**
 * Delete facts and every row that belongs to them: their mastery progress and
 * the fact's answers inside attempt documents (an attempt that only held this
 * fact goes away too). No orphans are left behind.
 */
export async function deleteFactDocs(ids, { store = state.store, sync = state.sync, allFacts = null, skipAttempts = false } = {}) {
  const list = (ids || []).filter(Boolean);
  if (!list.length || !store) return { facts: [], progress: [], attempts: 0 };
  const known = allFacts || (await allDocs(store, FACT));
  const attempts = skipAttempts ? [] : await allDocs(store, ATTEMPT);
  const removedProgress = [];
  let attemptsTouched = 0;
  for (const factId of list) {
    const plan = deletionPlan({ factId, allFacts: known, attempts });
    for (const progressRow of plan.progressIds) {
      await removeDoc(store, sync, PROGRESS, progressRow);
      removedProgress.push(progressRow);
    }
    for (const update of plan.attemptsUpdate) {
      const original = attempts.find((doc) => doc.biteId === update.id);
      if (original) await putDoc(store, sync, ATTEMPT, update.id, { ...original, rows: update.rows });
      attemptsTouched += 1;
    }
    for (const biteId of plan.attemptsDelete) {
      await removeDoc(store, sync, ATTEMPT, biteId);
      attemptsTouched += 1;
    }
    await removeDoc(store, sync, FACT, factId);
  }
  return { facts: list, progress: removedProgress, attempts: attemptsTouched };
}

/** Remove progress rows whose fact is gone (tombstones are skipped by removeDoc). */
export async function pruneOrphans({ store = state.store, sync = state.sync } = {}) {
  if (!store) return { removed: 0 };
  const known = new Set((await allDocs(store, FACT)).map((fact) => fact.id));
  let removed = 0;
  for (const doc of await allDocs(store, PROGRESS)) {
    if (doc && doc.factId && !known.has(doc.factId)) {
      await removeDoc(store, sync, PROGRESS, progressId(doc.factId));
      removed += 1;
    }
  }
  return { removed };
}

/** The whole pack as one plain object: what the study engine and exports take. */
export async function loadPackBundle(packId, store = state.store) {
  const pack = await loadPack(store, packId);
  if (!pack) return null;
  const [topics, facts] = await Promise.all([loadTopics(store, packId), loadFacts(store, packId)]);
  return { pack, topics, facts };
}

// ------------------------------------------------------------- active pack

export async function activePackId(store = state.store) {
  if (!store) return null;
  try {
    const row = await store.get('meta', 'active-pack-id');
    return (row && row.value) || null;
  } catch {
    return null;
  }
}

/** Set the pack the Trail studies. `null` clears it. This is a device choice. */
export async function setActivePack(packId, { store = state.store } = {}) {
  if (!store) return;
  await store.put('meta', { key: 'active-pack-id', value: packId || null });
}

/** The active pack, or the newest frozen one when nothing is chosen yet. */
export async function resolveActivePack(store = state.store) {
  const chosen = await activePackId(store);
  if (chosen) {
    const bundle = await loadPackBundle(chosen, store);
    if (bundle) return bundle;
  }
  const frozen = (await listPacks(store)).filter((pack) => pack.status === 'frozen');
  if (!frozen.length) return null;
  return loadPackBundle(frozen[0].id, store);
}

// ------------------------------------------------------------- review draft

/**
 * The draft under review. Stored in `meta` because it is temporary and must
 * not sync as a Pack before the human approves it (SPEC M2: freeze is the save).
 */
export async function loadDraft(store, packId) {
  if (!store) return null;
  try {
    const row = await store.get('meta', 'draft-' + packId);
    return (row && row.value) || null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft, { store = state.store } = {}) {
  if (!store) return draft;
  await store.put('meta', { key: 'draft-' + draft.pack.id, value: draft });
  return draft;
}

export async function clearDraft(packId, { store = state.store } = {}) {
  if (!store) return;
  await store.delete('meta', 'draft-' + packId);
}
