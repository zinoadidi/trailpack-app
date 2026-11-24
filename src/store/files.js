// Local file store with the low-space policy: files download on demand, and
// when space is tight the cached blobs are evicted (docs are kept) and
// re-fetched when needed. Storage numbers come from navigator.storage.

export function estimateStorage(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || !nav.storage || !nav.storage.estimate) return Promise.resolve({ usage: 0, quota: 0 });
  return nav.storage.estimate().then((e) => ({ usage: e.usage || 0, quota: e.quota || 0 }));
}

export async function requestPersist(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || !nav.storage) return false;
  try {
    if (nav.storage.persisted && (await nav.storage.persisted())) return true;
    if (nav.storage.persist) return await nav.storage.persist();
  } catch {
    return false;
  }
  return false;
}

/** Space is tight when less than the threshold or less than 10% remains. */
export function isTight({ usage, quota }, thresholdBytes = 50 * 1024 * 1024) {
  if (!quota) return false;
  const free = quota - usage;
  return free < thresholdBytes || free / quota < 0.1;
}

export function createFileStore({ store, api }) {
  let inflight = new Map();

  async function cached(id) {
    const row = await store.get('files', id);
    return row && row.blob ? row : null;
  }

  async function save(id, blob, meta = {}) {
    const row = { id, name: meta.name || id, type: meta.type || blob.type || '', size: blob.size, updatedAt: Date.now(), blob };
    await store.put('files', row);
    return row;
  }

  /** Get a file blob, downloading it once if it is not cached. */
  async function ensure(id, meta = {}) {
    const hit = await cached(id);
    if (hit) return hit.blob;
    if (inflight.has(id)) return inflight.get(id);
    const job = (async () => {
      const res = await api.getFile(id);
      const blob = res instanceof Response ? await res.blob() : new Blob([res], { type: meta.type });
      await save(id, blob, meta);
      return blob;
    })().finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }

  /** Evict file blobs to make room, oldest first. Docs are never touched. */
  async function evict(needBytes = 0) {
    const rows = await store.getAll('files');
    rows.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    let freed = 0;
    for (const row of rows) {
      if (needBytes && freed >= needBytes) break;
      freed += row.size || 0;
      await store.put('files', { ...row, blob: null, evictedAt: Date.now() });
    }
    return freed;
  }

  /**
   * Call after any download. Returns the new storage reading and whether files
   * were evicted, so the UI can show a calm note.
   */
  async function checkSpace() {
    const reading = await estimateStorage();
    if (isTight(reading)) {
      const freed = await evict(Math.max(0, (reading.quota || 0) - (reading.usage || 0)) * -1 + 20 * 1024 * 1024);
      return { ...reading, evicted: freed, low: true };
    }
    return { ...reading, evicted: 0, low: false };
  }

  return { ensure, save, cached, evict, checkSpace };
}
