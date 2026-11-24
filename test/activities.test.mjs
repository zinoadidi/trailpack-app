// Pure helpers of the activity components in src/screens/activities/.
// No DOM: every function tested here is a plain function over plain data.

import test from 'node:test';
import assert from 'node:assert/strict';

import { shuffle, moveItem, reorderKey, seedOf, blitzRemaining, blitzExpired, sweepProgress, BLITZ_SECONDS } from '../src/screens/activities/_helpers.js';
import { orderScore } from '../src/screens/activities/order.js';
import { wrongIndex, spotPrompt } from '../src/screens/activities/spot-mistake.js';
import { speechSupported, pickVoice } from '../src/screens/activities/listen.js';
import { recognitionSupported, coverageLine } from '../src/screens/activities/voice.js';
import { teachFeedback } from '../src/screens/activities/teach-back.js';
import { sweepFormat } from '../src/screens/activities/sweep.js';
import { ACTIVITY_COMPONENTS, BUILT_TYPES, renderActivity } from '../src/screens/activities/registry.js';

test('shuffle is a seeded permutation, the same for the same seed', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  const one = shuffle(list, 42);
  const two = shuffle(list, 42);
  assert.deepEqual(one, two);
  assert.deepEqual([...one].sort(), [...list].sort());
  assert.notDeepEqual(shuffle(list, 7), shuffle(list, 8), 'different seeds differ');
  assert.deepEqual(list, ['a', 'b', 'c', 'd', 'e', 'f'], 'the input is not changed');
});

test('moveItem moves one item and clamps out of range', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 99), ['a', 'c', 'b']);
  assert.deepEqual(moveItem([], 0, 1), []);
});

test('reorderKey reads the arrow keys, Home and End, and ignores the rest', () => {
  assert.equal(reorderKey(1, 'ArrowUp', 4), 0);
  assert.equal(reorderKey(0, 'ArrowUp', 4), 0, 'no wrap at the top');
  assert.equal(reorderKey(3, 'ArrowDown', 4), 3, 'no wrap at the bottom');
  assert.equal(reorderKey(1, 'ArrowDown', 4), 2);
  assert.equal(reorderKey(2, 'Home', 4), 0);
  assert.equal(reorderKey(2, 'End', 4), 3);
  assert.equal(reorderKey(2, 'Tab', 4), null);
});

test('seedOf is stable per step and differs between steps', () => {
  assert.equal(seedOf({ variantId: 'v1', factId: 'f1' }), seedOf({ variantId: 'v1', factId: 'f1' }));
  assert.notEqual(seedOf({ variantId: 'v1' }), seedOf({ variantId: 'v2' }));
  assert.equal(typeof seedOf(null), 'number');
});

test('order score counts the positions that are right', () => {
  assert.deepEqual(orderScore(['a', 'b', 'c'], ['a', 'b', 'c']), { right: 3, total: 3, ratio: 1 });
  assert.deepEqual(orderScore(['b', 'a', 'c'], ['a', 'b', 'c']), { right: 1, total: 3, ratio: 1 / 3 });
  assert.equal(orderScore([], []).ratio, 0);
});

test('spot the mistake finds the wrong claim and falls back safely', () => {
  assert.equal(wrongIndex(['a', 'b', 'c'], 1), 1);
  assert.equal(wrongIndex(['a', 'b'], 9), 1, 'out of range falls back to the last claim');
  assert.equal(wrongIndex([], 0), -1);
  assert.equal(spotPrompt({ prompt: ' Which is wrong? ' }, null), 'Which is wrong?');
  assert.equal(spotPrompt({}, { statement: 'The fact' }), 'The fact');
  assert.equal(spotPrompt(null, null), '');
});

test('the blitz clock counts down to zero and never goes negative', () => {
  const start = 1_000_000;
  assert.equal(blitzRemaining(start, start), BLITZ_SECONDS);
  assert.equal(blitzRemaining(start, start + 30_000), 30);
  assert.equal(blitzRemaining(start, start + 59_100), 1, 'a part second still reads as 1');
  assert.equal(blitzRemaining(start, start + 120_000), 0);
  assert.equal(blitzExpired(start, start + 59_000), false);
  assert.equal(blitzExpired(start, start + 60_000), true);
});

test('sweep progress is clamped to the deck', () => {
  assert.deepEqual(sweepProgress(1, 3), { done: 1, total: 3, ratio: 1 / 3 });
  assert.equal(sweepProgress(9, 3).done, 3);
  assert.equal(sweepProgress(-2, 3).done, 0);
  assert.equal(sweepProgress(1, 0).ratio, 0);
});

test('sweep falls back to a flashcard for an unknown format', () => {
  assert.equal(sweepFormat({ type: 'multiple-choice' }), 'multiple-choice');
  assert.equal(sweepFormat({ type: 'cloze' }), 'cloze');
  assert.equal(sweepFormat({ type: 'true-false' }), 'true-false');
  assert.equal(sweepFormat({ type: 'flashcard' }), 'flashcard');
  assert.equal(sweepFormat({ type: 'order' }), 'flashcard');
  assert.equal(sweepFormat(null), 'flashcard');
});

test('speech support is detected, never assumed', () => {
  assert.equal(speechSupported({}), false);
  assert.equal(speechSupported({ speechSynthesis: {} }), false);
  const fake = { speechSynthesis: {}, SpeechSynthesisUtterance: function Utterance() {} };
  assert.equal(speechSupported(fake), true);
  assert.equal(recognitionSupported({}), false);
  assert.equal(recognitionSupported({ webkitSpeechRecognition: function () {} }), true);
  assert.equal(recognitionSupported({ SpeechRecognition: function () {} }), true);
});

test('pickVoice prefers a local voice in the study language', () => {
  const voices = [
    { lang: 'en-GB', localService: false, name: 'Remote English' },
    { lang: 'en-US', localService: true, name: 'Local English' },
    { lang: 'fr-FR', localService: true, name: 'Local French' },
  ];
  assert.equal(pickVoice(voices, 'en').name, 'Local English');
  assert.equal(pickVoice(voices, 'fr-FR').name, 'Local French');
  assert.equal(pickVoice(voices, 'de'), null, 'no voice in that language is not a voice');
  assert.equal(pickVoice([], 'en'), null);
});

test('coverage bands and the teach feedback merge offline and model results', () => {
  assert.equal(coverageLine({ ratio: 0.9 }).band, 'high');
  assert.equal(coverageLine({ ratio: 0.6 }).band, 'mid');
  assert.equal(coverageLine({ ratio: 0.1 }).band, 'low');
  assert.equal(coverageLine({ ratio: 0.5 }).percent, 50);
  assert.equal(coverageLine(null).percent, 0);

  const merged = teachFeedback({ ratio: 0.4, hit: ['a'], missed: ['b'] }, { score: 0.75, missed: ['c'], comment: 'Good start' });
  assert.equal(merged.percent, 75);
  assert.deepEqual(merged.missed.sort(), ['b', 'c']);
  assert.equal(merged.comment, 'Good start');
  assert.equal(teachFeedback({ ratio: 0.9, hit: [], missed: [] }, null).band, 'high', 'offline alone still scores');
});

test('the registry owns exactly the types this folder builds', () => {
  assert.deepEqual(
    [...BUILT_TYPES].sort(),
    ['blitz', 'listen', 'match', 'order', 'spot-mistake', 'sweep', 'teach-back', 'voice'],
  );
  for (const name of BUILT_TYPES) assert.equal(typeof ACTIVITY_COMPONENTS[name], 'function', name);
  assert.equal(renderActivity('quiz', null, {}, {}), null, 'the runner owns the quiz');
});
