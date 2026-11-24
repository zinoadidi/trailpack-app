// Add i18n keys to every catalogue in one go (used while building a screen).
//   node scripts/add-keys.mjs keys.json [translations.json]
// `keys.json` holds the English text for each key.
// `translations.json` maps key -> {et, es, fr, fi}; any language left out is
// filled from English for now and recorded in that catalogue's `_review` list,
// which is where untranslated strings are tracked.
// Existing keys are never overwritten unless --force is passed.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const LOCALES = ['en', 'et', 'es', 'fr', 'fi'];
const english = process.argv[2];
const translated = process.argv[3];
const force = process.argv.includes('--force');
if (!english) {
  console.error('usage: node scripts/add-keys.mjs keys.json [translations.json] [--force]');
  process.exit(1);
}
const base = JSON.parse(await readFile(english, 'utf8'));
const other = translated ? JSON.parse(await readFile(translated, 'utf8')) : {};
let added = 0;
for (const lang of LOCALES) {
  const path = dir + lang + '.json';
  const catalogue = JSON.parse(await readFile(path, 'utf8'));
  const review = catalogue._review || [];
  delete catalogue._review;
  const toReview = [];
  for (const [key, en] of Object.entries(base)) {
    if (!key.startsWith('study.') && !key.startsWith('practice.')) throw new Error('key outside study./practice.: ' + key);
    if (catalogue[key] !== undefined && !force) continue;
    const value = lang === 'en' ? en : other[key] && other[key][lang];
    catalogue[key] = value || en;
    if (!value) toReview.push(key);
    added += 1;
  }
  catalogue._review = [...new Set([...review, ...toReview])];
  await writeFile(path, JSON.stringify(catalogue, null, 2) + '\n');
}
console.log('keys written:', added);
