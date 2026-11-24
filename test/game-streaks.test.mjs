import test from 'node:test';
import assert from 'node:assert/strict';

import { answerStep, comboMultiplier, dayKey, daysBetween, previousDay, recordStep, returnGapDays, shortcutMilestones, crossedShortcutMilestone, streakToday, touchDay } from '../src/game/streaks.js';
import { WALLET, canSpend, earnForStreak, emptyWallet, spend, skippedQueue, usedInCamp, walletBalance } from '../src/game/shortcuts.js';

test('answer streak combo goes x2 at 5, x3 at 10, x4 at 20', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(4), 1);
  assert.equal(comboMultiplier(5), 2);
  assert.equal(comboMultiplier(9), 2);
  assert.equal(comboMultiplier(10), 3);
  assert.equal(comboMultiplier(20), 4);
  assert.equal(comboMultiplier(99), 4);
});

test('a single miss keeps the combo, a second ends it', () => {
  let state = { current: 6, best: 6, misses: 0 };
  state = answerStep(state, true);
  assert.equal(state.current, 7);
  assert.equal(state.multiplier, 2);
  state = answerStep(state, false);
  assert.equal(state.current, 7, 'one miss keeps the run');
  assert.equal(state.misses, 1);
  state = answerStep(state, false);
  assert.equal(state.current, 0, 'two misses in a row reset it');
  assert.equal(state.misses, 0);
  assert.equal(state.best, 7, 'the best survives');
  state = answerStep(state, true);
  assert.equal(state.current, 1);
  assert.equal(state.best, 7);
});

test('answerStep does not mutate and survives junk input', () => {
  const state = { current: 3, best: 3, misses: 0 };
  const next = answerStep(state, true);
  assert.equal(state.current, 3);
  assert.equal(next.current, 4);
  assert.equal(answerStep(undefined, false).current, 0);
});

test('day keys are local days and daysBetween counts whole days', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.equal(daysBetween('2026-01-05', '2026-01-06'), 1);
  assert.equal(daysBetween('2026-01-05', '2026-03-01'), 55);
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});

test('day streak: same day no change, next day +1, a gap restarts at 1', () => {
  let streak = { current: 0, best: 0, lastDay: null };
  streak = touchDay(streak, '2026-02-01');
  assert.equal(streak.current, 1);
  assert.equal(streak.changed, true);
  streak = touchDay(streak, '2026-02-01');
  assert.equal(streak.current, 1);
  assert.equal(streak.changed, false);
  streak = touchDay(streak, '2026-02-02');
  assert.equal(streak.current, 2);
  streak = touchDay(streak, '2026-02-05');
  assert.equal(streak.current, 1, 'a gap starts again at 1 without a scolding');
  assert.equal(streak.best, 2);
});

test('a clock step back does not inflate a streak', () => {
  const streak = touchDay({ current: 6, best: 6, lastDay: '2026-02-10' }, '2026-02-08');
  assert.equal(streak.current, 1);
  assert.equal(streak.best, 6);
});

test('a stale streak shows as 0 today but the best is kept', () => {
  const streak = { current: 9, best: 9, lastDay: '2026-02-01' };
  assert.deepEqual(streakToday(streak, '2026-02-02').current, 9, 'yesterday still counts');
  assert.equal(streakToday(streak, '2026-02-05').current, 0);
  assert.equal(streakToday(streak, '2026-02-05').best, 9);
  assert.equal(streakToday({}, '2026-02-05').current, 0);
});

test('recordStep moves the day streak always and the plan streak only when the goal was met', () => {
  const when = new Date(2026, 3, 2, 19, 0);
  const met = recordStep({ dayStreak: { current: 2, best: 2, lastDay: '2026-04-01' }, planStreak: { current: 0, best: 0, lastDay: null }, goalMet: true }, when);
  assert.equal(met.dayStreak.current, 3);
  assert.equal(met.planStreak.current, 1);
  assert.equal(met.lastActiveDay, '2026-04-02');
  const missed = recordStep({ dayStreak: { current: 2, best: 2, lastDay: '2026-04-01' }, planStreak: { current: 4, best: 4, lastDay: '2026-04-01' }, goalMet: false }, when);
  assert.equal(missed.dayStreak.current, 3);
  assert.equal(missed.planStreak.current, 4, 'a missed plan day does not erase the stored value');
});

test('Shortcut milestones are one per three day streak and only fire once', () => {
  assert.equal(shortcutMilestones(2), 0);
  assert.equal(shortcutMilestones(3), 1);
  assert.equal(shortcutMilestones(9), 3);
  assert.equal(crossedShortcutMilestone(2, 3), true);
  assert.equal(crossedShortcutMilestone(3, 5), false);
  assert.equal(crossedShortcutMilestone(5, 6), true);
});

test('returnGapDays is the number of full days away', () => {
  assert.equal(returnGapDays('2026-01-01', '2026-01-05'), 3);
  assert.equal(returnGapDays('2026-01-01', '2026-01-02'), 0);
  assert.equal(returnGapDays(null, '2026-01-02'), 0);
});

test('the Shortcut wallet is 7 by default, 7 max, 2 per camp', () => {
  assert.deepEqual(WALLET, { default: 7, max: 7, perCamp: 2, earnEvery: 3 });
  assert.equal(walletBalance(emptyWallet()), 7);
  assert.equal(walletBalance({ balance: 99 }), 7);
  assert.equal(walletBalance({ balance: -3 }), 0);
  assert.equal(walletBalance({}), 7);
});

test('a Shortcut cannot skip a Checkpoint, and a camp allows two', () => {
  let wallet = emptyWallet();
  const base = { campId: 'camp-1', kind: 'step', itemId: 's1', day: '2026-01-01' };
  assert.deepEqual(canSpend(wallet, { ...base, isCheckpoint: true }), { ok: false, reason: 'checkpoint' });
  assert.deepEqual(canSpend(wallet, { ...base, kind: 'summit-mock' }), { ok: false, reason: 'kind' });
  let result = spend(wallet, base);
  assert.equal(result.spent, true);
  wallet = result.wallet;
  result = spend(wallet, { ...base, itemId: 's2' });
  assert.equal(result.spent, true);
  wallet = result.wallet;
  assert.equal(usedInCamp(wallet, 'camp-1'), 2);
  assert.equal(canSpend(wallet, { ...base, itemId: 's3' }).reason, 'camp');
  assert.equal(canSpend(wallet, { ...base, campId: 'camp-2', itemId: 's4' }).ok, true, 'another camp is fine');
  assert.equal(walletBalance(wallet), 5);
});

test('a spent Shortcut lands in the review queue', () => {
  const { wallet } = spend(emptyWallet(), { campId: 'camp-1', kind: 'bite', itemId: 'b1', day: '2026-01-01' });
  assert.deepEqual(skippedQueue(wallet), [{ id: 'b1', campId: 'camp-1', kind: 'bite', at: '2026-01-01' }]);
});

test('an empty wallet refuses and never goes negative', () => {
  const wallet = { balance: 0, earnedFor: 0, used: {} };
  const result = spend(wallet, { campId: 'camp-1', kind: 'step', itemId: 's1' });
  assert.equal(result.spent, false);
  assert.equal(result.reason, 'empty');
  assert.equal(walletBalance(result.wallet), 0);
});

test('streak milestones pay a Shortcut once, not on every render', () => {
  let wallet = emptyWallet(0);
  let step = earnForStreak(wallet, 3);
  assert.equal(step.gained, 1);
  wallet = step.wallet;
  step = earnForStreak(wallet, 3);
  assert.equal(step.gained, 0, 're-entering the app does not pay twice');
  step = earnForStreak(wallet, 6);
  assert.equal(step.gained, 1);
  wallet = step.wallet;
  assert.equal(walletBalance(wallet), 2);
  assert.equal(wallet.earnedFor, 2);
});

test('earning never pushes the wallet past 7', () => {
  const wallet = { balance: 7, earnedFor: 0, used: {} };
  const step = earnForStreak(wallet, 30);
  assert.equal(walletBalance(step.wallet), 7);
  assert.equal(step.wallet.earnedFor, 10);
});
