// Pure helpers for the Mixer settings screen (src/screens/mixer.js): the grid
// rows, the cell state, a count of open cells and the summary line. The rules
// themselves live in src/study/mixer-settings.js; nothing new is decided here.

import { ACTIVITIES, ACTIVITY_TYPES, MATRIX_STATES } from '../study/activities.js';
import { PRESETS, PRESET_NAMES, allOn } from '../study/mixer-settings.js';

/** One row of the matrix, in activity catalogue order. */
export function matrixRows() {
  return ACTIVITY_TYPES.map((type) => ({
    type,
    label: ACTIVITIES[type].label,
    states: [...MATRIX_STATES],
  }));
}

/** Is one cell on? A missing matrix reads as on, exactly like openCells(). */
export function cellOn(matrix, type, state) {
  if (!matrix || !matrix[type]) return true;
  return matrix[type][state] !== false;
}

/** How many cells are on, out of the whole grid, for the manual summary. */
export function onCount(matrix) {
  let on = 0;
  for (const type of ACTIVITY_TYPES) for (const state of MATRIX_STATES) if (cellOn(matrix, type, state)) on += 1;
  return { on, total: ACTIVITY_TYPES.length * MATRIX_STATES.length };
}

/** A generated matrix from off lists, for a camp override: everything else on. */
export function matrixFromOff(off = [], states = {}) {
  const matrix = allOn();
  for (const type of off) {
    if (!matrix[type]) continue;
    for (const state of MATRIX_STATES) matrix[type][state] = false;
  }
  for (const [type, list] of Object.entries(states)) {
    if (!matrix[type]) continue;
    for (const state of MATRIX_STATES) matrix[type][state] = list.includes(state);
  }
  return matrix;
}

/** Human summary of the current mode: auto with a preset, or manual cells. */
export function modeSummary(settings) {
  const counts = onCount(settings && settings.matrix);
  const preset = settings && settings.preset && PRESETS[settings.preset] ? settings.preset : null;
  return {
    mode: settings && settings.mode === 'manual' ? 'manual' : 'auto',
    preset,
    presetKey: preset ? 'mixer.preset.' + preset : null,
    ...counts,
    line: settings && settings.mode === 'manual' ? { on: counts.on, total: counts.total } : null,
  };
}

/** Is this preset name offered on the screen? Unknown names are dropped. */
export function presetChoices() {
  return PRESET_NAMES.filter((name) => Boolean(PRESETS[name])).map((name) => ({ name, label: 'mixer.preset.' + name, help: 'mixer.presetHelp.' + name }));
}

/** The camps a per camp override can be written for. */
export function overrideCamps(plan) {
  return ((plan && plan.camps) || []).map((camp) => ({
    id: camp.id,
    title: camp.title,
    index: camp.index,
    hasOverride: false,
  }));
}

export { MATRIX_STATES, ACTIVITY_TYPES };
