// Achievements (design 4.4): the full table, each one a pure predicate over a
// plain `stats` object. Every action that can unlock one runs `checkAll`, so a
// badge never shows up late. See ./README.md for the exact stats shape.

/**
 * `id` matches the design table. `group` only groups the list on Me.
 * `test(stats)` is total: missing fields count as zero.
 */
export const ACHIEVEMENTS = [
  { id: 'first-step', group: 'steps', test: (s) => num(s.stepsDone) >= 1 },
  { id: 'warming-up', group: 'answers', test: (s) => num(s.bestAnswerStreak) >= 3 },
  { id: 'on-a-roll', group: 'answers', test: (s) => num(s.bestAnswerStreak) >= 5 },
  { id: 'unstoppable', group: 'answers', test: (s) => num(s.bestAnswerStreak) >= 10 },
  { id: 'sharp-mind', group: 'answers', test: (s) => num(s.noHintCompletions) >= 5 },
  { id: 'comeback', group: 'answers', test: (s) => s.comeback === true || num(s.comebacks) >= 1 },
  { id: 'camp-1', group: 'trail', test: (s) => s.camp1Done === true },
  { id: 'halfway', group: 'trail', test: (s) => s.halfway === true || (num(s.stepsTotal) > 0 && num(s.stepsDone) / num(s.stepsTotal) >= 0.5) },
  { id: 'summit', group: 'trail', test: (s) => s.summit === true },
  { id: 'century', group: 'points', test: (s) => num(s.points) >= 100 },
  { id: 'high-roller', group: 'points', test: (s) => num(s.points) >= 500 },
  { id: 'getting-serious', group: 'steps', test: (s) => num(s.stepsDone) >= 25 },
  { id: 'grinder', group: 'steps', test: (s) => num(s.stepsDone) >= 50 },
  { id: 'quiz-whiz', group: 'checkpoints', test: (s) => num(s.checkpointsPassed) >= 5 },
  { id: 'day-3', group: 'streaks', test: (s) => num(s.dayStreakBest) >= 3 || num(s.dayStreak) >= 3 },
  { id: 'day-7', group: 'streaks', test: (s) => num(s.dayStreakBest) >= 7 || num(s.dayStreak) >= 7 },
  { id: 'day-30', group: 'streaks', test: (s) => num(s.dayStreakBest) >= 30 || num(s.dayStreak) >= 30 },
  { id: 'back-again', group: 'streaks', test: (s) => s.backAgain === true || num(s.returnGapDays) >= 3 },
  { id: 'lens-switcher', group: 'lens', test: (s) => num(s.lensesUsedOnOneTopic) >= 3 || num(s.distinctLenses) >= 3 },
  { id: 'teach-it', group: 'lens', test: (s) => num(s.bestTeachCoverage) >= 0.8 },
  { id: 'clean-sheet', group: 'checkpoints', test: (s) => s.cleanSheet === true },
  { id: 'night-before', group: 'trail', test: (s) => s.nightBefore === true },
  { id: 'variety-pack', group: 'variety', test: (s) => num(s.activityTypesToday) >= 6 },
  { id: 'bite-size', group: 'variety', test: (s) => num(s.bitesToday) >= 3 },
  { id: 'mastered-50', group: 'mastery', test: (s) => num(s.masteredCount) >= 50 },
  { id: 'full-mastery', group: 'mastery', test: (s) => s.fullMastery === true },
  { id: 'polyglot', group: 'language', test: (s) => num(s.studyLanguages) >= 2 },
  { id: 'boss-slayer', group: 'checkpoints', test: (s) => s.bossFullHealth === true },
];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

/** Unlock order used to stamp `at` when several unlock at once. */
export const ACHIEVEMENT_INDEX = Object.fromEntries(ACHIEVEMENT_IDS.map((id, i) => [id, i]));

export const ACHIEVEMENT_GROUPS = ['steps', 'answers', 'points', 'streaks', 'trail', 'checkpoints', 'variety', 'mastery', 'lens', 'language'];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Achievement state for the stats. Never mutates.
 * `earned` is `{ [id]: { at } }` from a previous call; new unlocks get `at`.
 *
 * @param {object} stats
 * @param {{ earned?: object, at?: string }} [opts]
 * @returns {{ earned: object, unlocked: string[] }}
 */
export function checkAll(stats = {}, { earned = {}, at = new Date().toISOString() } = {}) {
  const next = { ...(earned || {}) };
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (next[achievement.id]) continue;
    let ok = false;
    try {
      ok = Boolean(achievement.test(stats || {}));
    } catch {
      ok = false;
    }
    if (ok) {
      next[achievement.id] = { at };
      unlocked.push(achievement.id);
    }
  }
  return { earned: next, unlocked };
}

/** Achievements in design order, each with its earned state. */
export function achievementList(earned = {}) {
  return ACHIEVEMENTS.map((a) => ({ id: a.id, group: a.group, earned: Boolean(earned && earned[a.id]), at: earned?.[a.id]?.at || null }));
}

/** Count earned, and the share of the table. */
export function achievementSummary(earned = {}) {
  const list = achievementList(earned);
  const count = list.filter((a) => a.earned).length;
  return { earned: count, total: list.length, share: list.length ? count / list.length : 0 };
}

/** How many more of a numeric stat are needed, for a "3 of 5" line. */
export function progressTowards(id, value, target) {
  const n = num(value);
  const goal = num(target);
  if (!ACHIEVEMENT_INDEX.hasOwnProperty(id)) return null;
  return { value: n, target: goal, done: goal > 0 && n >= goal, remaining: Math.max(0, goal - n) };
}
