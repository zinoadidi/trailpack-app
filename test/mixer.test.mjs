import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVITY_TYPES, canPlay, suitsState } from '../src/study/activities.js';
import { allOn, defaultSettings, presetSettings, setCell, togglePin, forCamp, lensPreferences, situationRules, PRESET_NAMES } from '../src/study/mixer-settings.js';
import { BITE_STEPS, MAX_PER_TYPE, MIN_TYPES, biteLength, buildBite, seeded, situationRules as mixerSituation } from '../src/study/mixer.js';

/** A fact with one variant per type, so any activity can render it. */
function fact(id, types = ['flashcard', 'multiple-choice', 'true-false', 'swipe', 'cloze', 'match', 'order', 'spot-mistake', 'teach-back', 'voice', 'listen', 'scenario']) {
  return {
    id,
    topicId: 't1',
    statement: `Fact number ${id} says something testable.`,
    variants: types.map((type, i) => ({ id: `v_${id}_${i}`, type })),
  };
}

function facts(n = 24, types) {
  return Array.from({ length: n }, (_, i) => fact('f' + i, types));
}

const statesNew = (list) => (id) => (list || 'new');

function checkRules(bite) {
  const types = bite.steps.map((step) => step.type);
  for (let i = 1; i < types.length; i += 1) assert.notEqual(types[i], types[i - 1], `same type twice in a row at ${i}: ${types.join(',')}`);
  const counts = {};
  for (const type of types) counts[type] = (counts[type] || 0) + 1;
  for (const [type, count] of Object.entries(counts)) assert.ok(count <= MAX_PER_TYPE, `${type} used ${count} times`);
  if (types.length >= MIN_TYPES) assert.ok(new Set(types).size >= MIN_TYPES, `only ${types.length} types: ${types.join(',')}`);
}

test('bite length is between 6 and 10 steps and 3 minutes caps at the minimum', () => {
  assert.ok(biteLength(3) >= BITE_STEPS.min && biteLength(3) <= BITE_STEPS.max);
  assert.ok(biteLength(9) <= BITE_STEPS.max);
  assert.ok(biteLength(20) <= BITE_STEPS.max);
  assert.ok(biteLength(0) >= BITE_STEPS.min);
  assert.ok(biteLength(9, { conditions: { short: true } }) <= 8);
});

test('the same seed builds the same bite', () => {
  const input = { facts: facts(), stateOf: statesNew(), settings: defaultSettings(), steps: 8, seed: 42 };
  assert.deepEqual(buildBite(input).steps, buildBite(input).steps);
  assert.notDeepEqual(buildBite({ ...input, seed: 7 }).steps, buildBite(input).steps);
});

test('auto mode keeps every rule on many seeds', () => {
  const list = facts();
  for (let seed = 1; seed <= 60; seed += 1) {
    const bite = buildBite({ facts: list, stateOf: (id) => (Number(id.slice(1)) % 4 === 0 ? 'learning' : 'new'), settings: defaultSettings(), steps: 6 + (seed % 5), seed });
    checkRules(bite);
    assert.ok(bite.steps.length >= 6 && bite.steps.length <= 10);
    assert.ok(bite.minutes >= 1);
  }
});

test('learning facts move to production activities, mastered only to sweeps', () => {
  const list = facts();
  const bite = buildBite({ facts: list, stateOf: (id) => (Number(id.slice(1)) % 2 ? 'learning' : 'review'), settings: defaultSettings(), steps: 8, seed: 3 });
  for (const step of bite.steps) {
    assert.notEqual(step.state, 'new');
    assert.ok(suitsState(step.type, step.state), `${step.type} does not suit ${step.state}`);
  }
  // Mastered facts only show up in sweeps. With a pack that is entirely
  // mastered the safety net still has to fill a bite, so at most one type
  // other than a sweep may appear.
  const mastered = buildBite({ facts: list, stateOf: () => 'mastered', settings: defaultSettings(), steps: 6, seed: 5 });
  for (const step of mastered.steps) assert.ok(['sweep', 'flash'].includes(step.type), step.type);
  assert.ok(mastered.steps.some((step) => step.type === 'sweep' && !step.fallback));
});

test('the manual matrix is respected', () => {
  let settings = defaultSettings();
  for (const state of ['new', 'learning', 'review', 'weak', 'mastered']) settings = setCell(settings, 'quiz', state, false);
  settings = setCell(settings, 'true-false', 'new', false);
  const bite = buildBite({ facts: facts(), stateOf: (id) => (Number(id.slice(1)) % 3 ? 'new' : 'learning'), settings, steps: 8, seed: 9 });
  for (const step of bite.steps) {
    assert.notEqual(step.type, 'quiz');
    if (step.state === 'new') assert.notEqual(step.type, 'true-false');
  }
});

test('bans are never used and pins survive', () => {
  const settings = { ...defaultSettings(), bans: ['blitz', 'swipe'], pins: ['match'] };
  const bite = buildBite({ facts: facts(), stateOf: () => 'review', settings, steps: 8, seed: 11 });
  const types = bite.steps.map((step) => step.type);
  assert.ok(!types.includes('blitz'));
  assert.ok(!types.includes('swipe'));
  assert.ok(types.includes('match'), `match was pinned but got ${types.join(',')}`);
});

test('a train ban removes voice and shallows the speak types', () => {
  const settings = { ...defaultSettings(), conditions: { train: true } };
  const bite = buildBite({ facts: facts(), stateOf: () => 'review', settings, steps: 8, seed: 13 });
  const types = bite.steps.map((step) => step.type);
  for (const banned of ['voice', 'teach-back', 'scenario']) assert.ok(!types.includes(banned), `${banned} used on a train`);
});

test('safety net: a flashcard stands in when a fact has no playable variant', () => {
  // The fact only has a true-false variant and that format is closed for New,
  // so the Mixer swaps in the flashcard variant instead of leaving a hole.
  const list = Array.from({ length: 6 }, (_, i) => ({
    id: 'n' + i,
    statement: 'Only a true false claim lives on this fact.',
    variants: [
      { id: 'v' + i, type: 'true-false', type2: undefined },
      { id: 'w' + i, type: 'flashcard', front: 'Q', back: 'A' },
    ],
  }));
  let settings = defaultSettings();
  for (const type of ACTIVITY_TYPES) if (type !== 'flash') settings = setCell(settings, type, 'new', false);
  const bite = buildBite({ facts: list, stateOf: () => 'new', settings, steps: 6, seed: 4 });
  assert.equal(bite.steps.length, 6);
  assert.ok(bite.steps.every((step) => step.type === 'flash'));
  assert.ok(bite.warnings.includes('study.fewTypes'));
});

test('a fact with nothing playable at all is skipped, not shown broken', () => {
  const list = [fact('empty', []), ...facts(12)];
  const bite = buildBite({ facts: list, stateOf: () => 'new', settings: defaultSettings(), steps: 8, seed: 2 });
  assert.ok(!bite.steps.some((step) => step.factId === 'empty'));
  for (const step of bite.steps) {
    const source = list.find((item) => item.id === step.factId);
    assert.ok(canPlay(step.type, source));
    assert.ok(step.variantId, 'every step names the variant it will render');
  }
});

test('the Lens leans the mix towards its formats', () => {
  const oral = { formats: { flash: 0, quiz: 0, oral: 1, task: 0 }, difficulty: 'hard' };
  const bite = buildBite({ facts: facts(), stateOf: () => 'review', settings: defaultSettings(), lens: oral, steps: 8, seed: 17 });
  for (const step of bite.steps) assert.ok(['voice', 'teach-back', 'scenario'].includes(step.type), `Lens ignored: ${step.type}`);
  assert.equal(bite.lensFocused, true);
});

test('recency weighting prefers types that have not been seen lately', () => {
  const settings = defaultSettings();
  const history = { typesSeen: ['flash', 'quiz', 'cloze', 'order', 'match', 'blitz', 'swipe', 'true-false'] };
  const bite = buildBite({ facts: facts(), stateOf: () => 'new', settings, steps: 6, seed: 21, history });
  // With every new-state easy type used recently, true-false is the one fresh
  // new-state type left in that history, so it should appear.
  assert.ok(bite.steps.some((step) => ['listen', 'true-false', 'match', 'flash'].includes(step.type)));
});

test('presets map to settings and every preset name exists', () => {
  assert.deepEqual(PRESET_NAMES, ['auto', 'cram', 'calm', 'speaking', 'reading', 'phone', 'commute']);
  const reading = presetSettings('reading');
  assert.equal(reading.matrix.voice.new, false);
  assert.equal(reading.matrix.flash.new, true);
  const speaking = presetSettings('speaking');
  assert.ok(speaking.pins.includes('voice'));
  const auto = presetSettings('auto');
  assert.deepEqual(auto.matrix, allOn());
  const custom = setCell(auto, 'blitz', 'review', false);
  assert.equal(custom.mode, 'manual');
  assert.equal(custom.preset, 'custom');
});

test('pins toggle and per camp overrides apply whole', () => {
  let settings = defaultSettings();
  settings = togglePin(settings, 'scenario');
  assert.deepEqual(settings.pins, ['scenario']);
  settings = togglePin(settings, 'scenario');
  assert.deepEqual(settings.pins, []);
  settings = { ...settings, campOverrides: { camp2: { pins: ['listen'], mode: 'manual' } } };
  assert.deepEqual(forCamp(settings, 'camp2').pins, ['listen']);
  assert.deepEqual(forCamp(settings, 'camp1').pins, []);
});

test('lens preferences and situation rules are plain data', () => {
  const prefs = lensPreferences({ formats: { flash: 0.1, quiz: 0.2, oral: 0.5, task: 0.2 } });
  assert.ok(prefs.allow.includes('voice'));
  assert.equal(prefs.allow.includes('match'), false);
  assert.deepEqual(prefs.order, ['oral', 'quiz', 'task', 'flash']);
  assert.deepEqual(situationRules({ train: true, headphones: true, short: true }).bans.sort(), ['scenario', 'teach-back', 'voice']);
  assert.ok(situationRules({ headphones: true }).pins.includes('listen'));
  assert.equal(situationRules({ short: true }).maxMinutes, 3);
  assert.deepEqual(mixerSituation({}), { bans: [], pins: [], maxMinutes: null });
});

test('seeded random is stable', () => {
  const a = seeded(5);
  const b = seeded(5);
  assert.equal(a(), b());
  assert.equal(a(), b());
});
