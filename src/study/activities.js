// Activity catalogue: one entry per activity type, with what it needs from a
// fact, how it is scored and which learning state it suits (design 3.8).
//
// The Mixer, the study screen and the tests all read this table, so a new
// activity is added in one place. `formats` are the variant types a fact must
// have for the activity to be playable; `fallback` types are tried in order
// when the Lens or the manual matrix switches formats off.

/** State keys in the mixer matrix. Mastered facts only appear in sweeps/boss. */
export const MATRIX_STATES = ['new', 'learning', 'review', 'weak', 'mastered'];

export const ACTIVITIES = {
  flash: { label: 'study.type.flash', formats: ['flashcard'], scoring: 'self', minutes: 0.4, states: ['new', 'learning', 'review', 'weak'] },
  quiz: { label: 'study.type.quiz', formats: ['multiple-choice'], scoring: 'hard', minutes: 0.6, states: ['new', 'learning', 'review', 'weak'] },
  'true-false': { label: 'study.type.trueFalse', formats: ['true-false'], scoring: 'hard', minutes: 0.4, states: ['new', 'learning', 'review', 'weak'] },
  swipe: { label: 'study.type.swipe', formats: ['swipe', 'true-false'], scoring: 'hard', minutes: 0.3, states: ['new', 'learning', 'weak'] },
  cloze: { label: 'study.type.cloze', formats: ['cloze'], scoring: 'fuzzy', minutes: 0.6, states: ['learning', 'review', 'weak'] },
  match: { label: 'study.type.match', formats: ['match'], scoring: 'hard', minutes: 0.7, states: ['new', 'learning', 'weak'] },
  order: { label: 'study.type.order', formats: ['order'], scoring: 'hard', minutes: 0.8, states: ['learning', 'review'] },
  'spot-mistake': { label: 'study.type.spotMistake', formats: ['spot-mistake', 'true-false'], scoring: 'hard', minutes: 0.6, states: ['learning', 'review', 'weak'] },
  blitz: { label: 'study.type.blitz', formats: ['multiple-choice', 'true-false'], scoring: 'hard', minutes: 1, states: ['review', 'weak'] },
  'teach-back': { label: 'study.type.teachBack', formats: ['teach-back'], scoring: 'llm', minutes: 1.5, states: ['review'], production: true },
  voice: { label: 'study.type.voice', formats: ['voice'], scoring: 'coverage', minutes: 1, states: ['review', 'weak'], production: true },
  listen: { label: 'study.type.listen', formats: ['listen'], scoring: 'hard', minutes: 0.8, states: ['new', 'learning', 'review'] },
  scenario: { label: 'study.type.scenario', formats: ['scenario'], scoring: 'coverage', minutes: 1.2, states: ['review'], production: true },
  sweep: { label: 'study.type.sweep', formats: ['multiple-choice', 'cloze', 'true-false', 'flashcard'], scoring: 'hard', minutes: 0.5, states: ['mastered'] },
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITIES);

/** Production activities in this table (a mastery requirement). */
export const PRODUCTION_ACTIVITIES = ACTIVITY_TYPES.filter((type) => ACTIVITIES[type].production || ['cloze', 'order'].includes(type));

export function activity(type) {
  return ACTIVITIES[type] || null;
}

export function isKnownActivity(type) {
  return Object.prototype.hasOwnProperty.call(ACTIVITIES, type);
}

/** Does the activity suit this learning state (by the catalogue)? */
export function suitsState(type, state) {
  const entry = ACTIVITIES[type];
  if (!entry) return false;
  return entry.states.includes(state === 'lapsed' ? 'weak' : state);
}

/**
 * Does the fact carry a variant the activity can render? `formats` lets the
 * caller narrow to what a Lens or the manual grid allows.
 */
export function canPlay(type, fact, formats = null) {
  const entry = ACTIVITIES[type];
  if (!entry || !fact) return false;
  const allowed = formats && formats.length ? formats : entry.formats;
  const wanted = entry.formats.filter((f) => allowed.includes(f));
  const list = wanted.length ? wanted : [];
  return (fact.variants || []).some((variant) => list.includes(variant.type));
}

/** The first variant of this activity the fact has, or null. */
export function variantFor(type, fact) {
  const entry = ACTIVITIES[type];
  if (!entry || !fact) return null;
  return (fact.variants || []).find((variant) => entry.formats.includes(variant.type)) || null;
}
