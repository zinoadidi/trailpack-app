import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, ACHIEVEMENT_IDS, achievementList, achievementSummary, checkAll, progressTowards } from '../src/game/achievements.js';

const EN = JSON.parse(await readFile(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8'));

test('the table is exactly the design table, in order', () => {
  assert.deepEqual(ACHIEVEMENT_IDS, [
    'first-step', 'warming-up', 'on-a-roll', 'unstoppable', 'sharp-mind', 'comeback',
    'camp-1', 'halfway', 'summit', 'century', 'high-roller', 'getting-serious', 'grinder',
    'quiz-whiz', 'day-3', 'day-7', 'day-30', 'back-again', 'lens-switcher', 'teach-it',
    'clean-sheet', 'night-before', 'variety-pack', 'bite-size', 'mastered-50',
    'full-mastery', 'polyglot', 'boss-slayer',
  ]);
  assert.equal(ACHIEVEMENTS.length, 28);
});

test('every achievement has a title, a help line and a known group', () => {
  for (const achievement of ACHIEVEMENTS) {
    assert.ok(ACHIEVEMENT_GROUPS.includes(achievement.group), achievement.id + ' group');
    assert.ok(EN['game.achievement.' + achievement.id], achievement.id + ' title key');
    assert.ok(EN['game.achievement.' + achievement.id + '.help'], achievement.id + ' help key');
  }
});

test('an empty stats object unlocks nothing and does not throw', () => {
  const { earned, unlocked } = checkAll({});
  assert.deepEqual(unlocked, []);
  assert.deepEqual(earned, {});
  assert.deepEqual(checkAll(undefined).unlocked, []);
  assert.deepEqual(checkAll(null).unlocked, []);
});

test('step and points achievements fire at their threshold', () => {
  assert.deepEqual(checkAll({ stepsDone: 1 }).unlocked, ['first-step']);
  const many = checkAll({ stepsDone: 25, points: 100 }).unlocked;
  assert.ok(many.includes('getting-serious'));
  assert.ok(many.includes('century'));
  assert.ok(!many.includes('grinder'));
  assert.ok(checkAll({ stepsDone: 50, points: 500 }).unlocked.includes('high-roller'));
});

test('answer streak achievements need the best run, not the current one', () => {
  assert.deepEqual(checkAll({ bestAnswerStreak: 3 }).unlocked, ['warming-up']);
  assert.deepEqual(checkAll({ bestAnswerStreak: 5 }).unlocked, ['warming-up', 'on-a-roll']);
  assert.deepEqual(checkAll({ bestAnswerStreak: 12 }).unlocked, ['warming-up', 'on-a-roll', 'unstoppable']);
});

test('streak achievements accept today or best', () => {
  assert.deepEqual(checkAll({ dayStreak: 3 }).unlocked, ['day-3']);
  assert.deepEqual(checkAll({ dayStreakBest: 7 }).unlocked, ['day-3', 'day-7']);
  assert.deepEqual(checkAll({ dayStreak: 30 }).unlocked, ['day-3', 'day-7', 'day-30']);
});

test('one day achievements: variety, bites and languages', () => {
  assert.deepEqual(checkAll({ activityTypesToday: 6 }).unlocked, ['variety-pack']);
  assert.deepEqual(checkAll({ bitesToday: 3 }).unlocked, ['bite-size']);
  assert.deepEqual(checkAll({ studyLanguages: 2 }).unlocked, ['polyglot']);
  assert.deepEqual(checkAll({ lensesUsedOnOneTopic: 3 }).unlocked, ['lens-switcher']);
  assert.deepEqual(checkAll({ bestTeachCoverage: 0.8 }).unlocked, ['teach-it']);
  assert.deepEqual(checkAll({ bestTeachCoverage: 0.79 }).unlocked, []);
});

test('never pays the same achievement twice', () => {
  const first = checkAll({ stepsDone: 1, points: 200 }, { at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(first.unlocked.sort(), ['century', 'first-step']);
  const second = checkAll({ stepsDone: 2, points: 200 }, { earned: first.earned, at: '2026-02-01T00:00:00.000Z' });
  assert.deepEqual(second.unlocked, []);
  assert.equal(second.earned['century'].at, '2026-01-01T00:00:00.000Z', 'the first date is kept');
});

test('a broken test never crashes the check', () => {
  const { unlocked } = checkAll({ get stepsDone() { throw new Error('boom'); } });
  assert.ok(Array.isArray(unlocked));
});

test('achievementList and summary count in design order', () => {
  const earned = { 'first-step': { at: '2026-01-01' }, summit: { at: '2026-02-01' } };
  const list = achievementList(earned);
  assert.equal(list.length, 28);
  assert.equal(list[0].id, 'first-step');
  assert.equal(list[0].earned, true);
  assert.equal(list[1].earned, false);
  const summary = achievementSummary(earned);
  assert.equal(summary.earned, 2);
  assert.equal(summary.total, 28);
  assert.equal(achievementSummary({}).earned, 0);
});

test('progressTowards tells how far away a numeric badge is', () => {
  assert.deepEqual(progressTowards('grinder', 32, 50), { value: 32, target: 50, done: false, remaining: 18 });
  assert.equal(progressTowards('grinder', 50, 50).done, true);
  assert.equal(progressTowards('nope', 1, 1), null);
});
