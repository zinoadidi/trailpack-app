import test from 'node:test';
import assert from 'node:assert/strict';

import { stepInput, biteInput, stepToasts, biteToasts, newLevels, sfxFor, biteSoundPlan, pointsMade, walkGoalMet, STREAK_TOAST_MIN } from '../src/game/wire.js';
import { stepDone } from '../src/game/profile.js';
import { emptyProfile } from '../src/game/profile.js';

test('stepInput turns a correct hint free answer into a no hint step', () => {
  const input = stepInput({ type: 'quiz', correct: true, points: 10, hint: false }, { goalMet: true });
  assert.equal(input.points, 10);
  assert.equal(input.type, 'quiz');
  assert.equal(input.noHint, true);
  assert.equal(input.goalMet, true);
});

test('stepInput never marks a wrong or hinted answer as no hint and clamps points', () => {
  assert.equal(stepInput({ correct: false, points: 0 }).noHint, false);
  assert.equal(stepInput({ correct: true, hint: true }).noHint, false);
  assert.equal(stepInput({ points: -5 }).points, 0);
  assert.equal(stepInput({}).points, 0);
});

test('stepInput feeds stepDone and pays once per call', () => {
  const start = emptyProfile();
  const one = stepDone(start, stepInput({ type: 'flash', correct: true, points: 8 }, { when: '2026-11-24T09:00:00.000Z' }));
  assert.equal(one.profile.points, 8);
  assert.equal(one.profile.counts.stepsDone, 1);
  assert.equal(one.profile.counts.noHintCompletions, 1);
  const twice = stepDone(one.profile, stepInput({ type: 'flash', correct: true, points: 8 }, { when: '2026-11-24T09:05:00.000Z' }));
  assert.equal(twice.profile.points, 16);
  assert.equal(twice.profile.counts.stepsDone, 2);
});

test('stepInput does not mutate the row', () => {
  const row = { type: 'quiz', correct: true, points: 10, hint: false };
  const copy = JSON.parse(JSON.stringify(row));
  stepInput(row);
  assert.deepEqual(row, copy);
});

test('biteInput keeps only real activity types', () => {
  assert.deepEqual(biteInput({ stepPoints: '12', activityTypes: ['flash', '', null, 'quiz'] }), { points: 12, activityTypes: ['flash', 'quiz'], when: undefined });
  assert.equal(biteInput({ stepPoints: -3 }).points, 0);
});

test('stepToasts: points, streak, level and badges, in that order', () => {
  const list = stepToasts({ points: 10, levelledTo: 3, unlocked: ['first-step'], streak: 4 });
  assert.deepEqual(list.map((x) => x.key), ['wire.toast.points', 'wire.toast.streak', 'wire.toast.level', 'wire.toast.badge']);
  assert.equal(list[0].values.points, 10);
  assert.equal(list[1].values.count, 4);
  assert.equal(list[2].values.level, 3);
  assert.equal(list[3].raw, 'first step');
});

test('stepToasts stays quiet for a zero point answer and a one day streak', () => {
  assert.deepEqual(stepToasts({ points: 0 }), []);
  assert.deepEqual(stepToasts({ points: 5, streak: STREAK_TOAST_MIN - 1 }).map((x) => x.key), ['wire.toast.points']);
  assert.equal(stepToasts({ streak: STREAK_TOAST_MIN })[0].key, 'wire.toast.streak');
});

test('stepToasts handles missing input', () => {
  assert.deepEqual(stepToasts(), []);
  assert.deepEqual(stepToasts({ unlocked: null, points: null }), []);
});

test('biteToasts never repeats a streak line', () => {
  const list = biteToasts({ gained: 30, levelledTo: 2, unlocked: ['a', 'b'] });
  assert.deepEqual(list.map((x) => x.key), ['wire.toast.points', 'wire.toast.level', 'wire.toast.badge', 'wire.toast.badge']);
});

test('newLevels counts the levels crossed, zero when none', () => {
  assert.equal(newLevels(0, 0), 0);
  assert.ok(newLevels(0, 100000) >= 1);
  assert.equal(newLevels(100000, 0), 0);
});

test('sfxFor names the sound for each moment', () => {
  assert.equal(sfxFor('answer', { correct: true }), 'correct');
  assert.equal(sfxFor('answer', { correct: false }), 'wrong');
  assert.equal(sfxFor('answer', { correct: true, thrown: true }), 'wrong');
  assert.equal(sfxFor('flip'), 'flip');
  assert.equal(sfxFor('step'), 'stepDone');
  assert.equal(sfxFor('bite'), 'biteDone');
  assert.equal(sfxFor('level'), 'levelUp');
  assert.equal(sfxFor('badge'), 'achievement');
  assert.equal(sfxFor('failed'), 'failed');
});

test('sfxFor stays silent for a skip and an unknown moment', () => {
  assert.equal(sfxFor('answer', { correct: false, skipped: true }), null);
  assert.equal(sfxFor('nope'), null);
});

test('biteSoundPlan plays the finish, then a level and a badge only when earned', () => {
  assert.deepEqual(biteSoundPlan({ gained: 0 }), ['stepDone']);
  assert.deepEqual(biteSoundPlan({ gained: 20 }), ['stepDone', 'biteDone']);
  assert.deepEqual(biteSoundPlan({ gained: 20, levelled: 1, unlocked: ['x'] }), ['stepDone', 'biteDone', 'levelUp', 'achievement']);
  assert.deepEqual(biteSoundPlan(), ['stepDone']);
});

test('pointsMade adds the paid rows only', () => {
  assert.equal(pointsMade([{ points: 8 }, { points: 0 }, { points: -4 }, {}]), 8);
  assert.equal(pointsMade(), 0);
});

test('stepInput carries the answer streak and time when the row has them', () => {
  const input = stepInput({ type: 'quiz', correct: true, points: 10, streak: 5, ms: 2400 });
  assert.equal(input.answerStreak, 5);
  assert.equal(input.ms, 2400);
  assert.equal(stepInput({ points: 1 }).answerStreak, undefined);
});

test('walkGoalMet pays on the bite that crosses the minutes goal, not before', () => {
  const plan = { minutesPerDay: 20 };
  assert.equal(walkGoalMet(plan, 12, 4), false);
  assert.equal(walkGoalMet(plan, 16, 4), true);
  assert.equal(walkGoalMet(plan, 30, 0), true);
  assert.equal(walkGoalMet(null, 0, 5), false);
  assert.equal(walkGoalMet({}, 16, 4), true);
});

