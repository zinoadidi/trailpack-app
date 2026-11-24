// A practice run bridges the activity contract and the session's answer shape
// (src/screens/practice-run.js): the variant lookup, the step handed to an
// activity and the answer handed back.

import test from 'node:test';
import assert from 'node:assert/strict';

import { variantFor, activityStep, answerFromActivity, practiceLine } from '../src/screens/practice-run.js';
import { ACTIVITIES } from '../src/study/activities.js';

const FACT = {
  id: 'f1',
  variants: [
    { id: 'v1', type: 'match', pairs: [{ term: 'a', meaning: 'b' }] },
    { id: 'v2', type: 'true-false', statement: 'x', answer: true },
  ],
};

test('the variant is found by id, then by the type the activity wants', () => {
  assert.equal(variantFor({ factId: 'f1', type: 'match', variantId: 'v1' }, [FACT]).variant.id, 'v1');
  assert.equal(variantFor({ factId: 'f1', type: 'true-false', variantId: 'gone' }, [FACT]).variant.id, 'v2', 'stale id falls back to the format');
});

test('a missing fact or variant says why, it does not throw', () => {
  assert.equal(variantFor({ factId: 'nope', type: 'match' }, [FACT]).reason, 'study.noFacts');
  assert.equal(variantFor({ factId: 'f1', type: 'cloze' }, [FACT]).reason, 'study.fallbackFlash');
  assert.equal(variantFor(null, []).reason, 'study.noFacts');
});

test('the step an activity reads carries its variant', () => {
  const resolved = variantFor({ factId: 'f1', type: 'match', variantId: 'v1' }, [FACT]);
  const step = activityStep({ factId: 'f1', type: 'match', variantId: 'v1', state: 'review' }, resolved);
  assert.equal(step.variant.id, 'v1');
  assert.equal(step.state, 'review');
  assert.equal(step.type, 'match');
});

test('an activity answer becomes a session answer', () => {
  const answer = answerFromActivity({ correct: true, quality: 0.5, ms: 1200, answer: { picked: 1 } }, 'quiz', { at: 42 });
  assert.equal(answer.correct, true);
  assert.equal(answer.ms, 1200);
  assert.equal(answer.at, 42);
  assert.equal(answer.type, 'quiz');
  const selfRated = answerFromActivity({ selfRate: 'good', ms: 10 }, 'teach-back');
  assert.equal(selfRated.correct, true, 'a self rated good counts as correct');
  const bare = answerFromActivity(true, 'true-false');
  assert.equal(bare.correct, true);
  assert.equal(bare.ms, 0);
});

test('the practice line names the activity and its budget', () => {
  const line = practiceLine('match', { index: 2, total: 5 });
  assert.equal(line.label, ACTIVITIES.match.label);
  assert.equal(line.minutes, ACTIVITIES.match.minutes);
  assert.equal(line.total, 5);
  assert.equal(practiceLine('unknown').label, 'study.type.flash');
});
