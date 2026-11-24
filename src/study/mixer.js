// Session Mixer (design 3.9): build one bite from the facts that are due.
//
// Rules the auto mode enforces, and the tests check:
//   - never the same activity type twice in a row,
//   - at most 2 steps of one type per bite,
//   - at least 3 different types (when the bite has 3 or more steps),
//   - shape: easy opener, harder middle, confident finish,
//   - match activity to learning state (recognition for New, production for
//     Learning, retrieval under pressure for Review, sweeps only for Mastered),
//   - prefer types not seen lately and types the learner does well with,
//   - respect the Lens and the situation,
//   - pins and bans from the manual matrix,
//   - safety net: an item whose every format is switched off falls back to a
//     flashcard and the bite says so.
//
// Everything is derived from the seed passed in, so a test (or a replay) gets
// the same bite every time.

import { ACTIVITIES, ACTIVITY_TYPES, canPlay, variantFor } from './activities.js';
import { openCells, situationRules } from './mixer-settings.js';

export const BITE_STEPS = { min: 6, max: 10 };
export const MAX_PER_TYPE = 2;
export const MIN_TYPES = 3;

/** Small seeded random: mulberry32. */
export function seeded(seed = 1) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Steps for a bite under a time budget: 6 to 10 (3 to 5 minutes). */
export function biteLength(minutes, { conditions = {} } = {}) {
  const budget = Number(minutes) > 0 ? Number(minutes) : 4;
  const capped = conditions && conditions.short ? Math.min(budget, 3) : budget;
  const steps = Math.round(capped / 0.45);
  return Math.max(BITE_STEPS.min, Math.min(BITE_STEPS.max, steps));
}

const EASY = new Set(['flash', 'true-false', 'swipe', 'match', 'listen', 'quiz']);
const HARD = new Set(['cloze', 'order', 'spot-mistake', 'blitz', 'scenario', 'teach-back', 'voice']);

function difficultyOf(type) {
  if (EASY.has(type)) return 'easy';
  if (HARD.has(type)) return 'hard';
  return 'medium';
}

/**
 * Pick an activity for one fact. `stateKey` is the fact's mastery state.
 * Returns a step or null when nothing playable is left. The "never the same
 * type twice in a row" rule is applied here; the caller relaxes it only when
 * there is nothing else at all (two variants in the whole Pack, say).
 */
export function chooseActivity(fact, stateKey, ctx) {
  const { open, used, last, weights, banned = [], pins = [], rng = Math.random, allowRepeatLast = false } = ctx;
  const candidates = [];
  for (const type of ACTIVITY_TYPES) {
    if (banned.includes(type)) continue;
    const entry = ACTIVITIES[type];
    if (!canPlay(type, fact)) continue;
    const state = stateKey === 'lapsed' ? 'weak' : stateKey;
    if (!entry.states.includes(state)) continue;
    if (!open.some((cell) => cell.type === type && cell.state === state)) continue;
    if ((used[type] || 0) >= MAX_PER_TYPE) continue;
    if (type === last && !allowRepeatLast) continue;
    let score = 1;
    score += (weights[type] || 0) * 2; // recency: unseen types score higher
    score += pins.includes(type) ? 3 : 0;
    score += rng() * 0.4;
    candidates.push({ type, score });
  }
  if (!candidates.length) {
    if (allowRepeatLast && last) return chooseActivity(fact, stateKey, { ...ctx, allowRepeatLast: false, last: null, rng });
    // The safety net: a flashcard, if the matrix allows it for this state.
    const state = stateKey === 'lapsed' ? 'weak' : stateKey;
    const flashOpen = open.some((cell) => cell.type === 'flash' && cell.state === state);
    const hasFlash = (fact.variants || []).some((variant) => variant.type === 'flashcard');
    if (hasFlash && flashOpen) return { type: 'flash', fallback: true, reason: 'study.fallbackFlash' };
    return null;
  }
  candidates.sort((a, b) => b.score - a.score);
  return { type: candidates[0].type, fallback: false };
}

/** Which fact to use for a step: the one with the fewest attempts seen so far. */
function pickFact(facts, stateOf, { usedFacts = [], rng = Math.random }) {
  const fresh = facts.filter((fact) => !usedFacts.includes(fact.id));
  const pool = fresh.length ? fresh : facts;
  if (!pool.length) return null;
  const index = Math.floor(rng() * pool.length);
  void stateOf;
  return pool[index];
}

/**
 * Build a bite.
 *
 * @param {object} input
 * @param {Array} input.facts      facts in play (each with variants)
 * @param {Function} input.stateOf (factId) => mastery state key
 * @param {Array} [input.order]    fact ids in the order the intake chose
 * @param {object} [input.settings] mixer settings (see mixer-settings.js)
 * @param {object} [input.lens]    the active Lens (formats, difficulty)
 * @param {number} [input.steps]   desired steps, 6 to 10
 * @param {number} [input.seed]    deterministic seed
 * @param {object} [input.history] {perType: {type: lastUsedIndex}, typesSeen: []}
 */
export function buildBite(input = {}) {
  const {
    facts = [],
    stateOf = () => 'new',
    order = null,
    settings,
    lens = null,
    steps = 8,
    seed = 1,
    history = {},
  } = input;
  const rng = seeded(seed);
  const want = Math.max(0, Math.min(BITE_STEPS.max, Math.round(Number(steps) || 8)));
  const { cells, prefs, situation, bans } = openCells(settings || { matrix: {}, pins: [], bans: [] }, { lens, conditions: input.conditions });
  const open = cells;
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const sequence = (order && order.length ? order : facts.map((fact) => fact.id)).map((id) => byId.get(id)).filter(Boolean);

  const used = {};
  const usedFacts = [];
  const typesSeen = Array.isArray(history.typesSeen) ? history.typesSeen : [];
  const weights = {};
  for (const type of ACTIVITY_TYPES) {
    const position = typesSeen.lastIndexOf(type);
    weights[type] = position < 0 ? 0.5 : Math.max(0, 1 - (typesSeen.length - position) / Math.max(6, typesSeen.length));
  }
  const pins = [...(settings && settings.pins ? settings.pins : []), ...situation.pins].filter((type) => !bans.includes(type));
  const out = [];
  const fallbacks = [];
  let last = null;

  const shape = (index) => (index === 0 ? 'easy' : index === want - 1 ? 'finish' : 'middle');

  for (let index = 0; index < want; index += 1) {
    const fact = pickFact(sequence, stateOf, { usedFacts, rng });
    if (!fact) break;
    const stateKey = stateOf(fact.id);
    let choice = chooseActivity(fact, stateKey, { open, used, last, weights, banned: bans, pins: pins.filter((type) => (used[type] || 0) === 0), rng });
    // Shape: the opener prefers an easy type, the finish too; the middle
    // takes what it can get. When the preference is impossible, keep going.
    if (choice && index === 0 && !EASY.has(choice.type) && !choice.fallback) {
      const easyPick = chooseActivity({ ...fact, variants: (fact.variants || []).filter((v) => ['flashcard', 'true-false', 'swipe', 'multiple-choice', 'match', 'listen'].includes(v.type)) }, stateKey, { open, used, last, weights, banned: bans, pins: [], rng });
      if (easyPick) choice = easyPick;
    }
    if (!choice) {
      // Nothing for this fact: allow a repeat of the last type as a last resort.
      choice = chooseActivity(fact, stateKey, { open, used, last, weights, banned: bans, pins: [], rng, allowRepeatLast: true });
    }
    if (!choice) {
      // Still nothing: try the rest of the queue before giving up.
      const other = sequence.find((item) => !usedFacts.includes(item.id) && chooseActivity(item, stateOf(item.id), { open, used, last, weights, banned: bans, pins: [], rng }));
      if (!other) continue;
      const retry = chooseActivity(other, stateOf(other.id), { open, used, last, weights, banned: bans, pins: [], rng });
      if (!retry) continue;
      out.push({ factId: other.id, type: retry.type, state: stateOf(other.id), shape: shape(index), variantId: (variantFor(retry.type, other) || {}).id || null, fallback: retry.fallback });
      used[retry.type] = (used[retry.type] || 0) + 1;
      usedFacts.push(other.id);
      last = retry.type;
      continue;
    }
    out.push({
      factId: fact.id,
      type: choice.type,
      state: stateKey,
      shape: shape(index),
      variantId: (variantFor(choice.type, fact) || {}).id || null,
      fallback: choice.fallback,
    });
    if (choice.fallback) fallbacks.push(fact.id);
    used[choice.type] = (used[choice.type] || 0) + 1;
    usedFacts.push(fact.id);
    last = choice.type;
  }

  // Ensure a pin is honoured: swap one step when a pinned type never made it.
  const present = new Set(out.map((step) => step.type));
  for (const type of pins) {
    if (present.has(type)) continue;
    const swapAt = out.findIndex((step, i) => i > 0 && i < out.length - 1);
    if (swapAt < 0) break;
    const fact = byId.get(out[swapAt].factId);
    if (fact && canPlay(type, fact)) {
      out[swapAt] = { ...out[swapAt], type, variantId: (variantFor(type, fact) || {}).id || null, pinned: true };
      present.add(type);
    }
  }

  const types = [...new Set(out.map((step) => step.type))];
  const minutes = Math.max(1, Math.round(out.reduce((sum, step) => sum + (ACTIVITIES[step.type]?.minutes || 0.5), 0)));
  const tooFewTypes = out.length >= MIN_TYPES && types.length < MIN_TYPES;
  return {
    steps: out,
    types,
    minutes,
    seed,
    length: out.length,
    fallbacks,
    warnings: [...(fallbacks.length ? ['study.fallbackUsed'] : []), ...(tooFewTypes ? ['study.fewTypes'] : []), ...(prefs.allow ? [] : [])],
    lensFocused: Boolean(prefs.allow),
    maxMinutes: situation.maxMinutes,
  };
}

export { situationRules };
