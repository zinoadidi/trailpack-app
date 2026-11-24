// What a practice round says at the end (src/screens/practice-result.js): the
// right and wrong counts, the best run and the accuracy, from a plain list of
// answers. Also the sentence the screen shows, with a band so it can be calm.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resultSummary, typesPractised } from '../src/screens/practice-result.js';

test('an empty round is a zero summary, not a NaN', () => {
  assert.deepEqual(resultSummary([]), { asked: 0, right: 0, wrong: 0, best: 0, ms: 0, accuracy: 0 });
  assert.deepEqual(resultSummary(null), { asked: 0, right: 0, wrong: 0, best: 0, ms: 0, accuracy: 0 });
});

test('right, wrong and the best run are counted', () => {
  const rows = [{ correct: true }, { correct: true }, { correct: false }, { correct: true }, { correct: false }];
  const summary = resultSummary(rows);
  assert.equal(summary.asked, 5);
  assert.equal(summary.right, 3);
  assert.equal(summary.wrong, 2);
  assert.equal(summary.best, 2);
  assert.equal(summary.accuracy, 60);
});

test('a self rated good or easy counts as right', () => {
  const summary = resultSummary([{ correct: false, selfRate: 'easy' }, { correct: null, selfRate: 'good' }, { correct: false, selfRate: 'again' }]);
  assert.equal(summary.right, 2);
  assert.equal(summary.wrong, 1);
});

test('milliseconds add up and never go negative', () => {
  const summary = resultSummary([{ correct: true, ms: 500 }, { correct: true, ms: -20 }, { correct: true }]);
  assert.equal(summary.ms, 500);
});

test('types are listed once, in the order they were practised', () => {
  assert.deepEqual(typesPractised([{ type: 'match' }, { type: 'order' }, { type: 'match' }, {}]), ['match', 'order']);
  assert.deepEqual(typesPractised([]), []);
});
