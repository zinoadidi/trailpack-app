// The Mixer matrix drawn as a table of toggle buttons: one row per activity,
// one column per learning state. Header cells are column headers, rows toggle
// with buttons, and the whole thing is reachable from a keyboard in order.

import { h } from '../app/ui.js';
import { setCell } from '../study/mixer-settings.js';
import { matrixRows, cellOn } from './mixer-logic.js';

/**
 * @param {object} settings   current mixer settings
 * @param {Function} onChange  (nextSettings) => void
 * @param {Function} t         translator
 */
export function matrixTable(settings, onChange, t) {
  const rows = matrixRows();
  const table = h('table', { class: 'matrix' });
  const head = h('tr', {}, h('th', { scope: 'col' }, t('mixer.activityCol')));
  for (const state of rows[0] ? rows[0].states : []) head.append(h('th', { scope: 'col' }, t('mixer.state.' + state)));
  table.append(h('thead', {}, head));

  const body = h('tbody', {});
  for (const row of rows) {
    const tr = h('tr', {}, h('th', { scope: 'row' }, t(row.label)));
    for (const state of row.states) {
      const on = cellOn(settings.matrix, row.type, state);
      tr.append(
        h('td', {},
          h('button', {
            type: 'button',
            class: 'cell' + (on ? ' on' : ''),
            'aria-pressed': String(on),
            'aria-label': t('mixer.cellLabel', { activity: t(row.label), state: t('mixer.state.' + state), on: on ? t('mixer.on') : t('mixer.off') }),
            onclick: () => onChange(setCell(settings, row.type, state, !on)),
          }, on ? '\u2713' : '\u00b7')),
      );
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}
