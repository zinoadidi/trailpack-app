import test from 'node:test';
import assert from 'node:assert/strict';
import * as study from '../src/study/session.js';

const facts = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
const trail = { camps: [
  { id: 'past', state: 'summited', factIds: ['one'] },
  { id: 'current', state: 'open', factIds: ['two'] },
  { id: 'future', state: 'locked', factIds: ['three'] },
] };

test('an explicitly requested reachable camp selects only its own facts', () => {
  assert.equal(typeof study.studySelection, 'function');
  assert.deepEqual(study.studySelection({ facts, trail, requested: 'past' }), { camp: trail.camps[0], facts: [facts[0]] });
  assert.deepEqual(study.studySelection({ facts, trail, requested: 'current' }), { camp: trail.camps[1], facts: [facts[1]] });
});

test('unknown or locked requested camps cannot silently select another camp', () => {
  assert.equal(typeof study.studySelection, 'function');
  assert.equal(study.studySelection({ facts, trail, requested: 'future' }), null);
  assert.equal(study.studySelection({ facts, trail, requested: 'missing' }), null);
});

test('without a requested camp the existing mixed queue remains available', () => {
  assert.equal(typeof study.studySelection, 'function');
  assert.deepEqual(study.studySelection({ facts, trail }), { camp: trail.camps[1], facts });
});

test('a selected camp ignores review backlog from other camps', () => {
  const progress = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`outside-${i}`, { state: 'review', dueAt: 1 }]));
  const selection = study.studySelection({ facts, trail, requested: 'past', progress });
  assert.deepEqual(selection.progress, {});
  assert.equal(study.studyQueue({ facts: selection.facts, progress: selection.progress, trail, steps: 8, now: 100 }).paused, false);
});

test('a completed camp can be revisited even when its facts are not yet due', () => {
  const progress = { one: { state: 'mastered', dueAt: 10000 } };
  const selection = study.studySelection({ facts, trail, requested: 'past', progress });
  const queue = study.studyQueue({ facts: selection.facts, progress: selection.progress, trail, campId: 'past', now: 100 });
  assert.deepEqual(queue.queue, ['one']);
});
