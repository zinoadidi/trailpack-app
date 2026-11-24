// Chunker: extracted text to chunks of 150 to 400 words with a source anchor.
// Pure logic (no DOM, no network) so it can be tested directly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkDocument, cleanText, countWords, splitSentences, chunkId, chunkSources } from '../src/study/chunker.js';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];

/** A paragraph of `n` words ending in a full stop. */
function para(n, seed = 0) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(WORDS[(i + seed) % WORDS.length]);
  out[out.length - 1] = out[out.length - 1] + '.';
  return out.join(' ');
}

/** `n` paragraphs of `size` words each. */
function doc(paragraphs, size = 60, pages = 1) {
  const out = [];
  for (let i = 0; i < paragraphs; i += 1) out.push(para(size, i));
  if (pages === 1) return { text: out.join('\n\n'), pages: [{ n: 1, text: out.join('\n\n') }] };
  const per = Math.ceil(out.length / pages);
  const list = [];
  for (let i = 0; i < out.length; i += per) list.push({ n: list.length + 1, text: out.slice(i, i + per).join('\n\n') });
  return { text: out.join('\n\n'), pages: list };
}

test('cleanText joins hyphenated words and tidies spacing', () => {
  assert.equal(cleanText('exam-\nple  of   text'), 'example of text');
  assert.equal(cleanText('a\r\nb\u00a0c'), 'a\nb c');
  assert.equal(cleanText('one\n\n\n\ntwo'), 'one\n\ntwo');
  assert.equal(cleanText(null), '');
});

test('sentences split at real ends, not at abbreviations', () => {
  const parts = splitSentences('Use a tool, e.g. a form. Then check the p. 4 notes. Done.');
  assert.equal(parts.length, 3);
  assert.match(parts[0], /e\.g\. a form\.$/);
  assert.match(parts[1], /p\. 4 notes\.$/);
  assert.equal(parts[2], 'Done.');
});

test('every chunk is between 150 and 400 words', () => {
  const chunks = chunkDocument(doc(20, 60), { sourceId: 's1' });
  assert.ok(chunks.length >= 3, 'twenty paragraphs of 60 words make several chunks');
  for (const chunk of chunks) {
    assert.ok(chunk.words >= 150, `chunk ${chunk.id} is too short: ${chunk.words}`);
    assert.ok(chunk.words <= 400, `chunk ${chunk.id} is too long: ${chunk.words}`);
    assert.equal(chunk.words, countWords(chunk.text));
  }
});

test('a short single page still yields one chunk, not zero', () => {
  const chunks = chunkDocument({ text: 'A short note about milestones.' }, { sourceId: 's2' });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].words, 5);
  assert.equal(chunks[0].source, 's2');
  assert.equal(chunks[0].page, 1);
});

test('a very long paragraph is cut on sentences and still fits', () => {
  const sentences = [];
  for (let i = 0; i < 60; i += 1) sentences.push(para(20, i));
  const chunks = chunkDocument({ text: sentences.join(' ') }, { sourceId: 's3' });
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.words <= 400, `overflow ${chunk.words}`);
    assert.ok(chunk.words >= 150, `underflow ${chunk.words}`);
  }
});

test('a single giant sentence is cut on word boundaries, never dropped', () => {
  const giant = Array.from({ length: 900 }, (_, i) => 'word' + i).join(' ');
  const chunks = chunkDocument({ text: giant }, { sourceId: 's4' });
  const total = chunks.reduce((n, c) => n + c.words, 0);
  assert.equal(total, 900, 'no words are lost');
  for (const chunk of chunks) assert.ok(chunk.words <= 400);
});

test('chunks keep page anchors', () => {
  const chunks = chunkDocument(doc(12, 60, 3), { sourceId: 's5' });
  const pages = new Set(chunks.map((c) => c.page));
  assert.deepEqual([...pages].sort(), [1, 2, 3]);
  for (const chunk of chunks) assert.match(chunk.id, /^s5_p[123]_\d+$/);
});

test('ids are stable for the same input and unique inside a document', () => {
  const a = chunkDocument(doc(10, 60), { sourceId: 'stable' });
  const b = chunkDocument(doc(10, 60), { sourceId: 'stable' });
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
  assert.equal(a.map((c) => c.id).length, new Set(a.map((c) => c.id)).size);
});

test('ids are safe for the API pattern', () => {
  const id = chunkId('my file (1).pdf', 2, 7);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('chunkSources keeps document order', () => {
  const chunks = chunkSources([
    { id: 'a', extract: { text: para(200) } },
    { id: 'b', extract: { text: para(200) } },
  ]);
  assert.equal(chunks[0].source, 'a');
  assert.equal(chunks.at(-1).source, 'b');
});

test('a short tail is spread over the chunks, not left as a stub', () => {
  const chunks = chunkDocument(doc(13, 37), { sourceId: 'tail' });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.words >= 150 && chunk.words <= 400, `chunk ${chunk.id} has ${chunk.words}`);
});

test('limits are configurable but the defaults are 150 and 400', () => {
  const small = chunkDocument(doc(10, 40), { sourceId: 'x', limits: { min: 40, max: 80 } });
  for (const chunk of small) assert.ok(chunk.words <= 80);
  const normal = chunkDocument(doc(10, 40), { sourceId: 'x' });
  assert.ok(normal[0].words >= 150 || normal.length === 1);
});
