// The bite complete screen (design 2.7 celebration): points for the bite, the
// variety bonus, level up, achievements unlocked, streak lines and the confetti
// plan. Pure: it returns a plain `summary` object the screen renders. Confetti
// pieces take no random input here, the caller passes a seeded list, so tests
// are deterministic.

import { POINTS, VARIETY_BONUS, earnsVarietyBonus, varietyCount } from './points.js';
import { levelFor, levelUp } from './levels.js';

/** Confetti piece count. Zero when the user prefers reduced motion. */
export const CONFETTI_COUNT = 48;
export const CONFETTI_COUNT_REDUCED = 0;

/**
 * One shape for every confetti piece. The caller animates with CSS transforms
 * and its own seeded random, so this stays a pure layout description.
 */
export function confettiPlan(count = CONFETTI_COUNT) {
  const total = Math.max(0, Math.min(200, Math.floor(Number(count) || 0)));
  const colours = ['spark', 'volt', 'summit', 'mint', 'orchid', 'sky'];
  return Array.from({ length: total }, (_, i) => ({
    id: 'c' + i,
    colour: colours[i % colours.length],
    angle: Math.round((i / Math.max(1, total)) * 360),
    delay: Math.round(((i % 8) / 8) * 400),
    drift: ((i * 37) % 100) - 50,
  }));
}

/**
 * Summary for the bite complete screen.
 *
 * @param {{
 *   pointsBefore?: number, stepPoints?: number, activityTypes?: string[],
 *   kind?: string, factCount?: number, biteCountToday?: number, variety?: boolean,
 *   newAchievements?: string[], dayStreak?: number, planStreak?: number,
 *   bestAnswerStreak?: number, reducedMotion?: boolean, minutes?: number
 * }} bite
 */
export function biteComplete(bite = {}) {
  const stepPoints = Math.max(0, Number(bite.stepPoints) || 0);
  const before = Math.max(0, Number(bite.pointsBefore) || 0);
  const types = (bite.activityTypes || []).filter(Boolean);
  const variety = bite.variety === true || earnsVarietyBonus(types);
  const finish = POINTS['bite-finished'];
  const subtotal = stepPoints + finish;
  const bonus = variety ? Math.round(subtotal * VARIETY_BONUS) : 0;
  const gained = subtotal + bonus;
  const after = before + gained;
  const levelBefore = levelFor(before, { kind: bite.kind, factCount: bite.factCount });
  const levelAfter = levelFor(after, { kind: bite.kind, factCount: bite.factCount });
  const up = levelUp(before, after, { kind: bite.kind, factCount: bite.factCount });

  return {
    pointsBefore: before,
    stepPoints,
    finishPoints: finish,
    bonus,
    gained,
    pointsAfter: after,
    variety,
    varietyTypes: varietyCount(types),
    level: levelAfter,
    levelUp: up ? { from: levelBefore.level, to: levelAfter.level, name: levelAfter.name } : null,
    achievements: [...(bite.newAchievements || [])],
    streaks: {
      day: Math.max(0, Number(bite.dayStreak) || 0),
      plan: Math.max(0, Number(bite.planStreak) || 0),
      answer: Math.max(0, Number(bite.bestAnswerStreak) || 0),
    },
    bitesToday: Math.max(0, Number(bite.biteCountToday) || 0) + 1,
    minutes: Math.max(0, Number(bite.minutes) || 0),
    confetti: bite.reducedMotion ? CONFETTI_COUNT_REDUCED : CONFETTI_COUNT,
    plan: confettiPlan(bite.reducedMotion ? CONFETTI_COUNT_REDUCED : CONFETTI_COUNT),
  };
}

/** The one line "what you now know" summary for a level up or a camp summit. */
export function celebrationLine(summary) {
  if (!summary) return { kind: 'none', key: null, values: {} };
  if (summary.levelUp) {
    return { kind: 'level', key: 'game.levelUpLine', values: { level: summary.levelUp.to, name: 'game.level.' + summary.levelUp.name } };
  }
  if (summary.campSummited) {
    return { kind: 'camp', key: 'game.campSummitLine', values: { camp: summary.campSummited } };
  }
  return { kind: 'bite', key: 'game.biteDoneLine', values: { points: summary.gained } };
}
