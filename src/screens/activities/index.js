// Activity loader: type -> module. A small map, not a template string, so the
// bundler keeps working. Unknown or not-yet-written types (the other agent's
// match, order, blitz and so on) fall back to the flashcard, which every fact
// has; the screen says so quietly when it happens.

import flash from './flash.js';

/** Types shipped (A: flash to cloze; B: match to voice). `swipe` also answers true-false variants. */
export const MODULES = {
  flash: () => import('./flash.js'),
  quiz: () => import('./quiz.js'),
  'true-false': () => import('./true-false.js'),
  swipe: () => import('./swipe.js'),
  cloze: () => import('./cloze.js'),
  sweep: () => import('./sweep.js'),
  match: () => import('./match.js'),
  order: () => import('./order.js'),
  'spot-mistake': () => import('./spot-mistake.js'),
  blitz: () => import('./blitz.js'),
  'teach-back': () => import('./teach-back.js'),
  listen: () => import('./listen.js'),
  voice: () => import('./voice.js'),
};

/**
 * Render one step into `container`. Returns `{el, destroy}` shape always: a
 * broken module must never take the bite down with it.
 */
export async function renderActivity(container, step, ctx) {
  const load = MODULES[step.type];
  let used = step.type;
  let mod = null;
  if (load) {
    try {
      mod = await load();
    } catch {
      mod = null;
    }
  }
  const fallbackCtx = { ...ctx, fallback: used !== 'flash' };
  if (!mod || typeof mod.default !== 'function') {
    used = 'flash';
    await flash(container, step, fallbackCtx);
    return { fallback: true, type: used };
  }
  try {
    mod.default(container, step, { ...ctx, fallback: false });
    return { fallback: false, type: used };
  } catch {
    container.replaceChildren();
    await flash(container, step, fallbackCtx);
    return { fallback: true, type: 'flash' };
  }
}
