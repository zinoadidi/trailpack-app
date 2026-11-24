// Runs a game action from a screen: load the profile, run the pure action,
// save it, and say what happened in one small toast per thing (points, streak,
// level, badge). `screen-helpers.js` keeps the calm "one toast for all badges"
// version used by Progress; the study runner uses this one so a step shows its
// points. Sound is played here too, through `sfx.js` (off until switched on).
//
// Every function swallows errors: a store or sync failure costs the toast, it
// never breaks the study step.

import { state, t } from '../app/state.js';
import { toast } from '../app/ui.js';
import { loadProfile, saveProfile } from './store.js';
import { levelFor } from './levels.js';
import { stepDone, biteDone, normaliseProfile } from './profile.js';
import { biteComplete } from './bite.js';
import { stepInput, biteInput, stepToasts, biteToasts, newLevels, sfxFor, walkGoalMet } from './wire.js';
import { play } from './sfx.js';

/** Render one toast row from `wire.js` to a string. */
export function toastText(row, translate = t) {
  if (!row) return '';
  const values = row.nameKey ? { ...row.values, name: translate(row.nameKey) } : row.values;
  return translate(row.key, values);
}

export function sound(name) {
  if (!name) return false;
  try {
    return play(name);
  } catch {
    return false;
  }
}

/** Level ladder options for a trail plan (kind from the plan, facts from camps). */
export function levelOptions(plan) {
  const camps = plan && Array.isArray(plan.camps) ? plan.camps : [];
  const factCount = camps.reduce((n, camp) => n + ((camp && camp.factIds) || []).length, 0);
  return { kind: (plan && plan.kind) || 'other', factCount };
}

function show(rows) {
  for (const row of rows) {
    try {
      toast(toastText(row));
    } catch {
      /* no document (a test or a worker): the points are already saved */
    }
  }
}

/**
 * Record one answered step and show its toasts.
 *
 * @param {{row: object, plan?: object, when?: number}} input
 *   `row` is the session answer row (type, points, correct, hint).
 */
export async function recordStep({ row, plan, when = Date.now(), streak = 0 } = {}) {
  try {
    const before = normaliseProfile(await loadProfile(state.store));
    const input = stepInput(row, { when, goalMet: false, streak });
    const paid = (before.wire && before.wire.steps) || [];
    // A row is paid once: the session step number and its fact say which.
    const key = stepKey(row);
    if (key && paid.includes(key)) return { profile: before, duplicated: true, unlocked: [], levelled: 0 };
    const result = stepDone(before, input);
    const steps = key ? [...paid, key].slice(-400) : paid;
    const profile = normaliseProfile({ ...result.profile, wire: { ...(result.profile.wire || {}), steps } });
    await saveProfile(state.store, state.sync, profile);
    const options = levelOptions(plan);
    const levelled = newLevels(before.points, result.profile.points, options);
    const level = levelled ? levelFor(result.profile.points, options).level : null;
    show(stepToasts({ points: input.points, levelledTo: level, unlocked: result.unlocked, streak: result.profile.dayStreak.current }));
    sound(sfxFor('answer', { correct: row && row.correct === true }));
    if (levelled) sound(sfxFor('level'));
    if (result.unlocked.length) sound(sfxFor('badge'));
    return { profile, unlocked: result.unlocked, levelled, duplicated: false };
  } catch {
    return null;
  }
}

/** One paid step is `step:factId`, so the same step of a resumed bite is not paid again. */
export function stepKey(row) {
  if (!row || row.step == null) return null;
  return String(row.step) + ':' + String(row.factId || '');
}

/** The game profile for a screen that only displays it: never throws. */
export async function readProfileSafe() {
  try {
    return await loadProfile(state.store);
  } catch {
    return null;
  }
}

/** Today's minutes already in the profile (local day, like the rest of the game). */
export function minutesToday(profile, when = Date.now()) {
  const d = new Date(when);
  const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const bucket = profile && profile.days ? profile.days[key] : null;
  return Math.max(0, Number(bucket && bucket.minutes) || 0);
}

/**
 * Record a finished bite: every answered row through the game profile, then
 * the day's activities, the plan streak when the Daily Walk minutes goal is
 * met, and the celebration sounds.
 *
 * The bite complete screen shows the finish bonus (+20, and the variety bonus)
 * separately through the pure `biteComplete()`; this function pays the steps
 * only, so the two never double count.
 *
 * @param {{session: object, plan?: object, when?: number}} input
 *   `session` is the finished study session (`{startedAt, steps, answers}`).
 */
export async function recordBite({ session, plan, when = Date.now() } = {}) {
  try {
    const answers = (session && session.answers) || [];
    const id = biteId(session);
    // A normalise keeps the `wire` marks; normaliseProfile only fills defaults.
    const before = normaliseProfile(await loadProfile(state.store));
    // Rows already paid are remembered under their bite id, so a resumed bite
    // or a second call never pays twice.
    const done = new Set((before.wire && before.wire.bites && before.wire.bites[id]) || []);
    const unpaid = answers.filter((row) => !done.has(rowKey(row)));
    const goalMet = walkGoalMet(plan, minutesToday(before, when), minutesOf(session));
    const base = goalMet ? stepDone(before, { points: 0, type: null, goalMet: true, when }).profile : before;
    const stepPoints = unpaid.reduce((sum, row) => sum + Math.max(0, Number(row && row.points) || 0), 0);
    const types = [...new Set(answers.map((row) => row && row.type).filter(Boolean))];
    const result = biteDone(base, { points: stepPoints, activityTypes: types, when });
    const bites = { ...((before.wire && before.wire.bites) || {}), [id]: answers.map((row) => rowKey(row)) };
    // Keep the list to the last 20 bites so the doc stays small.
    const keys = Object.keys(bites);
    for (const old of keys.slice(0, Math.max(0, keys.length - 20))) delete bites[old];
    const profile = normaliseProfile({ ...result.profile, wire: { bites } });
    const options = levelOptions(plan);
    const levelled = newLevels(before.points, profile.points, options);
    const level = levelled ? levelFor(profile.points, options).level : null;
    await saveProfile(state.store, state.sync, profile);
    show(biteToasts({ gained: stepPoints, levelledTo: level, unlocked: result.unlocked }));
    sound(sfxFor('bite'));
    if (levelled) sound(sfxFor('level'));
    if (result.unlocked.length) sound(sfxFor('badge'));
    return { profile, unlocked: result.unlocked, levelled, goalMet, stepPoints };
  } catch {
    return null;
  }
}

/** The finish bonus to pay: +20 and the variety bonus, without the steps, which are paid separately. */
export function finishPoints(activityTypes) {
  return biteComplete({ stepPoints: 0, activityTypes: activityTypes || [] }).gained;
}

/** Record the finish bonus (+20 and the variety bonus) once, when the bite screen first opens. */
export async function recordFinish({ points = 0, activityTypes = [], plan, when = Date.now(), session } = {}) {
  try {
    const before = normaliseProfile(await loadProfile(state.store));
    const id = 'finish-' + (session ? biteId(session) : when);
    const bites = { ...((before.wire && before.wire.bites) || {}) };
    if (bites[id]) return { profile: before, duplicated: true, unlocked: [] };
    const result = biteDone(before, { points, activityTypes, when });
    // Keep the step marks of the bite so its steps stay paid.
    const stepKey = session ? biteId(session) : null;
    bites[id] = [...((stepKey && bites[stepKey]) || []), 'finish'];
    const profile = normaliseProfile({ ...result.profile, wire: { bites } });
    await saveProfile(state.store, state.sync, profile);
    return { profile, unlocked: result.unlocked, duplicated: false };
  } catch {
    return null;
  }
}

/** A stable id for one bite: the session's own id, else its start time and size. */
export function biteId(session) {
  if (session && session.id) return String(session.id).slice(0, 40);
  const at = Number(session && session.startedAt) || 0;
  const steps = Number(session && Array.isArray(session.steps) && session.steps.length) || 0;
  return 'bite-' + at + '-' + steps;
}

/** A stable key for one answer row: its step number. */
export function rowKey(row) {
  return String((row && row.step) ?? 0);
}

/** Minutes this session claims, from its own reported minutes. */
export function minutesOf(session) {
  return Math.max(0, Number(session && session.minutes) || 0);
}

/** Current run of correct answers, for the header chip and the profile. */
export function answerStreak(session) {
  const answers = (session && session.answers) || [];
  let run = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i] && answers[i].correct; i -= 1) run += 1;
  return run;
}

/** A step or a screen that could not load: the soft "not this time" sound. */
export function soundFailed() {
  return sound(sfxFor('failed'));
}

/** A card was turned over (flashcards, listen). */
export function soundFlip() {
  return sound(sfxFor('flip'));
}

export { stepInput, biteInput, newLevels, sfxFor, play, t };
