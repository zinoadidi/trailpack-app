// Session Mixer settings: the manual matrix (activity type x learning state),
// pin and ban, presets, Lens and situation rules. Pure data and small
// functions; `mixer.js` builds bites from the result.

import { ACTIVITIES, ACTIVITY_TYPES, MATRIX_STATES } from './activities.js';

/** Every cell on. Auto mode is the default and looks like this. */
export function allOn() {
  const out = {};
  for (const type of ACTIVITY_TYPES) {
    out[type] = Object.fromEntries(MATRIX_STATES.map((state) => [state, true]));
  }
  return out;
}

/** Map a Lens format weight (flash/quiz/oral/task...) to activity types. */
export const LENS_FORMATS = {
  flash: ['flash'],
  quiz: ['quiz', 'true-false', 'swipe', 'blitz', 'sweep'],
  oral: ['voice', 'teach-back', 'scenario'],
  task: ['order', 'spot-mistake', 'teach-back', 'scenario'],
  match: ['match'],
  order: ['order'],
  swipe: ['swipe'],
  teach: ['teach-back'],
  listen: ['listen'],
};

/**
 * Presets (design 3.9). Each is a partial matrix: a type listed in `off` has
 * every state off; `states` limits a type to the listed states. Everything not
 * mentioned keeps the auto behaviour.
 */
export const PRESETS = {
  auto: { off: [], states: {}, pins: [], bans: [], noVoice: false },
  cram: { off: ['listen'], states: { 'teach-back': ['review'], voice: ['review'] }, pins: ['quiz'], bans: [], noVoice: false },
  calm: { off: ['blitz', 'swipe', 'spot-mistake', 'voice'], states: {}, pins: [], bans: [], noVoice: true },
  speaking: { off: ['swipe', 'match'], states: {}, pins: ['voice'], bans: [], noVoice: false },
  reading: { off: ['voice', 'teach-back', 'listen', 'scenario', 'blitz', 'swipe'], states: {}, pins: [], bans: ['blitz'], noVoice: true },
  phone: { off: ['order', 'teach-back', 'scenario', 'voice'], states: {}, pins: ['swipe'], bans: [], noVoice: false },
  commute: { off: ['order', 'match'], states: {}, pins: ['listen'], bans: [], noVoice: true },
};

export const PRESET_NAMES = Object.keys(PRESETS);

/** Settings shape, filled from defaults. Per camp overrides are keyed by id. */
export function defaultSettings(overrides = {}) {
  return {
    mode: 'auto',
    preset: 'auto',
    matrix: allOn(),
    pins: [],
    bans: [],
    conditions: { train: false, headphones: false, short: false },
    lens: null,
    campOverrides: {},
    ...overrides,
  };
}

/** Apply a preset on top of the all-on matrix. */
export function presetSettings(name, base = {}) {
  const preset = PRESETS[name] || PRESETS.auto;
  const matrix = allOn();
  for (const type of preset.off) {
    for (const state of MATRIX_STATES) matrix[type][state] = false;
  }
  for (const [type, states] of Object.entries(preset.states)) {
    for (const state of MATRIX_STATES) matrix[type][state] = states.includes(state);
  }
  return defaultSettings({
    ...base,
    preset: name,
    matrix,
    pins: [...preset.pins],
    bans: [...preset.bans],
    conditions: { ...(base.conditions || {}), train: preset.noVoice ? true : (base.conditions || {}).train || false },
  });
}

/** Flip one cell (manual mode). Returns a new settings object. */
export function setCell(settings, type, state, on) {
  if (!ACTIVITIES[type] || !MATRIX_STATES.includes(state)) return settings;
  const matrix = { ...settings.matrix, [type]: { ...(settings.matrix[type] || {}), [state]: on === true } };
  return { ...settings, mode: 'manual', matrix, preset: 'custom' };
}

/** Pin ("always one of this per bite") or ban ("never in this bite"). */
export function togglePin(settings, type, which = 'pins') {
  const list = settings[which] || [];
  const next = list.includes(type) ? list.filter((t) => t !== type) : [...list, type];
  return { ...settings, [which]: next };
}

/** The settings to use for one camp: a per camp override wins whole. */
export function forCamp(settings, campId) {
  const override = settings && settings.campOverrides ? settings.campOverrides[campId] : null;
  return override ? { ...settings, ...override } : settings;
}

/**
 * Activity types the Lens favours, from its format weights. A weight of 0
 * removes the group; the largest weights come first.
 */
export function lensPreferences(lens) {
  if (!lens || !lens.formats) return { allow: null, order: [], focus: [] };
  const weights = Object.entries(lens.formats)
    .map(([key, value]) => [key, Number(value) || 0])
    .filter(([key]) => LENS_FORMATS[key]);
  if (!weights.length) return { allow: null, order: [], focus: [] };
  const allow = new Set();
  const focus = [];
  for (const [key, weight] of weights) {
    if (weight <= 0) continue;
    for (const type of LENS_FORMATS[key]) allow.add(type);
    if (weight >= 0.25) focus.push(...LENS_FORMATS[key]);
  }
  const order = weights.sort((a, b) => b[1] - a[1]).map(([key]) => key);
  return { allow: allow.size ? [...allow] : null, order, focus };
}

/**
 * Situation rules (design 3.9): on a train no voice, headphones add listening,
 * little time means short bites.
 */
export function situationRules(conditions = {}) {
  const bans = new Set();
  const pins = new Set();
  let maxMinutes = null;
  if (conditions.train) {
    bans.add('voice');
    bans.add('teach-back');
    bans.add('scenario');
  }
  if (conditions.headphones) pins.add('listen');
  if (conditions.short) {
    maxMinutes = 3;
    bans.add('teach-back');
    bans.add('scenario');
  }
  return { bans: [...bans], pins: [...pins], maxMinutes };
}

/**
 * Work out which (activity, state) cells are open, after the manual matrix, the
 * Lens, pins and bans. `locked` cells cannot be opened by the Lens.
 */
export function openCells(settings, { lens = null, conditions = null } = {}) {
  const prefs = lensPreferences(lens || settings.lens);
  const situation = situationRules(conditions || settings.conditions);
  const bans = new Set([...(settings.bans || []), ...situation.bans]);
  const cells = [];
  const closed = new Set();
  for (const type of ACTIVITY_TYPES) {
    for (const state of MATRIX_STATES) {
      const manual = settings.matrix && settings.matrix[type] ? settings.matrix[type][state] !== false : true;
      const allowedByLens = !prefs.allow || prefs.allow.includes(type);
      const banned = bans.has(type);
      if (manual && allowedByLens && !banned) cells.push({ type, state });
      else if (banned) closed.add(type);
    }
  }
  return { cells, closed: [...closed], prefs, situation, bans: [...bans] };
}
