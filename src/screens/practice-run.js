// A practice round as the state the session screen keeps, and the answer it
// hands back. No rule lives here: it wraps session.js so a practice run and a
// bite answer the same way, and a step that is missing its variant is caught
// on the way in with a message instead of a broken screen.

import { answerStep, currentStep, normaliseAnswer, startSession } from '../study/session.js';
import { ACTIVITIES } from '../study/activities.js';
import { MODULES } from './activities/index.js';
import { DECK_LIMIT, practiceStep, variantsForActivity } from './practice-deck.js';

/** Built activities with at least one matching variant in this Pack. */
export function availablePracticeTypes(facts = []) {
  return Object.keys(MODULES).filter((type) => {
    const entry = ACTIVITIES[type];
    return entry && variantsForActivity(facts, entry.formats, { limit: 1 }).length > 0;
  });
}

/** Start a bounded, single-activity session over playable facts. */
export function startPracticeSession({ facts = [], progress = {}, type, now = Date.now(), seed = (now % 1000000) + 1 } = {}) {
  const entry = ACTIVITIES[type];
  if (!entry || !MODULES[type]) return null;
  const picks = variantsForActivity(facts, entry.formats, { limit: DECK_LIMIT });
  if (!picks.length) return null;
  const base = startSession({ facts, progress, steps: picks.length, seed, now });
  const steps = picks.map(({ fact, variant }) => practiceStep(fact, variant, type, progress[fact.id]?.state || 'new'));
  return { ...base, steps, index: 0, answers: [], startedAt: now, endedAt: null, factProgress: { ...progress }, types: [type] };
}

/** Record an activity answer with the same mastery rules as a study bite. */
export function answerPracticeStep(session, payload, facts, { now = Date.now() } = {}) {
  const step = currentStep(session);
  if (!step) return { session, step: null, done: true };
  const answer = answerFromActivity(payload, step.type, { at: now });
  return answerStep(session, answer, { facts, now });
}

/**
 * Pull the variant a step renders, from the fact list. Returns
 * `{fact, variant}` or `{fact: null, variant: null, reason}`.
 */
export function variantFor(step, facts = []) {
  if (!step) return { fact: null, variant: null, reason: 'study.noFacts' };
  const fact = (facts || []).find((item) => item.id === step.factId) || null;
  if (!fact) return { fact: null, variant: null, reason: 'study.noFacts' };
  const wanted = ACTIVITIES[step.type] ? ACTIVITIES[step.type].formats : [];
  const variant = (fact.variants || []).find((v) => v.id === step.variantId)
    || (fact.variants || []).find((v) => wanted.includes(v.type))
    || null;
  if (!variant) return { fact, variant: null, reason: 'study.fallbackFlash' };
  return { fact, variant, reason: null };
}

/** The step an activity component receives: shaped like an organiser step. */
export function activityStep(step, resolved) {
  return { ...step, factId: (resolved.fact && resolved.fact.id) || step.factId, variantId: (resolved.variant && resolved.variant.id) || step.variantId, variant: resolved.variant };
}

/** Turn an activity's `ctx.onAnswer` payload into the session's answer shape. */
export function answerFromActivity(payload, type, { at = Date.now() } = {}) {
  const raw = payload && typeof payload === 'object' ? payload : { correct: Boolean(payload) };
  const answer = normaliseAnswer({ ...raw, ms: raw.ms === undefined ? 0 : raw.ms }, type);
  return { ...answer, at, type };
}

/** A one line status for a practice step: the activity, and the time budget. */
export function practiceLine(type, { index = 0, total = 0 } = {}) {
  const entry = ACTIVITIES[type] || { label: 'study.type.flash', minutes: 0.5 };
  return { label: entry.label, minutes: entry.minutes, index, total };
}
