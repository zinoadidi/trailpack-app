import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Append or replace catalogue keys in place, keeping the file layout (one key
// per line, regular strings). Not loaded by the app.
//
// Usage: node scripts/apply-i18n.mjs <file with { "<lang>": { "<key>": "..." } }>
const here = fileURLToPath(new URL('.', import.meta.url));
const LANGS = ['en', 'et', 'es', 'fr', 'fi'];
const blockFile = process.argv[2];
if (!blockFile) {
  console.error('pass a JSON file with keys per language');
  process.exit(1);
}
const block = JSON.parse(readFileSync(blockFile, 'utf8'));
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
let total = 0;
for (const lang of LANGS) {
  const path = here + '../src/i18n/' + lang + '.json';
  let text = readFileSync(path, 'utf8');
  const data = JSON.parse(text);
  for (const [key, enValue] of Object.entries(block.en || {})) {
    const value = (block[lang] && block[lang][key]) ?? enValue;
    const encoded = JSON.stringify(value);
    const pattern = new RegExp('(\\n\\s*"' + escapeRe(key) + '"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"');
    if (pattern.test(text)) text = text.replace(pattern, '$1' + encoded);
    else text = text.replace(/(\n\}\s*)$/, ',\n  ' + JSON.stringify(key) + ': ' + encoded + '$1');
    data[key] = value;
    total += 1;
  }
  writeFileSync(path, text);
}
console.log('applied', total, 'values');
