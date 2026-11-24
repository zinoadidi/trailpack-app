import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SPRINT_DAYS, biteMinutes, clampSprintDays, getSprintDays, setSprintDays } from '../src/screens/trail-sprint.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('sprint days default to 7 and are clamped', () => {
  assert.equal(DEFAULT_SPRINT_DAYS, 7);
  assert.equal(getSprintDays(mem()), 7);
  assert.equal(clampSprintDays('abc'), 7);
  assert.equal(clampSprintDays(0), 1);
  assert.equal(clampSprintDays(500), 60);
  const s = mem();
  assert.equal(setSprintDays(10, s), 10);
  assert.equal(getSprintDays(s), 10);
});

test('bite minutes use real timing, capped for idle tabs', () => {
  const rows = Array.from({ length: 10 }, () => ({}));
  assert.equal(biteMinutes({ rows, startedAt: 0, endedAt: 6 * 60000, }), 4.5); // no start: estimate
  assert.equal(biteMinutes({ rows, startedAt: 1000, endedAt: 1000 + 6 * 60000 }), 6);
  assert.equal(biteMinutes({ rows, startedAt: 1000, endedAt: 1000 + 5 * 3600000 }), 20); // idle cap = rows * 2
});
