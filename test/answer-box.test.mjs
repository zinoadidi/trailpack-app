// The shared answer box (src/screens/activities/answer-box.js): the three
// coverage bands and the hit and missed point rows, over study/match.js's
// coverage check. Pure, so both writing activities are checked the same way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { coverageBand, pointLines } from '../src/screens/activities/answer-box.js';

test('coverage bands are high, mid and low with their chip colours', () => {
  assert.deepEqual(coverageBand(0.9), { band: 'high', chip: 'm' });
  assert.deepEqual(coverageBand(0.8), { band: 'high', chip: 'm' });
  assert.deepEqual(coverageBand(0.5), { band: 'mid', chip: 'a' });
  assert.deepEqual(coverageBand(0.4), { band: 'low', chip: 'f' });
  assert.deepEqual(coverageBand(null), { band: 'low', chip: 'f' });
  assert.deepEqual(coverageBand(4), { band: 'high', chip: 'm' }, 'a ratio above one is clamped');
});

test('a point is hit when its key words are said', () => {
  const points = ['Phosphorylation transfers a phosphate group', 'ATP supplies the energy'];
  const result = pointLines('A kinase transfers a phosphate group, and ATP supplies the energy for it.', points);
  assert.deepEqual(result.hit, points);
  assert.deepEqual(result.missed, []);
  assert.equal(result.ratio, 1);
  assert.deepEqual(result.rows, points.map((point) => ({ point, hit: true })));
});

test('a missed point is listed, not silently dropped', () => {
  const points = ['Mitochondria make ATP', 'The nucleus holds DNA'];
  const result = pointLines('The nucleus holds the DNA.', points);
  assert.deepEqual(result.hit, ['The nucleus holds DNA']);
  assert.deepEqual(result.missed, ['Mitochondria make ATP']);
  assert.deepEqual(result.rows.map((r) => r.hit), [false, true]);
});

test('an empty answer misses every point and does not throw', () => {
  const result = pointLines('', ['One thing', 'Another thing']);
  assert.equal(result.ratio, 0);
  assert.deepEqual(pointLines('', []), { ratio: 0, hit: [], missed: [], rows: [] });
});
