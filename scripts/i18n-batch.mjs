// Add B's i18n keys (act2., trailhome., mixer.) to all five catalogues.
// Existing keys are never touched. Unknown arguments are ignored.
//
//   node scripts/i18n-batch.mjs <batch-file.mjs> [--write]
//
// The batch file exports STRINGS and PREFIXES (see scripts/i18n-act2.mjs).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const LANGS = ['en', 'et', 'es', 'fr', 'fi'];

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) {
  console.error('usage: node scripts/i18n-batch.mjs <batch-file> [--write]');
  process.exit(2);
}
const mod = await import(pathToFileURL(file).href);
const prefixes = mod.PREFIXES;
const wanted = Object.entries(mod.STRINGS).filter(([key]) => prefixes.some((p) => key.startsWith(p)));

const catalogues = {};
for (const lang of LANGS) catalogues[lang] = JSON.parse(await readFile(DIR + lang + '.json', 'utf8'));

let missing = 0;
for (const [key] of wanted) {
  for (const lang of LANGS) if (!catalogues[lang][key]) missing += 1;
}
if (!write) {
  for (const [key] of wanted) for (const lang of LANGS) if (!catalogues[lang][key]) console.log(`missing ${lang}: ${key}`);
  console.log(`${wanted.length} keys, ${missing} missing values`);
  process.exit(0);
}
if (!missing) {
  console.log('nothing to add');
  process.exit(0);
}
for (const lang of LANGS) {
  const next = { ...catalogues[lang] };
  for (const [key, values] of wanted) if (!next[key]) next[key] = values[lang] || values.en;
  await writeFile(DIR + lang + '.json', JSON.stringify(next, null, 2) + '\n');
}
console.log(`added ${missing} values across ${LANGS.length} catalogues`);
