import test from 'node:test';
import assert from 'node:assert/strict';
import { chunksForSource } from '../src/study/library.js';

test('a fetched source preserves page anchors even for short pages', () => {
  const chunks = chunksForSource({ id: 'source' }, { pages: [
    { n: 1, text: 'First page facts.' },
    { n: 2, text: 'Second page facts.' },
  ] }, undefined, { preservePages: true });
  assert.deepEqual(chunks.map((chunk) => chunk.page), [1, 2]);
  assert.equal(chunks[1].text, 'Second page facts.');
});
