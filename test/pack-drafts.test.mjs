import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/idb.js';
import { newPack } from '../src/study/library.js';
import { listPacks, saveDraft, savePack } from '../src/study/store.js';

test('local drafts appear in the library without being saved as synced pack documents', async () => {
  const store = new MemoryStore();
  const pack = newPack({ title: 'Biology cells' });
  await saveDraft({ pack, topics: [], facts: [], edits: {} }, { store });
  assert.deepEqual((await listPacks(store)).map((p) => p.id), [pack.id]);
  assert.equal((await store.getAll('docs')).length, 0);
  await savePack(pack, { store, sync: null });
  assert.deepEqual((await listPacks(store)).map((p) => p.id), [pack.id]);
});
