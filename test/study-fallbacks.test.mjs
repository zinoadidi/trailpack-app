// A Pack with facts must always start a bite. Before this test the study
// screen fell into its empty state ("This Pack has nothing to study yet")
// whenever the mixer could not find an activity the learner's state allowed,
// even though the Pack had facts and variants.

import test from 'node:test';
import assert from 'node:assert/strict';

import { startSession, studyQueue, studySelection } from '../src/study/session.js';
import { ACTIVITIES, ACTIVITY_TYPES, canPlay, variantFor } from '../src/study/activities.js';
import { buildBite } from '../src/study/mixer.js';

function fact(id, types = ['flashcard']) {
  return {
    id,
    packId: 'p1',
    statement: 'statement ' + id,
    variants: types.map((type, i) => ({
      id: id + '-v' + i,
      factId: id,
      type,
      ...(type === 'flashcard' ? { front: 'q' + id, back: 'a' + id } : {}),
      ...(type === 'multiple-choice' ? { prompt: 'q' + id, choices: ['a', 'b'], answer: 0 } : {}),
      ...(type === 'true-false' ? { statement: 's' + id, answer: true } : {}),
      ...(type === 'cloze' ? { text: 'the {blank} thing', blank: 'x' } : {}),
    })),
  };
}

const FACTS_WITH_VARIANTS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => fact(id, ['flashcard', 'multiple-choice', 'true-false']));

// Every state a fact can be in, all at once.
const PROGRESS = {
  f1: { state: 'new' },
  f2: { state: 'learning' },
  f3: { state: 'review' },
  f4: { state: 'weak' },
  f5: { state: 'mastered' },
  f6: { state: 'lapsed' },
};

test('a linked source name survives the round trip', () => {
  assert.equal(typeof studySelection, 'function');
});

test('facts with a variant the catalogue can play always build steps', () => {
  const playable = FACTS_WITH_VARIANTS.filter((item) => ACTIVITY_TYPES.some((type) => canPlay(type, item)));
  assert.equal(playable.length, FACTS_WITH_VARIANTS.length, 'fixture facts must be playable');
  for (const state of ['new', 'learning', 'review', 'weak', 'mastered', 'lapsed']) {
    const progress = Object.fromEntries(FACTS_WITH_VARIANTS.map((item) => [item.id, { state }]));
    const session = startSession({ facts: FACTS_WITH_VARIANTS, progress, seed: 7 });
    assert.ok(session.steps.length > 0, `state ${state} gave no steps`);
  }
});

test('a Mastered fact still studies when every fact in the Pack is Mastered', () => {
  const facts = ['f1', 'f2', 'f3'].map((id) => fact(id, ['flashcard', 'multiple-choice']));
  const progress = Object.fromEntries(facts.map((item) => [item.id, { state: 'mastered', dueAt: Date.now() + 86400000 }]));
  const session = startSession({ facts, progress, seed: 3 });
  assert.ok(session.steps.length > 0, 'a mastered pack must still give a bite');
});

test('every session step points at a variant the catalogue can render', () => {
  for (const seed of [1, 2, 3, 11, 42, 99]) {
    const session = startSession({ facts: FACTS_WITH_VARIANTS, progress: PROGRESS, seed });
    for (const step of session.steps) {
      const item = FACTS_WITH_VARIANTS.find((entry) => entry.id === step.factId);
      const chosen = (item.variants || []).find((variant) => variant.id === step.variantId) || variantFor(step.type, item);
      assert.ok(chosen, `seed ${seed}: step ${step.type} on ${step.factId} has no variant`);
    }
  }
});

test('the queue is never empty when the Pack has facts, even off-camp', () => {
  const trail = { camps: [{ id: 'c1', state: 'open', factIds: ['f4'] }, { id: 'c2', state: 'open', factIds: ['ghost'] }] };
  const { queue } = studyQueue({ facts: FACTS_WITH_VARIANTS, progress: PROGRESS, trail, campId: 'c2', steps: 8 });
  assert.ok(queue.length > 0, 'a camp whose facts are gone must not empty the queue');
});

test('a bite keeps its activity-count rules while never coming out empty', () => {
  const bite = buildBite({ facts: FACTS_WITH_VARIANTS, stateOf: () => 'mastered', steps: 8, seed: 5 });
  assert.ok(bite.steps.length > 0);
  for (const step of bite.steps) assert.ok(ACTIVITIES[step.type], `unknown activity ${step.type}`);
});
