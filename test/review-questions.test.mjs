// The question sheet (#/library/review/questions?id=...), the screen "Open the
// review" opens.
//
// Three things must hold for every Pack, draft or frozen:
//   1. it never leaves a "Loading" line behind once it has painted;
//   2. it lists facts for a draft (whose facts live in the draft document, not
//      in the synced fact docs yet) as well as for a frozen Pack;
//   3. it says so plainly when there is nothing to check.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, byText } from './helpers/dom.mjs';

installDom();
const { state, t, loadCatalogue, setLanguage } = await import('../src/app/state.js');
const { MemoryStore } = await import('../src/store/idb.js');
const { saveDraft } = await import('../src/study/store.js');
await loadCatalogue('en');
await setLanguage('en');

const FACTS = [
  { id: 'f1', packId: 'p1', topicId: 't1', statement: 'A milestone marks a point in time.', sourceId: 's1', confidence: 0.9 },
  { id: 'f2', packId: 'p1', topicId: 't1', statement: 'A project has a scope.', sourceId: null, confidence: 0.9 },
  { id: 'f3', packId: 'p1', topicId: 't1', statement: 'Every project has a deadline.', sourceId: 's1', confidence: 0.2 },
];
const TOPICS = [{ id: 't1', packId: 'p1', title: 'Basics', order: 0 }];
const PACK = { id: 'p1', title: 'Field Notes', status: 'frozen', sources: [{ id: 's1', name: 'Notes.txt' }] };

/** A frozen Pack: facts and topics are synced docs. */
async function frozenStore() {
  const store = new MemoryStore();
  store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'packs', id: 'p1', doc: PACK });
  for (const topic of TOPICS) store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'topics', id: topic.id, doc: topic });
  for (const fact of FACTS) store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'facts', id: fact.id, doc: fact });
  return store;
}

/** A draft: its topics and facts are only in the draft document so far. */
async function draftStore() {
  const store = new MemoryStore();
  const pack = { ...PACK, status: 'draft' };
  store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'packs', id: 'p1', doc: pack });
  await saveDraft({ pack, topics: TOPICS, facts: FACTS, edits: { dropped: [], renamed: {}, merged: {} } }, { store });
  return store;
}

async function openSheet(store) {
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.store = store;
  location.hash = '#/library/review/questions?id=p1';
  const screen = (await import('../src/screens/review-questions.js')).default;
  const view = screen();
  await view.mount();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return view;
}

test('Question sheet: no "Loading" line is left behind after it paints', async () => {
  const view = await openSheet(await frozenStore());
  assert.equal(view.el.textContent.includes(t('common.loading')), false, 'the loading line is cleared');
  view.destroy?.();
});

test('Question sheet: a frozen Pack lists the facts that need a look', async () => {
  const view = await openSheet(await frozenStore());
  const text = view.el.textContent;
  assert.ok(text.includes('A project has a scope.'), 'the unsourced fact is listed');
  assert.ok(text.includes('Every project has a deadline.'), 'the low-confidence fact is listed');
  assert.equal(text.includes('A milestone marks a point in time.'), false, 'a clean fact is not listed');
  view.destroy?.();
});

test('Question sheet: a draft Pack lists its facts too', async () => {
  const view = await openSheet(await draftStore());
  const text = view.el.textContent;
  assert.equal(text.includes(t('common.loading')), false, 'the loading line is cleared');
  assert.ok(text.includes('A project has a scope.'), 'the draft fact with no source is listed');
  assert.ok(text.includes('Every project has a deadline.'), 'the draft low-confidence fact is listed');
  view.destroy?.();
});

test('Question sheet: a Pack with nothing to check says so, with no empty list', async () => {
  const store = new MemoryStore();
  store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'packs', id: 'p1', doc: PACK });
  for (const topic of TOPICS) store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'topics', id: topic.id, doc: topic });
  store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'facts', id: 'f1', doc: FACTS[0] });
  const view = await openSheet(store);
  assert.ok(view.el.textContent.includes(t('review.questionsNone')), 'it says nothing needs a look');
  assert.equal(view.el.querySelectorAll('ol').length, 0, 'no empty list is drawn');
  view.destroy?.();
});

test('Question sheet: a missing Pack is explained and links back to the Library', async () => {
  const view = await openSheet(new MemoryStore());
  assert.ok(view.el.textContent.includes(t('review.questionsMissing')), 'it says the Pack is not here');
  assert.ok(byText(view.el, t('nav.library')).length > 0, 'there is a way back');
  view.destroy?.();
});

test('Question sheet: a draft with no Pack document yet still lists its facts', async () => {
  // persist() in the review screen saves the draft to meta; the Pack document
  // is only written on freeze. The sheet must not require it first.
  const store = new MemoryStore();
  const pack = { ...PACK, status: 'draft' };
  await saveDraft({ pack, topics: TOPICS, facts: FACTS, edits: { dropped: [], renamed: {}, merged: {} } }, { store });
  assert.equal(await store.get('docs', ['packs', 'p1']), undefined, 'no Pack document is stored');

  const view = await openSheet(store);
  const text = view.el.textContent;
  assert.equal(text.includes(t('review.questionsMissing')), false, 'the draft is found without its Pack document');
  assert.equal(text.includes(t('common.loading')), false, 'the loading line is cleared');
  assert.ok(text.includes('A project has a scope.'), 'the unsourced draft fact is listed');
  assert.ok(text.includes('Every project has a deadline.'), 'the low-confidence draft fact is listed');
  view.destroy?.();
});
