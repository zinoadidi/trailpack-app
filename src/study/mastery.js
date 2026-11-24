// Mastery engine (design 3.10): each fact has a state, a step on the review
// schedule and a small history of attempts. Pure functions over plain objects:
// the study screen calls `recordAttempt` after every answer and `dueFacts`
// before building a bite.
//
// States: New, Learning, Review, Mastered, Lapsed (was known, then failed),
// Weak (missed recently, comes first in the queue).
//
// Mastered means ALL of:
//   - 3 or more correct recalls,
//   - on 3 or more different days,
//   - in 2 or more different activity types,
//   - at least one of those in a production type (cloze, order, voice, teach
//     back, scenario, task).
//
// Schedule: 10 minutes, 1, 3, 7, 14 and 30 days. A miss moves the fact back one
// step (two when it was Mastered), flags it Weak and makes it due soon.
//
// Shape (sync doc `progress`, id `p_<factId>`):
//   {v, factId, packId, state, step, dueAt, lapses, streak,
//    correct, days: ['YYYY-MM-DD'], types: [], production: false,
//    history: [{at, correct, type}], lastAt, masteredAt, updatedAt}

export const PROGRESS_VERSION = 1;
export const DAY_MIN = 24 * 60;
/** Review schedule in minutes: 10 min, then 1, 3, 7, 14 and 30 days. */
export const INTERVALS_MIN = [10, DAY_MIN, 3 * DAY_MIN, 7 * DAY_MIN, 14 * DAY_MIN, 30 * DAY_MIN];
export const MASTERED_RECALLS = 3;
export const MASTERED_DAYS = 3;
export const MASTERED_TYPES = 2;
export const PRODUCTION_TYPES = ['cloze', 'order', 'voice', 'teach-back', 'scenario', 'task', 'teach'];
export const HISTORY_KEEP = 30;

export const STATES = ['new', 'learning', 'review', 'mastered', 'lapsed', 'weak'];

/** Local day key, same rule as the game module (never UTC). */
export function dayOf(when) {
  const date = when instanceof Date ? when : new Date(when);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isProductionType(type) {
  return PRODUCTION_TYPES.includes(type);
}

/** A fresh state for a fact nobody has answered yet. */
export function newProgress(factId, { packId = null, now = Date.now() } = {}) {
  return {
    v: PROGRESS_VERSION,
    factId,
    packId,
    state: 'new',
    step: 0,
    dueAt: now,
    lapses: 0,
    streak: 0,
    correct: 0,
    days: [],
    types: [],
    production: false,
    history: [],
    lastAt: null,
    masteredAt: null,
    updatedAt: now,
  };
}

/** Fill in missing fields so an older or partial doc never throws. */
export function normaliseProgress(doc, factId = null, now = Date.now()) {
  const base = newProgress(factId || (doc && doc.factId) || 'fact', { now });
  if (!doc || typeof doc !== 'object') return base;
  return {
    ...base,
    ...doc,
    v: PROGRESS_VERSION,
    state: STATES.includes(doc.state) ? doc.state : base.state,
    step: clampInt(doc.step, 0, INTERVALS_MIN.length - 1, 0),
    days: Array.isArray(doc.days) ? [...new Set(doc.days)] : [],
    types: Array.isArray(doc.types) ? [...new Set(doc.types)] : [],
    history: Array.isArray(doc.history) ? doc.history.slice(-HISTORY_KEEP) : [],
    production: doc.production === true,
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Interval for a step, compressed when the Pack has a close deadline. */
export function intervalFor(step, { deadlineMode = false, packProgress = 1 } = {}) {
  const index = clampInt(step, 0, INTERVALS_MIN.length - 1, 0);
  const base = INTERVALS_MIN[index];
  // Deadline mode shortens every interval above 10 minutes to at most 3 days,
  // and never shorter than a tenth of the pack's remaining life.
  if (!deadlineMode) return base;
  const compressed = Math.min(base, 3 * DAY_MIN);
  return Math.max(30, Math.round(10 + (compressed - 10) * 0.4 * Math.max(0.3, Math.min(1, packProgress))));
}

/**
 * Does this fact meet the mastered rule?
 * @param {{correct, days, types, production}} p
 */
export function meetsMasteredRule(p) {
  const correct = Math.max(0, Number(p.correct) || 0);
  const days = Array.isArray(p.days) ? p.days.length : 0;
  const types = Array.isArray(p.types) ? p.types.length : 0;
  return correct >= MASTERED_RECALLS && days >= MASTERED_DAYS && types >= MASTERED_TYPES && p.production === true;
}

/**
 * One answer. `correct` is the scored outcome (self rated for flashcards),
 * `type` is the activity type (flash, quiz, cloze, ...).
 *
 * Returns a new progress object plus `{promoted, demoted, mastered, weak}` so
 * the screen can say exactly what changed ("you now know this").
 */
export function recordAttempt(progress, { factId, correct, type = 'flash', when = Date.now(), deadlineMode = false, packProgress = 1, selfRate } = {}) {
  const p = normaliseProgress(progress, factId, when);
  const at = typeof when === 'string' ? Date.parse(when) : when;
  const day = dayOf(at);
  const right = correct === true || selfRate === 'good' || selfRate === 'easy';
  const wasMastered = p.state === 'mastered';
  const history = [...p.history, { at, correct: right, type: String(type || 'flash') }].slice(-HISTORY_KEEP);
  let next = { ...p, history, lastAt: at, updatedAt: at };

  if (right) {
    next.correct = p.correct + 1;
    next.streak = p.streak + 1;
    // Keep every day: the mastered rule reads "3 or more different days", so
    // this list can never be cut to the history length.
    next.days = p.days.includes(day) ? p.days : [...p.days, day];
    next.types = [...new Set([...p.types, String(type || 'flash')])];
    next.production = p.production || isProductionType(type);
    next.step = Math.min(INTERVALS_MIN.length - 1, p.step + 1);
    next.dueAt = at + intervalFor(next.step, { deadlineMode, packProgress }) * 60 * 1000;
    if (meetsMasteredRule(next)) {
      next.state = 'mastered';
      next.masteredAt = wasMastered ? p.masteredAt : at;
    } else {
      next.state = next.correct >= 2 || next.step >= 2 ? 'review' : 'learning';
    }
    next.lapses = p.lapses;
    return { progress: next, promoted: next.state !== p.state, demoted: false, mastered: next.state === 'mastered' && !wasMastered, weak: false };
  }

  // A miss: back one step, or two when it was mastered (Lapsed, then Weak).
  const back = wasMastered ? 2 : 1;
  next.step = Math.max(0, p.step - back);
  next.state = 'weak';
  next.streak = 0;
  next.lapses = p.lapses + 1;
  // Weak facts come back in the same session, so 10 to 30 minutes out.
  next.dueAt = at + 30 * 60 * 1000;
  return { progress: next, promoted: false, demoted: wasMastered || p.state === 'review', mastered: false, weak: true };
}

/** Is the fact due now? New and weak facts are always available. */
export function isDue(progress, now = Date.now()) {
  const p = normaliseProgress(progress, null, now);
  if (p.state === 'new') return true;
  return Number(p.dueAt) <= now;
}

/** Everything the mixer can build from right now, plus the counts it shows. */
export function dueFacts(progressMap, { now = Date.now() } = {}) {
  // Carry the key as the fact id: a doc pulled from another device may not
  // have its own copy (older docs, partial merges), and a map keyed by id has
  // to win over a doc that was written without one.
  const rows = Object.entries(progressMap || {}).map(([key, doc]) => normaliseProgress(doc, (doc && doc.factId) || key, now));
  const byState = { new: [], learning: [], review: [], weak: [], mastered: [], lapsed: [] };
  const due = [];
  for (const p of rows) {
    byState[p.state].push(p.factId);
    if (isDue(p, now)) due.push(p.factId);
  }
  return { due, byState, counts: Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.length])), total: rows.length };
}

/**
 * Intake: about 30% of a bite is new, and it adapts. More than 40 due reviews
 * pauses new material; a light queue raises it. `steps` is the bite length.
 */
export function intakePlan({ newAvailable = 0, dueReviews = 0, steps = 8, rate = 0.3 } = {}) {
  const base = Math.max(0, Math.min(steps, Math.round(steps * rate)));
  let share = rate;
  if (dueReviews > 40) share = 0;
  else if (dueReviews > 25) share = rate * 0.5;
  else if (dueReviews < 8) share = Math.min(0.5, rate * 1.3);
  let intake = Math.max(0, Math.min(newAvailable, Math.round(steps * share)));
  // A bite that has nothing else to show still takes its one new fact.
  if (intake === 0 && newAvailable > 0 && dueReviews < steps) intake = 1;
  return {
    intake,
    review: Math.max(0, steps - intake),
    share,
    paused: share === 0,
    base,
  };
}

/**
 * What to study when new material runs out (design 3.10): weak first, then due
 * reviews, then learning facts in new formats, then mastery sweeps.
 *
 * @returns {{queue: string[], mode: string, message: object|null}}
 */
export function exhaustedQueue(states, dueIds = [], { steps = 8, repeat = [], all = [] } = {}) {
  const pick = (list, n) => list.filter((id) => !repeat.includes(id) && !queue.includes(id)).slice(0, n);
  const queue = [];
  const weak = pick(states.weak || [], steps);
  queue.push(...weak);
  if (queue.length < steps) queue.push(...pick(dueIds, steps - queue.length));
  if (queue.length < steps) queue.push(...pick(states.learning || [], steps - queue.length));
  if (queue.length < steps) queue.push(...pick(states.review || [], steps - queue.length));
  const sweep = queue.length < steps;
  if (sweep) queue.push(...pick(states.mastered || [], steps - queue.length));
  // Anything the state map did not mention (lapsed ids for example) comes last.
  if (queue.length < steps) queue.push(...pick(all, steps - queue.length));
  // Nothing at all in the pack yet: say so plainly.
  if (!queue.length) return { queue: [], mode: 'empty', message: { key: 'study.noFacts' } };
  if (weak.length) return { queue, mode: 'weak', message: { key: 'study.repeatWeak' } };
  return { queue, mode: sweep ? 'sweep' : 'repeat', message: { key: sweep ? 'study.masterySweep' : 'study.repeatDue' } };
}

/**
 * Pack level mastery: how many facts are Mastered, and the percentage the
 * Trail gate and the certificate show.
 */
export function masterySummary(progressMap, factIds = null) {
  const ids = factIds || Object.keys(progressMap || {});
  const counts = { new: 0, learning: 0, review: 0, weak: 0, lapsed: 0, mastered: 0 };
  for (const id of ids) {
    const p = progressMap && progressMap[id] ? normaliseProgress(progressMap[id], id) : newProgress(id);
    counts[p.state] = (counts[p.state] || 0) + 1;
  }
  const total = ids.length;
  return {
    total,
    counts,
    mastered: counts.mastered,
    percent: total ? Math.round((counts.mastered / total) * 100) : 0,
    toGo: total - counts.mastered,
  };
}

/**
 * Deadline mode: when the deadline is close, compress intervals and raise the
 * daily goal. Returns the plan the trail and the mixer both read.
 */
export function deadlinePlan({ deadline = null, minutesPerDay = 20, factsLeft = 0, now = Date.now() } = {}) {
  if (!deadline) return { mode: 'normal', deadlineMode: false, daysLeft: null, minutesPerDay, bitesPerDay: 2 };
  const target = typeof deadline === 'string' ? Date.parse(deadline) : deadline;
  const daysLeft = Math.max(0, Math.ceil((target - now) / (24 * 60 * 60 * 1000)));
  const deadlineMode = daysLeft <= 7;
  const bitesPerDay = Math.max(1, Math.min(8, Math.ceil(factsLeft / (8 * Math.max(1, daysLeft)))));
  return {
    mode: daysLeft <= 3 ? 'sprint' : deadlineMode ? 'deadline' : 'normal',
    deadlineMode,
    daysLeft,
    minutesPerDay: deadlineMode ? Math.max(minutesPerDay, 10 * bitesPerDay) : minutesPerDay,
    bitesPerDay,
  };
}
