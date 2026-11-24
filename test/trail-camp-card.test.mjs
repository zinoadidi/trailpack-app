// The camp card on the Trail home (src/screens/trail-camp-card.js): the gate
// score with pass or fail, whether the gate can be taken, and the study
// target. Pure over the plan's camps and the pack's facts.

import test from 'node:test';
import assert from 'node:assert/strict';

import { campCard, campCards, previewGate } from '../src/screens/trail-camp-card.js';

const FACTS = [
  { id: 'f1', check: 0 },
  { id: 'f2', check: 0 },
  { id: 'f3', check: 1 },
  { id: 'f4', check: 0 },
];

const SUMMITED = { id: 'camp_1', index: 0, title: 'Intro', factIds: ['f1', 'f2'], state: 'summited', checkpoint: { score: 85, passedAt: 'x', attempts: 1 } };
const OPEN = { id: 'camp_2', index: 1, title: 'Tools', factIds: ['f3', 'f4'], state: 'open', checkpoint: null };
const LOCKED = { id: 'camp_3', index: 2, title: 'Close', factIds: ['f9'], state: 'locked', checkpoint: null };

test('a summited camp shows its score and cannot be opened for a gate', () => {
  const card = campCard(SUMMITED, FACTS);
  assert.equal(card.score, 85);
  assert.equal(card.passed, true);
  assert.equal(card.canStudy, false);
  assert.equal(card.target, null);
});

test('an open camp offers the gate only when it has gate facts', () => {
  const card = campCard(OPEN, FACTS);
  assert.equal(card.canStudy, true);
  assert.equal(card.gateFacts, 1, 'the uncertain fact waits outside the gate');
  assert.equal(card.canGate, true);
  assert.equal(card.target, '#/bite?camp=camp_2');
});

test('a locked camp offers nothing', () => {
  const card = campCard(LOCKED, FACTS);
  assert.equal(card.canStudy, false);
  assert.equal(card.canGate, false);
  assert.equal(card.score, null);
  assert.equal(campCard(null, FACTS), null);
});

test('a failed checkpoint keeps its score for the card', () => {
  const camp = { ...OPEN, checkpoint: { score: 40, passedAt: null, attempts: 1 } };
  const card = campCard(camp, FACTS);
  assert.equal(card.failedAt, 40);
  assert.equal(card.passed, false);
});

test('camp cards map the whole plan in order', () => {
  assert.deepEqual(campCards([SUMMITED, OPEN], FACTS).map((c) => c.id), ['camp_1', 'camp_2']);
  assert.deepEqual(campCards(null), []);
});

test('a gate preview says pass or fail at the gate', () => {
  const camp = { factIds: ['f1', 'f2'] };
  assert.deepEqual(previewGate(camp, [{ correct: true }, { correct: true }]), { score: 100, correct: 2, total: 2, passed: true, gate: 70 });
  assert.equal(previewGate(camp, [{ correct: true }, { correct: false }]).passed, false);
});
