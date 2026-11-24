// The ZIP bundle: entry list, deterministic names and a readable archive.
// Runs under `node --test` with no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BUNDLE_FORMATS, bundleEntries, bundleSlug, zipBundle, zipFileName } from '../src/export/bundle.js';
import { crc32 } from '../src/export/zip.js';

const pack = {
  id: 'p1',
  title: 'Intro to Project Management',
  goal: 'Pass',
  topics: [
    { id: 'scope', title: 'Scope and charter' },
    { id: 'risk', title: 'Risks' },
  ],
  facts: [
    { id: 'f1', topicId: 'scope', text: 'A charter names the sponsor and the goal.', importance: 3, source: { name: 'notes.md' }, variants: [{ type: 'flashcard', front: 'Who signs the charter?', back: 'The sponsor.' }] },
    { id: 'f2', topicId: 'risk', text: 'A risk register lists threats and owners.', importance: 2, source: { name: 'notes.md', page: 4 }, variants: [] },
  ],
};

const DATE = new Date(2026, 2, 4);

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  let cdOffset = -1;
  let cdSize = 0;
  let count = 0;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      count = view.getUint16(i + 10, true);
      cdSize = view.getUint32(i + 12, true);
      cdOffset = view.getUint32(i + 16, true);
      break;
    }
  }
  let at = 0;
  while (files.length < count) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
    files.push({ name, data, crc, size });
    at += 30 + nameLen + extraLen + size;
  }
  return { files, count, cdOffset, cdSize, declaredEntries: view.getUint16(bytes.length - 12, true) };
}

test('the bundle holds the guide, the cheat sheet and the Anki file in that order', () => {
  const { entries } = bundleEntries(pack, { date: DATE });
  assert.deepEqual(entries.map((entry) => entry.format), BUNDLE_FORMATS);
  assert.deepEqual(entries.map((entry) => entry.name), ['guide-all.md', 'cheatsheet-all.md', 'anki-all.tsv']);
  assert.ok(entries[0].text.includes('Scope and charter'));
  assert.ok(entries[2].text.includes('\t'));
});

test('a camp bundle names its files after the camp', () => {
  const { entries, fileName } = bundleEntries(pack, { campId: 'risk', date: DATE });
  assert.deepEqual(entries.map((entry) => entry.name), ['guide-risks.md', 'cheatsheet-risks.md', 'anki-risks.tsv']);
  assert.equal(fileName, 'intro-to-project-management-camp-risk-2026-03-04.zip');
});

test('names are deterministic, lower case, ASCII and free of path characters', () => {
  const first = zipFileName(pack, { date: DATE });
  const second = zipFileName(pack, { date: DATE });
  assert.equal(first, second);
  assert.match(first, /^[a-z0-9-]+\.zip$/);
  assert.equal(bundleSlug('  Ülevaade / Intro  '), 'ulevaade-intro');
  assert.equal(bundleSlug(''), 'trailpack');
  assert.equal(zipFileName({}, { date: DATE }), 'trailpack-all-2026-03-04.zip');
});

test('the archive is a valid store-only ZIP with correct CRC and sizes', () => {
  const { entries, bytes } = zipBundle(pack, { date: DATE });
  const zip = readZip(bytes);
  assert.equal(zip.declaredEntries, entries.length, 'end of central directory counts the files');
  assert.ok(zip.cdOffset > 0 && zip.cdSize > 0);
  assert.equal(bytes.length, zip.cdOffset + zip.cdSize + 22);
  assert.equal(zip.files.length, entries.length);
  for (const [i, file] of zip.files.entries()) {
    assert.equal(file.name, entries[i].name);
    assert.equal(file.crc, crc32(file.data), file.name + ' crc');
    assert.equal(file.size, file.data.length);
    const text = new TextDecoder().decode(file.data);
    assert.ok(text.length > 0);
    assert.equal(text, entries[i].text);
  }
});

test('UTF-8 text survives the round trip', () => {
  const accented = { ...pack, title: 'Õppimine ja Õigused', facts: [{ ...pack.facts[0], text: 'Mõõdikud näitavad õnnestumist – tähtis fakt.' }] };
  const { bytes } = zipBundle(accented, { date: DATE });
  const [guide] = readZip(bytes).files;
  assert.ok(new TextDecoder().decode(guide.data).includes('Mõõdikud näitavad õnnestumist'));
});

test('an empty pack still yields a readable archive', () => {
  const { bytes, entries } = zipBundle({ title: 'Empty' }, { date: DATE });
  assert.ok(entries.length >= 2, 'guide and cheat sheet are always written');
  assert.equal(readZip(bytes).files.length, entries.length);
});
