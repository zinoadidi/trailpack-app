import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptAttribute,
  addLoadEstimate,
  applyEdits,
  applyMapReply,
  canFreeze,
  chunksForSource,
  extensionOf,
  factsNeedingVariants,
  foldTopics,
  freezePack,
  isAccepted,
  mapBatches,
  mergeDocument,
  newPack,
  newSource,
  rejectReason,
  removeSource,
  reviewSummary,
  setSourceState,
  sourceId,
  variantsFromReply,
  variantsProgress,
  wordsOf,
} from '../src/study/library.js';

const paragraph = (n, word = 'topic') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ') + '.';

test('accepted file types cover the contract and reject the rest', () => {
  assert.ok(isAccepted('notes.md'));
  assert.ok(isAccepted('Deck.PPTX'));
  assert.ok(isAccepted('handbook.pdf', 'application/pdf'));
  assert.ok(isAccepted('pasted', 'text/plain'));
  assert.equal(isAccepted('photo.png', 'image/png'), false);
  assert.equal(rejectReason('photo.png', 'image/png'), 'ingest.unsupported');
  assert.equal(rejectReason('notes.txt'), null);
  assert.ok(acceptAttribute().includes('.pdf'));
});

test('extensionOf lowercases and handles no extension', () => {
  assert.equal(extensionOf('A.B.MD'), 'md');
  assert.equal(extensionOf('README'), '');
  assert.equal(extensionOf('trailing.'), '');
});

test('source ids are sync safe', () => {
  const id = sourceId('Über Notes (v2).md', () => 0.5);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.ok(!id.startsWith('-'));
});

test('new pack is a draft with no sources', () => {
  const pack = newPack({ title: 'Intro to project management', kind: 'exam' }, );
  assert.equal(pack.status, 'draft');
  assert.equal(pack.kind, 'exam');
  assert.deepEqual(pack.sources, []);
  assert.match(pack.id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('source state moves and keeps its history', () => {
  const pack = { ...newPack({ title: 'P' }), sources: [newSource({ id: 's1', name: 'a.txt', type: 'text/plain', size: 10 })] };
  const mapped = setSourceState(pack, 's1', 'mapped', { words: 120, pages: 2 });
  assert.equal(mapped.sources[0].state, 'mapped');
  assert.equal(mapped.sources[0].words, 120);
  assert.equal(pack.sources[0].state, 'reading', 'input is not mutated');
  assert.equal(removeSource(mapped, 's1').sources.length, 0);
});

test('chunks keep the source anchor and the page', () => {
  const source = { id: 'src_a' };
  const chunks = chunksForSource(source, { pages: [{ n: 1, text: paragraph(200) }, { n: 2, text: paragraph(200, 'other') }] });
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.equal(chunk.source, 'src_a');
    assert.ok([1, 2].includes(chunk.page));
    assert.ok(chunk.words >= 150 && chunk.words <= 400, `chunk has ${chunk.words} words`);
  }
});

test('wordsOf prefers the extractor meta and falls back to counting', () => {
  assert.equal(wordsOf({ meta: { words: 99 }, text: 'one two three' }), 99);
  assert.equal(wordsOf({ text: 'one two three' }), 3);
});

test('map batches respect the per call limit', () => {
  const chunks = Array.from({ length: 13 }, (_, i) => ({ id: 'c' + i }));
  const out = mapBatches(chunks, 6);
  assert.deepEqual(out.map((b) => b.length), [6, 6, 1]);
});

test('map replies fold into review state and de-duplicate', () => {
  const chunks = [{ id: 'c1', source: 's1', page: 1 }];
  const reply = {
    topics: [{ id: 't1', title: 'Scope', facts: [{ id: 'f1', statement: 'Scope says what is inside the project.', chunk_id: 'c1', importance: 4 }] }],
  };
  let state = applyMapReply({ topics: [], facts: [], warnings: [] }, reply, { packId: 'p', chunks });
  state = applyMapReply(state, reply, { packId: 'p', chunks });
  assert.equal(state.facts.length, 1, 'the same statement is not stored twice');
  assert.equal(state.warnings.filter((w) => w.code === 'duplicate').length, 1);
});

test('topics with the same title merge and facts follow', () => {
  const { topics, facts } = foldTopics(
    [
      { id: 't1', title: 'Scope', summary: '' },
      { id: 't2', title: 'scope ', summary: 'What is in the work' },
      { id: 't3', title: 'Risk', summary: '' },
    ],
    [
      { id: 'f1', topicId: 't1' },
      { id: 'f2', topicId: 't2' },
      { id: 'f3', topicId: 't3' },
    ],
  );
  assert.equal(topics.length, 2);
  assert.equal(topics[0].summary, 'What is in the work');
  assert.deepEqual(facts.map((f) => f.topicId), ['t1', 't1', 't3']);
});

test('review summary counts facts per topic and flags weak facts', () => {
  const topics = [{ id: 't1', title: 'Scope' }];
  const facts = [
    { id: 'f1', topicId: 't1', chunkId: 'c1', confidence: 0.9 },
    { id: 'f2', topicId: 't1', chunkId: null, confidence: 0.3 },
  ];
  const summary = reviewSummary(topics, facts);
  assert.equal(summary.facts, 2);
  assert.equal(summary.unsourced, 1);
  assert.equal(summary.lowConfidence, 1);
  assert.equal(summary.byTopic[0].title, 'Scope');
  assert.equal(summary.byTopic[0].count, 2);
});

test('edits renumber, rename and drop, then fold', () => {
  const topics = [
    { id: 't1', title: 'A', summary: '' },
    { id: 't2', title: 'B', summary: '' },
    { id: 't3', title: 'C', summary: '' },
  ];
  const facts = [
    { id: 'f1', topicId: 't1', statement: 'One fact here yes' },
    { id: 'f2', topicId: 't2', statement: 'Two fact here yes' },
    { id: 'f3', topicId: 't3', statement: 'Three fact here yes' },
  ];
  const out = applyEdits(topics, facts, { dropped: ['t3'], renamed: { t1: 'Alpha' }, merged: { t2: 't1' } });
  assert.deepEqual(out.topics.map((t) => t.title), ['Alpha']);
  assert.deepEqual(out.facts.map((f) => f.topicId), ['t1', 't1']);
});

test('freeze needs a title, a topic and facts', () => {
  assert.deepEqual(canFreeze({ title: '' }, [], []), { ok: false, problems: ['freeze.needsTitle', 'freeze.needsTopic', 'freeze.needsFacts'] });
  assert.equal(canFreeze({ title: 'P' }, [{ id: 't' }], [{ id: 'f' }]).ok, true);
});

test('freeze marks low confidence facts for a human check', () => {
  const pack = newPack({ title: 'Intro' });
  const { pack: frozen, topics, facts } = freezePack(pack, [{ id: 't1', title: 'A' }], [
    { id: 'f1', topicId: 't1', statement: 'A certain fact is here', confidence: 0.9 },
    { id: 'f2', topicId: 't1', statement: 'An unsure fact is here', confidence: 0.2 },
  ]);
  assert.equal(frozen.status, 'frozen');
  assert.ok(frozen.review.generatedAt);
  assert.deepEqual(facts.map((f) => f.check), [0, 1]);
  assert.equal(topics[0].order, 0);
  assert.equal(pack.status, 'draft', 'the draft is not mutated');
});

test('adding a document merges new facts only', () => {
  const stored = [{ id: 'f1', statement: 'A milestone is one point in time.' }];
  const out = mergeDocument(stored, [
    { id: 'f9', statement: 'A milestone is one point in time.' },
    { id: 'f10', statement: 'A project has a scope.' },
  ]);
  assert.equal(out.added, 1);
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.facts.map((f) => f.id), ['f1', 'f10']);
});

test('the added load estimate turns facts into bites', () => {
  assert.deepEqual(addLoadEstimate({ added: 0 }), { facts: 0, bites: 0 });
  assert.deepEqual(addLoadEstimate({ added: 18 }), { facts: 18, bites: 2 });
});

test('variant batches only include facts under three variants', () => {
  const facts = [
    { id: 'a', variants: [{}, {}, {}] },
    { id: 'b', variants: [] },
    { id: 'c', variants: [{}, {}] },
  ];
  const out = factsNeedingVariants(facts, 5);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].map((f) => f.id), ['b', 'c']);
  assert.deepEqual(variantsProgress(facts), { done: 1, total: 3, complete: false });
  assert.equal(variantsProgress([]).complete, false);
});

test('generate replies attach to the requested fact ids only', () => {
  const rows = variantsFromReply(
    { variants: [{ type: 'flashcard', front: 'Q', back: 'A', fact_id: 'a' }, { type: 'flashcard', front: 'Q', back: 'A', fact_id: 'zzz' }] },
    ['a'],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].factId, 'a');
});
