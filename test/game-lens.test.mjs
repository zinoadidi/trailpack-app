import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPENDENCIES,
  LENS_FIELDS,
  LENS_FORMATS,
  LENS_PRESETS,
  applyDiff,
  changedFields,
  dependenciesFor,
  diffSentence,
  emptyLens,
  isProtectedItem,
  lensUsage,
  normaliseLens,
  parseLensDiff,
  presetLens,
  regenerationPlan,
  ruleBasedDiff,
  staleItems,
} from '../src/game/lens.js';

test('a Lens has exactly the design fields', () => {
  assert.deepEqual(LENS_FIELDS, ['audience', 'tone', 'formats', 'difficulty', 'length', 'emphasis', 'language', 'extra']);
  const lens = emptyLens();
  assert.equal(lens.difficulty, 'medium');
  assert.equal(lens.formats.flash + lens.formats.quiz + lens.formats.oral + lens.formats.task, 1);
});

test('normaliseLens clamps, drops unknown formats and fixes junk', () => {
  const lens = normaliseLens({ difficulty: 'impossible', formats: { flash: 2, quiz: 2, nonsense: 5 }, length: { learn_card_words: -4 }, emphasis: 'names , dates', id: 'x'.repeat(200) });
  assert.equal(lens.difficulty, 'medium');
  assert.deepEqual(Object.keys(lens.formats).sort(), ['flash', 'quiz']);
  assert.equal(lens.formats.flash + lens.formats.quiz, 1, 'weights are normalised');
  assert.equal(lens.length.learn_card_words, 80, 'junk length falls back');
  assert.deepEqual(lens.emphasis, ['names', 'dates']);
  assert.equal(lens.id.length, 64);
  for (const key of Object.keys(normaliseLens({ formats: { diy: 1 } }).formats)) assert.ok(LENS_FORMATS.includes(key));
});

test('a parsed diff only keeps known fields and safe values', () => {
  const parsed = parseLensDiff({ fields: { difficulty: 'hard', tone: 'direct', formats: { task: 0.4, madeUp: 1 }, eyeColour: 'green', length: { learn_card_words: 40 } } });
  assert.deepEqual(parsed.fields.difficulty, 'hard');
  assert.equal(parsed.fields.tone, 'direct');
  assert.deepEqual(parsed.fields.formats, { task: 0.4 });
  assert.equal(parsed.fields.eyeColour, undefined);
  assert.equal(parsed.fields.length.learn_card_words, 40);
});

test('a diff can arrive as JSON text inside text, or as a bare field map', () => {
  const fromText = parseLensDiff({ text: 'Sure!\n{"fields":{"difficulty":"easy"},"summary":[{"field":"difficulty","from":"medium","to":"easy"}]}' });
  assert.equal(fromText.fields.difficulty, 'easy');
  assert.deepEqual(fromText.summary, [{ field: 'difficulty', from: 'medium', to: 'easy' }]);
  assert.equal(parseLensDiff('{"difficulty":"hard"}').fields.difficulty, 'hard');
  assert.equal(parseLensDiff('{"diff":{"tone":"warm"}}').fields.tone, 'warm');
  assert.deepEqual(parseLensDiff('not json at all').fields, {});
  assert.deepEqual(parseLensDiff(null).fields, {});
});

test('changedFields ignores noise and reports whole fields', () => {
  const before = emptyLens();
  assert.deepEqual(changedFields(before, before), []);
  assert.deepEqual(changedFields(before, { ...before, difficulty: 'hard' }), ['difficulty']);
  assert.deepEqual(changedFields(before, { ...before, formats: { ...before.formats, task: 0.12 } }), ['formats'], 'a small move counts once');
  assert.deepEqual(changedFields(before, { ...before, formats: { ...before.formats, task: 0.403 } }), ['formats']);
  assert.deepEqual(changedFields(before, { ...before, formats: { ...before.formats, flash: 0.399 } }), [], 'rounding does not nag');
  assert.deepEqual(changedFields(before, { ...before, emphasis: ['names'] }), ['emphasis']);
});

test('applyDiff returns the new Lens and the rows shown for approval', () => {
  const lens = applyDiff(emptyLens(), { fields: { difficulty: 'hard', formats: { task: 0.3 } } });
  assert.equal(lens.lens.difficulty, 'hard');
  assert.ok(lens.lens.formats.task > 0.1, 'the task weight went up from the default 10%');
  assert.deepEqual(lens.changed, ['formats', 'difficulty'], 'in field order');
  const row = lens.rows.find((r) => r.field === 'difficulty');
  assert.deepEqual(row, { field: 'difficulty', from: 'medium', to: 'hard' });
  assert.deepEqual(diffSentence([row]), ['difficulty: medium \u2192 hard'], 'a list of lines, one per field');
  assert.ok(diffSentence(lens.rows)[0].startsWith('formats: flash 40%'));
});

test('applying the same diff twice changes nothing the second time', () => {
  const first = applyDiff(emptyLens(), { fields: { tone: 'direct' } });
  const second = applyDiff(first.lens, { fields: { tone: 'direct' } });
  assert.deepEqual(second.changed, []);
});

test('the rule based parser reads the common asks, offline', () => {
  assert.equal(ruleBasedDiff('make it harder, exam level').fields.difficulty, 'hard');
  assert.equal(ruleBasedDiff('explain in plain english please').fields.difficulty, 'easy');
  assert.equal(ruleBasedDiff('more scenarios, fewer definitions').fields.formats.task, 0.5);
  assert.equal(ruleBasedDiff('ask me out loud').fields.formats.oral, 0.5);
  assert.equal(ruleBasedDiff('short, for my commute').fields.length.learn_card_words, 40);
  assert.deepEqual(ruleBasedDiff('hello there').fields, {}, 'no guess when nothing matches');
  assert.equal(ruleBasedDiff('').raw.source, 'rules');
});

test('every preset is a valid Lens with a title key', () => {
  for (const [name, preset] of Object.entries(LENS_PRESETS)) {
    assert.equal(preset.id, name);
    const lens = presetLens(name);
    assert.equal(lens.id, name);
    assert.ok(lens.title.length > 0);
    const sum = Object.values(lens.formats).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, name + ' weights sum to 1');
  }
  assert.equal(presetLens('flash-only').formats.flash, 1);
  assert.equal(presetLens('nope').id, 'default');
});

test('dependency tracking: only items whose fields changed go stale', () => {
  const items = [
    { id: 'c1', kind: 'flash' },
    { id: 'q1', kind: 'quiz' },
    { id: 'g1', kind: 'guide' },
    { id: 'k1', kind: 'certificate' },
  ];
  assert.deepEqual(staleItems(items, ['difficulty']), { stale: ['q1'], untouched: ['c1', 'g1', 'k1'] });
  assert.deepEqual(staleItems(items, ['tone']).stale, ['c1', 'g1']);
  assert.deepEqual(staleItems(items, []).stale, [], 'nothing changed, nothing rebuilt');
  assert.deepEqual(staleItems(items, ['language']).stale, [], 'language is not a dependency of these kinds');
});

test('an item can record its own dependencies, which win over the table', () => {
  const item = { id: 'x', kind: 'quiz', lens_fields: ['length'] };
  assert.deepEqual(dependenciesFor('quiz', item), ['length']);
  assert.deepEqual(dependenciesFor('quiz'), DEPENDENCIES.quiz);
  assert.deepEqual(dependenciesFor('unknown-kind'), []);
  assert.deepEqual(dependenciesFor('quiz', { lens_fields: ['bogus', 'tone'] }), ['tone'], 'only real fields survive');
  assert.deepEqual(dependenciesFor('quiz', { lens_fields: ['bogus'] }), DEPENDENCIES.quiz, 'nothing usable, table used');
  assert.deepEqual(staleItems([item], ['length']).stale, ['x']);
  assert.deepEqual(staleItems([item], ['difficulty']).stale, []);
});

test('the regeneration plan is a count and an honest estimate', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, kind: 'quiz' }));
  const plan = regenerationPlan(items, ['difficulty']);
  assert.equal(plan.count, 40);
  assert.equal(plan.estimateMs, 48_000);
  assert.equal(plan.untouched.length, 0);
  assert.equal(regenerationPlan(items, [], { msPerItem: 1000 }).count, 0);
});

test('facts and progress are never in a Lens change', () => {
  assert.equal(isProtectedItem({ collection: 'facts' }), true);
  assert.equal(isProtectedItem({ collection: 'progress' }), true);
  assert.equal(isProtectedItem({ collection: 'attempts' }), true);
  assert.equal(isProtectedItem({ collection: 'generated' }), false);
});

test('lensUsage counts distinct Lenses per topic', () => {
  const usage = lensUsage([
    { topicId: 't1', lensId: 'oral' },
    { topicId: 't1', lensId: 'oral' },
    { topicId: 't1', lensId: 'plain' },
    { topicId: 't2', lensId: 'exam' },
  ]);
  assert.deepEqual(usage, { t1: 2, t2: 1 });
});
