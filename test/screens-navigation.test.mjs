// The screens' buttons must do what they say, on a Pack that has facts:
//   - Practice: "Review weak facts" shows the weak drill, "Start a bite" opens
//     the bite, a drill draws its first question (no literal "null" text);
//   - Study: a Pack with facts starts a bite instead of the empty state, and a
//     saved session is resumed instead of started over;
//   - Review: "Open the review" opens the question sheet, "Study this Pack"
//     makes the Pack active and starts studying it;
//   - Library: "Study" studies the Pack it is on, not whichever is active.
//
// The real screens run against a small DOM (test/helpers/dom.mjs) and an in
// memory store, so a click goes through the same code a browser would run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, byText } from './helpers/dom.mjs';

const dom = installDom();
const { state } = await import('../src/app/state.js');
const { t } = await import('../src/app/state.js');
const { loadCatalogue, setLanguage } = await import('../src/app/state.js');
const { MemoryStore } = await import('../src/store/idb.js');
const screens = {
  practice: (await import('../src/screens/practice.js')).default,
  study: (await import('../src/screens/study.js')).default,
  review: (await import('../src/screens/review.js')).default,
  library: (await import('../src/screens/library.js')).default,
};
await loadCatalogue('en');
await setLanguage('en');

const PACK = {
  id: 'p1',
  title: 'Field Notes',
  status: 'frozen',
  sources: [{ id: 's1', name: 'Notes.txt', state: 'mapped' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const TOPICS = [{ id: 't1', packId: 'p1', title: 'Basics', order: 0 }];
const FACTS = [
  { id: 'f1', packId: 'p1', topicId: 't1', statement: 'A milestone marks a point in time.', sourceId: 's1', variants: VARIANT_SET('f1') },
  { id: 'f2', packId: 'p1', topicId: 't1', statement: 'A project has a scope.', sourceId: 's1', variants: VARIANT_SET('f2') },
  { id: 'f3', packId: 'p1', topicId: 't1', statement: 'Every project has a deadline.', sourceId: 's1', variants: VARIANT_SET('f3') },
];

function VARIANT_SET(id) {
  return [
    { id: id + 'v1', factId: id, type: 'flashcard', front: 'Q ' + id, back: 'A ' + id },
    { id: id + 'v2', factId: id, type: 'multiple-choice', prompt: 'Pick ' + id, choices: ['right', 'wrong'], answer: 0, why: 'because ' + id },
    { id: id + 'v3', factId: id, type: 'true-false', statement: 'Statement ' + id, answer: true, why: 'why ' + id },
  ];
}

/** A store with documents: the app's own in memory store, no IndexedDB. */
function memoryStore(docs = []) {
  const store = new MemoryStore();
  for (const doc of docs) store.put('docs', { rev: 1, deleted: 0, dirty: 0, ...doc });
  return store;
}function seedStore({ progress = {}, meta = [] } = {}) {
  const store = memoryStore([
    { collection: 'packs', id: 'p1', doc: PACK },
    ...TOPICS.map((topic) => ({ collection: 'topics', id: topic.id, doc: topic })),
    ...FACTS.map((fact) => ({ collection: 'facts', id: fact.id, doc: fact })),
    ...Object.entries(progress).map(([factId, doc]) => ({ collection: 'progress', id: 'p_' + factId, doc: { factId, packId: 'p1', ...doc } })),
  ]);
  for (const [key, value] of meta) store.put('meta', { key, value });
  return store;
}

function setup(options) {
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.studySession = null;
  state.store = seedStore(options);
  location.hash = '#/practice';
  return state.store;
}

async function mount(screen) {
  const view = screen();
  await view.mount?.();
  await new Promise((resolve) => setTimeout(resolve, 25));
  return view;
}

const button = (root, text) => byText(root, text)[0] || null;

/** The panel an activity draws its question into (where the answer buttons are). */
function drawnQuestions(root) {
  return root.querySelectorAll('[aria-live="polite"]').filter((node) => (node.attributes.class || '').split(/\s+/).includes('panel'));
}

/** Practice and Study both draw the activity inside the live region; a step
 *  always shows at least one of its fact's texts. */
function questionText(root) {
  const live = root.querySelectorAll('[aria-live="polite"]')[0];
  if (!live || !live.querySelectorAll('section').length) return null;
  const text = live.textContent;
  return /^(Q|Pick|Statement) f/.test(text) || text.includes('Swipe right') ? text : null;
}

test.afterEach(() => {
  state.studySession = null;
});

// ------------------------------------------------------------------ practice

test('Practice: a drill starts a round and draws its first question', async () => {
  setup({});
  const practice = screens.practice;
  const view = await mount(practice);
  const quiz = view.el.querySelectorAll('button').find((node) => node.dataset.practiceType === 'quiz');
  assert.ok(quiz, 'the quiz drill is offered');
  quiz.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(view.el.textContent.includes('null'), false, 'no literal null is rendered');
  assert.ok(drawnQuestions(view.el).length > 0, 'the first question is drawn');
  view.destroy?.();
});

test('Practice: "Start a bite" opens the bite', async () => {
  setup({});
  const practice = screens.practice;
  const view = await mount(practice);
  button(view.el, t('practice.start')).click();
  assert.equal(location.hash, '#/study');
  view.destroy?.();
});

test('Practice: "Review weak facts" shows the weak drill and answers it', async () => {
  const now = Date.now();
  setup({ progress: { f1: { state: 'weak', dueAt: now + 600000 }, f2: { state: 'weak', dueAt: now + 600000 } } });
  const practice = screens.practice;
  const view = await mount(practice);
  button(view.el, t("practice.reviewWeak")).click();
  await new Promise((resolve) => setTimeout(resolve, 25));
  console.log("DBGA", view.el.querySelectorAll("button").map((b) => (b.dataset.practiceType || b.textContent.trim().slice(0, 12)) + (b.hasAttribute("disabled") ? "*" : "")).join(" | "));
  assert.ok(view.el.textContent.includes(t('practice.weakOnlyLine')), 'the weak drill is the round, not the full deck');
  const drill = view.el.querySelectorAll("button[data-practice-type]");
  console.log("DBGB", drill.length, JSON.stringify(view.el.querySelectorAll("button").length));
  assert.ok(drill.length > 0, 'the weak drill offers activities');
  drill[0].click();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(questionText(view.el), 'the weak round drew a question');
  assert.equal(view.el.textContent.includes('null'), false, 'no literal null is rendered');
  view.destroy?.();
});

test('Practice: "Review weak facts" is disabled when nothing is weak', async () => {
  setup({});
  const practice = screens.practice;
  const view = await mount(practice);
  const weak = button(view.el, t('practice.reviewWeak'));
  assert.ok(weak.hasAttribute('disabled'), 'nothing weak: the button cannot be pressed');
  view.destroy?.();
});

// --------------------------------------------------------------------- study

test('Study: a Pack with facts starts a bite instead of the empty state', async () => {
  setup({});
  location.hash = '#/study';
  const study = screens.study;
  const view = await mount(study);
  assert.equal(view.el.textContent.includes(t('study.noFacts')), false, 'no empty state');
  assert.ok(state.studySession && state.studySession.session.steps.length > 0, 'a session was built');
  assert.ok(questionText(view.el), 'the first question is drawn');
  view.destroy?.();
});

test('Study: a saved session is resumed, not restarted', async () => {
  setup({});
  location.hash = '#/study';
  const study = screens.study;
  const first = await mount(study);
  const session = state.studySession.session;
  const answers = first.el.querySelectorAll('button').find((node) => node.textContent.trim() === t('study.skip'));
  answers.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const advanced = state.studySession.session.index;
  assert.equal(advanced, 1, 'the skip advanced the session');
  first.destroy?.();
  state.studySession = { ...state.studySession };
  location.hash = '#/practice';
  location.hash = '#/study';
  await mount(study);
  assert.equal(state.studySession.session.biteId, session.biteId, 'the same bite is still running');
  assert.equal(state.studySession.session.index, advanced, 'the progress was kept');
});

// -------------------------------------------------------------------- review

test('Review: "Open the review" opens the question sheet', async () => {
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.store = memoryStore([
    { collection: 'packs', id: 'p1', doc: { ...PACK, status: 'draft' } },
    { collection: 'topics', id: 't1', doc: TOPICS[0] },
    { collection: 'facts', id: 'f1', doc: FACTS[0] },
  ]);
  location.hash = '#/library/review?id=p1';
  const review = screens.review;
  const view = await mount(review);
  const open = button(view.el, t('library.openReview'));
  assert.ok(open, 'the button is there once a source is read');
  open.click();
  assert.ok(location.hash.includes('/library/review/questions'), 'the question sheet opens, got ' + location.hash);
});

test('Review: the question sheet lists the Pack\'s facts that need a look', async () => {
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.store = memoryStore([
    { collection: 'packs', id: 'p1', doc: { ...PACK, status: 'draft' } },
    { collection: 'topics', id: 't1', doc: TOPICS[0] },
    { collection: 'facts', id: 'fq', doc: { id: 'fq', packId: 'p1', topicId: 't1', statement: 'An unsourced claim.' } },
  ]);
  location.hash = '#/library/review/questions?id=p1';
  const sheet = (await import('../src/screens/review-questions.js')).default;
  const view = await mount(sheet);
  const text = view.el.textContent;
  assert.ok(!text.includes(t('review.questionsMissing')), 'the Pack is found, not reported missing');
  assert.ok(!text.includes(t('common.loading')), 'no loading line is left behind');
  assert.ok(text.includes('An unsourced claim.'), 'the fact that needs a look is listed');
});

test('Review: "Study this Pack" makes the pack active and starts studying it', async () => {
  const store = memoryStore([
    { collection: 'packs', id: 'p1', doc: PACK },
    { collection: 'topics', id: 't1', doc: TOPICS[0] },
    ...FACTS.map((fact) => ({ collection: 'facts', id: fact.id, doc: fact })),
  ]);
  state.store = store;
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.studySession = null;
  location.hash = '#/library/review?id=p1';
  const review = screens.review;
  const view = await mount(review);
  button(view.el, t('review.makeActive')).click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const active = await store.get('meta', 'active-pack-id');
  assert.equal(active?.value, 'p1', 'the Pack is active on this device');
  assert.ok(location.hash.startsWith('#/study'), 'studying starts right away, got ' + location.hash);
  assert.ok(location.hash.includes('pack=p1'), 'and it studies p1');
});

// ------------------------------------------------------------------- library

test('Library: "Study" studies the Pack on its card, not another active Pack', async () => {
  const other = { ...PACK, id: 'p2', title: 'Other Pack', updatedAt: '2026-01-05T00:00:00.000Z' };
  const store = memoryStore([
    { collection: 'packs', id: 'p2', doc: other },
    { collection: 'packs', id: 'p1', doc: PACK },
    { collection: 'topics', id: 't1', doc: TOPICS[0] },
    ...FACTS.map((fact) => ({ collection: 'facts', id: fact.id, doc: fact })),
  ]);
  state.store = store;
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.studySession = null;
  location.hash = '#/library';
  const library = screens.library;
  const view = await mount(library);
  // p2 is the newest, so it sorts first and is the default active Pack; press
  // the Study button on p1's card.
  const cards = view.el.querySelectorAll('a.panel');
  assert.ok(cards.length >= 2, 'both packs have a card');
  const p1Card = cards.find((node) => node.textContent.includes(PACK.title));
  assert.ok(p1Card, 'the p1 card is on the page');
  const card = p1Card.querySelectorAll('button').find((node) => node.textContent.trim() === t('library.study'));
  assert.ok(card, 'the study button is on the card');
  card.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  // The card asks for its own Pack, so the bite is that Pack even though p2
  // would be the default (no active Pack is stored).
  assert.ok(location.hash.includes('pack=p1'), 'studying opens the bite for p1, got ' + location.hash);
  location.hash = '#/study?pack=p1';
  await mount(screens.study);
  assert.equal(state.studySession && state.studySession.pack.id, 'p1', 'it is the card\'s Pack that starts');
});

test('Study: a requested Pack that is not here does not start another Pack', async () => {
  const store = memoryStore([
    { collection: 'packs', id: 'p2', doc: { ...PACK, id: 'p2', title: 'Some Other Pack' } },
    { collection: 'topics', id: 't2', doc: { ...TOPICS[0], id: 't2', packId: 'p2' } },
    { collection: 'facts', id: 'fx', doc: { ...FACTS[0], id: 'fx', packId: 'p2' } },
  ]);
  state.store = store;
  state.user = { id: 'u1', studyLang: 'en' };
  state.api = null;
  state.sync = null;
  state.studySession = null;
  // p1 was deleted (or is on another device), and p2 happens to exist here.
  location.hash = '#/study?pack=p1';
  const view = await mount(screens.study);
  assert.equal(state.studySession, null, 'no bite is started');
  assert.ok(!view.el.textContent.includes(t('study.stepOf', { step: 1, total: 9 }).split(' of ')[0] + ' of'),
    'no step is drawn');
  // The panel names the Pack that could not be found, not a silent empty state.
  assert.ok(view.el.textContent.includes(t('study.packMissing')), 'the sheet says the requested Pack is unavailable');
  view.destroy?.();
});
