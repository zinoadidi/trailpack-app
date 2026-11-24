// The activity registry: one small module per activity type, each exporting
// default render(container, step, ctx) and returning {destroy()}.
//
// The study runner (agent A) asks for a type and gets either a component or
// null. Types that are not built here (flash, quiz, true-false, swipe, cloze,
// scenario) belong to the runner; a null return means "the runner renders it".

import match from './match.js';
import order from './order.js';
import spotMistake from './spot-mistake.js';
import blitz from './blitz.js';
import teachBack from './teach-back.js';
import sweep from './sweep.js';
import listen from './listen.js';
import voice from './voice.js';

export const ACTIVITY_COMPONENTS = {
  match,
  order,
  'spot-mistake': spotMistake,
  blitz,
  'teach-back': teachBack,
  sweep,
  listen,
  voice,
};

/** Types this folder renders (a Set, for a quick membership check). */
export const BUILT_TYPES = new Set(Object.keys(ACTIVITY_COMPONENTS));

/**
 * Render one step into a container. Returns `{destroy}` from the component,
 * or null when this folder does not own that type.
 */
export function renderActivity(type, container, step, ctx) {
  const component = ACTIVITY_COMPONENTS[type];
  if (!component) return null;
  return component(container, step, ctx) || { destroy() {} };
}

export { match, order, spotMistake, blitz, teachBack, sweep, listen, voice };
