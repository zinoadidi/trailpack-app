// Map the session organiser's step into what an activity in this folder
// reads, and back. The organiser step is `{factId, type, variantId, state,
// shape}`; an activity needs the variant object. This is the one place that
// knows both shapes, so the study runner (agent A) and practice.js agree.

import { normaliseAnswer } from '../study/session.js';
import { ACTIVITIES } from '../study/activities.js';

/** The step an activity component receives, with its variant filled in. */
export function activityStep(step, resolved) {
  if (!step) return null;
  const variant = (resolved && resolved.variant) || null;
  return {
    ...step,
    variant,
    variantId: (variant && variant.id) || step.variantId || null,
    factId: (resolved && resolved.fact && resolved.fact.id) || step.factId,
  };
}

/** The context object every activity is called with. */
export function activityCtx(t, onAnswer, api = null) {
  return { t, api, onAnswer: (payload) => onAnswer(payload) };
}

/** The answer an activity gave, in the session's own shape. */
export function activityAnswer(payload, type, { at = Date.now() } = {}) {
  const raw = payload && typeof payload === 'object' ? payload : { correct: Boolean(payload) };
  const answer = normaliseAnswer({ ...raw, ms: raw.ms === undefined ? 0 : raw.ms }, type);
  return { ...answer, at, type };
}

/** What the runner shows beside a step: the activity name and its budget. */
export function stepLine(type, { index = 0, total = 0 } = {}) {
  const entry = ACTIVITIES[type] || { label: 'study.type.flash', minutes: 0.5 };
  return { label: entry.label, minutes: entry.minutes, index, total };
}
