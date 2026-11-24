// Merge a translated key block into a catalogue (one-off helper, run by hand).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

for (const lang of ['et', 'es', 'fr', 'fi']) {
  const target = new URL(`../src/i18n/${lang}.json`, import.meta.url);
  const extra = new URL(`../src/i18n/.new-${lang}.json`, import.meta.url);
  if (!existsSync(extra)) continue;
  const data = JSON.parse(readFileSync(target, 'utf8'));
  const additions = JSON.parse(readFileSync(extra, 'utf8'));
  for (const [key, value] of Object.entries(additions)) if (!(key in data)) data[key] = value;
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  unlinkSync(extra);
  console.log(lang, Object.keys(additions).length);
}
