// The Mixer settings logic (src/screens/mixer-logic.js) plus the rules it
// reads from src/study/mixer-settings.js, checked together so the screen and
// the bite cannot disagree about which cell is on.

import test from 'node:test';
import assert from 'node:assert/strict';

import { matrixRows, cellOn, onCount, matrixFromOff, modeSummary, presetChoices, overrideCamps } from '../src/screens/mixer-logic.js';
import { allOn, presetSettings, setCell, defaultSettings, openCells } from '../src/study/mixer-settings.js';
import { ACTIVITY_TYPES, MATRIX_STATES } from '../src/study/activities.js';

test('the matrix has one row per activity and one column per state', () => {
  const rows = matrixRows();
  assert.equal(rows.length, ACTIVITY_TYPES.length);
  assert.deepEqual(rows[0].states, MATRIX_STATES);
  assert.ok(rows.every((row) => row.label.startsWith('study.type.')));
});

test('a missing matrix reads as on, exactly like the bite', () => {
  assert.equal(cellOn({}, 'quiz', 'new'), true);
  assert.equal(cellOn({ quiz: { new: false } }, 'quiz', 'new'), false);
  assert.equal(cellOn({ quiz: { new: false } }, 'quiz', 'review'), true, 'only the switched off cell is off');
  const settings = defaultSettings();
  for (const type of ACTIVITY_TYPES) {
    for (const state of MATRIX_STATES) assert.equal(cellOn(settings.matrix, type, state), openCells(settings).cells.some((c) => c.type === type && c.state === state));
  }
});

test('every cell starts on and the count is the whole grid', () => {
  const counts = onCount(allOn());
  assert.deepEqual(counts, { on: ACTIVITY_TYPES.length * MATRIX_STATES.length, total: ACTIVITY_TYPES.length * MATRIX_STATES.length });
});

test('the screen counts what the rules open', () => {
  const settings = setCell(presetSettings('reading'), 'quiz', 'new', false);
  const screen = onCount(settings.matrix).on;
  const rules = openCells(settings).cells.length;
  assert.equal(screen, rules, 'the screen and openCells agree on what is on');
});

test('a preset with off lists rebuilds the same matrix', () => {
  const fromPreset = presetSettings('reading').matrix;
  const fromOff = matrixFromOff(['voice', 'teach-back', 'listen', 'scenario', 'blitz', 'swipe']);
  assert.deepEqual(fromOff, fromPreset);
  assert.equal(fromOff.new, undefined, 'only known activities are written');
});

test('the summary names the mode and the preset key', () => {
  const auto = modeSummary(presetSettings('commute'));
  assert.equal(auto.mode, 'auto');
  assert.equal(auto.presetKey, 'mixer.preset.commute');
  assert.equal(auto.line, null, 'auto mode has no cell count line');
  const manual = modeSummary({ ...setCell(defaultSettings(), 'quiz', 'new', false), mode: 'manual' });
  assert.equal(manual.mode, 'manual');
  assert.deepEqual(manual.line, { on: manual.on, total: manual.total });
});

test('every preset has a label and a help key', () => {
  const choices = presetChoices();
  assert.ok(choices.length >= 7);
  for (const choice of choices) {
    assert.equal(choice.label, 'mixer.preset.' + choice.name);
    assert.equal(choice.help, 'mixer.presetHelp.' + choice.name);
  }
});

test('the camps offered for an override are the plan’s camps in order', () => {
  const plan = { camps: [{ id: 'camp_1', index: 0, title: 'Intro' }, { id: 'camp_2', index: 1, title: 'Tools' }] };
  assert.deepEqual(overrideCamps(plan).map((c) => c.id), ['camp_1', 'camp_2']);
  assert.deepEqual(overrideCamps(null), []);
});
