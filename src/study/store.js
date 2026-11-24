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
import { prepareAdditionPublish } from './additions.js';
import { prepareReplacement } from './replacement.js';

export const PACK = 'packs';
export const TOPIC = 'topics';
export const FACT = 'facts';

const replacementKey = (id) => 'replacement-' + id;
const replacementId = (prefix) => prefix + '_' + globalThis.crypto.randomUUID().replaceAll('-', '');
const stableJSON = (value) => JSON.stringify(value, function (_key, item) {
  return item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});

export async function loadReplacement(oldPackId, store = state.store) {
  return (await store.get('meta', replacementKey(oldPackId)))?.value || null;
}

export async function listReplacementOffers(store = state.store) {
  if (!store) return [];
  return (await store.getAll('meta')).filter((row) => row.key?.startsWith('replacement-') && row.value?.state === 'complete' && row.value.choice === 'pending').map((row) => row.value);
}

export async function keepBothReplacement(oldPackId, store = state.store) {
  return Boolean(store && await store.keepReplacement(oldPackId));
}

// Unlike the general store helpers, publication must never swallow I/O errors.
async function strictRows(store, collection) {
  return (await store.getAll('docs', 'collection', collection))
    .filter((row) => row && row.doc && !row.deleted).map((row) => row.doc);
}

async function strictReplacementWrite(store, sync, collection, id, doc) {
  const existing = await store.get('docs', [collection, id]);
  if (existing && (existing.deleted || stableJSON(existing.doc) !== stableJSON(doc))) throw new Error('replacement_id_conflict');
  if (existing && (!existing.dirty || await store.get('outbox', [collection, id]))) return;
  if (sync && typeof sync.localChange === 'function') {
    await sync.localChange(collection, id, doc);
  } else {
    if (!existing) await store.put('docs', { collection, id, doc, rev: null, baseRev: null, deleted: 0, updatedAt: Date.now(), dirty: 1 });
    await store.put('outbox', { collection, id, queuedAt: Date.now() });
  }
}

/** Journal first, then create independent docs; retry uses the same snapshot. */
export async function publishReplacementDraft(draft, { store = state.store, sync = state.sync } = {}) {
  const oldId = draft?.pack?.id;
  if (!store || !oldId || typeof store.getOrCreateMeta !== 'function') return { ok: false, reason: 'invalid_draft' };
  try {
    let journal = await loadReplacement(oldId, store);
    if (!journal) {
      const packRow = await store.get('docs', [PACK, oldId]);
      const live = {
        pack: packRow && !packRow.deleted ? packRow.doc : null,
        topics: (await strictRows(store, TOPIC)).filter((doc) => doc.packId === oldId),
        facts: (await strictRows(store, FACT)).filter((doc) => doc.packId === oldId),
      };
      const factIds = new Set(live.facts.map((fact) => fact.id));
      const progress = Object.fromEntries((await strictRows(store, PROGRESS)).filter((doc) => factIds.has(doc.factId)).map((doc) => [doc.factId, doc]));
      const attempts = await strictRows(store, ATTEMPT);
      const idMap = (items, prefix) => Object.fromEntries(items.map((id) => [id, replacementId(prefix)]));
      const ids = {
        packId: replacementId('pack'), createdAt: new Date().toISOString(),
        topicIds: idMap([...live.topics, ...draft.topics].map((item) => item.id), 'topic'),
        factIds: idMap([...live.facts, ...draft.facts].map((item) => item.id), 'fact'),
        attemptIds: idMap(attempts.map((item) => item.biteId), 'bite'),
      };
      const prepared = prepareReplacement({ draft, live, progress, attempts, ids });
      if (!prepared.ok) return prepared;
      journal = await store.getOrCreateMeta(replacementKey(oldId), {
        oldPackId: oldId, packId: ids.packId, ids, prepared, draft: structuredClone(draft), state: 'creating', choice: 'pending',
      });
    }
    if (stableJSON(journal.draft) !== stableJSON(draft)) return { ok: false, reason: 'draft_changed' };
    if (journal.state === 'complete') return { ok: true, packId: journal.packId };
    const data = journal.prepared;
    const groups = [
      [TOPIC, data.topics, (doc) => doc.id], [FACT, data.facts, (doc) => doc.id],
      [PROGRESS, data.progress, (doc) => progressId(doc.factId)], [ATTEMPT, data.attempts, (doc) => doc.biteId],
      [PACK, [data.pack], (doc) => doc.id],
    ];
    for (const [collection, docs, idOf] of groups) {
      for (const doc of docs) await strictReplacementWrite(store, sync, collection, idOf(doc), doc);
    }
    if (!await store.finalizeReplacementDraft(oldId, journal.draft, journal)) return { ok: false, reason: 'draft_changed' };
    return { ok: true, packId: journal.packId };
  } catch (error) {
    return { ok: false, reason: error.message === 'replacement_id_conflict' ? 'conflict' : 'write_failed' };
  }
}

const sortBy = (items, key) => [...items].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

async function inspectReplacementDeletion(oldId, store, sync) {
  const journal = await loadReplacement(oldId, store);
  if (!journal || journal.state !== 'complete' || journal.choice === 'deleted') return { ok: false, reason: 'unavailable' };
  if (sync) {
    if (typeof sync.sync !== 'function') return { ok: false, reason: 'sync_unavailable' };
    const result = await sync.sync();
    if (result?.status !== 'synced' || result.pullComplete !== true || result.pushed?.conflicts || result.pushed?.failed) return { ok: false, reason: 'sync_incomplete' };
  }
  const docs = await store.getAll('docs');
  const outbox = await store.getAll('outbox');
  const rows = docs.filter((row) => row && row.doc && !row.deleted);
  const byKey = new Map(rows.map((row) => [row.collection + '\u0000' + row.id, row]));
  const data = journal.prepared;
  const expected = [
    [PACK, [data.pack], (doc) => doc.id], [TOPIC, data.topics, (doc) => doc.id],
    [FACT, data.facts, (doc) => doc.id], [PROGRESS, data.progress, (doc) => progressId(doc.factId)],
    [ATTEMPT, data.attempts, (doc) => doc.biteId],
  ];
  const relevant = new Set();
  for (const [collection, entries, idOf] of expected) {
    for (const doc of entries) {
      const key = collection + '\u0000' + idOf(doc);
      const row = byKey.get(key);
      relevant.add(key);
      if (!row || stableJSON(row.doc) !== stableJSON(doc)) return { ok: false, reason: 'replacement_changed' };
    }
  }
  const baseline = data.originalBaseline;
  const originalPack = byKey.get(PACK + '\u0000' + oldId)?.doc;
  const topics = rows.filter((row) => row.collection === TOPIC && row.doc.packId === oldId).map((row) => row.doc);
  const facts = rows.filter((row) => row.collection === FACT && row.doc.packId === oldId).map((row) => row.doc);
  const originalFactIds = new Set(baseline.facts.map((fact) => fact.id));
  const progress = rows.filter((row) => row.collection === PROGRESS && originalFactIds.has(row.doc.factId));
  const progressMap = Object.fromEntries(progress.map((row) => [row.doc.factId, row.doc]));
  const attempts = rows.filter((row) => row.collection === ATTEMPT)
    .map((row) => ({ ...row.doc, rows: (row.doc.rows || []).filter((item) => originalFactIds.has(item?.factId)) }))
    .filter((doc) => doc.rows.length);
  if (stableJSON(originalPack) !== stableJSON(baseline.pack) ||
      stableJSON(sortBy(topics, 'id')) !== stableJSON(sortBy(baseline.topics, 'id')) ||
      stableJSON(sortBy(facts, 'id')) !== stableJSON(sortBy(baseline.facts, 'id')) ||
      stableJSON(progressMap) !== stableJSON(baseline.progress) ||
      stableJSON(sortBy(attempts, 'biteId')) !== stableJSON(sortBy(baseline.attempts, 'biteId'))) {
    return { ok: false, reason: 'original_changed' };
  }
  const targets = [
    ...topics.map((doc) => [TOPIC, doc.id]), ...facts.map((doc) => [FACT, doc.id]),
    ...progress.map((row) => [PROGRESS, row.id]), [PACK, oldId],
  ];
  for (const [collection, id] of targets) relevant.add(collection + '\u0000' + id);
  for (const attempt of attempts) relevant.add(ATTEMPT + '\u0000' + attempt.biteId);
  if (sync && (outbox.some((row) => relevant.has(row.collection + '\u0000' + row.id)) ||
      [...relevant].some((key) => { const row = byKey.get(key); return !row || row.dirty || row.rev == null; }))) {
    return { ok: false, reason: 'sync_incomplete' };
  }
  return { ok: true, replacementId: journal.packId, journal, docs, outbox, targets };
}

export async function replacementDeletionStatus(oldPackId, { store = state.store, sync = state.sync } = {}) {
  if (!store) return { ok: false, reason: 'unavailable' };
  try {
    const result = await inspectReplacementDeletion(oldPackId, store, sync);
    return result.ok ? { ok: true, replacementId: result.replacementId } : result;
  } catch {
    return { ok: false, reason: 'check_failed' };
  }
}

/** Call only after explicit confirmation; all local tombstones commit together. */
export async function deleteReplacedPack(oldPackId, { store = state.store, sync = state.sync } = {}) {
  if (!store || typeof store.commitReplacementDeletion !== 'function') return { ok: false, reason: 'unavailable' };
  try {
    const result = await inspectReplacementDeletion(oldPackId, store, sync);
    if (!result.ok) return result;
    const committed = await store.commitReplacementDeletion(result.journal, result.docs, result.outbox, result.targets);
    return committed ? { ok: true } : { ok: false, reason: 'changed_during_deletion' };
  } catch {
    return { ok: false, reason: 'delete_failed' };
  }
}

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

/** Publish only additions; a failed or conflicting attempt keeps the draft. */
export async function publishAdditionDraft(draft, { store = state.store, sync = state.sync } = {}) {
  if (!store || !draft?.pack?.id) return { ok: false, reason: 'invalid_draft' };
  try {
    const live = await loadPackBundle(draft.pack.id, store);
    const prepared = prepareAdditionPublish({ draft, live });
    if (!prepared.ok) return { ok: false, reason: prepared.reason };
    // IDs are global within a collection, not merely within a Pack.
    for (const [collection, docs] of [[TOPIC, prepared.topics], [FACT, prepared.facts]]) {
      for (const doc of docs) {
        if (await store.get('docs', [collection, doc.id])) return { ok: false, reason: 'conflict' };
      }
    }
    // Persist the exact retry input before the first potentially visible write.
    // Documents and outbox entries are separate writes and cannot be rolled back
    // safely after another device has synced them.
    if (!draft.additionBase.publicationStarted) {
      const additionBase = { ...draft.additionBase, publicationStarted: true };
      await saveDraft({ ...draft, additionBase }, { store });
      draft.additionBase.publicationStarted = true;
    }
    if (sync && typeof sync.localChange === 'function') {
      // A prior outbox write may have failed after its document was saved.
      for (const [collection, docs] of [[TOPIC, prepared.retryTopics], [FACT, prepared.retryFacts]]) {
        for (const doc of docs) {
          const row = await store.get('docs', [collection, doc.id]);
          if (row?.dirty && !(await store.get('outbox', [collection, doc.id]))) await sync.localChange(collection, doc.id, doc);
        }
      }
      for (const topic of prepared.topics) await sync.localChange(TOPIC, topic.id, topic);
      for (const fact of prepared.facts) await sync.localChange(FACT, fact.id, fact);
      await sync.localChange(PACK, prepared.pack.id, { ...prepared.pack, updatedAt: new Date().toISOString() });
    } else {
      for (const topic of prepared.topics) await saveTopic(topic, { store, sync: null });
      for (const fact of prepared.facts) await saveFact(fact, { store, sync: null });
      await savePack(prepared.pack, { store, sync: null });
    }
    await clearDraft(draft.pack.id, { store });
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'storage_error' };
  }
}
