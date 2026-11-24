import test from 'node:test';
import assert from 'node:assert/strict';
import { beginAdditionDraft, prepareAdditionPublish } from '../src/study/additions.js';
import { MemoryStore } from '../src/store/idb.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { savePack, saveTopic, saveFact, saveDraft, loadDraft, loadPackBundle, setActivePack, resolveActivePack, publishAdditionDraft } from '../src/study/store.js';

const bundle = () => ({
  pack: { id: 'p', title: 'Pack', status: 'frozen', sources: [{ id: 's', name: 'Old' }] },
  topics: [{ id: 't', packId: 'p', title: 'Topic' }],
  facts: [{ id: 'f', packId: 'p', topicId: 't', statement: 'Original fact', variants: [{ id: 'v' }] }],
});

test('addition draft is an independent copy of the frozen bundle', () => {
  const live = bundle();
  const before = structuredClone(live);
  const draft = beginAdditionDraft(live);
  assert.equal(draft.pack.status, 'draft');
  draft.pack.sources.push({ id: 'new-source' });
  draft.facts[0].variants.push({ id: 'new-variant' });
  assert.deepEqual(live, before);
  assert.ok(draft.additionBase);
});

test('publishing adds material without rewriting old documents', () => {
  const live = bundle();
  const draft = beginAdditionDraft(live);
  draft.pack.sources.push({ id: 's2', name: 'New' });
  draft.topics.push({ id: 't2', packId: 'p', title: 'Another topic' });
  draft.facts.push({ id: 'f2', packId: 'p', topicId: 't2', statement: 'Another fact' });
  draft.facts.push({ id: 'f3', packId: 'p', topicId: 't', statement: 'A third fact' });
  draft.facts.push({ id: 'dup', packId: 'p', topicId: 't', statement: 'ORIGINAL FACT!' });
  const result = prepareAdditionPublish({ draft, live });
  assert.equal(result.ok, true);
  assert.equal(result.pack.status, 'frozen');
  assert.deepEqual(result.pack.sources.map((source) => source.id), ['s', 's2']);
  assert.deepEqual(result.topics.map((topic) => topic.id), ['t2']);
  assert.deepEqual(result.facts.map((fact) => fact.id), ['f2', 'f3']);
  assert.equal(result.facts[1].topicId, 't');
  assert.deepEqual(live, bundle());
});

for (const [name, change] of [
  ['source changed', (live) => { live.pack.sources[0].name = 'Changed'; }],
  ['source removed', (live) => { live.pack.sources = []; }],
  ['topic changed', (live) => { live.topics[0].title = 'Changed'; }],
  ['topic removed', (live) => { live.topics = []; }],
  ['fact removed', (live) => { live.facts = []; }],
  ['variants changed', (live) => { live.facts[0].variants.push({ id: 'new' }); }],
]) {
  test(`publishing rejects stale draft when ${name}`, () => {
    const live = bundle();
    const draft = beginAdditionDraft(live);
    change(live);
    assert.equal(prepareAdditionPublish({ draft, live }).ok, false);
  });
}

test('publishing refuses conflicting new document IDs', () => {
  const live = bundle();
  const draft = beginAdditionDraft(live);
  draft.topics.push({ id: 'new', packId: 'p', title: 'Draft topic' });
  live.topics.push({ id: 'new', packId: 'p', title: 'Different topic' });
  assert.equal(prepareAdditionPublish({ draft, live }).ok, false);
});

test('publishing refuses new facts with a missing topic', () => {
  const live = bundle();
  const draft = beginAdditionDraft(live);
  draft.facts.push({ id: 'f2', packId: 'p', topicId: 'missing', statement: 'New fact' });
  assert.equal(prepareAdditionPublish({ draft, live }).ok, false);
});

test('study progress changes do not conflict with adding material', () => {
  const live = bundle();
  const draft = beginAdditionDraft(live);
  live.progress = [{ factId: 'f', state: 'mastered' }];
  assert.equal(prepareAdditionPublish({ draft, live }).ok, true);
  assert.deepEqual(live.progress, [{ factId: 'f', state: 'mastered' }]);
});

async function storedDraft() {
  const store = new MemoryStore();
  const initial = bundle();
  await savePack(initial.pack, { store, sync: null });
  await saveTopic(initial.topics[0], { store, sync: null });
  await saveFact(initial.facts[0], { store, sync: null });
  await setActivePack('p', { store });
  const progress = { collection: 'progress', id: 'f', doc: { factId: 'f', state: 'mastered' }, deleted: 0 };
  const attempt = { collection: 'attempts', id: 'bite', doc: { biteId: 'bite', rows: [{ factId: 'f' }] }, deleted: 0 };
  await store.put('docs', progress);
  await store.put('docs', attempt);
  const live = await loadPackBundle('p', store);
  const draft = beginAdditionDraft(live);
  draft.pack.sources.push({ id: 's2', name: 'New' });
  draft.topics.push({ id: 't2', packId: 'p', title: 'New topic' });
  draft.facts.push({ id: 'f2', packId: 'p', topicId: 't2', statement: 'New fact' });
  await saveDraft(draft, { store });
  return { store, live, draft, progress, attempt };
}

test('addition draft leaves the live bundle and active study unchanged', async () => {
  const { store, live, progress, attempt } = await storedDraft();
  assert.deepEqual(await loadPackBundle('p', store), live);
  assert.deepEqual(await resolveActivePack(store), live);
  assert.deepEqual(await store.get('docs', ['progress', 'f']), progress);
  assert.deepEqual(await store.get('docs', ['attempts', 'bite']), attempt);
});

test('publication adds documents and preserves progress, attempts and variants', async () => {
  const { store, draft, progress, attempt } = await storedDraft();
  assert.equal((await publishAdditionDraft(draft, { store, sync: null })).ok, true);
  const published = await resolveActivePack(store);
  assert.deepEqual(published.pack.sources.map((source) => source.id), ['s', 's2']);
  assert.deepEqual(published.topics.map((topic) => topic.id).sort(), ['t', 't2']);
  assert.deepEqual(published.facts.map((fact) => fact.id).sort(), ['f', 'f2']);
  assert.deepEqual(published.facts.find((fact) => fact.id === 'f').variants, [{ id: 'v' }]);
  assert.deepEqual(await store.get('docs', ['progress', 'f']), progress);
  assert.deepEqual(await store.get('docs', ['attempts', 'bite']), attempt);
  assert.equal(await loadDraft(store, 'p'), null);
});

test('a partial publication retains its draft and can be retried without duplicates', async () => {
  const { store, draft, progress, attempt } = await storedDraft();
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (name, row) => {
    if (fail && name === 'docs' && row.collection === 'facts' && row.id === 'f2') {
      fail = false;
      throw new Error('storage full');
    }
    return put(name, row);
  };
  assert.equal((await publishAdditionDraft(draft, { store, sync: null })).ok, false);
  assert.ok(await loadDraft(store, 'p'));
  assert.equal((await publishAdditionDraft(draft, { store, sync: null })).ok, true);
  const published = await loadPackBundle('p', store);
  assert.deepEqual(published.topics.map((topic) => topic.id).sort(), ['t', 't2']);
  assert.deepEqual(published.facts.map((fact) => fact.id).sort(), ['f', 'f2']);
  assert.deepEqual(published.pack.sources.map((source) => source.id), ['s', 's2']);
  assert.deepEqual(await store.get('docs', ['progress', 'f']), progress);
  assert.deepEqual(await store.get('docs', ['attempts', 'bite']), attempt);
});

test('a live conflict leaves the draft and published Pack untouched', async () => {
  const { store, draft } = await storedDraft();
  await saveFact({ ...bundle().facts[0], variants: [{ id: 'changed' }] }, { store, sync: null });
  const before = await loadPackBundle('p', store);
  assert.equal((await publishAdditionDraft(draft, { store, sync: null })).ok, false);
  assert.deepEqual(await loadPackBundle('p', store), before);
  assert.ok(await loadDraft(store, 'p'));
});

test('an outbox failure retains the draft and retry queues the partially written fact', async () => {
  const { store, draft } = await storedDraft();
  const sync = createSyncEngine({ store, api: {}, isOnline: () => false });
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (name, row) => {
    if (fail && name === 'outbox' && row.collection === 'facts' && row.id === 'f2') {
      fail = false;
      throw new Error('outbox unavailable');
    }
    return put(name, row);
  };
  assert.equal((await publishAdditionDraft(draft, { store, sync })).ok, false);
  assert.ok(await loadDraft(store, 'p'));
  assert.equal((await publishAdditionDraft(draft, { store, sync })).ok, true);
  assert.ok(await store.get('outbox', ['facts', 'f2']));
  assert.ok(await store.get('outbox', ['topics', 't2']));
  assert.ok(await store.get('outbox', ['packs', 'p']));
});

test('publication writes no live documents if its retry marker cannot be saved', async () => {
  const { store, draft, live } = await storedDraft();
  const put = store.put.bind(store);
  store.put = async (name, row) => {
    if (name === 'meta' && row.key === 'draft-p') throw new Error('storage full');
    return put(name, row);
  };
  assert.equal((await publishAdditionDraft(draft, { store, sync: null })).ok, false);
  assert.deepEqual(await loadPackBundle('p', store), live);
  assert.ok(await loadDraft(store, 'p'));
});
