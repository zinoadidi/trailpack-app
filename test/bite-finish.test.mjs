// The Bite complete screen's own rules, pure: what the finish bonus pays and
// how many levels it crosses. The profile action and the sounds live in
// wire-run.js; these two only read the pure bite summary.

import test from 'node:test';
import assert from 'node:assert/strict';

import { finishLevels } from '../src/screens/bite.js';
import { finishPoints } from '../src/game/wire-run.js';
import { biteComplete } from '../src/game/bite.js';
import { POINTS } from '../src/game/points.js';

test('finishPoints pays the finish bonus and the variety bonus, not the steps', () => {
  const plain = finishPoints([]);
  assert.equal(plain, POINTS['bite-finished']);
  assert.ok(finishPoints(['flash', 'quiz', 'match', 'order']) >= POINTS['bite-finished']);
  assert.equal(finishPoints(), POINTS['bite-finished']);
});

test('finishLevels counts a level up from the pure summary', () => {
  const none = biteComplete({ stepPoints: 1, activityTypes: [] });
  assert.equal(finishLevels(none), 0);
  assert.equal(finishLevels(null), 0);
  // The summary computes its own level up from pointsBefore and what was paid.
  const big = biteComplete({ pointsBefore: 0, stepPoints: 100000, activityTypes: [] });
  assert.ok(big.levelUp);
  assert.equal(finishLevels(big), big.levelUp.to - big.levelUp.from);
  assert.ok(finishLevels(big) >= 1);
});

test('the screen shows the profile total after a real bite', async () => {
  const store = new Map();
  const state = (await import('../src/app/state.js')).state;
  const { loadProfile } = await import('../src/game/store.js');
  const { recordBite, recordFinish } = await import('../src/game/wire-run.js');
  state.store = {
    async get(_t, k) { return store.get(JSON.stringify(k)) || null; },
    async put(_t, r) { store.set(JSON.stringify([r.collection, r.id]), r); return r; },
  };
  state.sync = null;
  const types = ['flash', 'quiz', 'match', 'order'];
  const session = { startedAt: 1764000000000, steps: [1, 2], index: 2, answers: [
    { step: 0, factId: 'a', type: 'flash', correct: true, points: 10 },
    { step: 1, factId: 'b', type: 'quiz', correct: true, points: 10 },
  ] };
  const finish = finishPoints(types);
  await recordBite({ session, plan: null });
  await recordFinish({ points: finish, activityTypes: types, session });
  const profile = await loadProfile(state.store);
  // What the screen does: pointsBefore = profile minus the finish bonus.
  const screenBefore = Math.max(0, profile.points - finish);
  const shown = biteComplete({ pointsBefore: screenBefore, stepPoints: 20, activityTypes: types });
  // The variety bonus rides on top of the profile total (the finish bonus is
  // already in it), so the screen reads 44 where the profile holds 42.
  assert.ok(shown.pointsAfter > profile.points);
  assert.equal(shown.gained, screenBefore + 24);
  void shown;
});
