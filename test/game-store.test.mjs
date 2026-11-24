import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStore } from '../src/store/idb.js';
import { PROFILE_COLLECTION, PROFILE_ID, loadLenses, loadProfile, mergeRemoteProfile, pickActiveLens, saveLens, saveProfile } from '../src/game/store.js';
import { emptyProfile, stepDone } from '../src/game/profile.js';

/**
 * A stand-in for the sync engine. The real `localChange` writes the doc and
 * queues the outbox entry, so the fake does the same, and records the calls.
 */
function fakeSync(store) {
  const queued = [];
  return {
    queued,
    async localChange(collection, id, doc) {
      await store.put('docs', { collection, id, doc });
      queued.push({ collection, id, doc });
      return { collection, id, doc };
    },
  };
}

test('a fresh device has an empty profile', async () => {
  const store = new MemoryStore();
  const profile = await loadProfile(store);
  assert.equal(profile.points, 0);
  assert.deepEqual(await loadLenses(store), []);
  const fallback = await loadProfile(null);
  assert.equal(fallback.points, 0, 'no store, still a usable profile');
});

test('saving the profile queues it with the sync engine', async () => {
  const store = new MemoryStore();
  const sync = fakeSync(store);
  const next = stepDone(emptyProfile(), { points: 15, when: new Date(2026, 0, 2) }).profile;
  await saveProfile(store, sync, next);
  assert.equal(sync.queued.length, 1);
  assert.equal(sync.queued[0].collection, PROFILE_COLLECTION);
  assert.equal(sync.queued[0].id, PROFILE_ID);
  const back = await loadProfile(store);
  assert.equal(back.points, 15);
});

test('saving without a sync engine still writes locally', async () => {
  const store = new MemoryStore();
  await saveProfile(store, null, { ...emptyProfile(), points: 42 });
  assert.equal((await loadProfile(store)).points, 42);
});

test('a corrupt profile doc loads as a fresh profile', async () => {
  const store = new MemoryStore();
  await store.put('docs', { collection: PROFILE_COLLECTION, id: PROFILE_ID, doc: 'not an object' });
  const profile = await loadProfile(store);
  assert.equal(profile.points, 0);
});

test('merging a remote copy never lowers points', async () => {
  const store = new MemoryStore();
  await saveProfile(store, null, { ...emptyProfile(), points: 300 });
  const merged = await mergeRemoteProfile(store, { points: 120 });
  assert.equal(merged.points, 300);
});

test('Lenses round trip and keep a sync safe id', async () => {
  const store = new MemoryStore();
  const sync = fakeSync(store);
  await saveLens(store, sync, { id: 'oral-exam', title: 'Oral exam', difficulty: 'hard' });
  const lenses = await loadLenses(store);
  assert.equal(lenses.length, 1);
  assert.equal(lenses[0].id, 'oral-exam');
  assert.equal(sync.queued[0].collection, 'lenses');
  await saveLens(store, null, { id: 'bad id with spaces', title: 'x' });
  const after = await loadLenses(store);
  assert.deepEqual(after.map((l) => l.id).sort(), ['default', 'oral-exam']);
});

test('a deleted Lens is not listed', async () => {
  const store = new MemoryStore();
  await saveLens(store, null, { id: 'gone', title: 'Gone' });
  await store.put('docs', { collection: 'lenses', id: 'gone', doc: { id: 'gone' }, deleted: 1 });
  assert.deepEqual(await loadLenses(store), []);
});

test('the active Lens is the preferred one, else the first', () => {
  const lenses = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  assert.equal(pickActiveLens(lenses, 'b').id, 'b');
  assert.equal(pickActiveLens(lenses, 'zzz').id, 'a');
  assert.equal(pickActiveLens([]), null);
});
