import test from 'node:test';
import assert from 'node:assert/strict';
import * as study from '../src/study/session.js';

test('study source context uses only the source associated with the fact', () => {
  assert.equal(typeof study.studySourceContext, 'function');
  const pack = { sources: [{ id: 'a', name: 'Lesson', url: 'https://example.org/lesson' }, { id: 'b', name: 'Other' }] };
  assert.deepEqual(study.studySourceContext({ sourceId: 'a', page: 2 }, pack), { name: 'Lesson', url: 'https://example.org/lesson', page: 2 });
  assert.equal(study.studySourceContext({ sourceId: 'missing' }, pack), null);
  assert.equal(study.studySourceContext({}, pack), null);
});

test('file sources have no invented citation and unsafe links are not exposed', () => {
  assert.equal(typeof study.studySourceContext, 'function');
  const pack = { sources: [{ id: 'file', name: 'Notes.pdf' }, { id: 'bad', name: 'Unsafe', url: 'javascript:alert(1)' }] };
  assert.deepEqual(study.studySourceContext({ sourceId: 'file' }, pack), { name: 'Notes.pdf', url: null, page: null });
  assert.deepEqual(study.studySourceContext({ sourceId: 'bad' }, pack), { name: 'Unsafe', url: null, page: null });
});

test('missing or malformed saved source lists do not break a study step', () => {
  assert.equal(study.studySourceContext({ sourceId: 'x' }, { sources: [null] }), null);
  assert.equal(study.studySourceContext({ sourceId: 'x' }, { sources: {} }), null);
});
