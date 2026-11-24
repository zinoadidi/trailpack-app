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
