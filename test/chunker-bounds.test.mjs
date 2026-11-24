import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkDocument, countWords } from '../src/study/chunker.js';

test('every chunk is 150 to 400 words and no word is lost (random documents)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const para = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';
  for (let t = 0; t < 300; t += 1) {
    const pages = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () =>
      Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => para(20 + Math.floor(rnd() * 300))).join('\n\n'));
    const total = pages.reduce((n, p) => n + countWords(p), 0);
    const chunks = chunkDocument({ text: '', pages: pages.map((text, i) => ({ n: i + 1, text })) }, { sourceId: 's' });
    assert.equal(chunks.reduce((n, c) => n + countWords(c.text), 0), total);
    if (chunks.length > 1) for (const c of chunks) assert.ok(c.words >= 150 && c.words <= 400, `case ${t}: ${c.words}`);
  }
});

import { normaliseMap, junkReason } from '../src/study/pack.js';

test('junk facts are dropped and ids do not collide across batches', () => {
  assert.equal(junkReason('The ____ is the unit of charge.'), 'blank');
  assert.equal(junkReason('The text includes a discussion of atoms.'), 'meta');
  assert.equal(junkReason('Office hours are on Tuesday at noon.'), 'logistics');
  assert.equal(junkReason('Atoms of one element share a proton count.'), '');
  const chunks = [{ id: 'c1', source: 's', page: 1 }];
  const raw = (st) => ({ topics: [{ id: 't1', title: 'Atoms', facts: [{ id: 'f1', statement: st, chunk_id: 'c1' }] }] });
  const a = normaliseMap(raw('Protons carry a positive charge.'), { packId: 'p', chunks });
  const b = normaliseMap(raw('Electrons carry a negative charge.'), { packId: 'p', chunks });
  assert.notEqual(a.facts[0].id, b.facts[0].id);
  const bad = normaliseMap(raw('The text includes a note on atoms.'), { packId: 'p', chunks });
  assert.equal(bad.facts.length, 0);
});
