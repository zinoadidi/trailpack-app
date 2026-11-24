// Admin routes, owner only.

import { HttpError, send, codeStatus, publicUser } from './mock-lib.mjs';
import { newCode, sha256 } from './mock-data.mjs';
import { PEPPER } from './mock-lib.mjs';
import { usageToday } from './mock-me.mjs';

function requireOwner(user) {
  if (user.role !== 'owner') throw new HttpError(403, 'forbidden', 'Owner only');
}

export async function handleCodesCreate(data, user, res, body) {
  requireOwner(user);
  const code = newCode();
  const days = Number(body.expiresInDays ?? 7);
  const record = {
    id: 'code_' + Math.random().toString(36).slice(2, 10),
    hash: sha256(code + PEPPER),
    note: body.note || '',
    dailyTokenBudget: Number(body.dailyTokenBudget ?? 200000),
    createdAt: new Date(data.now()).toISOString(),
    expiresAt: new Date(data.now() + days * 86400_000).toISOString(),
    usedAt: null,
    usedByUserId: null,
    revokedAt: null,
  };
  data.codes.set(record.id, record);
  send(res, 201, { id: record.id, code, note: record.note, expiresAt: record.expiresAt });
}

export async function handleCodesList(data, user, res) {
  requireOwner(user);
  const out = [...data.codes.values()].map((c) => {
    const usedBy = c.usedByUserId && data.users.get(c.usedByUserId);
    return {
      id: c.id,
      note: c.note,
      status: codeStatus(c, data.now()),
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      ...(usedBy ? { usedBy: usedBy.email } : {}),
      ...(c.usedAt ? { usedAt: c.usedAt } : {}),
    };
  });
  send(res, 200, out);
}

export async function handleCodeRevoke(data, user, res, id) {
  requireOwner(user);
  const record = data.codes.get(id);
  if (!record) throw new HttpError(404, 'not_found');
  if (codeStatus(record, data.now()) === 'unused') record.revokedAt = new Date(data.now()).toISOString();
  send(res, 204);
}

function syncBytes(data, userId) {
  let bytes = 0;
  for (const d of data.docs.get(userId)?.values() || []) bytes += JSON.stringify(d.doc || '').length;
  for (const f of data.files.get(userId)?.values() || []) bytes += f.size;
  return bytes;
}

export async function handleAccountsList(data, user, res) {
  requireOwner(user);
  const out = [...data.users.values()].map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    codeId: u.codeId,
    tokensToday: usageToday(data, u).tokensToday,
    dailyTokenBudget: u.dailyTokenBudget,
    syncBytes: syncBytes(data, u.id),
  }));
  send(res, 200, out);
}

export async function handleAccountPatch(data, user, res, id, body) {
  requireOwner(user);
  const target = data.users.get(id);
  if (!target) throw new HttpError(404, 'not_found');
  if (body.status) {
    if (!['active', 'suspended'].includes(body.status)) throw new HttpError(400, 'invalid_status');
    target.status = body.status;
    if (body.status === 'suspended') {
      for (const session of data.sessions.values()) if (session.userId === id) session.revoked = true;
    }
  }
  if (body.dailyTokenBudget !== undefined) target.dailyTokenBudget = Number(body.dailyTokenBudget);
  send(res, 200, publicUser(target));
}

export async function handleAccountDelete(data, user, res, id) {
  requireOwner(user);
  const target = data.users.get(id);
  if (!target) throw new HttpError(404, 'not_found');
  const owners = [...data.users.values()].filter((u) => u.role === 'owner');
  if (target.role === 'owner' && owners.length <= 1) throw new HttpError(400, 'last_owner');
  for (const [hash, session] of data.sessions) if (session.userId === id) data.sessions.delete(hash);
  data.users.delete(id);
  data.docs.delete(id);
  data.files.delete(id);
  send(res, 204);
}

export async function handleUsage(data, user, res, url) {
  requireOwner(user);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7)));
  const since = new Date(data.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = data.usage.filter((r) => r.day >= since);
  const byUser = new Map();
  const byModel = new Map();
  for (const r of rows) {
    const u = data.users.get(r.userId);
    const key = u ? u.email : 'deleted';
    const entry = byUser.get(key) || { user: key, calls: 0, tokens: 0 };
    entry.calls += r.calls;
    entry.tokens += r.tokens;
    byUser.set(key, entry);
    const m = byModel.get(r.model) || { model: r.model, calls: 0, tokens: 0 };
    m.calls += r.calls;
    m.tokens += r.tokens;
    byModel.set(r.model, m);
  }
  send(res, 200, { days, users: [...byUser.values()], models: [...byModel.values()] });
}

export async function handleProviders(data, user, res) {
  requireOwner(user);
  send(res, 200, {
    muse: { configured: true, ok: true },
    deepseekFlash: { configured: true, ok: true },
  });
}
