// Points (XP): one currency, awarded per action, with the design's modifiers.
// Pure functions over plain objects. See ./README.md for the input shapes.

/** Base points per action, straight from design section 4.1. */
export const POINTS = {
  'learn-card': 5,
  'flash-first-try': 3,
  'quiz-correct': 10,
  'blitz-correct': 10,
  'bite-finished': 20,
  checkpoint: 50,
  'summit-pass': 150,
  'summit-fail': 60,
  'boss-win': 60,
  'boss-full-health': 20,
  export: 30,
  replay: 5,
  'teach-back': 5,
  mastered: 25,
  step: 15,
};

/** Guided tasks award 15 to 30 by difficulty, checked out of the table. */
export const TASK_POINTS = { easy: 15, medium: 20, hard: 25, expert: 30 };

/** Variety bonus: +10% when a bite uses 4 or more activity types. */
export const VARIETY_MIN_TYPES = 4;
export const VARIETY_BONUS = 0.1;

export const MODIFIERS = {
  'no-hint': 0.2,
  'lens-hard': 0.1,
  comeback: 0,
};

/**
 * Base points for one action.
 * `action` is a POINTS key or `{ type, difficulty }` for a guided step.
 */
export function basePoints(action) {
  if (typeof action === 'string') {
    if (action === 'task') return TASK_POINTS.medium;
    return POINTS[action] ?? 0;
  }
  if (!action) return 0;
  const { type, difficulty } = action;
  if (type === 'task' || type === 'guided-task') {
    return TASK_POINTS[difficulty] ?? (difficulty === undefined ? TASK_POINTS.medium : TASK_POINTS.hard);
  }
  return POINTS[type] ?? 0;
}

/**
 * Points after modifiers.
 *   - no-hint +20% (only when `hint` is explicitly false)
 *   - Lens hard +10% (only when `lensDifficulty === 'hard'`)
 *   - comeback (pass right after revealing the answer) is a win with no bonus
 *     (the base points, without the no-hint or Lens percentage)
 *   - negative modifiers are ignored, points never drop below zero
 */
export function actionPoints(action, modifiers = {}) {
  const base = basePoints(action);
  if (base <= 0) return 0;
  let pct = 0;
  if (modifiers.hint === false) pct += MODIFIERS['no-hint'];
  if (modifiers.lensDifficulty === 'hard') pct += MODIFIERS['lens-hard'];
  if (modifiers.comeback === true) return base;
  return Math.round(base * (1 + pct));
}

/** True when a bite earns the variety bonus. */
export function varietyCount(activityTypes) {
  return new Set((activityTypes || []).filter(Boolean)).size;
}

export function earnsVarietyBonus(activityTypes) {
  return varietyCount(activityTypes) >= VARIETY_MIN_TYPES;
}

/**
 * Points for one finished bite: the per step points already awarded are passed
 * in as `stepPoints`, the bite reward is added, then the variety bonus applies
 * to the whole bite.
 *
 * @param {{ stepPoints?: number, activityTypes?: string[], points?: object }} bite
 */
export function bitePoints(bite = {}) {
  const step = Math.max(0, Number(bite.stepPoints) || 0);
  const finished = POINTS['bite-finished'];
  const total = step + finished;
  if (earnsVarietyBonus(bite.activityTypes)) return Math.round(total * (1 + VARIETY_BONUS));
  return total;
}

/** Exports award 30 once per Camp per day. `log` is a list of `{ camp, day }`. */
export function exportAward(entry, log = []) {
  const camp = entry && entry.camp ? entry.camp : null;
  const day = (entry || {}).day || null;
  const already = (log || []).some((item) => item && (item.camp || null) === camp && item.day === day);
  return already ? 0 : POINTS.export;
}

/** Add points to a running total without ever going negative. */
export function addPoints(total, delta) {
  return Math.max(0, (Number(total) || 0) + (Number(delta) || 0));
}
