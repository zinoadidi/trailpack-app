import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('home quick start opens the study runner, not the completed-bite screen', async () => {
  const source = await readFile(new URL('../src/screens/trail.js', import.meta.url), 'utf8');
  assert.match(source, /href: '#\/study'\s*}\s*,\s*t\('study\.startBite'\)/);
});
