// The empty states of the Trail home (src/screens/trail-empty.js): no pack,
// a pack with no facts, a pack with facts but no camps. Each says what to do
// next instead of leaving the home blank.

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyHome, needsEmptyState, ctaHref } from '../src/screens/trail-empty.js';

const PLAN = { camps: [{ id: 'camp_1' }] };

test('no pack at all asks for a document', () => {
  const state = emptyHome(0, null, 0);
  assert.equal(state.kind, 'no-pack');
  assert.equal(state.message, 'trail.empty');
  assert.equal(needsEmptyState(0, null, 0), true);
});

test('a pack with no facts is still empty', () => {
  assert.equal(emptyHome(1, null, 0).kind, 'empty-pack');
});

test('facts without camps are reported as no camps', () => {
  assert.equal(emptyHome(1, { camps: [] }, 12).kind, 'no-camps');
  assert.equal(emptyHome(1, null, 12).kind, 'no-camps');
});

test('a plan with camps is ready, no empty state', () => {
  const state = emptyHome(2, PLAN, 12);
  assert.equal(state.kind, 'ready');
  assert.equal(state.message, null);
  assert.equal(needsEmptyState(2, PLAN, 12), false);
});

test('the call to action goes to the library', () => {
  assert.equal(ctaHref('no-pack'), '#/library');
  assert.equal(ctaHref('empty-pack'), '#/library');
  assert.equal(ctaHref('ready'), '#/');
});
