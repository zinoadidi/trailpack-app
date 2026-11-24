#!/usr/bin/env node
// Stamp a build id into the places that cache things:
//   sw.js            BUILD_ID constant (names the cache)
//   index.html       <meta name="build-id" content="...">
//   src/build-id.js  exported BUILD_ID for the Me screen
// Run by hand or in CI: node scripts/stamp-build.mjs [--id <id>]
// Default id: git short hash plus a UTC timestamp, so a rebuild never reuses a cache.

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

function gitHash() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'nogit';
  }
}

function defaultId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${gitHash()}-${stamp}`;
}

const ID = arg('id') || process.env.BUILD_ID || defaultId();

if (!/^[A-Za-z0-9._-]{3,80}$/.test(ID)) {
  console.error('Build id must be 3 to 80 characters of letters, digits, dot, underscore or dash.');
  process.exit(1);
}

async function patch(file, pattern, replacement) {
  const path = ROOT + file;
  const text = await readFile(path, 'utf8');
  if (!pattern.test(text)) {
    console.error(`Could not find the stamp point in ${file}`);
    process.exit(1);
  }
  await writeFile(path, text.replace(pattern, replacement));
  console.log(`stamped ${file}`);
}

await patch('sw.js', /const BUILD_ID = '[^']*';/, `const BUILD_ID = '${ID}';`);
await patch('index.html', /<meta name="build-id" content="[^"]*">/, `<meta name="build-id" content="${ID}">`);
await patch('src/build-id.js', /export const BUILD_ID = '[^']*';/, `export const BUILD_ID = '${ID}';`);

console.log('Build id:', ID);
