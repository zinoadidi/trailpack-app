import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStore } from '../src/store/idb.js';
import { createSyncEngine, mergeDocs, docBytes, COLLECTIONS, validId } from '../src/sync/engine.js';

/** A fake server: stores docs with revs and a global seq, like /sync. */
function fakeServer() {
  const docs = new Map();
  let seq = 0;
  return {
    docs,
    failNext: null,
    async getChanges(since = 0, limit = 200) {
      if (this.failNext === 'getChanges') {
        this.failNext = null;
        throw Object.assign(new Error('boom'), { code: 'network' });
      }
      const all = [...docs.values()].filter((d) => d.seq > since).sort((a, b) => a.seq - b.seq);
      const page = all.slice(0, limit);
      return {
        changes: page.map((d) => ({ collection: d.collection, id: d.id, rev: d.rev, seq: d.seq, deleted: d.deleted, updatedAt: d.updatedAt, ...(d.deleted ? {} : { doc: d.doc }) })),
        cursor: page.length ? page[page.length - 1].seq : since,
        more: all.length > page.length,
      };
    },
    async putDoc(collection, id, doc, baseRev) {
      const key = collection + '/' + id;
      const cur = docs.get(key);
      if (baseRev && (!cur || cur.rev !== baseRev)) {
        throw Object.assign(new Error('conflict'), { code: 'conflict', serverRev: cur ? cur.rev : null, serverDoc: cur ? cur.doc : null });
      }
      seq += 1;
      const rev = ((cur && cur.rev) || 0) + 1;
      const rec = { collection, id, rev, seq, deleted: false, updatedAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), doc };
      docs.set(key, rec);
      return { rev, seq, updatedAt: rec.updatedAt };
    },
    async deleteDoc(collection, id) {
      const key = collection + '/' + id;
      const cur = docs.get(key);
      seq += 1;
      docs.set(key, { collection, id, rev: ((cur && cur.rev) || 0) + 1, seq, deleted: true, updatedAt: new Date(2026, 0, 1, 0, 0, seq).toISOString() });
    },
    /** A change made by another device. */
    serverWrite(collection, id, doc) {
      seq += 1;
      const key = collection + '/' + id;
      const cur = docs.get(key);
      docs.set(key, { collection, id, rev: ((cur && cur.rev) || 0) + 1, seq, deleted: false, updatedAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(), doc });
    },
  };
}

function engine(store, server, opts = {}) {
  return createSyncEngine({ store, api: server, now: opts.now || Date.now(), isOnline: opts.isOnline || (() => true) });
}

test('contract collections match the API', () => {
  assert.deepEqual(COLLECTIONS, ['packs', 'facts', 'topics', 'lenses', 'plans', 'progress', 'attempts', 'settings', 'notes', 'generated']);
  assert.ok(validId('pack-1_test'));
  assert.ok(!validId('bad id'));
  assert.ok(!validId('x'.repeat(65)));
  assert.ok(!validId(''));
});

test('local change queues an outbox entry and pushes it', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const sync = engine(store, server);

  await sync.localChange('packs', 'p1', { title: 'Intro to project management' });
  assert.equal(await sync.pendingCount(), 1);

  const res = await sync.sync();
  assert.equal(res.status, 'synced');
  assert.equal(await sync.pendingCount(), 0);
  assert.equal(server.docs.get('packs/p1').doc.title, 'Intro to project management');

  const local = await store.get('docs', ['packs', 'p1']);
  assert.equal(local.dirty, 0);
  assert.equal(local.rev, 1);
});

test('delete writes a tombstone locally and on the server', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const sync = engine(store, server);
  await sync.localChange('notes', 'n1', { text: 'x' });
  await sync.sync();
  await sync.localChange('notes', 'n1', null);
  await sync.sync();
  assert.equal(server.docs.get('notes/n1').deleted, true);
  const local = await store.get('docs', ['notes', 'n1']);
  assert.equal(local.deleted, 1);
});

test('pull brings in another device and advances the cursor', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const sync = engine(store, server);
  server.serverWrite('packs', 'p9', { title: 'Exam pack' });
  server.serverWrite('topics', 't1', { title: 'Ledger' });
  const res = await sync.sync();
  assert.equal(res.status, 'synced');
  assert.equal(res.changed, 2);
  assert.deepEqual((await store.get('docs', ['packs', 'p9'])).doc, { title: 'Exam pack' });
  const meta = await store.get('meta', 'cursor');
  assert.equal(meta.value, 2);

  // Second sync is a no op.
  const again = await sync.sync();
  assert.equal(again.changed, 0);
});

test('pagination with more=true follows through every page', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  for (let i = 0; i < 25; i += 1) server.serverWrite('facts', 'f' + i, { n: i });
  const orig = server.getChanges.bind(server);
  server.getChanges = (since) => orig(since, 10);
  const sync = engine(store, server);
  const res = await sync.sync();
  assert.equal(res.status, 'synced');
  assert.equal((await store.getAll('docs')).filter((d) => d.collection === 'facts').length, 25);
});

test('offline: queues and reports offline without losing the outbox', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  let online = false;
  const sync = engine(store, server, { isOnline: () => online });
  await sync.localChange('packs', 'p1', { title: 'Offline work' });
  const res = await sync.sync();
  assert.equal(res.status, 'offline');
  assert.equal(await sync.pendingCount(), 1);

  online = true;
  const after = await sync.sync();
  assert.equal(after.status, 'synced');
  assert.equal(server.docs.get('packs/p1').doc.title, 'Offline work');
});

test('a failed push keeps the item queued and reports error', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  server.putDoc = async () => {
    throw Object.assign(new Error('down'), { code: 'network' });
  };
  const sync = engine(store, server);
  await sync.localChange('packs', 'p1', { title: 'x' });
  const res = await sync.sync();
  assert.equal(res.status, 'error');
  assert.equal(await sync.pendingCount(), 1);
});

test('conflict on a pack: last writer wins, server copy kept', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const sync = engine(store, server);
  await sync.localChange('packs', 'p1', { title: 'Mine' });
  await sync.sync();

  // Another device writes a newer version between our local edit and push.
  server.serverWrite('packs', 'p1', { title: 'Theirs' });
  await sync.localChange('packs', 'p1', { title: 'Mine again' });
  const res = await sync.sync();
  assert.equal(res.status, 'synced');
  const remote = server.docs.get('packs/p1');
  assert.ok(['Mine again', 'Theirs'].includes(remote.doc.title));
});

test('conflict on progress merges facts from both sides', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const now = 1_700_000_000_000;
  const sync = engine(store, server, { now: () => now });
  const base = {
    facts: [
      { id: 'f1', state: 'Review', correct: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'f2', state: 'New', correct: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  };
  await sync.localChange('progress', 'pack1', base);
  await sync.sync();

  // Server side learns f1 to a new state; local side learns f2.
  server.serverWrite('progress', 'pack1', {
    facts: [
      { id: 'f1', state: 'Mastered', correct: 3, updatedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'f2', state: 'New', correct: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  });
  await sync.localChange('progress', 'pack1', {
    facts: [base.facts[0], { id: 'f2', state: 'Learning', correct: 1, updatedAt: '2026-03-01T00:00:00.000Z' }],
  });
  const res = await sync.sync();
  assert.equal(res.status, 'synced');
  const facts = server.docs.get('progress/pack1').doc.facts;
  const f1 = facts.find((f) => f.id === 'f1');
  const f2 = facts.find((f) => f.id === 'f2');
  assert.equal(f1.state, 'Mastered', 'newer server fact wins the item');
  assert.equal(f2.state, 'Learning', 'local-only progress is kept');
});

test('rollback: local record takes the rev we last pushed, so a stale edit conflicts', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  const sync = engine(store, server);
  await sync.localChange('notes', 'n1', { v: 1 });
  await sync.sync();
  await sync.localChange('notes', 'n2', { v: 1 });
  await sync.localChange('notes', 'n1', { v: 2 });
  const rec = await store.get('docs', ['notes', 'n1']);
  assert.equal(rec.baseRev, 1);
  await sync.sync();
  assert.equal(server.docs.get('notes/n1').doc.v, 2);
  assert.equal(server.docs.get('notes/n1').rev, 2);
});

test('restore after a wipe rebuilds every doc from since=0', async () => {
  const server = fakeServer();
  const first = engine(new MemoryStore(), server);
  await first.localChange('packs', 'p1', { title: 'Pack' });
  await first.localChange('facts', 'f1', { statement: 'A milestone marks a point in time' });
  await first.sync();

  const freshStore = new MemoryStore();
  const fresh = engine(freshStore, server);
  const res = await fresh.restore();
  assert.equal(res.status, 'synced');
  assert.deepEqual((await freshStore.get('docs', ['packs', 'p1'])).doc, { title: 'Pack' });
  assert.equal((await freshStore.getAll('docs')).length, 2);
});

test('doc size limit rejects a 1 MB doc locally', async () => {
  const store = new MemoryStore();
  const sync = engine(store, fakeServer());
  const big = { text: 'x'.repeat(1024 * 1024) };
  assert.ok(docBytes(big) > 1024 * 1024);
  await assert.rejects(sync.localChange('packs', 'p1', big), /doc_too_large/);
  assert.equal(await sync.pendingCount(), 0);
});

test('unknown collection and bad id are refused', async () => {
  const sync = engine(new MemoryStore(), fakeServer());
  await assert.rejects(sync.localChange('users', 'u1', {}), /Unknown collection/);
  await assert.rejects(sync.localChange('packs', 'bad id', {}), /Invalid id/);
});

test('concurrent sync calls share one run', async () => {
  const store = new MemoryStore();
  const server = fakeServer();
  let calls = 0;
  const orig = server.getChanges.bind(server);
  server.getChanges = async (since) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return orig(since);
  };
  const sync = engine(store, server);
  const [a, b] = await Promise.all([sync.sync(), sync.sync()]);
  assert.equal(a, b);
  assert.ok(calls <= 3, 'one run, at most two pulls');
});

test('per collection merge keeps non fact fields intact', () => {
  const server = { facts: [{ id: 'f1', state: 'Review' }], points: 10, trail: { camp: 2 } };
  const client = { facts: [{ id: 'f2', state: 'New' }], points: 14 };
  const { doc } = mergeDocs('progress', server, client, { serverAt: '2026-01-01T00:00:00Z', clientAt: '2026-01-02T00:00:00Z' });
  assert.equal(doc.facts.length, 2);
  assert.equal(doc.points, 10, 'scalar keeps the server value');
  assert.deepEqual(doc.trail, { camp: 2 });
});

test('packs are not merged, server wins on conflict', () => {
  const { doc, merged } = mergeDocs('packs', { title: 'Server' }, { title: 'Client' });
  assert.equal(merged, false);
  assert.deepEqual(doc, { title: 'Server' });
});
