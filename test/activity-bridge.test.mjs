// The bridge between the session organiser's steps and the activity
// components (src/screens/activity-bridge.js): step to variant, context, and
// the answer back, plus the timing helper the activities use.

import test from 'node:test';
import assert from 'node:assert/strict';

import { activityStep, activityCtx, activityAnswer, stepLine } from '../src/screens/activity-bridge.js';
import { timer, ctxOf } from '../src/screens/activities/_helpers.js';
import { ACTIVITIES } from '../src/study/activities.js';

test('a step gains its variant and keeps the organiser fields', () => {
  const step = { factId: 'f1', type: 'match', variantId: 'v9', state: 'learning', shape: 'middle' };
  const out = activityStep(step, { fact: { id: 'f1' }, variant: { id: 'v1', type: 'match' } });
  assert.equal(out.variant.id, 'v1');
  assert.equal(out.variantId, 'v1');
  assert.equal(out.state, 'learning');
  assert.equal(out.shape, 'middle');
});

test('a step without a resolved variant still reads', () => {
  const step = { factId: 'f1', type: 'match', variantId: 'v9' };
  const out = activityStep(step, null);
  assert.equal(out.variant, null);
  assert.equal(out.variantId, 'v9');
  assert.equal(activityStep(null, null), null);
});

test('the context always has t and onAnswer', () => {
  const seen = [];
  const ctx = activityCtx((key, v) => key + ':' + (v ? 'x' : ''), (payload) => seen.push(payload));
  assert.equal(ctx.t('a'), 'a:');
  ctx.onAnswer({ correct: true });
  assert.deepEqual(seen, [{ correct: true }]);
  assert.equal(ctx.api, null);
  const withApi = activityCtx((k) => k, () => {}, { chat: () => {} });
  assert.equal(typeof withApi.api.chat, 'function');
});

test('an answer is normalised to the session shape', () => {
  const answer = activityAnswer({ correct: true, quality: 0.6, ms: 900, answer: { picked: 2 } }, 'quiz', { at: 5 });
  assert.equal(answer.correct, true);
  assert.equal(answer.ms, 900);
  assert.equal(answer.at, 5);
  assert.equal(answer.type, 'quiz');
  assert.equal(activityAnswer(false, 'true-false').correct, false);
  assert.equal(activityAnswer({ selfRate: 'good' }, 'voice').correct, true);
});

test('the step line names the activity', () => {
  assert.equal(stepLine('teach-back', { index: 1, total: 3 }).label, ACTIVITIES['teach-back'].label);
  assert.equal(stepLine('nothing').label, 'study.type.flash');
});

test('the timer counts real milliseconds from the call', () => {
  let clock = 1000;
  const stop = timer(() => clock);
  clock = 1450;
  assert.equal(stop.ms(), 450);
  clock = 900;
  assert.equal(stop.ms(), 0, 'a clock that goes back never gives a negative');
});

test('ctxOf fills in a safe t and onAnswer', () => {
  const ctx = ctxOf(null);
  assert.equal(ctx.t('key'), 'key');
  assert.doesNotThrow(() => ctx.onAnswer({}));
});
