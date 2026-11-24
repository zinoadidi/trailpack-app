// Merge translated catalogues from small per-language files, then tidy
// `_review`: a key that no longer reads as English leaves the review list.
//   node scripts/merge-keys.mjs es=scripts/es.json fr=scripts/fr.json
// Each file is `{ "<key>": "text" }` (or the `{ "<key>": {es: "text"} }` form).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const LOCALES = ['en', 'et', 'es', 'fr', 'fi'];
const pairs = process.argv.slice(2).filter((arg) => arg.includes('=')).map((arg) => arg.split('='));
if (!pairs.length) {
  console.error('usage: node scripts/merge-keys.mjs es=file.json et=file.json ...');
  process.exit(1);
}
const english = JSON.parse(await readFile(dir + 'en.json', 'utf8'));
const merged = {};
for (const [lang, file] of pairs) {
  if (!LOCALES.includes(lang)) throw new Error('unknown locale: ' + lang);
  const data = JSON.parse(await readFile(file, 'utf8'));
  for (const [key, value] of Object.entries(data)) {
    merged[key] = merged[key] || {};
    if (typeof value === 'string') merged[key][lang] = value;
    else if (value && typeof value === 'object') Object.assign(merged[key], value);
  }
}
let written = 0;
for (const lang of LOCALES) {
  if (lang === 'en') continue;
  const path = dir + lang + '.json';
  const catalogue = JSON.parse(await readFile(path, 'utf8'));
  for (const [key, values] of Object.entries(merged)) {
    if (catalogue[key] === undefined) continue;
    const text = values[lang];
    if (typeof text === 'string' && text.trim()) {
      catalogue[key] = text;
      written += 1;
    }
  }
  const review = (catalogue._review || []).filter((key) => typeof catalogue[key] === 'string' && catalogue[key] === english[key]);
  delete catalogue._review;
  catalogue._review = [...new Set(review)];
  await writeFile(path, JSON.stringify(catalogue, null, 2) + '\n');
}
console.log('values written:', written);
