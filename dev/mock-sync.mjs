// Sync routes: docs, changes, files, usage and export.

import { HttpError, send } from './mock-lib.mjs';
import { COLLECTIONS } from './mock-data.mjs';

const MAX_DOC_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const QUOTA_BYTES = 300 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function userDocs(data, userId) {
  let map = data.docs.get(userId);
  if (!map) {
    map = new Map();
    data.docs.set(userId, map);
  }
  return map;
}

function checkCollection(collection) {
  if (!COLLECTIONS.includes(collection)) throw new HttpError(404, 'not_found');
}

export async function handleChanges(data, user, res, url) {
  const since = Number(url.searchParams.get('since') || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 200)));
  const all = [...userDocs(data, user.id).values()]
    .filter((d) => d.seq > since)
    .sort((a, b) => a.seq - b.seq);
  const page = all.slice(0, limit);
  const changes = page.map((d) => ({
    collection: d.collection,
    id: d.id,
    rev: d.rev,
    seq: d.seq,
    deleted: d.deleted ? 1 : 0,
    updatedAt: d.updatedAt,
    ...(d.deleted ? {} : { doc: d.doc }),
  }));
  const cursor = page.length ? page[page.length - 1].seq : since;
  send(res, 200, { changes, cursor, more: all.length > page.length });
}

export async function handleGetDoc(data, user, res, collection, id) {
  checkCollection(collection);
  const doc = userDocs(data, user.id).get(collection + '/' + id);
  if (!doc || doc.deleted) throw new HttpError(404, 'not_found');
  send(res, 200, { id, rev: doc.rev, seq: doc.seq, updatedAt: doc.updatedAt, doc: doc.doc });
}

export async function handlePutDoc(data, user, res, collection, id, body) {
  checkCollection(collection);
  if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id');
  const bytes = JSON.stringify(body.doc ?? null).length;
  if (bytes > MAX_DOC_BYTES) throw new HttpError(413, 'doc_too_large');
  const store = userDocs(data, user.id);
  const key = collection + '/' + id;
  const existing = store.get(key);
  if (body.baseRev && existing && existing.rev !== body.baseRev) {
    send(res, 409, { error: 'conflict', serverRev: existing.rev, serverDoc: existing.deleted ? null : existing.doc });
    return;
  }
  const rev = (existing && !existing.deleted ? Number(existing.rev) || 0 : 0) + 1;
  data.seq += 1;
  const record = {
    collection,
    id,
    rev,
    seq: data.seq,
    deleted: false,
    updatedAt: new Date(data.now()).toISOString(),
    doc: body.doc,
  };
  store.set(key, record);
  send(res, 200, { rev, seq: record.seq, updatedAt: record.updatedAt });
}

export async function handleDeleteDoc(data, user, res, collection, id) {
  checkCollection(collection);
  const store = userDocs(data, user.id);
  const key = collection + '/' + id;
  const existing = store.get(key);
  data.seq += 1;
  store.set(key, {
    collection,
    id,
    rev: ((existing && Number(existing.rev)) || 0) + 1,
    seq: data.seq,
    deleted: true,
    updatedAt: new Date(data.now()).toISOString(),
    doc: null,
  });
  send(res, 204);
}

function userFiles(data, userId) {
  let map = data.files.get(userId);
  if (!map) {
    map = new Map();
    data.files.set(userId, map);
  }
  return map;
}

export async function handleFilePut(data, user, req, res, id, bytes) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id');
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'too_large');
  const files = userFiles(data, user.id);
  files.set(id, {
    name: decodeURIComponent(req.headers['x-file-name'] || id),
    type: req.headers['content-type'] || 'application/octet-stream',
    size: bytes.length,
    bytes,
    updatedAt: new Date(data.now()).toISOString(),
  });
  send(res, 200, { id, size: bytes.length });
}

export async function handleFileList(data, user, res) {
  send(
    res,
    200,
    [...userFiles(data, user.id)].map(([id, f]) => ({ id, name: f.name, type: f.type, size: f.size, updatedAt: f.updatedAt })),
  );
}

export async function handleFileGet(data, user, res, id) {
  const file = userFiles(data, user.id).get(id);
  if (!file) throw new HttpError(404, 'not_found');
  send(res, 200, file.bytes, { 'content-type': file.type, 'content-disposition': 'attachment' });
}

export async function handleFileDelete(data, user, res, id) {
  userFiles(data, user.id).delete(id);
  send(res, 204);
}

export async function handleSyncUsage(data, user, res) {
  const docs = [...userDocs(data, user.id).values()].filter((d) => !d.deleted).length;
  const files = userFiles(data, user.id).size;
  let bytes = 0;
  for (const d of userDocs(data, user.id).values()) bytes += JSON.stringify(d.doc || '').length;
  for (const f of userFiles(data, user.id).values()) bytes += f.size;
  send(res, 200, { docs, files, bytes, quotaBytes: QUOTA_BYTES });
}

export async function handleExport(data, user, res) {
  const docs = [...userDocs(data, user.id).values()]
    .filter((d) => !d.deleted)
    .map((d) => ({ collection: d.collection, id: d.id, rev: d.rev, doc: d.doc }));
  const files = [...userFiles(data, user.id)].map(([id, f]) => ({ id, name: f.name, type: f.type, size: f.size }));
  send(
    res,
    200,
    { exportedAt: new Date(data.now()).toISOString(), user: { id: user.id, name: user.name }, docs, files },
    { 'content-disposition': 'attachment; filename="trailpack-export.json"' },
  );
}
