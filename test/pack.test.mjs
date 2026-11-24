// Pack model: mapping LLM output to topics and facts, review edits, variants
// and later merges. Pure logic, tested directly.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseMap,
  normaliseVariants,
  normaliseVariant,
  mergeIntoPack,
  applyReviewEdits,
  summarisePack,
  variantsComplete,
  isProduction,
  safeId,
  MIN_VARIANTS,
} from '../src/study/pack.js';

const chunks = [
  { id: 's1_p1_1', source: 's1', page: 1, text: 'Project basics.' },
  { id: 's1_p2_2', source: 's1', page: 2, text: 'Milestone basics.' },
];

const map = {
  topics: [
    {
      id: 'basics',
      title: 'Project basics',
      summary: 'Core terms.',
      facts: [
        { id: 'f1', statement: 'A project has a start, a scope and a finish date.', chunk_id: 's1_p1_1', importance: 4, confidence: 0.95 },
        { id: 'f2', statement: 'A milestone marks a point in time, not a period.', chunk_id: 's1_p2_2', importance: 3, confidence: 0.4 },
      ],
    },
    {
      id: 'roles',
      title: 'Roles',
      summary: '',
      facts: [{ id: 'f3', statement: 'A sponsor pays for the project and defends its budget.', chunk_id: 's1_p1_1', importance: 9, confidence: 2 }],
    },
  ],
};

test('normaliseMap keeps topics, facts and their source anchors', () => {
  const { topics, facts } = normaliseMap(map, { packId: 'p1', chunks });
  assert.equal(topics.length, 2);
  assert.equal(facts.length, 3);
  assert.equal(topics[0].packId, 'p1');
  assert.equal(facts[0].topicId, 'basics');
  assert.equal(facts[0].chunkId, 's1_p1_1');
  assert.equal(facts[0].sourceId, 's1');
  assert.equal(facts[0].page, 1);
  assert.equal(facts[1].page, 2);
  assert.equal(facts[1].check, 1, 'low confidence facts are marked check me');
});

test('normaliseMap clamps importance and confidence', () => {
  const { facts } = normaliseMap(map, { packId: 'p1', chunks });
  assert.equal(facts[2].importance, 5);
  assert.equal(facts[2].confidence, 1);
});

test('normaliseMap drops empty topics, short facts and duplicates', () => {
  const raw = {
    topics: [
      { id: 'a', title: 'A', facts: [{ statement: 'too short' }, { statement: 'The same statement appears twice here.' }, { statement: 'the same statement appears twice here' }] },
      { id: 'b', title: '   ', facts: [{ statement: 'This topic has no title so it goes away.' }] },
    ],
  };
  const { topics, facts, warnings } = normaliseMap(raw, { packId: 'p', chunks });
  assert.equal(topics.length, 1);
  assert.equal(facts.length, 1);
  assert.ok(warnings.some((w) => w.code === 'duplicate'));
});

test('facts without a known chunk keep null anchors and are reported', () => {
  const raw = { topics: [{ id: 'a', title: 'A', facts: [{ statement: 'A fact with no citation in the output.', chunk_id: 'missing' }] }] };
  const { facts, warnings } = normaliseMap(raw, { packId: 'p', chunks });
  assert.equal(facts[0].chunkId, null);
  assert.ok(warnings.some((w) => w.code === 'uncited'));
});

test('normaliseMap tolerates junk and makes ids safe', () => {
  assert.deepEqual(normaliseMap(null, { packId: 'p' }).facts, []);
  const { topics, facts } = normaliseMap({ topics: [{ id: 'my topic/1', title: 'Fine', facts: [{ id: 'x y', statement: 'A perfectly good statement about scope.' }] }] }, { packId: 'p' });
  assert.equal(topics[0].id, 'my-topic-1');
  for (const id of [topics[0].id, facts[0].id]) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('review edits: rename, merge and drop renumber topics', () => {
  const { topics, facts } = normaliseMap(map, { packId: 'p1', chunks });
  const edited = applyReviewEdits(topics, { renamed: { roles: 'People' }, merged: { roles: 'basics' }, dropped: [] }, facts);
  assert.equal(edited.topics.length, 1);
  assert.equal(edited.topics[0].id, 'basics');
  assert.equal(edited.topics[0].order, 0);
  assert.equal(edited.facts.length, 3, 'facts moved into the merged topic');
  assert.ok(edited.facts.every((f) => f.topicId === 'basics'));
});

test('review edits: dropping a topic drops its facts', () => {
  const { topics, facts } = normaliseMap(map, { packId: 'p1', chunks });
  const edited = applyReviewEdits(topics, { dropped: ['roles'] }, facts);
  assert.equal(edited.topics.length, 1);
  assert.equal(edited.facts.length, 2);
});

test('review edits: rename keeps the id and the facts', () => {
  const { topics, facts } = normaliseMap(map, { packId: 'p1', chunks });
  const edited = applyReviewEdits(topics, { renamed: { roles: 'People and money' } }, facts);
  assert.equal(edited.topics.find((t) => t.id === 'roles').title, 'People and money');
  assert.equal(edited.facts.filter((f) => f.topicId === 'roles').length, 1);
});

test('adding documents later merges new facts and skips known ones', () => {
  const first = normaliseMap(map, { packId: 'p1', chunks });
  const later = normaliseMap(
    {
      topics: [
        {
          id: 'basics',
          title: 'Project basics',
          facts: [
            { id: 'new', statement: 'A project has a start, a scope and a finish date', chunk_id: 's1_p1_1' },
            { id: 'other', statement: 'A risk is an uncertain event that could affect the outcome.', chunk_id: 's1_p2_2' },
          ],
        },
      ],
    },
    { packId: 'p1', chunks },
  );
  const { added, skipped } = mergeIntoPack(first.facts, later.facts);
  assert.equal(added.length, 1);
  assert.equal(skipped.length, 1, 'the known statement is not duplicated');
  assert.match(added[0].statement, /^A risk/);
});

test('variants: three or more is complete, and production types are known', () => {
  assert.equal(MIN_VARIANTS, 3);
  assert.equal(variantsComplete({ variants: [1, 2] }), false);
  assert.equal(variantsComplete({ variants: [1, 2, 3] }), true);
  assert.equal(isProduction('cloze'), true);
  assert.equal(isProduction('flashcard'), false);
  assert.equal(isProduction('teach-back'), true);
});

test('variants: each supported shape is validated', () => {
  const ok = [
    { type: 'flashcard', front: 'What is a milestone?', back: 'A point in time.' },
    { type: 'multiple-choice', prompt: 'What is a milestone?', choices: ['A period', 'A point'], answer: 1, why: 'Because.' },
    { type: 'true-false', statement: 'A milestone is a period of work.', answer: false },
    { type: 'cloze', text: 'A milestone marks a ___ in time.', answer: 'point' },
    { type: 'cloze', text: 'A milestone marks a point in time.', blank: 'point' },
    { type: 'order', prompt: 'Put the phases in order', items: ['Start', 'Plan', 'Close'] },
    { type: 'match', pairs: [{ term: 'Scope', meaning: 'What is included' }, { term: 'Risk', meaning: 'Uncertain event' }, { term: 'Gate', meaning: 'A checkpoint' }] },
    { type: 'spot-mistake', prompt: 'Which claim is wrong?', claims: ['A is right', 'B is wrong'], wrong: 1 },
    { type: 'swipe', statement: 'Scope means what is included.', answer: true },
    { type: 'voice', prompt: 'Explain the critical path.', points: ['longest chain'] },
    { type: 'teach-back', prompt: 'Teach me milestones.', points: ['point in time'] },
    { type: 'listen', transcript: 'A milestone is a point in time.', question: 'What is it?', choices: ['A period', 'A point'], answer: 1 },
  ];
  for (const raw of ok) {
    const variant = normaliseVariant(raw, 'f1');
    assert.ok(variant, 'accepted ' + raw.type);
    assert.equal(variant.factId, 'f1');
    assert.match(variant.id, /^[A-Za-z0-9_-]{1,64}$/);
  }
});

test('variants: broken shapes are dropped, not shown half built', () => {
  const bad = [
    null,
    {},
    { type: 'flashcard', front: 'no back' },
    { type: 'multiple-choice', prompt: 'q', choices: ['only one'], answer: 0 },
    { type: 'multiple-choice', prompt: 'q', choices: ['a', 'b'], answer: 5 },
    { type: 'true-false', statement: 'maybe', answer: 'perhaps' },
    { type: 'cloze', text: 'no blank here', answer: '' },
    { type: 'order', items: ['too', 'few'] },
    { type: 'match', pairs: [{ term: 'one', meaning: 'thing' }] },
    { type: 'spot-mistake', claims: ['a', 'b'], wrong: 9 },
    { type: 'listen', transcript: 't', question: 'q', choices: ['a', 'b'], answer: 3 },
    { type: 'unknown-type', front: 'x', back: 'y' },
  ];
  for (const raw of bad) assert.equal(normaliseVariant(raw, 'f1'), null, JSON.stringify(raw));
});

test('variants: string answers are read sensibly', () => {
  const mc = normaliseVariant({ type: 'multiple-choice', prompt: 'q', choices: ['a', 'b'], answer: 'b' }, 'f1');
  assert.equal(mc.answer, 1);
  const tf = normaliseVariant({ type: 'true-false', statement: 's', answer: 'True' }, 'f1');
  assert.equal(tf.answer, true);
});

test('variants: normaliseVariants removes duplicates and keeps the first', () => {
  const list = [
    { type: 'flashcard', front: 'q', back: 'a' },
    { type: 'flashcard', front: 'q', back: 'a' },
    { type: 'true-false', statement: 'q', answer: true },
  ];
  const out = normaliseVariants(list, { factId: 'f1' });
  assert.equal(out.length, 2);
});

test('pack summary counts facts per topic and check me flags', () => {
  const { topics, facts } = normaliseMap(map, { packId: 'p1', chunks });
  const summary = summarisePack(topics, facts);
  assert.equal(summary.topics, 2);
  assert.equal(summary.facts, 3);
  assert.equal(summary.needsCheck, 1);
  assert.deepEqual(summary.byTopic, [
    { topicId: 'basics', count: 2 },
    { topicId: 'roles', count: 1 },
  ]);
});

test('safeId never returns an empty or unsafe id', () => {
  assert.equal(safeId('', 'fallback'), 'fallback');
  assert.equal(safeId('Über café / notes'), 'Uber-cafe-notes');
  assert.match(safeId('!!!', 'x'), /^[A-Za-z0-9_-]{1,64}$/);
});
