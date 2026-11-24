// The Trail home in pictures: the readiness ring and the "you are here"
// marker on the path. Pure DOM builders, no state; the screen keeps its
// layout and these only draw one small thing each.

import { h } from '../app/ui.js';

/** A readiness ring: 0..100 as a dashed circle with the number inside. */
export function ring(percent, label) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const wrap = h('div', { class: 'ringwrap', role: 'img', 'aria-label': label || String(value) + '%', style: { '--pct': String(value) } });
  wrap.append(h('div', { class: 'ring' }), h('div', { class: 'ringinner' }, h('b', {}, value + '%')));
  return wrap;
}

/** The "you are here" marker beside the open camp. */
export function hereMarker(label) {
  return h('span', { class: 'heremark', 'aria-hidden': 'true', title: label || '' }, '\u25bc');
}
