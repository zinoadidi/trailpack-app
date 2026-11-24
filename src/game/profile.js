// The Trailpack "game profile": one plain object that holds points, both day
// streaks, the Shortcut wallet, achievements and counters per day. Every
// function here is pure and returns a new profile, so the store and the sync
// engine can keep the previous copy for undo and conflict merges.
//
// Stored as one doc per user: collection `settings`, id `game-profile`.
// See ./README.md for the shape.

import { addPoints } from './points.js';
import { recordStep, touchDay, dayKey, crossedShortcutMilestone, returnGapDays } from './streaks.js';
import { emptyWallet, earnForStreak, spend, walletBalance } from './shortcuts.js';
import { checkAll } from './achievements.js';

export const PROFILE_VERSION = 1;

export function emptyProfile() {
  return {
    v: PROFILE_VERSION,
    points: 0,
    levelBest: 1,
    dayStreak: { current: 0, best: 0, lastDay: null },
    planStreak: { current: 0, best: 0, lastDay: null },
    wallet: emptyWallet(),
    achievements: {},
    counts: { stepsDone: 0, noHintCompletions: 0, comebacks: 0, checkpointsPassed: 0, bitesDone: 0, masteredCount: 0, teaches: 0 },
    days: {},
    exports: [],
    lensesUsed: [],
    studyLangs: [],
    activityTypes: [],
    flags: {},
    updatedAt: null,
  };
}

/** Fill in missing fields so an older or partial profile never throws. */
export function normaliseProfile(profile) {
  const base = emptyProfile();
  if (!profile || typeof profile !== 'object') return base;
  return {
    ...base,
    ...profile,
    v: PROFILE_VERSION,
    points: Math.max(0, Number(profile.points) || 0),
    dayStreak: { ...base.dayStreak, ...(profile.dayStreak || {}) },
    planStreak: { ...base.planStreak, ...(profile.planStreak || {}) },
    wallet: { ...base.wallet, ...(profile.wallet || {}) },
    achievements: { ...(profile.achievements || {}) },
    counts: { ...base.counts, ...(profile.counts || {}) },
    days: { ...(profile.days || {}) },
    exports: Array.isArray(profile.exports) ? [...profile.exports] : [],
    lensesUsed: Array.isArray(profile.lensesUsed) ? [...profile.lensesUsed] : [],
    studyLangs: Array.isArray(profile.studyLangs) ? [...profile.studyLangs] : [],
    activityTypes: Array.isArray(profile.activityTypes) ? [...profile.activityTypes] : [],
    flags: { ...(profile.flags || {}) },
  };
}

/** Today's counters: bites, steps, activity types seen. */
export function dayBucket(profile, day) {
  const bucket = normaliseProfile(profile).days[day] || {};
  return { bites: 0, steps: 0, types: [], minutes: 0, ...bucket };
}

function withDay(profile, day, patch) {
  const bucket = { ...dayBucket(profile, day), ...patch };
  return { ...profile, days: { ...profile.days, [day]: bucket } };
}

function addUniq(list, value) {
  if (!value) return list;
  return list.includes(value) ? list : [...list, value];
}

/**
 * A finished step. Updates points, the day streak (a step counts as activity),
 * the plan streak when the Daily Walk goal was met, and per day counters.
 *
 * @param {object} profile
 * @param {{ points?: number, type?: string, noHint?: boolean, comeback?: boolean,
 *   minutes?: number, goalMet?: boolean, when?: number|string }} step
 */
export function stepDone(profile, step = {}) {
  const p = normaliseProfile(profile);
  const when = step.when ?? Date.now();
  const day = typeof when === 'string' ? when.slice(0, 10) : dayKey(when);
  const points = Math.max(0, Number(step.points) || 0);
  let next = { ...p, points: addPoints(p.points, points) };
  next.dayStreak = touchDay(next.dayStreak, day);
  if (step.goalMet) next.planStreak = touchDay(next.planStreak, day);
  next.counts = {
    ...next.counts,
    stepsDone: next.counts.stepsDone + 1,
    noHintCompletions: next.counts.noHintCompletions + (step.noHint ? 1 : 0),
    comebacks: next.counts.comebacks + (step.comeback ? 1 : 0),
  };
  const bucket = dayBucket(next, day);
  const types = addUniq(bucket.types, step.type || null);
  next = withDay(next, day, { steps: bucket.steps + 1, types, minutes: bucket.minutes + Math.max(0, Number(step.minutes) || 0) });
  next.bestAnswerStreak = Math.max(Number(next.bestAnswerStreak) || 0, Number(step.answerStreak) || 0);
  // Back Again: returning after 3 or more days away and finishing a step.
  const gap = returnGapDays(p.dayStreak.lastDay, day);
  if (gap >= 3) next.flags = { ...next.flags, backAgain: true };
  next = touch(next, step.when ?? new Date().toISOString());
  return checkAllStats(next);
}

/** A finished bite: +20 (and the variety bonus is already inside `points`). */
export function biteDone(profile, bite = {}) {
  let p = normaliseProfile(profile);
  const when = bite.when ?? Date.now();
  const day = typeof when === 'string' ? when.slice(0, 10) : dayKey(when);
  const points = Math.max(0, Number(bite.points) || 0);
  let next = { ...p, points: addPoints(p.points, points) };
  next.counts = { ...next.counts, bitesDone: next.counts.bitesDone + 1 };
  const bucket = dayBucket(next, day);
  next = withDay(next, day, { bites: bucket.bites + 1, types: setTypes(bucket, bite.activityTypes) });
  next = touch(next, bite.when ?? new Date().toISOString());
  const result = checkAllStats(next);
  return { ...result, profile: syncWalletForStreak(result.profile).profile };
}

function setTypes(bucket, types) {
  let list = [...(bucket.types || [])];
  for (const type of types || []) list = addUniq(list, type);
  return list;
}

/** A new study language was used for material. */
export function studyLanguage(profile, lang) {
  const next = { ...normaliseProfile(profile), studyLangs: addUniq(normaliseProfile(profile).studyLangs, lang) };
  return checkAllStats(next);
}

/** A Lens was used for a topic. Three on one topic is Lens Switcher. */
export function lensUsed(profile, { lensId, topicId } = {}) {
  const p = normaliseProfile(profile);
  const entry = String(topicId || 'all') + ':' + String(lensId || 'default');
  if (p.lensesUsed.includes(entry)) return { profile: p, unlocked: [] };
  return checkAllStats({ ...p, lensesUsed: [...p.lensesUsed, entry] });
}

/** Teach it back result coverage (0 to 1). */
export function teachScored(profile, coverage) {
  const p = normaliseProfile(profile);
  const next = {
    ...p,
    counts: { ...p.counts, teaches: p.counts.teaches + 1 },
    bestTeachCoverage: Math.max(Number(p.bestTeachCoverage) || 0, Math.max(0, Math.min(1, Number(coverage) || 0))),
  };
  return checkAllStats(next);
}

/**
 * The counters of the latest active day. Every action that can unlock a badge
 * runs right after that day's bucket was written, so the newest day is the one
 * to judge. Using the newest day instead of "today" also keeps a test or a
 * replay of an older day honest.
 */
function newestBucket(days = {}) {
  const keys = Object.keys(days || {}).sort();
  if (!keys.length) return { bites: 0, steps: 0, types: [], minutes: 0 };
  return { bites: 0, steps: 0, types: [], minutes: 0, ...days[keys[keys.length - 1]] };
}

function touch(profile, at) {
  return { ...profile, updatedAt: at };
}

/**
 * Run the achievement table against the profile's own counters. Called after
 * every action, so a badge can never arrive a screen late.
 */
export function checkAllStats(profile, at) {
  const p = normaliseProfile(profile);
  const bucket = newestBucket(p.days);
  const distinctLensesOnTopic = (() => {
    const byTopic = {};
    for (const entry of p.lensesUsed) {
      const [topic, lens] = String(entry).split(':');
      byTopic[topic] = byTopic[topic] || new Set();
      byTopic[topic].add(lens);
    }
    return Math.max(0, ...Object.values(byTopic).map((set) => set.size));
  })();
  const stats = {
    points: p.points,
    stepsDone: p.counts.stepsDone,
    noHintCompletions: p.counts.noHintCompletions,
    comebacks: p.counts.comebacks,
    checkpointsPassed: p.counts.checkpointsPassed,
    masteredCount: p.counts.masteredCount,
    bestAnswerStreak: p.bestAnswerStreak || 0,
    dayStreak: p.dayStreak.current,
    dayStreakBest: p.dayStreak.best,
    biteCountToday: bucket.bites,
    bitesToday: bucket.bites,
    activityTypesToday: bucket.types.length,
    distinctLenses: new Set(p.lensesUsed.map((e) => String(e).split(':')[1])).size,
    lensesUsedOnOneTopic: distinctLensesOnTopic,
    bestTeachCoverage: p.bestTeachCoverage || 0,
    studyLanguages: p.studyLangs.length,
    backAgain: p.flags.backAgain === true,
    camp1Done: p.flags.camp1Done === true,
    halfway: p.flags.halfway === true,
    summit: p.flags.summit === true,
    cleanSheet: p.flags.cleanSheet === true,
    nightBefore: p.flags.nightBefore === true,
    bossFullHealth: p.flags.bossFullHealth === true,
    fullMastery: p.flags.fullMastery === true,
  };
  const { earned, unlocked } = checkAll(stats, { earned: p.achievements, at: at || new Date().toISOString() });
  return { profile: { ...p, achievements: earned, newlyUnlocked: unlocked }, unlocked };
}

/**
 * The wallet after a day streak change. Pays +1 per 3 day milestone, once.
 */
export function syncWalletForStreak(profile) {
  const p = normaliseProfile(profile);
  const { wallet, gained } = earnForStreak(p.wallet, p.dayStreak.current);
  return { profile: { ...p, wallet }, shortcutGained: gained };
}

/** Spend a Shortcut. Returns `{ profile, spent, reason }`. */
export function spendShortcut(profile, item) {
  const p = normaliseProfile(profile);
  const result = spend(p.wallet, item, item.day);
  return { profile: { ...p, wallet: result.wallet }, spent: result.spent, reason: result.reason };
}

/** Wallet balance for the UI. */
export function shortcutsLeft(profile) {
  return walletBalance(normaliseProfile(profile).wallet);
}

/** Log an export so the 30 points are paid once per Camp per day. */
export function noteExport(profile, entry, gained = 0) {
  const p = normaliseProfile(profile);
  return { ...p, points: addPoints(p.points, gained), exports: [...p.exports, { camp: entry.camp, day: entry.day, format: entry.format || null }] };
}

/** Did a day streak just cross a Shortcut milestone? */
export function justEarnedShortcut(before, after) {
  return crossedShortcutMilestone(normaliseProfile(before).dayStreak.current, normaliseProfile(after).dayStreak.current);
}

/**
 * Two profiles from two devices, merged without double paying. Points are
 * never summed (that would double pay): the larger total wins, and the per day
 * buckets take the larger count, which is the same spirit as the sync engine's
 * per fact progress merge. `prefer` breaks ties: 'left' keeps the previous
 * copy, 'right' keeps the incoming one.
 */
export function mergeProfiles(a, b, prefer = 'left') {
  const left = normaliseProfile(a);
  const right = normaliseProfile(b);
  const days = { ...left.days };
  for (const [day, bucket] of Object.entries(right.days)) {
    const mine = days[day];
    if (!mine) {
      days[day] = bucket;
      continue;
    }
    days[day] = {
      bites: Math.max(mine.bites || 0, bucket.bites || 0),
      steps: Math.max(mine.steps || 0, bucket.steps || 0),
      types: [...new Set([...(mine.types || []), ...(bucket.types || [])])],
      minutes: Math.max(mine.minutes || 0, bucket.minutes || 0),
    };
  }
  return {
    ...left,
    points: Math.max(left.points, right.points),
    dayStreak: laterStreak(left.dayStreak, right.dayStreak),
    planStreak: laterStreak(left.planStreak, right.planStreak),
    wallet: {
      balance: Math.min(left.wallet.balance, right.wallet.balance),
      earnedFor: Math.max(left.wallet.earnedFor || 0, right.wallet.earnedFor || 0),
      used: maxByKey(left.wallet.used, right.wallet.used),
      skipped: unionById(left.wallet.skipped, right.wallet.skipped),
    },
    achievements: prefer === 'right' ? { ...left.achievements, ...right.achievements } : { ...right.achievements, ...left.achievements },
    counts: {
      stepsDone: Math.max(left.counts.stepsDone, right.counts.stepsDone),
      noHintCompletions: Math.max(left.counts.noHintCompletions, right.counts.noHintCompletions),
      comebacks: Math.max(left.counts.comebacks, right.counts.comebacks),
      checkpointsPassed: Math.max(left.counts.checkpointsPassed, right.counts.checkpointsPassed),
      bitesDone: Math.max(left.counts.bitesDone, right.counts.bitesDone),
      masteredCount: Math.max(left.counts.masteredCount, right.counts.masteredCount),
      teaches: Math.max(left.counts.teaches, right.counts.teaches),
    },
    days,
    exports: unionByIdentity(left.exports, right.exports, (e) => e.camp + '@' + e.day),
    lensesUsed: [...new Set([...left.lensesUsed, ...right.lensesUsed])],
    studyLangs: [...new Set([...left.studyLangs, ...right.studyLangs])],
    activityTypes: [...new Set([...left.activityTypes, ...right.activityTypes])],
    flags: prefer === 'right' ? { ...left.flags, ...right.flags } : { ...right.flags, ...left.flags },
    bestAnswerStreak: Math.max(left.bestAnswerStreak || 0, right.bestAnswerStreak || 0),
    // The wire marks (paid steps per bite) union like the Lenses: never pay twice.
    wire: { bites: { ...((right.wire && right.wire.bites) || {}), ...((left.wire && left.wire.bites) || {}) }, steps: [...new Set([...((left.wire && left.wire.steps) || []), ...((right.wire && right.wire.steps) || [])])].slice(-400) },
    bestTeachCoverage: Math.max(left.bestTeachCoverage || 0, right.bestTeachCoverage || 0),
    levelBest: Math.max(left.levelBest || 1, right.levelBest || 1),
    updatedAt: laterDate(left.updatedAt, right.updatedAt),
  };
}

function laterStreak(a = {}, b = {}) {
  const lastA = a.lastDay || '';
  const lastB = b.lastDay || '';
  const pick = lastA >= lastB ? a : b;
  const other = pick === a ? b : a;
  return {
    current: Number(pick.current) || 0,
    best: Math.max(Number(a.best) || 0, Number(b.best) || 0, Number(other.current) || 0),
    lastDay: pick.lastDay || null,
  };
}

function maxByKey(a = {}, b = {}) {
  const out = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) out[key] = Math.max(Number(out[key]) || 0, Number(value) || 0);
  return out;
}

function unionById(a = [], b = []) {
  const seen = new Set();
  return [...(a || []), ...(b || [])].filter((item) => {
    const id = item && item.id ? item.id : JSON.stringify(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function unionByIdentity(a = [], b = [], keyOf = (x) => JSON.stringify(x)) {
  const seen = new Set();
  return [...(a || []), ...(b || [])].filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function laterDate(a, b) {
  const ta = Date.parse(a) || 0;
  const tb = Date.parse(b) || 0;
  return ta >= tb ? a || b || null : b || a || null;
}
