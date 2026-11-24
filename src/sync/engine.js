// The sync client: outbox, pull, conflict merge and restore.
// Everything here is transport agnostic: pass an `api` object with the sync
// methods from client.js (or a fake in tests). No DOM, no network of its own.

export const COLLECTIONS = [
  'packs',
  'facts',
  'topics',
  'lenses',
  'plans',
  'progress',
  'attempts',
  'settings',
  'notes',
  'generated',
];

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const DOC_LIMIT_BYTES = 1024 * 1024;

/** Collections merged per fact or id when both sides changed. */
export const FACT_MERGE = new Set(['progress', 'attempts']);

// ---------------------------------------------------------------- doc helpers

export function validId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function docBytes(doc) {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/** Local record shape stored in `docs`. */
export function localDoc(collection, id, doc, rev) {
  return { collection, id, doc, rev: rev ?? null, deleted: 0, seq: null, updatedAt: Date.now(), dirty: 1 };
}

// ---------------------------------------------------------------- merge rules

function byId(list) {
  const m = new Map();
  for (const item of list || []) {
    if (item && item.id !== undefined) m.set(item.id, item);
  }
  return m;
}

/**
 * Merge one item from each side. `serverAt` / `clientAt` are ISO dates used as
 * the tie breaker. The newer entry wins whole; ids that only one side has are
 * kept, so work is never lost.
 */
function mergeListByItem(serverList, clientList, serverAt, clientAt) {
  const a = byId(serverList);
  const b = byId(clientList);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const out = [];
  for (const id of ids) {
    const s = a.get(id);
    const c = b.get(id);
    if (s && !c) out.push(s);
    else if (!s && c) out.push(c);
    else {
      const ts = Date.parse(s.updatedAt || s.at || serverAt || 0) || 0;
      const tc = Date.parse(c.updatedAt || c.at || clientAt || 0) || 0;
      out.push(tc > ts ? c : s);
    }
  }
  return out;
}

/**
 * Per collection merge. Packs (and everything else) are last writer wins on the
 * whole doc; progress and attempts keep both sides' facts by id.
 *
 * @returns {{doc: object, merged: boolean, winner: 'server'|'client'}}
 */
export function mergeDocs(collection, server, client, { serverAt, clientAt } = {}) {
  if (!FACT_MERGE.has(collection)) return { doc: server, merged: false, winner: 'server' };
  const base = { ...(server || {}) };
  for (const [key, value] of Object.entries(client || {})) {
    if (Array.isArray(value) && Array.isArray(base[key])) {
      base[key] = mergeListByItem(base[key], value, serverAt, clientAt);
    } else if (base[key] === undefined || JSON.stringify(base[key]) !== JSON.stringify(value)) {
      // A fact level field that only the client has (for example a new counter)
      // is kept unless the server has a newer scalar of the same name.
      if (base[key] === undefined) base[key] = value;
    }
  }
  return { doc: base, merged: true, winner: 'merged' };
}

// ---------------------------------------------------------------- the engine

/**
 * @param {object} opts
 * @param {object} opts.store     IdbStore or MemoryStore
 * @param {object} opts.api       sync methods: getChanges, putDoc, deleteDoc
 * @param {() => boolean} [opts.isOnline]
 * @param {() => number} [opts.now]
 * @param {(event: object) => void} [opts.onStatus]
 */
export function createSyncEngine({ store, api, isOnline = () => true, now: clock, onStatus = () => {} }) {
  const now = typeof clock === 'function' ? clock : () => Date.now();
  let status = 'idle';
  let running = null;
  let lastError = null;
  let lastSyncAt = null;

  function setStatus(next, extra = {}) {
    status = next;
    onStatus({ status, lastError, lastSyncAt, ...extra });
  }

  async function getMeta(key, fallback = null) {
    const row = await store.get('meta', key);
    return row ? row.value : fallback;
  }

  async function setMeta(key, value) {
    await store.put('meta', { key, value });
  }

  /** Queue a local change. doc === null means a delete. */
  async function localChange(collection, id, doc) {
    if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection ' + collection);
    if (!validId(id)) throw new Error('Invalid id ' + id);
    if (doc !== null && docBytes(doc) > DOC_LIMIT_BYTES) {
      throw new Error('doc_too_large');
    }
    const existing = await store.get('docs', [collection, id]);
    const baseRev = existing && existing.dirty ? existing.baseRev : existing ? existing.rev : null;
    const record = {
      collection,
      id,
      doc: doc === null ? null : doc,
      rev: existing ? existing.rev : null,
      baseRev: baseRev ?? null,
      deleted: doc === null ? 1 : 0,
      seq: existing ? existing.seq : null,
      updatedAt: now(),
      dirty: 1,
    };
    await store.put('docs', record);
    await store.put('outbox', { collection, id, queuedAt: now() });
    return record;
  }

  async function pendingCount() {
    return (await store.getAllKeys('outbox')).length;
  }

  async function applyServerChange(change) {
    const { collection, id, rev, seq, deleted, updatedAt, doc } = change;
    const local = await store.get('docs', [collection, id]);
    const queued = await store.get('outbox', [collection, id]);
    if (queued) {
      // Both sides changed: merge instead of clobbering local edits.
      const serverDoc = deleted ? null : doc;
      const clientDoc = local && !local.deleted ? local.doc : null;
      const { doc: merged } = mergeDocs(collection, serverDoc, clientDoc, {
        serverAt: updatedAt,
        clientAt: local && local.updatedAt ? new Date(local.updatedAt).toISOString() : null,
      });
      if (merged !== null) {
        await store.put('docs', {
          ...(local || { collection, id }),
          collection,
          id,
          doc: merged,
          rev,
          baseRev: rev,
          deleted: 0,
          seq,
          updatedAt: now(),
          dirty: 1,
        });
        await store.put('outbox', { collection, id, queuedAt: now() });
      }
      return;
    }
    await store.put('docs', {
      collection,
      id,
      doc: deleted ? null : doc,
      rev,
      baseRev: rev,
      deleted: deleted ? 1 : 0,
      seq,
      updatedAt: now(),
      dirty: 0,
    });
  }

  async function pushOutbox() {
    const keys = await store.getAllKeys('outbox');
    const results = { pushed: 0, conflicts: 0, failed: 0 };
    for (const key of keys) {
      const [collection, id] = key;
      const rec = await store.get('docs', [collection, id]);
      if (!rec) {
        await store.delete('outbox', [collection, id]);
        continue;
      }
      try {
        if (rec.deleted) {
          await api.deleteDoc(collection, id);
          await store.put('docs', { ...rec, rev: null, dirty: 0, deleted: 1 });
          await store.delete('outbox', [collection, id]);
        } else {
          const out = await api.putDoc(collection, id, rec.doc, rec.baseRev ?? undefined);
          await store.put('docs', { ...rec, rev: out.rev, baseRev: out.rev, seq: out.seq, dirty: 0 });
          await store.delete('outbox', [collection, id]);
        }
        results.pushed += 1;
      } catch (err) {
        if (err && err.code === 'conflict') {
          results.conflicts += 1;
          const serverDoc = err.serverDoc ?? null;
          const { doc: merged } = mergeDocs(collection, serverDoc, rec.doc, {
            serverAt: err.serverUpdatedAt || null,
            clientAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
          });
          await store.put('docs', { ...rec, doc: merged, rev: err.serverRev, baseRev: err.serverRev, dirty: 1 });
          // Leave it queued so the merged doc is pushed on the next pass.
        } else {
          results.failed += 1;
          throw err;
        }
      }
    }
    return results;
  }

  async function pullChanges({ reset = false } = {}) {
    let cursor = reset ? 0 : (await getMeta('cursor', 0)) || 0;
    let changed = 0;
    let more = true;
    let guard = 0;
    while (more && guard < 200) {
      guard += 1;
      const page = await api.getChanges(cursor);
      for (const change of page.changes || []) {
        await applyServerChange(change);
        changed += 1;
      }
      cursor = page.cursor ?? cursor;
      more = Boolean(page.more);
    }
    await setMeta('cursor', cursor);
    return { changed, cursor, complete: !more };
  }

  async function syncOnce({ reset = false } = {}) {
    if (!isOnline()) {
      setStatus('offline');
      return { status: 'offline' };
    }
    setStatus(reset ? 'syncing' : 'syncing', { restoring: reset });
    try {
      const pulled = await pullChanges({ reset });
      const pushed = await pushOutbox();
      // A second pull gets anything this device just pushed.
      const pulledAgain = await pullChanges();
      lastSyncAt = now();
      await setMeta('lastSyncAt', lastSyncAt);
      await setMeta('lastError', null);
      lastError = null;
      setStatus('synced', { changed: pulled.changed + pushed.pushed + pulledAgain.changed });
      return { status: 'synced', ...pulled, pushed, pullComplete: pulled.complete && pulledAgain.complete, changed: pulled.changed + pulledAgain.changed };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      await setMeta('lastError', lastError);
      setStatus(isOnline() ? 'error' : 'offline', { error: lastError });
      return { status: 'error', error: lastError };
    }
  }

  function sync(opts) {
    if (running) return running;
    running = syncOnce(opts).finally(() => {
      running = null;
    });
    return running;
  }

  /** Restore after a wipe or first sign in on this device. */
  async function restore() {
    await setMeta('cursor', 0);
    return sync({ reset: true });
  }

  async function hydrate() {
    lastSyncAt = await getMeta('lastSyncAt', null);
    lastError = await getMeta('lastError', null);
    setStatus(isOnline() ? 'idle' : 'offline');
  }

  return {
    localChange,
    sync,
    restore,
    hydrate,
    pendingCount,
    pullChanges,
    pushOutbox,
    getStatus: () => status,
    getLastSyncAt: () => lastSyncAt,
    getLastError: () => lastError,
  };
}
