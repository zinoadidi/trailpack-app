// Parse every module the browser loads, and resolve every relative import, so
// a broken path or a syntax error fails `npm test` instead of the app.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);

test('every src module has valid JavaScript syntax', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const module = new vm.SourceTextModule(source, { identifier: file });
    assert.ok(module, path.relative(ROOT, file));
  }
});

test('every relative import points at a file that exists', async () => {
  const pattern = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const spec = match[1] || match[2];
      if (!spec || !spec.startsWith('.')) continue;
      const clean = spec.split('?')[0];
      const resolved = path.resolve(path.dirname(file), clean);
      await assert.doesNotReject(access(resolved), `${path.relative(ROOT, file)} imports missing ${spec}`);
    }
  }
});

test('the screen routes main.js registers all resolve', async () => {
  const main = await readFile(path.join(ROOT, 'main.js'), 'utf8');
  const routes = [...main.matchAll(/'(\/[^']*)':\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g)];
  assert.ok(routes.length >= 10);
  for (const [, route, target] of routes) {
    await assert.doesNotReject(access(path.join(ROOT, target)), `route ${route} points at ${target}`);
  }
});

test('every named import of a src module is exported by it', async () => {
  // A typo like `import { newLevels } from './wire-run.js'` must fail here, not
  // in the browser as a broken screen.
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const names = match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const target = path.resolve(path.dirname(file), match[2].split('?')[0]);
      const targetSource = await readFile(target, 'utf8');
      for (const name of names) {
        const pattern = new RegExp('export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+' + name + '\\b|export\\s*\\{[^}]*\\b' + name + '\\b');
        assert.ok(pattern.test(targetSource), path.relative(ROOT, file) + ' imports ' + name + ' but ' + path.basename(target) + ' does not export it');
      }
    }
  }
});
