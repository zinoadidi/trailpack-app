import test from 'node:test';
import assert from 'node:assert/strict';
import { beginAdditionDraft } from '../src/study/additions.js';
import { prepareReplacement } from '../src/study/replacement.js';
import { MemoryStore } from '../src/store/idb.js';
import { savePack, saveTopic, saveFact, saveDraft, setActivePack, activePackId, loadPackBundle, loadDraft, publishReplacementDraft, loadReplacement, replacementDeletionStatus, deleteReplacedPack } from '../src/study/store.js';
import { saveProgress, saveAttempts } from '../src/study/progress-store.js';
import { createSyncEngine } from '../src/sync/engine.js';

function fixture() {
  const live = {
    pack: { id: 'p', title: 'Pack', status: 'frozen', sources: [{ id: 's', name: 'Old' }] },
    topics: [{ id: 't', packId: 'p', title: 'Topic' }],
    facts: [{ id: 'f', packId: 'p', topicId: 't', statement: 'Original fact', variants: [{ id: 'v', prompt: 'Why?' }] }],
  };
  const draft = beginAdditionDraft(live);
  draft.pack.sources.push({ id: 's2', name: 'New' });
  draft.facts.push({ id: 'f2', packId: 'p', topicId: 't', statement: 'New fact', variants: [] });
  return {
    draft, live,
    progress: { f: { factId: 'f', packId: 'p', state: 'mastered', streak: 4 } },
    attempts: [{ biteId: 'a', rows: [{ factId: 'f', correct: true }, { factId: 'other', correct: false }] }],
    ids: { packId: 'p2', topicIds: { t: 'copy-t' }, factIds: { f: 'copy-f', f2: 'copy-f2' }, attemptIds: { a: 'copy-a' }, createdAt: '2026-11-24T00:00:00.000Z' },
  };
}

test('replacement excludes removed original facts without losing the deletion baseline', () => {
  const input = fixture();
  input.draft.facts = input.draft.facts.filter((fact) => fact.id !== 'f');
  const result = prepareReplacement(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.facts.map((fact) => fact.statement), ['New fact']);
  assert.deepEqual(result.attempts, []);
  assert.equal(result.originalBaseline.attempts[0].rows[0].factId, 'f');
  assert.equal(input.live.facts[0].statement, 'Original fact');
});

test('editing an original fact starts fresh progress and does not copy its old attempts', () => {
  const input = fixture();
  input.draft.facts[0] = { ...input.draft.facts[0], statement: 'Corrected fact', variants: [] };
  const result = prepareReplacement(input);
  assert.equal(result.ok, true);
  assert.equal(result.facts.find((fact) => fact.id === 'copy-f').statement, 'Corrected fact');
  assert.notEqual(result.progress.find((row) => row.factId === 'copy-f').state, 'mastered');
  assert.deepEqual(result.attempts, []);
  assert.equal(result.originalBaseline.attempts[0].rows[0].factId, 'f');
  assert.equal(input.live.facts[0].statement, 'Original fact');
});

async function storedFixture() {
  const input = fixture();
  const store = new MemoryStore();
  await savePack(input.live.pack, { store, sync: null });
  await saveTopic(input.live.topics[0], { store, sync: null });
  await saveFact(input.live.facts[0], { store, sync: null });
  await saveProgress(input.progress.f, { store, sync: null });
  await saveAttempts(input.attempts[0], { store, sync: null });
  await saveDraft(input.draft, { store });
  await setActivePack('p', { store });
  return { ...input, store };
}

async function completedFixture() {
  const input = await storedFixture();
  const result = await publishReplacementDraft(input.draft, { store: input.store, sync: null });
  assert.equal(result.ok, true);
  return { ...input, replacementId: result.packId };
}

test('removed fact history remains part of the original deletion safety check', async () => {
  const { store, draft } = await storedFixture();
  draft.facts = draft.facts.filter((fact) => fact.id !== 'f');
  await saveDraft(draft, { store });
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  assert.equal((await replacementDeletionStatus('p', { store, sync: null })).ok, true);
  await saveAttempts({ biteId: 'a', rows: [{ factId: 'f', correct: false }] }, { store, sync: null });
  assert.equal((await replacementDeletionStatus('p', { store, sync: null })).ok, false);
  assert.ok(await loadPackBundle('p', store));
});

test('local-only replacement is eligible for deletion when both snapshots are intact', async () => {
  const { store, replacementId } = await completedFixture();
  assert.deepEqual(await replacementDeletionStatus('p', { store, sync: null }), { ok: true, replacementId });
  assert.ok(await loadPackBundle('p', store));
});

for (const status of ['offline', 'error']) {
  test(`${status} sync blocks deletion without modifying either Pack`, async () => {
    const { store, replacementId } = await completedFixture();
    const sync = { sync: async () => ({ status }) };
    assert.equal((await replacementDeletionStatus('p', { store, sync })).ok, false);
    assert.equal((await deleteReplacedPack('p', { store, sync })).ok, false);
    assert.ok(await loadPackBundle('p', store));
    assert.ok(await loadPackBundle(replacementId, store));
  });
}

test('a synced result with queued replacement docs does not permit deletion', async () => {
  const { store } = await completedFixture();
  const sync = { sync: async () => ({ status: 'synced', pushed: { conflicts: 0 } }) };
  assert.equal((await replacementDeletionStatus('p', { store, sync })).ok, false);
  assert.ok(await loadPackBundle('p', store));
});

test('an incomplete server pull blocks deletion even after outbox entries disappear', async () => {
  const { store } = await completedFixture();
  const sync = { sync: async () => { await store.clear('outbox'); return { status: 'synced', pullComplete: false }; } };
  assert.equal((await replacementDeletionStatus('p', { store, sync })).ok, false);
  assert.ok(await loadPackBundle('p', store));
});

test('a dirty replacement document missing its outbox entry blocks deletion', async () => {
  const { store } = await completedFixture();
  const sync = { sync: async () => { await store.clear('outbox'); return { status: 'synced', pullComplete: true }; } };
  assert.equal((await replacementDeletionStatus('p', { store, sync })).ok, false);
  assert.ok(await loadPackBundle('p', store));
});

for (const [name, mutate] of [
  ['original pack', async (store) => { const row = await store.get('docs', ['packs', 'p']); row.doc.title = 'Changed'; await store.put('docs', row); }],
  ['original fact', async (store) => { const row = await store.get('docs', ['facts', 'f']); row.doc.statement = 'Changed'; await store.put('docs', row); }],
  ['original progress', async (store) => { await saveProgress({ factId: 'f', packId: 'p', state: 'learning' }, { store, sync: null }); }],
  ['original attempt', async (store) => { await saveAttempts({ biteId: 'a', rows: [{ factId: 'f', correct: false }] }, { store, sync: null }); }],
  ['replacement fact', async (store, id) => { const fact = (await loadPackBundle(id, store)).facts[0]; await store.delete('docs', ['facts', fact.id]); }],
]) {
  test(`changed or missing ${name} blocks deletion`, async () => {
    const { store, replacementId } = await completedFixture();
    await mutate(store, replacementId);
    assert.equal((await replacementDeletionStatus('p', { store, sync: null })).ok, false);
    assert.equal((await deleteReplacedPack('p', { store, sync: null })).ok, false);
    assert.ok(await loadPackBundle('p', store));
  });
}

test('confirmed deletion removes old docs and progress but keeps replacement, history and shared files', async () => {
  const { store, replacementId } = await completedFixture();
  await store.put('files', { id: 's', blob: 'shared' });
  assert.equal((await deleteReplacedPack('p', { store, sync: null })).ok, true);
  assert.equal(await loadPackBundle('p', store), null);
  assert.ok(await loadPackBundle(replacementId, store));
  assert.equal((await store.get('docs', ['progress', 'p_f'])).deleted, 1);
  assert.ok((await store.get('docs', ['attempts', 'a'])).doc);
  assert.ok(await store.get('files', 's'));
  assert.equal(await activePackId(store), replacementId);
});

test('failed deletion transaction leaves original intact and can be retried', async () => {
  const { store } = await completedFixture();
  const commit = store.commitReplacementDeletion?.bind(store);
  let failed = false;
  store.commitReplacementDeletion = async (...args) => {
    if (!failed) { failed = true; throw new Error('injected transaction failure'); }
    return commit(...args);
  };
  assert.equal((await deleteReplacedPack('p', { store, sync: null })).ok, false);
  assert.ok(await loadPackBundle('p', store));
  assert.equal((await store.get('docs', ['progress', 'p_f'])).deleted, 0);
  assert.equal((await deleteReplacedPack('p', { store, sync: null })).ok, true);
});

test('an original changed immediately before deletion is not deleted', async () => {
  const { store } = await completedFixture();
  const commit = store.commitReplacementDeletion?.bind(store);
  store.commitReplacementDeletion = async (...args) => {
    await saveProgress({ factId: 'f', packId: 'p', state: 'learning' }, { store, sync: null });
    return commit(...args);
  };
  assert.equal((await deleteReplacedPack('p', { store, sync: null })).ok, false);
  assert.ok(await loadPackBundle('p', store));
  assert.equal((await store.get('docs', ['progress', 'p_f'])).doc.state, 'learning');
});

test('offline creation leaves original usable and activates a complete independent snapshot', async () => {
  const { store, draft } = await storedFixture();
  const original = await loadPackBundle('p', store);
  const originalProgress = await store.get('docs', ['progress', 'p_f']);
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  assert.notEqual(result.packId, 'p');
  assert.deepEqual(await loadPackBundle('p', store), original);
  assert.deepEqual(await store.get('docs', ['progress', 'p_f']), originalProgress);
  assert.equal(await activePackId(store), result.packId);
  const replacement = await loadPackBundle(result.packId, store);
  assert.equal(replacement.facts.length, 2);
  const oldFact = replacement.facts.find((f) => f.statement === 'Original fact');
  assert.notEqual(oldFact.id, 'f');
  assert.equal((await store.get('docs', ['progress', 'p_' + oldFact.id])).doc.state, 'mastered');
  assert.equal((await store.get('docs', ['attempts', 'a'])).doc.rows.length, 2);
  assert.equal(await loadDraft(store, 'p'), null);
  assert.equal((await loadReplacement('p', store)).packId, result.packId);
});

test('later study progress in the new Pack does not change the old Pack', async () => {
  const { store, replacementId } = await completedFixture();
  const fact = (await loadPackBundle(replacementId, store)).facts.find((item) => item.statement === 'Original fact');
  await saveProgress({ factId: fact.id, packId: replacementId, state: 'learning', streak: 7 }, { store, sync: null });
  assert.equal((await store.get('docs', ['progress', 'p_f'])).doc.state, 'mastered');
  assert.equal((await store.get('docs', ['progress', 'p_' + fact.id])).doc.streak, 7);
});

test('interrupted document write keeps the old Pack active and retry uses the same replacement', async () => {
  const { store, draft } = await storedFixture();
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (name, value) => {
    if (!failed && name === 'docs' && value.collection === 'facts' && value.doc.packId !== 'p') {
      failed = true;
      throw new Error('injected write failure');
    }
    return put(name, value);
  };
  const first = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(first.ok, false);
  assert.equal(await activePackId(store), 'p');
  assert.ok(await loadDraft(store, 'p'));
  const journal = await loadReplacement('p', store);
  assert.ok(journal.packId);
  const retry = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(retry.ok, true);
  assert.equal(retry.packId, journal.packId);
  assert.equal((await store.getAll('docs', 'collection', 'packs')).filter((row) => !row.deleted).length, 2);
});

for (const collection of ['topics', 'facts', 'progress', 'attempts', 'packs']) {
  test(`creation resumes after a ${collection} write fails`, async () => {
    const { store, draft } = await storedFixture();
    const put = store.put.bind(store);
    let failed = false;
    store.put = async (name, value) => {
      if (!failed && name === 'docs' && value.collection === collection) {
        failed = true;
        throw new Error('injected');
      }
      return put(name, value);
    };
    assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
    assert.equal(await activePackId(store), 'p');
    assert.ok(await loadDraft(store, 'p'));
    const journal = await loadReplacement('p', store);
    const result = await publishReplacementDraft(draft, { store, sync: null });
    assert.equal(result.ok, true);
    assert.equal(result.packId, journal.packId);
    assert.ok(await loadPackBundle('p', store));
  });
}

test('retry repairs a document saved before its outbox write failed', async () => {
  const { store, draft } = await storedFixture();
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (name, value) => {
    if (!failed && name === 'outbox' && value.collection === 'facts') {
      failed = true;
      throw new Error('injected');
    }
    return put(name, value);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
  const journal = await loadReplacement('p', store);
  const factId = journal.prepared.facts[0].id;
  assert.ok(await store.get('docs', ['facts', factId]));
  assert.equal(await store.get('outbox', ['facts', factId]), undefined);
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, true);
  assert.ok(await store.get('outbox', ['facts', factId]));
});

test('retry repairs an outbox failure from the actual sync engine', async () => {
  const { store, draft } = await storedFixture();
  const sync = createSyncEngine({ store, api: {}, isOnline: () => false });
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (name, value) => {
    if (!failed && name === 'outbox' && value.collection === 'facts') { failed = true; throw new Error('injected'); }
    return put(name, value);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync })).ok, false);
  const id = (await loadReplacement('p', store)).prepared.facts[0].id;
  assert.ok(await store.get('docs', ['facts', id]));
  assert.equal(await store.get('outbox', ['facts', id]), undefined);
  assert.equal((await publishReplacementDraft(draft, { store, sync })).ok, true);
  assert.ok(await store.get('outbox', ['facts', id]));
});

test('a draft changed during creation does not activate its stale replacement', async () => {
  const { store, draft } = await storedFixture();
  const put = store.put.bind(store);
  let changed = false;
  store.put = async (name, value) => {
    if (!changed && name === 'docs' && value.collection === 'packs' && value.id !== 'p') {
      changed = true;
      const newer = structuredClone(draft);
      newer.pack.title = 'Newer edits';
      await put('meta', { key: 'draft-p', value: newer });
    }
    return put(name, value);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).reason, 'draft_changed');
  assert.equal(await activePackId(store), 'p');
  assert.equal((await loadDraft(store, 'p')).pack.title, 'Newer edits');
});

test('atomic finalization preserves edits made immediately before activation', async () => {
  const { store, draft } = await storedFixture();
  const finalize = store.finalizeReplacementDraft?.bind(store);
  store.finalizeReplacementDraft = async (...args) => {
    const newer = structuredClone(draft);
    newer.pack.title = 'Late edits';
    await saveDraft(newer, { store });
    return finalize(...args);
  };
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.reason, 'draft_changed');
  assert.equal(await activePackId(store), 'p');
  assert.equal((await loadDraft(store, 'p')).pack.title, 'Late edits');
});

test('concurrent creation uses a single journal and replacement', async () => {
  const { store, draft } = await storedFixture();
  const results = await Promise.all([
    publishReplacementDraft(draft, { store, sync: null }),
    publishReplacementDraft(draft, { store, sync: null }),
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(results[0].packId, results[1].packId);
  assert.equal((await store.getAll('docs', 'collection', 'packs')).length, 2);
});

test('retry retains the original progress snapshot even if the old Pack was studied later', async () => {
  const { store, draft } = await storedFixture();
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (name, value) => {
    if (!failed && name === 'docs' && value.collection === 'facts') { failed = true; throw new Error('injected'); }
    return put(name, value);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
  await saveProgress({ factId: 'f', packId: 'p', state: 'learning', streak: 9 }, { store, sync: null });
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  const journal = await loadReplacement('p', store);
  assert.equal(journal.prepared.originalBaseline.progress.f.state, 'mastered');
  assert.equal(journal.prepared.progress.find((p) => p.state === 'mastered').streak, 4);
  assert.equal((await store.get('docs', ['progress', 'p_f'])).doc.state, 'learning');
});

test('a journal write failure causes no replacement writes', async () => {
  const { store, draft } = await storedFixture();
  store.getOrCreateMeta = async () => { throw new Error('injected'); };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
  assert.equal(await activePackId(store), 'p');
  assert.equal((await store.getAll('docs', 'collection', 'packs')).length, 1);
  assert.ok(await loadDraft(store, 'p'));
});

test('failure of atomic finalization leaves the draft and active Pack intact for retry', async () => {
  const { store, draft } = await storedFixture();
  const finalize = store.finalizeReplacementDraft.bind(store);
  let failed = false;
  store.finalizeReplacementDraft = async (...args) => {
    if (!failed) { failed = true; throw new Error('injected transaction failure'); }
    return finalize(...args);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
  const journal = await loadReplacement('p', store);
  assert.equal(await activePackId(store), 'p');
  assert.ok(await loadDraft(store, 'p'));
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  assert.equal(result.packId, journal.packId);
});

test('retry refuses to overwrite a conflicting document at a journalled ID', async () => {
  const { store, draft } = await storedFixture();
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (name, value) => {
    if (!failed && name === 'docs' && value.collection === 'facts') { failed = true; throw new Error('injected'); }
    return put(name, value);
  };
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).ok, false);
  const journal = await loadReplacement('p', store);
  const id = journal.prepared.facts[0].id;
  const collision = { collection: 'facts', id, doc: { id, statement: 'Other user data' }, deleted: 0 };
  await store.put('docs', collision);
  assert.equal((await publishReplacementDraft(draft, { store, sync: null })).reason, 'conflict');
  assert.deepEqual(await store.get('docs', ['facts', id]), collision);
  assert.equal(await activePackId(store), 'p');
});

test('snapshot copies relevant attempts beyond the newest hundred', async () => {
  const { store, draft } = await storedFixture();
  await saveAttempts({ biteId: 'old', endedAt: 1, rows: [{ factId: 'f', correct: true }] }, { store, sync: null });
  for (let i = 0; i < 105; i++) await saveAttempts({ biteId: `other${i}`, endedAt: 100 + i, rows: [{ factId: 'elsewhere' }] }, { store, sync: null });
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  assert.equal((await loadReplacement('p', store)).prepared.attempts.length, 2);
});

test('sources with the same name retain their distinct IDs', async () => {
  const { store, draft } = await storedFixture();
  draft.pack.sources.push({ id: 's3', name: 'Old' });
  await saveDraft(draft, { store });
  const result = await publishReplacementDraft(draft, { store, sync: null });
  assert.equal(result.ok, true);
  assert.deepEqual((await loadPackBundle(result.packId, store)).pack.sources.map((s) => s.id), ['s', 's2', 's3']);
});

test('replacement copies sources, facts, live progress and relevant attempt rows without mutating originals', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = prepareReplacement(input);
  assert.equal(result.ok, true);
  assert.equal(result.pack.id, 'p2');
  assert.equal(result.pack.status, 'frozen');
  assert.deepEqual(result.pack.sources.map((s) => s.id), ['s', 's2']);
  assert.equal(result.facts.find((f) => f.id === 'copy-f').topicId, 'copy-t');
  assert.deepEqual(result.facts.find((f) => f.id === 'copy-f').variants, input.live.facts[0].variants);
  assert.equal(result.progress.find((p) => p.factId === 'copy-f').state, 'mastered');
  assert.equal(result.progress.find((p) => p.factId === 'copy-f').packId, 'p2');
  assert.equal(result.progress.find((p) => p.factId === 'copy-f2').state, 'new');
  assert.deepEqual(result.attempts[0].rows, [{ factId: 'copy-f', correct: true }]);
  assert.equal(result.attempts[0].biteId, 'copy-a');
  assert.deepEqual(input, before);
  assert.deepEqual(prepareReplacement(input), result);
  assert.deepEqual(result.originalBaseline.facts, input.live.facts);
  assert.deepEqual(result.originalBaseline.attempts[0].rows, [{ factId: 'f', correct: true }]);
});

test('duplicate statements are excluded and absent progress starts fresh', () => {
  const input = fixture();
  input.progress = {};
  input.draft.facts.push({ id: 'dup', packId: 'p', topicId: 't', statement: 'ORIGINAL FACT!' });
  const result = prepareReplacement(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.facts.map((f) => f.id), ['copy-f', 'copy-f2']);
  assert.equal(result.progress.find((p) => p.factId === 'copy-f').state, 'new');
});

for (const [name, change] of [
  ['changed original', (x) => { x.live.facts[0].statement = 'Changed'; }],
  ['deleted original', (x) => { x.live.facts = []; }],
  ['missing replacement fact ID', (x) => { delete x.ids.factIds.f; }],
  ['duplicate replacement fact IDs', (x) => { x.ids.factIds.f2 = x.ids.factIds.f; }],
  ['replacement fact ID collides with original', (x) => { x.ids.factIds.f = 'f'; }],
  ['replacement progress IDs collide after sanitizing', (x) => { x.ids.factIds.f = 'same!'; x.ids.factIds.f2 = 'same?'; }],
  ['replacement progress ID collides with original', (x) => { x.ids.factIds.f = 'f!'; }],
  ['replacement topic ID collides with original', (x) => { x.ids.topicIds.t = 't'; }],
  ['missing relevant attempt ID', (x) => { delete x.ids.attemptIds.a; }],
]) {
  test(`replacement rejects ${name}`, () => {
    const input = fixture();
    change(input);
    assert.equal(prepareReplacement(input).ok, false);
  });
}
