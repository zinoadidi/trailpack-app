// Small helpers shared by the activities. Everything here is pure except the
// two factories that touch the clock and the DOM; the pure parts are tested in
// test/activities.test.mjs.

import { h } from '../../app/ui.js';

/** Seeded shuffle: the same input list and seed give the same order. */
export function shuffle(list, seed = 1) {
  const out = [...(list || [])];
  let a = (Number(seed) || 1) >>> 0;
  const rng = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Move one item of a list to `to`, clamped. Returns a new list. */
export function moveItem(list, from, to) {
  const out = [...(list || [])];
  if (!out.length) return out;
  const a = Math.max(0, Math.min(out.length - 1, Number(from) || 0));
  const b = Math.max(0, Math.min(out.length - 1, Number(to) || 0));
  const [item] = out.splice(a, 1);
  out.splice(b, 0, item);
  return out;
}

/** Up/down keyboard move for a reorderable list. Returns the new index. */
export function reorderKey(index, key, length) {
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'ArrowDown') return Math.min(length - 1, index + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

/** A seeded seed from a step, so a re-render of one step is stable. */
export function seedOf(step) {
  const text = String((step && (step.variantId || step.factId)) || 'step');
  let n = 7;
  for (let i = 0; i < text.length; i += 1) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  return n || 7;
}

/** Timer bounds for the blitz; 60 seconds is the spec's round. */
export const BLITZ_SECONDS = 60;
export function blitzRemaining(startedAt, now, seconds = BLITZ_SECONDS) {
  const left = Number(seconds) - (now - Number(startedAt || 0)) / 1000;
  return Math.max(0, Math.ceil(left));
}
export function blitzExpired(startedAt, now, seconds = BLITZ_SECONDS) {
  return blitzRemaining(startedAt, now, seconds) <= 0;
}

/** A deck for the mastery sweep: the fact's variants in a stable order. */
export function sweepDeck(fact) {
  return (fact && fact.variants ? fact.variants : []).filter((v) => v && v.type);
}

/** "1 of 3 marked" for the sweep progress. */
export function sweepProgress(asked, total) {
  const done = Math.max(0, Math.min(Number(total) || 0, Number(asked) || 0));
  return { done, total: Number(total) || 0, ratio: total ? done / total : 0 };
}

/** milliseconds since the activity showed, for the answer row. */
export function timer(now = Date.now) {
  const start = now();
  return { ms: () => Math.max(0, Math.round(now() - start)) };
}

/** Common shell: title row, body, a status line announced politely. */
export function shell(container, title, body = null) {
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } }, h('b', {}, title));
  const wrap = h('div', { class: 'stack', style: { gap: '10px' } }, head, body, status);
  container.replaceChildren(wrap);
  return { wrap, head, status, body: () => status };
}

/** Values a step needs from the context, with safe fallbacks. */
export function ctxOf(ctx) {
  const safe = ctx || {};
  return {
    t: typeof safe.t === 'function' ? safe.t : (key) => key,
    onAnswer: typeof safe.onAnswer === 'function' ? safe.onAnswer : () => {},
    onFlip: typeof safe.onFlip === 'function' ? safe.onFlip : () => {},
  };
}
