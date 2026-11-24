// Wiring the game layer and the sound to the study screens. Pure: no DOM,
// no storage, no audio context. The screens call these helpers, `node --test`
// covers them in test/game-wire.test.mjs.
//
// Three jobs:
//   1. turn one answered step into the `stepDone` input and a list of toasts,
//   2. turn a finished bite into the `biteDone` input and the sound to play,
//   3. pick the sound for a moment (`sfxFor`), so a screen never guesses.

import { levelFor } from './levels.js';

export const STREAK_TOAST_MIN = 2;

/** The `stepDone` input for one answer row (see src/game/profile.js). */
export function stepInput(row = {}, { goalMet = false, when, streak = 0 } = {}) {
  const type = row && row.type ? String(row.type) : null;
  return {
    points: Math.max(0, Number(row && row.points) || 0),
    type,
    noHint: Boolean(row && row.correct) && row.hint !== true,
    comeback: false,
    minutes: 0,
    goalMet: goalMet === true,
    // The runner keeps the answer streak on the row; the caller may pass it.
    answerStreak: Math.max(0, Number(row && row.streak) || 0) || Math.max(0, Number(streak) || 0) || undefined,
    ms: Math.max(0, Number(row && row.ms) || 0),
    when,
  };
}

/** Points already made by a session's answers. */
export function pointsMade(answers = []) {
  return Math.max(0, (answers || []).reduce((sum, row) => sum + Math.max(0, Number(row && row.points) || 0), 0));
}

/** A day key from a timestamp (local day, `YYYY-MM-DD`). */
export function goalDay(when) {
  const d = when == null ? new Date() : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  return goalDay(a) === goalDay(b);
}

/**
 * Has today's Daily Walk minutes goal been met? `plan` is the trail doc
 * (`{minutesPerDay}`; default 20 like the trail home). `today` is today's
 * already counted minutes from the game profile. `next` is the bite about to
 * count. No plan, no minutes, no goal met.
 */
export function walkGoalMet(plan, today = 0, next = 0) {
  const perDay = Number(plan && plan.minutesPerDay) || 20;
  const done = Math.max(0, Number(today) || 0) + Math.max(0, Number(next) || 0);
  return done >= perDay;
}

/** The `biteDone` input for a finished bite. */
export function biteInput({ stepPoints = 0, activityTypes = [], when } = {}) {
  return { points: Math.max(0, Number(stepPoints) || 0), activityTypes: (activityTypes || []).filter(Boolean), when };
}

function readable(id) {
  return String(id || '')
    .replace(/[._-]+/g, ' ')
    .trim();
}

/**
 * The toasts after a step. Each is `{key, values, raw}`; a caller renders
 * `raw ? raw : t(key, values)`. A step that paid nothing says nothing.
 */
export function stepToasts({ points = 0, levelledTo = null, unlocked = [], streak = 0 } = {}) {
  const list = [];
  const paid = Math.max(0, Math.round(Number(points) || 0));
  if (paid > 0) list.push({ key: 'wire.toast.points', values: { points: paid } });
  if (streak >= STREAK_TOAST_MIN) list.push({ key: 'wire.toast.streak', values: { count: Math.round(streak) } });
  if (Number(levelledTo) > 0) list.push({ key: 'wire.toast.level', values: { level: Math.round(Number(levelledTo)) } });
  for (const id of unlocked || []) {
    // Badge help text is translated; the id itself is not a catalogue key.
    list.push({ key: 'wire.toast.badge', values: { name: readable(id) }, raw: readable(id) });
  }
  return list;
}

/** The toasts after a bite: points, the level and each new badge. */
export function biteToasts({ gained = 0, levelledTo = null, unlocked = [] } = {}) {
  return stepToasts({ points: gained, levelledTo, unlocked, streak: 0 });
}

/** Levels crossed between two point totals (also bites: one level at most usually). */
export function newLevels(before, after, options = {}) {
  const a = levelFor(Math.max(0, Number(before) || 0), options);
  const b = levelFor(Math.max(0, Number(after) || 0), options);
  return Math.max(0, b.level - a.level);
}

/**
 * Which sound a moment gets, or null. Sound stays off unless `sfx.js` says
 * it is on; this only names the sound so the screens share one mapping.
 */
export function sfxFor(moment, { correct = true, skipped = false, thrown = false } = {}) {
  if (skipped) return null;
  switch (moment) {
    case 'answer':
      return thrown ? 'wrong' : correct ? 'correct' : 'wrong';
    case 'flip':
      return 'flip';
    case 'step':
      return 'stepDone';
    case 'bite':
      return 'biteDone';
    case 'level':
      return 'levelUp';
    case 'badge':
      return 'achievement';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/** How many distinct sounds one finished bite should play, in order. */
export function biteSoundPlan({ gained = 0, levelled = 0, unlocked = [] } = {}) {
  const list = ['stepDone'];
  if (Math.max(0, Number(gained) || 0) > 0) list.push('biteDone');
  if (Math.max(0, Number(levelled) || 0) > 0) list.push('levelUp');
  if ((unlocked || []).length) list.push('achievement');
  return list;
}
