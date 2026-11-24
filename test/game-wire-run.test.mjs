// The runner rules of wire-run.js, pure: goal day maths, level options from a
// plan, and the toast strings with a stand in translator (no DOM, no store).

import test from 'node:test';
import assert from 'node:assert/strict';

import { toastText, levelOptions, minutesToday, sound } from '../src/game/wire-run.js';
import { emptyProfile, stepDone } from '../src/game/profile.js';

test('toastText renders a plain row with the given translator', () => {
  const fake = (key, values) => (values ? key + ':' + JSON.stringify(values) : key);
  assert.equal(toastText({ key: 'wire.toast.points', values: { points: 9 } }, fake), 'wire.toast.points:{"points":9}');
  assert.equal(toastText(null, fake), '');
});

test('toastText swaps a badge raw name for a translated key when given one', () => {
  const fake = (key, values) => (values ? key + '(' + values.name + ')' : key);
  const row = { key: 'wire.toast.badge', raw: 'first step', nameKey: 'game.achievement.first-step' };
  assert.equal(toastText(row, fake), 'wire.toast.badge(game.achievement.first-step)');
});

test('levelOptions takes the kind from the plan and counts the camps facts', () => {
  const plan = { kind: 'exam', camps: [{ factIds: ['a', 'b'] }, { factIds: ['c'] }] };
  assert.deepEqual(levelOptions(plan), { kind: 'exam', factCount: 3 });
  assert.deepEqual(levelOptions(null), { kind: 'other', factCount: 0 });
  assert.deepEqual(levelOptions({ camps: [null, { factIds: null }] }), { kind: 'other', factCount: 0 });
});

test('minutesToday reads only the local day bucket', () => {
  const when = new Date(2026, 10, 24, 9, 0, 0).getTime();
  const profile = stepDone(emptyProfile(), { points: 0, minutes: 7, when }).profile;
  assert.equal(minutesToday(profile, when), 7);
  assert.equal(minutesToday(profile, when + 86400000), 0);
  assert.equal(minutesToday(null, when), 0);
});

test('sound never throws without a window or an audio context', () => {
  assert.equal(sound(null), false);
  assert.equal(sound('correct'), false);
});
