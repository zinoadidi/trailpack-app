// Bite session: the glue between the Session Mixer, the mastery engine, the
// intake and the Trail. A session is one bite being studied.
//
// Pure functions over plain objects, so the whole loop (build, answer, finish)
// is tested without a DOM, a clock or a network. The study screen only renders
// what this file decides.
//
// Lifecycle:
//   startSession(...)  -> {bite, steps, index: 0, answers: [], startedAt}
//   answerStep(session, answer)
//                      -> {session, step, result, summary, next}
//   finishSession(session)
//                      -> {session, summary, attempts, progress}
//
// `answer` shape (the study screen builds it from the activity component):
//   {correct?: boolean, value?: any, hint?: boolean, selfRate?: 'again'|'good'|'easy',
//    ms?: number, transcript?: string, coverage?: number, score?: number}
//
// Answers are applied to mastery progress (one doc per fact) and collected as
// attempt rows the sync engine stores and the Exports and Lens screens read.
// Points come from src/game/points.js so a bite is worth the same however it
// was built.

import { ACTIVITIES, canPlay, suitsState, variantFor } from './activities.js';
import { buildBite, BITE_STEPS } from './mixer.js';
import { biteLength } from './mixer.js';
import { normaliseProgress, recordAttempt, masterySummary, intakePlan, dueFacts } from './mastery.js';
import { forCamp } from './mixer-settings.js';
import { POINTS } from '../game/points.js';

export const SESSION_VERSION = 1;

/** Activities whose answer is a self rating, not a right or wrong. */
const SELF_RATED = new Set(['flash', 'teach-back', 'voice', 'scenario']);

/** Points for one answered step, by activity type (design 4.1 table). */
export function stepReward(type) {
  if (type === 'sweep') return POINTS['quiz-correct'];
  if (type === 'teach-back') return POINTS['teach-back'];
  if (type === 'blitz') return POINTS['blitz-correct'];
  if (type === 'flash') return POINTS['flash-first-try'];
  if (type === 'listen' || type === 'voice' || type === 'scenario') return POINTS['quiz-correct'];
  if (type === 'match' || type === 'order' || type === 'cloze' || type === 'spot-mistake') return POINTS.step;
  return POINTS['quiz-correct'];
}

/** Turn a raw answer into `{correct, selfRate, hint, ...}` with sane defaults. */
export function normaliseAnswer(raw = {}, type = 'quiz') {
  const answer = raw && typeof raw === 'object' ? raw : { value: raw };
  const selfRate = ['again', 'good', 'easy'].includes(answer.selfRate) ? answer.selfRate : null;
  let correct;
  if (SELF_RATED.has(type)) {
    correct = selfRate === 'good' || selfRate === 'easy';
  } else {
    correct = answer.correct === true;
  }
  return {
    correct,
    selfRate,
    hint: answer.hint === true,
    value: answer.value === undefined ? null : answer.value,
    ms: Math.max(0, Math.round(Number(answer.ms) || 0)),
    transcript: typeof answer.transcript === 'string' ? answer.transcript.slice(0, 2000) : null,
    coverage: Number.isFinite(Number(answer.coverage)) ? Math.max(0, Math.min(1, Number(answer.coverage))) : null,
    score: Number.isFinite(Number(answer.score)) ? Math.max(0, Math.min(1, Number(answer.score))) : null,
  };
}

/** Restrict an explicit camp request to reachable camps and their own facts. */
export function studySelection({ facts = [], trail = null, requested = null, progress = null } = {}) {
  const camps = Array.isArray(trail?.camps) ? trail.camps : [];
  if (!requested) return { camp: camps.find((camp) => camp.state === 'open') || null, facts, ...(progress ? { progress } : {}) };
  const camp = camps.find((item) => item.id === requested && (item.state === 'open' || item.state === 'summited'));
  if (!camp) return null;
  const ids = new Set(camp.factIds || []);
  return { camp, facts: facts.filter((fact) => ids.has(fact.id)), ...(progress ? { progress: Object.fromEntries(Object.entries(progress).filter(([id]) => ids.has(id))) } : {}) };
}

/** Only show source metadata that belongs to this fact; never manufacture a citation. */
export function studySourceContext(fact, pack) {
  const sources = Array.isArray(pack?.sources) ? pack.sources : [];
  const source = fact?.sourceId && sources.find((item) => item && item.id === fact.sourceId);
  if (!source || !source.name) return null;
  let url = null;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href;
  } catch { /* a local source has no web link */ }
  const page = Number(fact.page);
  return { name: String(source.name), url, page: Number.isInteger(page) && page > 0 ? page : null };
}

/**
 * Which facts a bite draws from, given the Progress map, the Trail and the
 * pack facts. Intake first (about 30% new), then due reviews, then the open
 * camp's facts as a fallback so a fresh pack always has something to bite.
 * Returns the fact id order the Mixer walks.
 */
export function studyQueue({ facts = [], progress = {}, trail = null, campId = null, steps = 8, now = Date.now(), rate = 0.3 } = {}) {
  const known = new Set(facts.map((fact) => fact.id));
  const due = dueFacts(progress, { now });
  const unseen = facts.filter((fact) => !progress[fact.id] || progress[fact.id].state === 'new').map((fact) => fact.id);
  const plan = intakePlan({ newAvailable: unseen.length, dueReviews: due.due.length, steps, rate });
  // New facts first in study order, then the due queue, both cut to the intake.
  const newIds = unseen.slice(0, plan.intake);
  // Weak facts always come first (design 3.10: weak, then due), then the rest
  // of the due queue. A fact due in a minute is still what this bite is for.
  const weakFirst = due.byState.weak.filter((id) => known.has(id) && !newIds.includes(id));
  const reviewIds = due.due
    .filter((id) => known.has(id) && !newIds.includes(id) && !weakFirst.includes(id))
    .sort((a, b) => Number((progress[a] || {}).dueAt || 0) - Number((progress[b] || {}).dueAt || 0))
    .slice(0, Math.max(0, steps - newIds.length - weakFirst.length));
  const queue = [...newIds, ...weakFirst, ...reviewIds];
  // The open camp's unseen facts fill the rest when the progress map is empty
  // (a brand new pack, or a device that has not synced yet).
  if (queue.length < steps) {
    const camps = Array.isArray(trail?.camps) ? trail.camps : [];
    const open = camps.find((camp) => camp.id === campId) || camps.find((camp) => camp.state === 'open');
    const campIds = open ? open.factIds.filter((id) => known.has(id)) : facts.map((fact) => fact.id);
    for (const id of campIds) {
      if (queue.length >= steps) break;
      if (!queue.includes(id)) queue.push(id);
    }
  }
  return { queue, intake: plan.intake, paused: plan.paused, due: due.counts };
}

/**
 * Is this step still answerable? The screen asks before showing a step whose
 * fact was deleted during the bite.
 */
export function stepPlayable(step, facts = []) {
  if (!step) return false;
  const fact = facts.find((item) => item.id === step.factId);
  return Boolean(fact) && canPlay(step.type, fact);
}

/**
 * Ids are sync safe; the bite id names one attempt doc. `at` keeps two bites
 * started in the same millisecond apart.
 */
export function biteId(seed = 1, at = Date.now()) {
  return `b_${Number(seed) || 0}_${Number(at) || 0}`.slice(0, 64);
}

/**
 * Start a bite.
 *
 * @param {object} input
 * @param {Array} input.facts        pack facts
 * @param {object} [input.progress]  factId -> progress doc (mastery)
 * @param {object|null} [input.trail] the pack's trail plan
 * @param {object} [input.settings]  mixer settings (see mixer-settings.js)
 * @param {object|null} [input.lens] the active Lens
 * @param {string|null} [input.campId] the camp being studied (per camp override)
 * @param {number} [input.minutes]   time budget, 6 to 10 steps come out of it
 * @param {number} [input.steps]     exact steps, overrides the budget
 * @param {number} [input.seed]      deterministic seed
 * @param {object} [input.history]   `{typesSeen: []}` from the last bite
 * @param {number} [input.now]       clock for tests
 */
export function startSession(input = {}) {
  const {
    facts = [],
    progress = {},
    trail = null,
    settings = { matrix: {}, pins: [], bans: [] },
    lens = null,
    campId = null,
    minutes = 4,
    steps = null,
    seed = 1,
    history = {},
    now = Date.now(),
  } = input;
  const settingsForCamp = campId ? forCamp(settings, campId) : settings;
  const want = steps ? Math.max(1, Math.min(BITE_STEPS.max, Math.round(steps))) : biteLength(minutes, { conditions: settingsForCamp.conditions || {} });
  const stateOf = (factId) => {
    const doc = progress && progress[factId];
    return doc && doc.state ? doc.state : 'new';
  };
  const { queue, intake, paused, due } = studyQueue({ facts, progress, trail, campId, steps: want, now });
  const ordered = queue.map((id) => facts.find((fact) => fact.id === id)).filter(Boolean);
  const bite = buildBite({ facts: ordered, stateOf, order: queue, settings: settingsForCamp, lens, steps: want, seed, history });

  const plan = [...bite.steps];
  // Repeated facts: a bite of 8 from 2 facts repeats them, which is the point.
  const session = {
    v: SESSION_VERSION,
    biteId: biteId(seed, now),
    seed,
    campId,
    steps: plan,
    index: 0,
    answers: [],
    startedAt: now,
    endedAt: null,
    factProgress: { ...(progress || {}) },
    intake,
    paused,
    due,
    minutes: bite.minutes,
    types: bite.types,
    warnings: [...bite.warnings],
    trace: {
      // What the Bite complete screen reads: the mixer's own numbers are kept
      // here so a later re-plan cannot rewrite history.
      length: plan.length,
      fallbacks: [...bite.fallbacks],
    },
  };
  return session;
}

/** The current step, or null when the bite is done. */
export function currentStep(session) {
  if (!session || !Array.isArray(session.steps)) return null;
  return session.index < session.steps.length ? session.steps[session.index] : null;
}

export function isComplete(session) {
  return Boolean(session) && Array.isArray(session.steps) && session.index >= session.steps.length;
}

/** Points awarded so far, before the bite finished bonus. */
export function sessionPoints(session) {
  return (session && session.answers ? session.answers : []).reduce((sum, answer) => sum + (Number(answer.points) || 0), 0);
}

/**
 * Answer the current step and advance. Returns the new session, the mastery
 * result for this fact and the progress doc the caller should save.
 *
 * A step can also be `skipped` (the shortcut wallet, or a fact that lost every
 * format): it records a miss for mastery only when `countsAsMiss` is true, and
 * never earns points.
 */
export function answerStep(session, rawAnswer, { facts = [], now = Date.now(), deadlineMode = false, packProgress = 1, skipped = false, countsAsMiss = false } = {}) {
  if (!session) return { session, step: null, result: null, done: true };
  const step = currentStep(session);
  if (!step) return { session, step: null, result: null, done: true };
  const answer = normaliseAnswer(skipped && !countsAsMiss ? { correct: false } : rawAnswer, step.type);
  // The clicked fact is here for the deleted case; the session carries its own
  // progress map so a step answered out of order still reads the right doc.
  const clicked = Array.isArray(facts) ? facts.find((item) => item.id === step.factId) || null : null;
  const before = normaliseProgress(session.factProgress ? session.factProgress[step.factId] : null, step.factId, now);
  const result = recordAttempt(before, {
    factId: step.factId,
    correct: answer.correct,
    type: step.type,
    when: now,
    deadlineMode,
    packProgress,
    selfRate: answer.selfRate,
  });
  // A skipped step that does not count still advances, it just changes nothing.
  const progressDoc = skipped && !countsAsMiss ? before : result.progress;
  const points = answer.correct && !skipped ? stepReward(step.type) : 0;
  // The answer rows carry the mastery and schedule, so a project of the bites
  // alone (an offline phone, or a doc that never reached the server) still
  // shows honest days and types. `progress` above stays the working map.
  const factProgress = { ...(session.factProgress || {}), [step.factId]: progressDoc };
  const row = {
    step: session.index,
    factId: step.factId,
    type: step.type,
    variantId: step.variantId,
    shape: step.shape,
    state: step.state,
    campId: session.campId || null,
    correct: answer.correct,
    selfRate: answer.selfRate,
    hint: answer.hint,
    skipped: skipped === true,
    ms: answer.ms,
    coverage: answer.coverage,
    score: answer.score,
    transcript: answer.transcript,
    points,
    at: now,
    before: before.state,
    after: progressDoc.state,
    mastered: skipped && !countsAsMiss ? false : result.mastered,
  };
  const next = {
    ...session,
    index: session.index + 1,
    answers: [...session.answers, row],
    progress: clicked || !Array.isArray(facts) || !facts.length ? { ...(session.progress || {}), [step.factId]: progressDoc } : session.progress,
    factProgress,
    endedAt: session.index + 1 >= session.steps.length ? now : null,
  };
  return {
    session: next,
    step,
    answer,
    result: { ...result, progress: progressDoc },
    progressDoc,
    fact: clicked,
    done: isComplete(next),
    summary: isComplete(next) ? finishSession(next, { now }) : null,
    next: currentStep(next),
  };
}

/** Best answer streak inside the bite (for the game profile's best). */
export function biteStreak(session) {
  let best = 0;
  let run = 0;
  for (const answer of (session && session.answers) || []) {
    if (answer.correct) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

/**
 * Close the bite: points, the numbers the Bite complete screen shows, the
 * mastery summary for the pack, and what to say about it.
 */
export function finishSession(session, { now = Date.now(), factIds = null } = {}) {
  const answers = (session && session.answers) || [];
  const finished = Boolean(session) && isComplete(session);
  const stepPoints = answers.reduce((sum, answer) => sum + (Number(answer.points) || 0), 0);
  const types = [...new Set(answers.map((answer) => answer.type))];
  const minutes = Math.max(1, Math.round(answers.reduce((sum, answer) => sum + (ACTIVITIES[answer.type] ? ACTIVITIES[answer.type].minutes : 0.5), 0)));
  const right = answers.filter((answer) => answer.correct).length;
  const mastered = answers.filter((answer) => answer.mastered).map((answer) => answer.factId);
  const weak = answers.filter((answer) => !answer.correct && !answer.skipped).map((answer) => answer.factId);
  // A projected map is the longest lived truth a bite has: earlier answers' docs,
  // updated by this bite, without depending on which days the grid covered.
  const progress = (session && session.factProgress) || (session && session.progress) || {};
  const summary = {
    v: SESSION_VERSION,
    finished,
    steps: answers.length,
    planned: session && Array.isArray(session.steps) ? session.steps.length : 0,
    correct: right,
    skipped: answers.filter((answer) => answer.skipped).length,
    stepPoints,
    finishPoints: finished ? POINTS['bite-finished'] : 0,
    points: stepPoints + (finished ? POINTS['bite-finished'] : 0),
    activityTypes: types,
    minutes,
    bestStreak: biteStreak(session),
    mastered,
    weak: [...new Set(weak)],
    typeCount: types.length,
    fallbacks: (session && session.trace && session.trace.fallbacks) || [],
    campId: (session && session.campId) || null,
    at: now,
    mastery: factIds ? masterySummary(progress, factIds) : masterySummary(progress),
  };
  return summary;
}

/** The attempt rows to store (collection `attempts`, one doc per bite). */
export function sessionAttempts(session) {
  if (!session) return null;
  return {
    v: SESSION_VERSION,
    biteId: session.biteId,
    campId: session.campId || null,
    seed: session.seed,
    startedAt: session.startedAt,
    endedAt: session.endedAt || Date.now(),
    rows: (session.answers || []).map((answer) => ({ ...answer })),
  };
}

/**
 * The variant a step renders. Kept here so the screen and a test agree on
 * exactly the same object, including the fallback to a plain flashcard.
 */
export function stepVariant(step, facts = []) {
  if (!step) return null;
  const fact = facts.find((item) => item.id === step.factId);
  if (!fact) return null;
  const chosen = (fact.variants || []).find((variant) => variant.id === step.variantId);
  if (chosen) return { fact, variant: chosen };
  const fallback = variantFor(step.type, fact);
  if (fallback) return { fact, variant: fallback };
  return { fact, variant: null };
}

/** Does the activity suit the fact's state? Used by the screen to warn. */
export function stepSuits(step) {
  if (!step) return false;
  return suitsState(step.type, step.state) || step.type === 'sweep';
}
