import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32, zipStore } from '../src/export/zip.js';
import { SOUNDS, isSoundOn, play, setSoundOn } from '../src/game/sfx.js';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zipStore builds a valid archive that the unzip tool accepts', () => {
  const bytes = zipStore([
    { name: 'guide.md', data: '# Study guide\n\nÅtom ja side.' },
    { name: 'cards/anki.txt', data: 'front\tback\n' },
  ]);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  try {
    const file = join(dir, 'pack.zip');
    writeFileSync(file, bytes);
    let out = '';
    try {
      out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    } catch (e) {
      if (e.code === 'ENOENT') return; // no unzip tool on this machine
      throw e;
    }
    assert.match(out, /No errors detected/);
    assert.match(out, /guide\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sound is off until switched on, and unknown sounds are ignored', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const made = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator: () => ({ frequency: { setValueAtTime() {} }, connect() {}, start() { made.push('o'); }, stop() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
  };
  assert.equal(isSoundOn(storage), false);
  assert.equal(play('correct', { ctx, storage }), false);
  setSoundOn(true, storage);
  assert.equal(play('correct', { ctx, storage }), true);
  assert.equal(made.length, SOUNDS.correct.length);
  assert.equal(play('nope', { ctx, storage }), false);
  setSoundOn(false, storage);
  assert.equal(play('correct', { ctx, storage }), false);
});
