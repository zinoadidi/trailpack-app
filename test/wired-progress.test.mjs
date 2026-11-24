// Progress screen data: per topic mastery and the readiness number the Trail
// already computes. Pure helpers are tested in test/wired-progress.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { masterProgress, packMastery, snapshotReadiness } from '../src/screens/progress-data.js';

const topics = [
  { id: 't1', title: 'Scope', order: 0 },
  { id: 't2', title: 'Risk', order: 1 },
];
const facts = [
  { id: 'f1', topicId: 't1' },
  { id: 'f2', topicId: 't1' },
  { id: 'f3', topicId: 't2' },
  { id: 'f4', topicId: 'gone' },
];
const progress = {
  f1: { factId: 'f1', state: 'mastered' },
  f2: { factId: 'f2', state: 'learning' },
  f3: { factId: 'f3', state: 'new' },
};

test('a new account gets one row per topic with zero mastery', () => {
  const snapshot = packMastery({ id: 'p' }, topics, facts, {});
  const rows = masterProgress(snapshot);
  assert.deepEqual(rows.map((row) => row.id), ['t1', 't2', 'other']);
  assert.deepEqual(rows.map((row) => row.mastered), [0, 0, 0]);
  assert.equal(snapshot.summary.total, 4);
});

test('mastery per topic counts mastered and learning, and titles come from topics', () => {
  const snapshot = packMastery({ id: 'p' }, topics, facts, progress);
  const rows = masterProgress(snapshot);
  const t1 = rows.find((row) => row.id === 't1');
  assert.equal(t1.title, 'Scope');
  assert.equal(t1.total, 2);
  assert.equal(t1.mastered, 1);
  assert.equal(t1.learning, 1);
  assert.equal(t1.percent, 50);
  const other = rows.find((row) => row.id === 'other');
  assert.equal(other.title, 'Other');
  assert.equal(other.total, 1);
});

test('percent is whole and never divides by zero', () => {
  const snapshot = packMastery({ id: 'p' }, [{ id: 't1', title: 'Scope' }], [], {});
  assert.deepEqual(masterProgress(snapshot), []);
});

test('readiness comes from the trail logic and is 0 for an empty snapshot', () => {
  const empty = snapshotReadiness(null);
  assert.equal(empty.score, 0);
  const snapshot = packMastery({ id: 'p' }, topics, facts, progress);
  const ready = snapshotReadiness(snapshot, { now: Date.now() });
  assert.ok(ready.score >= 0 && ready.score <= 100);
  assert.ok('parts' in ready);
});

test('a mastered pack reads higher than a new one', () => {
  const fresh = snapshotReadiness(packMastery({ id: 'p' }, topics, facts, {}));
  const learned = {};
  for (const fact of facts) learned[fact.id] = { factId: fact.id, state: 'mastered', masteryCount: 3 };
  const done = snapshotReadiness(packMastery({ id: 'p' }, topics, facts, learned));
  assert.ok(done.score > fresh.score, `${done.score} should beat ${fresh.score}`);
});
