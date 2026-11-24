// Build the static site for GitHub Pages into ./_site.
//
//   API_BASE=https://your-backend.example/api/v1 node scripts/build-pages.mjs
//
// Copies the runtime files, writes config.json from API_BASE, stamps the build id, and puts the
// security policy into index.html as a meta tag (Pages cannot send response headers).
// No secrets are involved: API_BASE is a public address.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const apiBase = process.env.API_BASE || '';

let origin;
try {
  const url = new URL(apiBase);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('bad');
  origin = url.origin;
} catch {
  console.error('Set API_BASE to an https URL without credentials, query or fragment.');
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) await cp(path.join(root, file), path.join(out, file));
for (const dir of ['icons', 'src', 'styles']) await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
await writeFile(path.join(out, 'config.json'), JSON.stringify({ apiBase }) + '\n');

// Stamp the build id into sw.js, index.html and src/build-id.js, working inside the output folder.
await mkdir(path.join(out, 'scripts'), { recursive: true });
await cp(path.join(root, 'scripts/stamp-build.mjs'), path.join(out, 'scripts/stamp-build.mjs'));
execFileSync('node', ['scripts/stamp-build.mjs'], { cwd: out, stdio: 'inherit' });
await rm(path.join(out, 'scripts'), { recursive: true, force: true });

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${origin}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const indexPath = path.join(out, 'index.html');
const html = await readFile(indexPath, 'utf8');
if (!html.includes('<head>')) throw new Error('index.html has no <head>');
await writeFile(indexPath, html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`));
await writeFile(path.join(out, '.nojekyll'), '');
console.log('Built', out, 'for API', origin);
