// Minimal IndexedDB wrapper. No dependencies.
// Stores:
//   docs     keyPath [collection, id]   plus index "collection"
//   outbox   keyPath [collection, id]   pending pushes
//   meta     keyPath key                cursors, settings, tokens
//   files    keyPath id                 {id, name, type, size, updatedAt, blob}

export const DB_NAME = 'trailpack';
export const DB_VERSION = 1;
export const STORES = ['docs', 'outbox', 'meta', 'files'];

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function sameValue(left, right) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => `${a.collection}\u0000${a.id}`.localeCompare(`${b.collection}\u0000${b.id}`));
}

function tombstone(row) {
  return { ...row, doc: null, deleted: 1, dirty: 1, baseRev: row.dirty ? row.baseRev ?? null : row.rev ?? null, updatedAt: Date.now() };
}

export function openDatabase(factory = globalThis.indexedDB, name = DB_NAME) {
  if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('docs')) {
      const docs = db.createObjectStore('docs', { keyPath: ['collection', 'id'] });
      docs.createIndex('collection', 'collection');
    }
    if (!db.objectStoreNames.contains('outbox')) {
      db.createObjectStore('outbox', { keyPath: ['collection', 'id'] });
    }
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('files')) {
      db.createObjectStore('files', { keyPath: 'id' });
    }
  };
  return new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export class IdbStore {
  constructor(db) {
    this.db = db;
  }

  static async open(name = DB_NAME) {
    const db = await openDatabase(globalThis.indexedDB, name);
    return new IdbStore(db);
  }

  async get(store, key) {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).get(key));
  }

  async put(store, value) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    return txDone(tx);
  }

  async getOrCreateMeta(key, value) {
    const tx = this.db.transaction('meta', 'readwrite');
    const done = txDone(tx);
    const target = tx.objectStore('meta');
    const existing = await req(target.get(key));
    if (existing === undefined) target.add({ key, value });
    await done;
    return existing === undefined ? value : existing.value;
  }

  async keepReplacement(oldId) {
    const tx = this.db.transaction('meta', 'readwrite');
    const done = txDone(tx);
    const meta = tx.objectStore('meta');
    const row = await req(meta.get('replacement-' + oldId));
    const allowed = row?.value?.state === 'complete' && row.value.choice === 'pending';
    if (allowed) meta.delete('replacement-' + oldId);
    await done;
    return Boolean(allowed);
  }

  async finalizeReplacementDraft(oldId, draft, journal) {
    const tx = this.db.transaction('meta', 'readwrite');
    const done = txDone(tx);
    const target = tx.objectStore('meta');
    const saved = await req(target.get('draft-' + oldId));
    const current = await req(target.get('replacement-' + oldId));
    if (current?.value?.state === 'complete' && current.value.packId === journal.packId) {
      await done;
      return true;
    }
    if (!saved || !sameValue(saved.value, draft)) {
      await done;
      return false;
    }
    target.put({ key: 'active-pack-id', value: journal.packId });
    target.delete('draft-' + oldId);
    target.put({ key: 'replacement-' + oldId, value: { ...journal, state: 'complete' } });
    await done;
    return true;
  }

  async commitReplacementDeletion(journal, expectedDocs, expectedOutbox, targets) {
    const tx = this.db.transaction(['docs', 'outbox', 'meta'], 'readwrite');
    const done = txDone(tx);
    const docs = tx.objectStore('docs');
    const outbox = tx.objectStore('outbox');
    const meta = tx.objectStore('meta');
    const [currentDocs, currentOutbox, currentJournal, active] = await Promise.all([
      req(docs.getAll()), req(outbox.getAll()), req(meta.get('replacement-' + journal.oldPackId)), req(meta.get('active-pack-id')),
    ]);
    if (!sameValue(sortedRows(currentDocs), sortedRows(expectedDocs)) ||
        !sameValue(sortedRows(currentOutbox), sortedRows(expectedOutbox)) ||
        !sameValue(currentJournal?.value, journal)) {
      await done;
      return false;
    }
    const byKey = new Map(currentDocs.map((row) => [row.collection + '\u0000' + row.id, row]));
    for (const [collection, id] of targets) {
      const row = byKey.get(collection + '\u0000' + id);
      docs.put(tombstone(row));
      outbox.put({ collection, id, queuedAt: Date.now() });
    }
    if (active?.value === journal.oldPackId) meta.put({ key: 'active-pack-id', value: journal.packId });
    meta.put({ key: 'replacement-' + journal.oldPackId, value: { ...journal, choice: 'deleted' } });
    await done;
    return true;
  }

  async delete(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    return txDone(tx);
  }

  async getAll(store, indexName, query) {
    const tx = this.db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const target = indexName ? objectStore.index(indexName) : objectStore;
    return req(query === undefined ? target.getAll() : target.getAll(query));
  }

  async getAllKeys(store, indexName, query) {
    const tx = this.db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const target = indexName ? objectStore.index(indexName) : objectStore;
    return req(query === undefined ? target.getAllKeys() : target.getAllKeys(query));
  }

  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    return txDone(tx);
  }

  /** Wipe every store in one transaction. */
  async wipe() {
    const tx = this.db.transaction(STORES, 'readwrite');
    for (const name of STORES) tx.objectStore(name).clear();
    return txDone(tx);
  }
}

/**
 * In memory store with the same shape as IdbStore, for tests and for browsers
 * without IndexedDB (the app then works for the session only and says so).
 */
export class MemoryStore {
  constructor() {
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  }

  static key(store, key) {
    return store === 'docs' || store === 'outbox' ? `${key[0]}\u0000${key[1]}` : String(key);
  }

  async get(store, key) {
    const v = this.data[store].get(MemoryStore.key(store, key));
    return v === undefined ? undefined : structuredClone(v);
  }

  async put(store, value) {
    const key = store === 'docs' || store === 'outbox' ? [value.collection, value.id] : value.key ?? value.id;
    this.data[store].set(MemoryStore.key(store, key), structuredClone(value));
  }

  async getOrCreateMeta(key, value) {
    const existing = this.data.meta.get(String(key));
    if (existing !== undefined) return structuredClone(existing.value);
    this.data.meta.set(String(key), structuredClone({ key, value }));
    return structuredClone(value);
  }

  async keepReplacement(oldId) {
    const key = 'replacement-' + oldId;
    const row = this.data.meta.get(key);
    if (row?.value?.state !== 'complete' || row.value.choice !== 'pending') return false;
    this.data.meta.delete(key);
    return true;
  }

  async finalizeReplacementDraft(oldId, draft, journal) {
    const saved = this.data.meta.get('draft-' + oldId);
    const current = this.data.meta.get('replacement-' + oldId);
    if (current?.value?.state === 'complete' && current.value.packId === journal.packId) return true;
    if (!saved || !sameValue(saved.value, draft)) return false;
    this.data.meta.set('active-pack-id', structuredClone({ key: 'active-pack-id', value: journal.packId }));
    this.data.meta.delete('draft-' + oldId);
    this.data.meta.set('replacement-' + oldId, structuredClone({ key: 'replacement-' + oldId, value: { ...journal, state: 'complete' } }));
    return true;
  }

  async commitReplacementDeletion(journal, expectedDocs, expectedOutbox, targets) {
    const currentJournal = this.data.meta.get('replacement-' + journal.oldPackId);
    if (!sameValue(sortedRows([...this.data.docs.values()]), sortedRows(expectedDocs)) ||
        !sameValue(sortedRows([...this.data.outbox.values()]), sortedRows(expectedOutbox)) ||
        !sameValue(currentJournal?.value, journal)) return false;
    for (const [collection, id] of targets) {
      const key = MemoryStore.key('docs', [collection, id]);
      this.data.docs.set(key, structuredClone(tombstone(this.data.docs.get(key))));
      this.data.outbox.set(key, { collection, id, queuedAt: Date.now() });
    }
    if (this.data.meta.get('active-pack-id')?.value === journal.oldPackId) {
      this.data.meta.set('active-pack-id', { key: 'active-pack-id', value: journal.packId });
    }
    this.data.meta.set('replacement-' + journal.oldPackId, structuredClone({ key: 'replacement-' + journal.oldPackId, value: { ...journal, choice: 'deleted' } }));
    return true;
  }

  async delete(store, key) {
    this.data[store].delete(MemoryStore.key(store, key));
  }

  async getAll(store, indexName, query) {
    let all = [...this.data[store].values()];
    if (indexName && query !== undefined) all = all.filter((v) => v[indexName] === query);
    return structuredClone(all);
  }

  async getAllKeys(store, indexName, query) {
    let all = [...this.data[store].values()];
    if (indexName && query !== undefined) all = all.filter((v) => v[indexName] === query);
    if (store === 'docs' || store === 'outbox') return all.map((v) => [v.collection, v.id]);
    return all.map((v) => v.key ?? v.id);
  }

  async clear(store) {
    this.data[store].clear();
  }

  async wipe() {
    for (const s of STORES) this.data[s].clear();
  }
}
