// The listen activity's pure parts (src/screens/activities/listen-plan.js):
// clamped speech rate, the read or play plan and the answer shape.

import test from 'node:test';
import assert from 'node:assert/strict';

import { speechParams, listenPlan, listenAnswer } from '../src/screens/activities/listen-plan.js';

test('the speech rate is clamped to a sayable range', () => {
  assert.equal(speechParams(null, { rate: 3 }).rate, 1.6);
  assert.equal(speechParams(null, { rate: 0.1 }).rate, 0.5);
  assert.equal(speechParams(null, {}).rate, 0.95);
  assert.equal(speechParams({ lang: 'et-EE' }).lang, 'et-EE');
  assert.equal(speechParams(null, { pitch: 0 }).pitch, 0.5);
});

test('without synthesis the transcript carries the step', () => {
  const plan = listenPlan({ supported: false });
  assert.equal(plan.step, 'read');
  assert.equal(plan.canPlay, false);
  assert.equal(plan.showTranscript, true);
});

test('with synthesis the plan is play, again, then done', () => {
  assert.equal(listenPlan({ supported: true }).step, 'play');
  assert.equal(listenPlan({ supported: true, played: 2 }).step, 'again');
  assert.equal(listenPlan({ supported: true, played: 1, answered: true }).step, 'done');
});

test('a listen answer marks the clip as heard', () => {
  assert.deepEqual(listenAnswer(1, 1, { heard: true, ms: 800 }), { correct: true, quality: 1, ms: 800, answer: { picked: 1, answer: 1, heard: true } });
  assert.equal(listenAnswer(0, 2).correct, false);
  assert.equal(listenAnswer('1', 1).correct, true, 'a string choice still matches');
  assert.equal(listenAnswer(-1, 1).correct, false, 'a timeout or no pick is a miss');
  assert.equal(listenAnswer(1, 1, { ms: -5 }).ms, 0);
});
