// Data hygiene: the review flags from pack.js, the delete plan from
// hygiene.js, and the real store code deleting facts with their progress and
// attempt rows in an in-memory store.

import test from 'node:test';
import assert from 'node:assert/strict';

import { REVIEW_CONFIDENCE, hasSource, needsReview, reviewQueue, reviewReasons } from '../src/study/pack.js';
import { deletionPlan, factsRemovedWithTopics, progressDocId } from '../src/study/hygiene.js';
import { deleteFactDocs, pruneOrphans, saveFact, saveTopic, savePack, FACT, TOPIC, PACK } from '../src/study/store.js';

const sourced = { id: 'f1', statement: 'A charter names the sponsor.', chunkId: 'c1', confidence: 0.9 };
const noSource = { id: 'f2', statement: 'Scopes grow quietly.', confidence: 0.8 };
const lowConfidence = { id: 'f3', statement: 'Risk is everywhere.', source: { name: 'notes.md' }, confidence: 0.4 };
const both = { id: 'f4', statement: 'Unknown origin.', confidence: 0.2 };

test('the review bar is confidence under 0.5', () => {
  assert.equal(REVIEW_CONFIDENCE, 0.5);
  assert.deepEqual(reviewReasons({ confidence: 0.5, chunkId: 'c' }), []);
  assert.deepEqual(reviewReasons({ confidence: 0.49, chunkId: 'c' }), ['low-confidence']);
});

test('a fact without a citation needs review', () => {
  assert.equal(hasSource(sourced), true);
  assert.equal(hasSource({ source: { page: 4 } }), true);
  assert.equal(hasSource({ sourceId: 's1' }), true);
  assert.equal(hasSource(noSource), false);
  assert.deepEqual(reviewReasons(noSource), ['no-source']);
  assert.equal(needsReview(noSource), true);
  assert.equal(needsReview(sourced), false);
});

test('a clean fact has no reasons and both flags are reported in order', () => {
  assert.deepEqual(reviewReasons({ chunkId: 'c', confidence: 1 }), []);
  assert.deepEqual(reviewReasons(both), ['no-source', 'low-confidence']);
  assert.deepEqual(reviewReasons(lowConfidence), ['low-confidence']);
  assert.equal(reviewReasons({ statement: 'no numbers at all' }).length, 1);
});

test('the review queue counts facts and each reason, with topic titles', () => {
  const topics = [{ id: 't1', title: 'Scope' }];
  const facts = [sourced, noSource, lowConfidence, both].map((fact) => ({ ...fact, topicId: 't1' }));
  const queue = reviewQueue(facts, topics);
  assert.equal(queue.count, 3, 'the sourced fact is not queued');
  assert.deepEqual(queue.byReason, { 'no-source': 2, 'low-confidence': 2 });
  assert.deepEqual(queue.items.map((item) => item.id), ['f2', 'f3', 'f4']);
  assert.equal(queue.items[0].title, 'Scope');
  assert.deepEqual(reviewQueue([], []), { count: 0, byReason: { 'no-source': 0, 'low-confidence': 0 }, items: [] });
});

test('deleting a fact plans its progress row and its attempt rows', () => {
  const allFacts = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
  const attempts = [
    { biteId: 'b1', rows: [{ factId: 'f1' }, { factId: 'f2' }] },
    { biteId: 'b2', rows: [{ factId: 'f1' }] },
    { biteId: 'b3', rows: [{ factId: 'f3' }] },
  ];
  const plan = deletionPlan({ factId: 'f1', allFacts, attempts });
  assert.deepEqual(plan.progressIds, [progressDocId('f1')]);
  assert.deepEqual(plan.attemptsUpdate, [{ id: 'b1', rows: [{ factId: 'f2' }] }]);
  assert.deepEqual(plan.attemptsDelete, ['b2']);
});

test('facts removed with a topic are only those no kept topic owns', () => {
  const facts = [{ id: 'f1', topicId: 't1' }, { id: 'f2', topicId: 't2' }, { id: 'f3', topicId: 't3' }];
  assert.deepEqual(factsRemovedWithTopics(facts, ['t1']), ['f1']);
  assert.deepEqual(factsRemovedWithTopics(facts, ['t1', 't2'], ['t1', 't2']), []);
});

/** Just enough of the store for the real code paths: docs in a Map. */
function memoryStore() {
  const docs = new Map();
  return {
    docs,
    // The app reads docs as get('docs', [collection, id]) and meta as get('meta', key).
    async get(collection, key) {
      const [name, id] = Array.isArray(key) ? key : ['meta', key];
      return docs.get(collection + '/' + name + '/' + id) || null;
    },
    async getAll(collection, index, byCollection) {
      // `index` is 'collection' in the app; the collection name stays unclear otherwise.
      const name = byCollection === undefined ? index : byCollection;
      return [...docs.values()].filter((row) => row.collection === name);
    },
    async put(collection, row) {
      if (collection === 'docs') docs.set(collection + '/' + row.collection + '/' + row.id, { ...row });
      else docs.set('meta/meta/' + row.key, row);
      return row;
    },
    async delete(collection, key) {
      if (Array.isArray(key)) docs.delete(collection + '/' + key[0] + '/' + key[1]);
    },
  };
}

async function seed(store) {
  await savePack({ id: 'p1', title: 'Pack', status: 'frozen' }, { store, sync: null });
  await saveTopic({ id: 't1', packId: 'p1', title: 'Scope' }, { store, sync: null });
  for (const fact of [{ id: 'fa' }, { id: 'fb' }]) await saveFact({ ...fact, packId: 'p1', topicId: 't1', statement: 'Fact ' + fact.id }, { store, sync: null });
  const progress = (factId) => ({ collection: 'progress', id: progressDocId(factId), doc: { factId, state: 'learning' }, rev: 1, updatedAt: 1 });
  const doc = (collection, id, body) => ({ collection, id, doc: body, rev: 1, updatedAt: 1 });
  await store.put('docs', progress('fa'));
  await store.put('docs', progress('fb'));
  await store.put('docs', progress('gone'));
  await store.put('docs', doc('attempts', 'b1', { biteId: 'b1', rows: [{ factId: 'fa' }, { factId: 'fb' }] }));
  await store.put('docs', doc('attempts', 'b2', { biteId: 'b2', rows: [{ factId: 'fa' }] }));
}

test('deleting a fact removes its progress and its attempt rows, keeps the rest', async () => {
  const store = memoryStore();
  await seed(store);
  const result = await deleteFactDocs(['fa'], { store, sync: null });
  assert.deepEqual(result.progress, [progressDocId('fa')]);
  assert.equal(await store.get('docs', ['facts', 'fa']), null);
  assert.ok(await store.get('docs', ['facts', 'fb']), 'the other fact stays');
  assert.equal(await store.get('docs', ['progress', progressDocId('fa')]), null, 'no orphan progress');
  assert.ok(await store.get('docs', ['progress', progressDocId('fb')]), 'the other progress stays');
  const b1 = (await store.get('docs', ['attempts', 'b1'])).doc;
  assert.deepEqual(b1.rows.map((row) => row.factId), ['fb'], 'the shared attempt keeps its other answer');
  assert.equal(await store.get('docs', ['attempts', 'b2']), null, 'an attempt that only held the fact goes');
});

test('pruneOrphans clears progress whose fact is gone', async () => {
  const store = memoryStore();
  await seed(store);
  const { removed } = await pruneOrphans({ store, sync: null });
  assert.equal(removed, 1);
  assert.equal(await store.get('docs', ['progress', progressDocId('gone')]), null);
  assert.ok(await store.get('docs', ['progress', progressDocId('fa')]));
});

test('deleting without a store is a no-op, not a crash', async () => {
  assert.deepEqual(await deleteFactDocs(['fa'], { store: null, sync: null }), { facts: [], progress: [], attempts: 0 });
});

void FACT;
void TOPIC;
void PACK;
