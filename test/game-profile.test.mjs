import test from 'node:test';
import assert from 'node:assert/strict';

import {
  biteDone,
  emptyProfile,
  lensUsed,
  mergeProfiles,
  normaliseProfile,
  noteExport,
  shortcutsLeft,
  spendShortcut,
  stepDone,
  studyLanguage,
  syncWalletForStreak,
  teachScored,
  dayBucket,
} from '../src/game/profile.js';

const DAY1 = new Date(2026, 2, 1, 10, 0);
const DAY2 = new Date(2026, 2, 2, 10, 0);

test('a new profile starts clean', () => {
  const p = emptyProfile();
  assert.equal(p.points, 0);
  assert.equal(p.dayStreak.current, 0);
  assert.equal(p.wallet.balance, 7);
  assert.deepEqual(p.achievements, {});
  assert.equal(p.v, 1);
});

test('normaliseProfile fills gaps and drops junk', () => {
  const p = normaliseProfile({ points: '120', dayStreak: { current: 2 } });
  assert.equal(p.points, 120);
  assert.equal(p.dayStreak.current, 2);
  assert.equal(p.dayStreak.best, 0);
  assert.equal(p.wallet.balance, 7);
  assert.deepEqual(p.days, {});
  assert.deepEqual(normaliseProfile(null), emptyProfile());
  assert.equal(normaliseProfile({ points: -5 }).points, 0);
});

test('a finished step adds points, the day streak and the counters', () => {
  const r = stepDone(emptyProfile(), { points: 15, type: 'quiz', noHint: true, when: DAY1 });
  assert.equal(r.profile.points, 15);
  assert.equal(r.profile.dayStreak.current, 1);
  assert.equal(r.profile.counts.stepsDone, 1);
  assert.equal(r.profile.counts.noHintCompletions, 1);
  assert.deepEqual(r.unlocked, ['first-step']);
  assert.deepEqual(dayBucket(r.profile, '2026-03-01').types, ['quiz']);
});

test('the plan streak only moves when the daily goal was met', () => {
  const met = stepDone(emptyProfile(), { points: 15, goalMet: true, when: DAY1 });
  assert.equal(met.profile.planStreak.current, 1);
  const missed = stepDone(met.profile, { points: 15, goalMet: false, when: DAY2 });
  assert.equal(missed.profile.planStreak.current, 1);
  assert.equal(missed.profile.dayStreak.current, 2);
});

test('coming back after three days away earns Back Again', () => {
  const first = stepDone(emptyProfile(), { points: 15, when: new Date(2026, 0, 1, 9) });
  const back = stepDone(first.profile, { points: 15, when: new Date(2026, 0, 6, 9) });
  assert.ok(back.unlocked.includes('back-again'));
  assert.equal(back.profile.dayStreak.current, 1, 'the streak restarted without a lecture');
  const quick = stepDone(emptyProfile(), { points: 15, when: DAY1 });
  assert.ok(!quick.unlocked.includes('back-again'));
});

test('a finished bite counts bites and activity types for the day', () => {
  const r = biteDone(emptyProfile(), { points: 55, activityTypes: ['quiz', 'flash', 'match', 'order'], when: DAY1 });
  assert.equal(r.profile.points, 55);
  assert.equal(r.profile.counts.bitesDone, 1);
  const bucket = dayBucket(r.profile, '2026-03-01');
  assert.equal(bucket.bites, 1);
  assert.equal(bucket.types.length, 4);
});

test('three bites in a day unlock Bite Size', () => {
  let profile = emptyProfile();
  for (let i = 0; i < 3; i += 1) profile = biteDone(profile, { points: 25, when: DAY1 }).profile;
  assert.ok(profile.achievements['bite-size']);
});

test('six activity types in one day unlock Variety Pack', () => {
  const r = stepDone(emptyProfile(), { points: 15, when: DAY1 });
  let profile = r.profile;
  for (const type of ['quiz', 'flash', 'match', 'order', 'swipe', 'listen']) {
    profile = stepDone(profile, { points: 15, type, when: DAY1 }).profile;
  }
  assert.ok(profile.achievements['variety-pack']);
});

test('a bite pays the Shortcut for the streak milestone once', () => {
  let profile = emptyProfile();
  profile = stepDone(profile, { points: 15, when: DAY1 }).profile;
  profile = biteDone(profile, { points: 20, when: DAY1 }).profile;
  assert.equal(shortcutsLeft(profile), 7, 'day 1 pays nothing');
  const two = stepDone(profile, { points: 15, when: DAY2 }).profile;
  const three = stepDone(two, { points: 15, when: new Date(2026, 2, 3, 9) }).profile;
  const paid = biteDone(three, { points: 20, when: new Date(2026, 2, 3, 9) }).profile;
  assert.equal(paid.dayStreak.current, 3);
  assert.equal(paid.wallet.earnedFor, 1);
  const again = syncWalletForStreak(paid).profile;
  assert.equal(shortcutsLeft(again), shortcutsLeft(paid), 'syncing the same streak pays nothing more');
});

test('spendShortcut lowers the wallet and can refuse', () => {
  const p = emptyProfile();
  const ok = spendShortcut(p, { campId: 'camp-1', kind: 'step', itemId: 's1', day: '2026-03-01' });
  assert.equal(ok.spent, true);
  assert.equal(shortcutsLeft(ok.profile), 6);
  const blocked = spendShortcut(ok.profile, { campId: 'camp-1', kind: 'step', itemId: 's2', isCheckpoint: true });
  assert.equal(blocked.spent, false);
  assert.equal(blocked.reason, 'checkpoint');
});

test('Lens usage on one topic unlocks Lens Switcher on the third', () => {
  let profile = emptyProfile();
  profile = lensUsed(profile, { topicId: 't1', lensId: 'oral' }).profile;
  assert.ok(!profile.achievements['lens-switcher']);
  profile = lensUsed(profile, { topicId: 't1', lensId: 'oral' }).profile;
  assert.equal(profile.lensesUsed.length, 1, 'the same Lens twice is not a switch');
  profile = lensUsed(profile, { topicId: 't1', lensId: 'plain' }).profile;
  profile = lensUsed(profile, { topicId: 't1', lensId: 'exam' }).profile;
  assert.ok(profile.achievements['lens-switcher']);
});

test('two languages and 80% teach coverage unlock their badges', () => {
  let profile = studyLanguage(emptyProfile(), 'en').profile;
  assert.ok(!profile.achievements.polyglot);
  profile = studyLanguage(profile, 'es').profile;
  assert.ok(profile.achievements.polyglot);
  const taught = teachScored(emptyProfile(), 0.8).profile;
  assert.ok(taught.achievements['teach-it']);
  assert.equal(teachScored(emptyProfile(), 0.5).profile.achievements['teach-it'], undefined);
});

test('noteExport adds the paid points once', () => {
  const p = noteExport(emptyProfile(), { camp: 'camp-1', day: '2026-03-01', format: 'guide' }, 30);
  assert.equal(p.points, 30);
  assert.equal(p.exports.length, 1);
});

test('merging two devices never double pays points', () => {
  const a = stepDone(emptyProfile(), { points: 100, when: DAY1 }).profile;
  const b = stepDone(emptyProfile(), { points: 40, when: DAY1 }).profile;
  const merged = mergeProfiles(a, b);
  assert.equal(merged.points, 100);
  assert.equal(merged.counts.stepsDone, 1, 'the largest count wins, not the sum');
  assert.ok(merged.achievements['first-step']);
});

test('merging keeps the later streak, the union of types and achievements', () => {
  const a = stepDone(emptyProfile(), { points: 10, type: 'quiz', when: DAY1 }).profile;
  const b = stepDone(emptyProfile(), { points: 10, type: 'flash', when: DAY2 }).profile;
  const merged = mergeProfiles(a, b, 'right');
  assert.equal(merged.dayStreak.lastDay, '2026-03-02');
  assert.deepEqual(merged.days['2026-03-02'].types, ['flash']);
  assert.ok(merged.achievements['first-step']);
  assert.equal(merged.wallet.balance, 7);
});

test('merging takes the larger per day counts and the union of Lens history', () => {
  const a = { ...emptyProfile(), days: { '2026-03-01': { bites: 2, steps: 1, types: ['quiz'], minutes: 5 } }, lensesUsed: ['t1:oral'] };
  const b = { ...emptyProfile(), days: { '2026-03-01': { bites: 1, steps: 4, types: ['flash'], minutes: 9 } }, lensesUsed: ['t1:plain'] };
  const merged = mergeProfiles(a, b);
  assert.deepEqual(merged.days['2026-03-01'], { bites: 2, steps: 4, types: ['quiz', 'flash'], minutes: 9 });
  assert.deepEqual(merged.lensesUsed, ['t1:oral', 't1:plain']);
});

test('actions never mutate the profile they are given', () => {
  const p = emptyProfile();
  const copy = JSON.stringify(p);
  stepDone(p, { points: 15, when: DAY1 });
  biteDone(p, { points: 20, when: DAY1 });
  spendShortcut(p, { campId: 'camp-1', kind: 'step', itemId: 's1' });
  teachScored(p, 0.9);
  assert.equal(JSON.stringify(p), copy);
});
