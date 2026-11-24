// Every key B's screens use at run time must exist in all five catalogues.
// The i18n completeness test already checks the catalogues against each other;
// this catches a key the code spells differently from the catalogue (the one
// way a missing string escapes that test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const I18N = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const PREFIXES = ['act2.', 'trailhome.', 'mixer.'];

const en = JSON.parse(await readFile(I18N + 'en.json', 'utf8'));
const keys = new Set(Object.keys(en));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = (await walk(path.join(SRC, 'screens'))).filter((file) => /activities[\\/]|trail|mixer|practice/.test(path.relative(SRC, file)));

test('every literal act2., trailhome. and mixer. key in the code is in the catalogue', async () => {
  const found = new Set();
  const pattern = /['"](act2\.|trailhome\.|mixer\.)[A-Za-z0-9_.]+['"]/g;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(pattern)) found.add(match[0].slice(1, -1));
  }
  assert.ok(found.size > 20, 'the scan finds the keys');
  const missing = [...found].filter((key) => {
    if (keys.has(key)) return false;
    // Prefix keys are built at run time: "mixer.state." + state, "study.type." + type.
    return !/\.$/.test(key) && ![...keys].some((k) => k.startsWith(key + '.'));
  });
  assert.deepEqual(missing, [], `keys used but not in en.json: ${missing.join(', ')}`);
});

test('the B catalogues have the same number of keys in every language', async () => {
  for (const lang of ['et', 'es', 'fr', 'fi']) {
    const other = JSON.parse(await readFile(I18N + lang + '.json', 'utf8'));
    const count = Object.keys(other).filter((key) => PREFIXES.some((p) => key.startsWith(p))).length;
    assert.equal(count, [...keys].filter((key) => PREFIXES.some((p) => key.startsWith(p))).length, lang);
  }
});
