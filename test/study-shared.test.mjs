// The activity helpers the five screens share (agent A, M5): comparing typed
// answers forgivingly and building the answer the session organiser takes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fold, distance, matchesTyped, qualityOf, makeAnswer } from '../src/screens/activities/shared.js';

test('fold ignores case, accents, punctuation and stray spaces', () => {
  assert.equal(fold('  Ánachronism! '), 'anachronism');
  assert.equal(fold("don't"), 'dont');
  assert.equal(fold('two   words'), 'two words');
  assert.equal(fold(undefined), '');
});

test('distance counts edits and stops early past the budget', () => {
  assert.equal(distance('abc', 'abc'), 0);
  assert.equal(distance('abc', 'abd'), 1);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.ok(distance('a', 'bbbbbbbb', 2) > 2);
});

test('a typed answer is accepted with a typo but not with a wrong word', () => {
  assert.equal(matchesTyped('finish', 'finish'), true);
  assert.equal(matchesTyped('Finish!', 'finish'), true);
  assert.equal(matchesTyped('finis', 'finish'), true);
  assert.equal(matchesTyped('single point in time', 'a single point in time'), true);
  assert.equal(matchesTyped('budget', 'finish'), false);
  assert.equal(matchesTyped('', 'finish'), false);
});

test('quality is 0 when wrong, lower with a hint, 1 when right', () => {
  assert.equal(qualityOf({ correct: false }), 0);
  assert.equal(qualityOf({ correct: true, hint: true }), 0.7);
  assert.equal(qualityOf({ correct: true, ms: 1200 }), 1);
});

test('makeAnswer falls back to the fact statement as the why', () => {
  const answer = makeAnswer({ correct: true, variant: {}, fact: { statement: 'A milestone marks a moment.' }, ms: 10 });
  assert.equal(answer.correct, true);
  assert.equal(answer.why, 'A milestone marks a moment.');
  assert.equal(answer.selfRate, undefined);
  const rated = makeAnswer({ correct: false, variant: { why: 'Because.' }, fact: {}, selfRate: 'again' });
  assert.equal(rated.why, 'Because.');
  assert.equal(rated.selfRate, 'again');
});
