// Streaks (design 4.2): answer streak inside a session, day streak (distinct
// days with a finished step) and plan streak (consecutive days the Daily Walk
// goal was met). Pure functions, all dates are `YYYY-MM-DD` strings or epoch ms.

/** Combo multiplier for the answer streak: x2 at 5, x3 at 10, x4 at 20. */
export const COMBO_STEPS = [
  { at: 20, multiplier: 4 },
  { at: 10, multiplier: 3 },
  { at: 5, multiplier: 2 },
];

/** Consecutive misses that end a run. A single miss keeps the combo going. */
export const MISS_LIMIT = 2;

export function comboMultiplier(streak) {
  const value = Math.max(0, Number(streak) || 0);
  for (const step of COMBO_STEPS) {
    if (value >= step.at) return step.multiplier;
  }
  return 1;
}

/**
 * One answer in a session. Returns the new state; never mutates the input.
 * @param {{ current: number, best: number, misses: number }} state
 * @param {boolean} correct
 */
export function answerStep(state = {}, correct) {
  const current = Math.max(0, Number(state.current) || 0);
  const best = Math.max(current, Number(state.best) || 0);
  const misses = Math.max(0, Number(state.misses) || 0);
  if (correct) {
    const next = current + 1;
    return { current: next, best: Math.max(best, next), misses: 0, multiplier: comboMultiplier(next) };
  }
  const nextMisses = misses + 1;
  if (nextMisses >= MISS_LIMIT) {
    return { current: 0, best, misses: 0, multiplier: 1 };
  }
  return { current, best, misses: nextMisses, multiplier: comboMultiplier(current) };
}

/** Local calendar day as `YYYY-MM-DD` (not UTC, so a late evening still counts). */
export function dayKey(when) {
  const d = when instanceof Date ? when : new Date(when ?? Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days between two day keys (b - a). */
export function daysBetween(a, b) {
  const ms = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export function previousDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Register activity on a day and update a day based streak.
 * Same day: no change. Next day: +1. Anything else (a gap, or a clock step
 * back): restart at 1, so timezone changes never inflate or erase by accident.
 *
 * @param {{ current?: number, best?: number, lastDay?: string|null }} streak
 * @param {string} day
 */
export function touchDay(streak = {}, day) {
  const current = Math.max(0, Number(streak.current) || 0);
  const best = Math.max(current, Number(streak.best) || 0);
  const last = streak.lastDay || null;
  if (last === day) return { current, best, lastDay: day, changed: false };
  const next = last && daysBetween(last, day) === 1 ? current + 1 : 1;
  return { current: next, best: Math.max(best, next), lastDay: day, changed: true };
}

/**
 * Streak as shown today: a streak that was not touched yesterday or today is
 * displayed as 0 but `best` is kept, so no guilt copy and no data loss.
 */
export function streakToday(streak = {}, today) {
  const current = Math.max(0, Number(streak.current) || 0);
  const last = streak.lastDay || null;
  const alive = last ? daysBetween(last, today) <= 1 : false;
  return {
    current: alive ? current : 0,
    best: Math.max(current, Number(streak.best) || 0),
    lastDay: last,
    alive,
  };
}

/**
 * One finished step at a given time updates both day streaks.
 * A plan streak only moves when the Daily Walk goal was met that day.
 */
export function recordStep(profile = {}, when = Date.now()) {
  const day = dayKey(when);
  return {
    dayStreak: touchDay(profile.dayStreak || {}, day),
    planStreak: profile.goalMet
      ? touchDay(profile.planStreak || {}, day)
      : profile.planStreak || { current: 0, best: 0, lastDay: null },
    lastActiveDay: day,
  };
}

/** Shortcuts earned so far for a day streak: +1 for every 3 days. */
export function shortcutMilestones(dayStreak) {
  return Math.floor(Math.max(0, Number(dayStreak) || 0) / 3);
}

/** True when a day streak just reached a 3 day boundary. */
export function crossedShortcutMilestone(before, after) {
  return shortcutMilestones(after) > shortcutMilestones(before);
}

/** Returned after a break of 3 or more days (Back Again achievement). */
export function returnGapDays(lastActiveDay, today) {
  if (!lastActiveDay) return 0;
  return Math.max(0, daysBetween(lastActiveDay, today) - 1);
}

/** The two day streak keys checked by achievements and the flame on Trail. */
export const STREAK_KINDS = ['day', 'plan'];

/**
 * Friendly streak state for a screen: current, best and today's touches.
 * @param {{ dayStreak?: object, planStreak?: object }} profile
 * @param {string} today `YYYY-MM-DD`
 */
export function streakSummary(profile = {}, today) {
  return {
    day: streakToday(profile.dayStreak, today),
    plan: streakToday(profile.planStreak, today),
  };
}
