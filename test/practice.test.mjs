// Pure helpers of the practice screen (src/screens/practice-deck.js): deck
// cleaning, pairing, round stats and variant lookup. No DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanDeckItem, buildDeck, pairDeck, roundStats, deckProgress, variantsOf, practiceStep, pairsFor } from '../src/screens/practice-deck.js';

test('list markers are stripped, not treated as part of the answer', () => {
  assert.equal(cleanDeckItem('2. Gather'), 'Gather');
  assert.equal(cleanDeckItem('3) Review'), 'Review');
  assert.equal(cleanDeckItem('II. Close'), 'Close');
  assert.equal(cleanDeckItem('b) Plan'), 'Plan');
  assert.equal(cleanDeckItem('Unchanged'), 'Unchanged');
  assert.equal(cleanDeckItem(null), '');
});

test('the deck is cleaned, deduplicated and capped', () => {
  const deck = buildDeck(['1. Plan', 'Plan', '', null, '2. Do', 'Check'], { limit: 8 });
  assert.deepEqual(deck, ['Plan', 'Do', 'Check'], 'a repeat after cleaning is one item');
  assert.equal(buildDeck(['a', 'b', 'c'], { limit: 2 }).length, 2);
  assert.deepEqual(buildDeck(null), []);
});

test('pairs come from even and odd deck items', () => {
  assert.deepEqual(pairDeck(['a', 'b', 'c', 'd']), [{ term: 'a', meaning: 'b' }, { term: 'c', meaning: 'd' }]);
  assert.deepEqual(pairDeck(['a', 'b', 'c']), [{ term: 'a', meaning: 'b' }], 'a lone last item pairs with nothing');
});

test('round stats track right, wrong, the run and the best run', () => {
  const stats = roundStats();
  stats.record(true);
  stats.record(true);
  stats.record(false);
  stats.record(true);
  assert.deepEqual(stats.get(), { right: 3, wrong: 1, streak: 1, best: 2, asked: 4 });
});

test('deck progress is clamped and safe when the deck is empty', () => {
  assert.deepEqual(deckProgress(2, 4), { index: 2, total: 4, ratio: 0.5 });
  assert.equal(deckProgress(9, 4).index, 4);
  assert.equal(deckProgress(-1, 4).index, 0);
  assert.equal(deckProgress(1, 0).ratio, 0);
});

test('variantsOf finds one type across facts, in fact order', () => {
  const facts = [
    { id: 'f1', variants: [{ id: 'a', type: 'match' }, { id: 'b', type: 'order' }] },
    { id: 'f2', variants: [{ id: 'c', type: 'match' }] },
    { id: 'f3' },
  ];
  assert.deepEqual(variantsOf(facts, 'match').map((v) => v.variant.id), ['a', 'c']);
  assert.deepEqual(variantsOf(facts, 'cloze'), []);
});

test('a practice step carries what an activity reads', () => {
  const step = practiceStep({ id: 'f1' }, { id: 'v1', type: 'match' }, 'match');
  assert.equal(step.factId, 'f1');
  assert.equal(step.type, 'match');
  assert.equal(step.variantId, 'v1');
  assert.equal(step.variant.id, 'v1');
});

test('match pairs use the variant’s own pairs, else the deck', () => {
  const own = pairsFor({ id: 'f1' }, { id: 'v1', type: 'match', pairs: [{ term: 'a', meaning: 'b' }, { term: 'c', meaning: 'd' }] });
  assert.equal(own.pairs.length, 2);
  const built = pairsFor({ id: 'f1', statement: 'First thing' }, { id: 'v2', type: 'flashcard', text: 'Second thing' });
  assert.deepEqual(built.pairs, [{ term: 'Second thing', meaning: 'First thing' }]);
  assert.equal(pairsFor({ id: 'f1' }, { id: 'v3' }), null, 'nothing to pair means no round');
});
