// The screen runner (wire-run.js) against an in memory store: a step is paid
// once, a bite pays its unpaid steps, and a resumed bite never pays twice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { recordStep, recordBite, recordFinish, stepKey, biteId, toastText } from '../src/game/wire-run.js';
import { state } from '../src/app/state.js';
import { loadProfile } from '../src/game/store.js';

// Smallest store the game store needs: get and put on `docs`.
function memoryStore(rows = new Map()) {
  return {
    rows,
    async get(_table, key) {
      return rows.get(JSON.stringify(key)) || null;
    },
    async put(_table, record) {
      rows.set(JSON.stringify([record.collection, record.id]), record);
      return record;
    },
    async getAll() {
      return [...rows.values()];
    },
  };
}

const ROW = (step, points = 10, extra = {}) => ({ step, factId: 'f' + step, type: 'quiz', correct: true, points, hint: false, ...extra });

function sessionFixture() {
  return {
    startedAt: 1764000000000,
    index: 3,
    minutes: 4,
    steps: [{}, {}, {}],
    answers: [ROW(0), ROW(1, 0, { correct: false }), ROW(2)],
  };
}

test('recordStep pays the same row only once', async () => {
  state.store = memoryStore();
  state.sync = null;
  const first = await recordStep({ row: ROW(0) });
  assert.equal(first.duplicated, false);
  const again = await recordStep({ row: ROW(0) });
  assert.equal(again.duplicated, true);
  const profile = await loadProfile(state.store);
  assert.equal(profile.points, 10);
});

test('recordStep keeps a different step paid', async () => {
  state.store = memoryStore();
  await recordStep({ row: ROW(0) });
  await recordStep({ row: ROW(1) });
  const profile = await loadProfile(state.store);
  assert.equal(profile.points, 20);
  assert.equal(profile.wire.steps.length, 2);
});

test('recordBite pays the unpaid steps and remembers them', async () => {
  state.store = memoryStore();
  const session = sessionFixture();
  await recordStep({ row: session.answers[0] });
  const first = await recordBite({ session, plan: { minutesPerDay: 5 } });
  assert.equal(first.stepPoints, 20); // rows 1 and 2; row 0 was paid by recordStep
  const profile = await loadProfile(state.store);
  assert.equal(profile.points, 30);
  assert.equal(profile.counts.bitesDone, 1);
  const again = await recordBite({ session, plan: { minutesPerDay: 5 } });
  assert.equal(again.stepPoints, 0);
  const after = await loadProfile(state.store);
  assert.equal(after.points, profile.points);
  assert.equal(after.counts.bitesDone, 2);
});

test('recordBite pays the plan streak only when the walk goal is met', async () => {
  state.store = memoryStore();
  const met = await recordBite({ session: sessionFixture(), plan: { minutesPerDay: 4 } });
  assert.equal(met.goalMet, true);
  assert.equal(met.profile.planStreak.current, 1);
  state.store = memoryStore();
  const missed = await recordBite({ session: sessionFixture(), plan: { minutesPerDay: 30 } });
  assert.equal(missed.goalMet, false);
  assert.equal(missed.profile.planStreak.current, 0);
});

test('recordFinish pays once per bite', async () => {
  state.store = memoryStore();
  const session = sessionFixture();
  const one = await recordFinish({ points: 30, activityTypes: ['quiz'], session });
  assert.equal(one.duplicated, false);
  assert.equal(one.profile.points, 30);
  const two = await recordFinish({ points: 30, activityTypes: ['quiz'], session });
  assert.equal(two.duplicated, true);
  assert.equal((await loadProfile(state.store)).points, 30);
});

test('stepKey and biteId are stable', () => {
  assert.equal(stepKey(ROW(0)), '0:f0');
  assert.equal(stepKey(null), null);
  assert.equal(biteId(sessionFixture()), 'bite-1764000000000-3');
  assert.equal(biteId({ id: 'abc' }), 'abc');
});

test('toastText renders through the app translator', () => {
  const text = toastText({ key: 'wire.toast.points', values: { points: 7 } }, (key, values) => key + ' ' + JSON.stringify(values));
  assert.equal(text, 'wire.toast.points {"points":7}');
});

test('a merge keeps the wire marks from both devices so nothing is paid twice', async () => {
  const { mergeProfiles, emptyProfile } = await import('../src/game/profile.js');
  const left = { ...emptyProfile(), wire: { bites: { a: [0, 1] }, steps: ['0:f0'] } };
  const right = { ...emptyProfile(), wire: { bites: { b: [0] }, steps: ['1:f1', '0:f0'] } };
  const merged = mergeProfiles(left, right);
  assert.deepEqual(merged.wire.bites, { b: [0], a: [0, 1] });
  assert.deepEqual(merged.wire.steps.sort(), ['0:f0', '1:f1']);
});
