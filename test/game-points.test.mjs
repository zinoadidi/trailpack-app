import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  POINTS,
  TASK_POINTS,
  actionPoints,
  addPoints,
  basePoints,
  bitePoints,
  earnsVarietyBonus,
  exportAward,
  varietyCount,
} from '../src/game/points.js';
import { DEFAULT_THRESHOLDS, KIND_LADDERS, LADDER_KINDS, levelFor, levelName, levelThresholds, levelUp, normaliseKind } from '../src/game/levels.js';

const EN = JSON.parse(await readFile(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8'));

test('points table matches the design numbers', () => {
  assert.equal(POINTS['learn-card'], 5);
  assert.equal(POINTS['flash-first-try'], 3);
  assert.equal(POINTS['quiz-correct'], 10);
  assert.equal(POINTS['blitz-correct'], 10);
  assert.equal(POINTS['bite-finished'], 20);
  assert.equal(POINTS.checkpoint, 50);
  assert.equal(POINTS['summit-pass'], 150);
  assert.equal(POINTS['summit-fail'], 60);
  assert.equal(POINTS.export, 30);
  assert.equal(POINTS.replay, 5);
  assert.equal(POINTS.mastered, 25);
  assert.equal(POINTS['boss-win'], 60);
  assert.equal(POINTS['boss-full-health'], 20);
  assert.equal(POINTS.step, 15);
  assert.deepEqual(TASK_POINTS, { easy: 15, medium: 20, hard: 25, expert: 30 });
});

test('guided tasks award 15 to 30 by difficulty', () => {
  assert.equal(basePoints({ type: 'task', difficulty: 'easy' }), 15);
  assert.equal(basePoints({ type: 'task', difficulty: 'expert' }), 30);
  assert.equal(basePoints({ type: 'task' }), TASK_POINTS.medium);
  assert.equal(basePoints({ type: 'guided-task', difficulty: 'hard' }), 25);
  assert.equal(basePoints('task'), TASK_POINTS.medium);
  assert.equal(basePoints(undefined), 0);
  assert.equal(basePoints('nonsense'), 0);
});

test('modifiers: no hint +20%, hard Lens +10%, comeback is a win with no bonus', () => {
  assert.equal(actionPoints('quiz-correct'), 10);
  assert.equal(actionPoints('quiz-correct', { hint: false }), 12);
  assert.equal(actionPoints('quiz-correct', { lensDifficulty: 'hard' }), 11);
  assert.equal(actionPoints('quiz-correct', { hint: false, lensDifficulty: 'hard' }), 13);
  assert.equal(actionPoints({ type: 'task', difficulty: 'expert' }, { hint: false }), 36);
  assert.equal(actionPoints('quiz-correct', { comeback: true }), 10);
  assert.equal(actionPoints('quiz-correct', { hint: true }), 10, 'a hint is not a penalty');
  assert.equal(actionPoints('unknown', { hint: false }), 0);
  assert.equal(actionPoints(null), 0);
});
test('variety bonus needs four or more activity types', () => {
  assert.equal(varietyCount(['quiz', 'quiz', 'flash']), 2);
  assert.equal(earnsVarietyBonus(['quiz', 'flash', 'match']), false);
  assert.equal(earnsVarietyBonus(['quiz', 'flash', 'match', 'order']), true);
  assert.equal(earnsVarietyBonus(['quiz', null, 'flash', 'match', 'order', '']), true);
  assert.equal(earnsVarietyBonus(undefined), false);
  assert.equal(Math.round((30 + 20) * 1.1), 55);
  assert.equal(bitePoints({ stepPoints: 30, activityTypes: ['quiz', 'flash', 'match', 'order'] }), 55);
  assert.equal(bitePoints({ stepPoints: 30, activityTypes: ['quiz', 'flash', 'match'] }), 50);
  assert.equal(bitePoints({ stepPoints: -5 }), 20);
  assert.equal(bitePoints({}), 20);
});

test('an export pays once per camp per day and once a day for all camps', () => {
  const log = [{ camp: 'camp-1', day: '2026-01-02' }];
  assert.equal(exportAward({ camp: 'camp-1', day: '2026-01-02' }, log), 0);
  assert.equal(exportAward({ camp: 'camp-2', day: '2026-01-02' }, log), 30);
  assert.equal(exportAward({ camp: 'camp-1', day: '2026-01-03' }, log), 30);
  assert.equal(exportAward({}, [{ camp: undefined, day: null }]), 0, 'the same day is enough');
  assert.equal(exportAward({ camp: 'trail', day: '2026-01-02' }, log), 30);
  assert.equal(exportAward({}, []), 30, 'an empty log always pays');
});test('points never go below zero', () => {
  assert.equal(addPoints(10, 5), 15);
  assert.equal(addPoints(10, -20), 0);
  assert.equal(addPoints(undefined, 'x'), 0);
});

test('level thresholds scale with pack length and stay sane', () => {
  assert.deepEqual(levelThresholds(0), DEFAULT_THRESHOLDS);
  assert.deepEqual(levelThresholds(60), DEFAULT_THRESHOLDS);
  assert.deepEqual(levelThresholds(6), [150, 400, 750, 1250]);
  assert.deepEqual(levelThresholds(1000), [600, 1600, 3000, 5000], 'clamped at 2x');
  for (const n of [1, 10, 40, 90, 400]) {
    const values = levelThresholds(n);
    assert.equal(values.length, 4);
    for (let i = 1; i < values.length; i += 1) assert.ok(values[i] > values[i - 1], 'ascending');
    for (const value of values) assert.ok(value >= 50 && value % 50 === 0, 'rounded to 50 and at least 50');
  }
});

test('level names differ by pack kind and every name has a catalogue key', () => {
  assert.equal(normaliseKind('interview'), 'interview');
  assert.equal(normaliseKind('nope'), 'other');
  assert.equal(levelName('interview', 1), 'analyst');
  assert.equal(levelName('exam', 5), 'master');
  assert.equal(levelName('other', 99), 'summit');
  assert.equal(levelName('other', 0), 'starter');
  for (const kind of LADDER_KINDS) {
    for (const name of KIND_LADDERS[kind]) {
      assert.ok(EN['game.level.names.' + name], `game.level.names.${name} has text`);
    }
  }
});

test('levelFor reports level, span and progress', () => {
  const first = levelFor(0, { kind: 'interview', factCount: 60 });
  assert.equal(first.level, 1);
  assert.equal(first.name, 'analyst');
  assert.equal(first.levelStart, 0);
  assert.equal(first.levelEnd, 300);
  assert.equal(first.toNext, 300);
  assert.equal(first.progress, 0);
  const mid = levelFor(450, { factCount: 60 });
  assert.equal(mid.level, 2);
  assert.equal(mid.levelStart, 300);
  assert.equal(mid.levelEnd, 800);
  assert.equal(mid.progress, 0.3);
  const top = levelFor(9999, { factCount: 60 });
  assert.equal(top.level, 5);
  assert.equal(top.levelEnd, null);
  assert.equal(top.toNext, null);
  assert.equal(top.progress, 1);
  assert.equal(levelFor(-50).points, 0);
});

test('levelUp only fires on a threshold crossing', () => {
  assert.equal(levelUp(290, 310), true);
  assert.equal(levelUp(310, 320), false);
  assert.equal(levelUp(0, 0), false);
  assert.equal(levelUp(280, 300), true, 'reaching the threshold counts');
});
