import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (/\.(js|json)$/.test(entry.name)) result.push(`./${path}`);
  }
  return result;
}

test('all app modules and locales are available after service-worker installation', async () => {
  const source = await readFile('sw.js', 'utf8');
  const context = { self: { addEventListener() {} } };
  const assets = vm.runInNewContext(source + '\nSHELL;', context);
  const missing = (await sourceFiles('src')).filter((path) => !assets.includes(path));
  assert.deepEqual(missing, []);
});
