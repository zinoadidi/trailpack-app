// Helpers shared by the mock API routes: users, codes, sessions, errors.

import { sha256, newId } from './mock-data.mjs';

export const PEPPER = 'dev-only-pepper';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body, headers = {}) {
  const out = { 'cache-control': 'no-store', ...headers };
  if (body === undefined || body === null) {
    res.writeHead(status, out);
    res.end();
    return;
  }
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
    res.writeHead(status, out);
    res.end(body);
    return;
  }
  out['content-type'] = 'application/json; charset=utf-8';
  res.writeHead(status, out);
  res.end(JSON.stringify(body));
}

export function fail(res, status, code, message) {
  send(res, status, { error: code, message: message || code });
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    lang: user.lang,
    studyLang: user.studyLang,
    theme: user.theme,
    model: user.model,
    status: user.status,
  };
}

export function hashPassword(password, salt) {
  return sha256(salt + ':' + password);
}

export function createUser(data, { name, email, password, role = 'member', lang = 'en' }) {
  const id = newId('u');
  const salt = randomString();
  const user = {
    id,
    name,
    email: String(email).toLowerCase(),
    role,
    lang,
    studyLang: lang,
    theme: 'system',
    model: 'auto',
    status: 'active',
    salt,
    passwordHash: hashPassword(password, salt),
    dailyTokenBudget: 200000,
    codeId: null,
    createdAt: new Date(data.now()).toISOString(),
  };
  data.users.set(user.id, user);
  data.docs.set(user.id, new Map());
  data.files.set(user.id, new Map());
  return user;
}

export function randomString() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function checkPassword(user, password) {
  return hashPassword(password, user.salt) === user.passwordHash;
}

export function findByEmail(data, email) {
  const target = String(email).toLowerCase();
  for (const user of data.users.values()) if (user.email === target) return user;
  return null;
}

export function issueSession(data, user) {
  const refreshToken = randomString() + randomString();
  const family = newId('fam');
  data.sessions.set(sha256(refreshToken), { userId: user.id, family, used: false });
  return {
    user: publicUser(user),
    accessToken: 'dev-access-' + user.id,
    refreshToken,
    expiresIn: 900,
    _family: family,
  };
}

export function rotateSession(data, refreshToken) {
  const hash = sha256(refreshToken);
  const session = data.sessions.get(hash);
  if (!session) throw new HttpError(401, 'invalid_credentials');
  if (session.used || session.revoked) {
    // Reuse of an old refresh token revokes the whole family.
    for (const [h, s] of data.sessions) if (s.family === session.family) s.revoked = true;
    throw new HttpError(401, 'invalid_credentials');
  }
  session.used = true;
  const user = data.users.get(session.userId);
  if (!user || user.status !== 'active') throw new HttpError(401, 'invalid_credentials');
  const next = issueSession(data, user);
  // Rotation keeps the family: the new token inherits the old family name.
  const family = session.family;
  const issued = data.sessions.get(sha256(next.refreshToken));
  issued.family = family;
  next._family = family;
  return next;
}

export function revokeSession(data, refreshToken) {
  const session = data.sessions.get(sha256(refreshToken));
  if (session) for (const s of data.sessions.values()) if (s.family === session.family) s.revoked = true;
}

export function authenticate(data, req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = token.startsWith('dev-access-') ? token.slice('dev-access-'.length) : null;
  const user = userId && data.users.get(userId);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in again');
  if (user.status !== 'active') throw new HttpError(403, 'suspended', 'Account is suspended');
  return user;
}

export function parseCode(data, code) {
  const raw = String(code || '').trim().toUpperCase();
  for (const record of data.codes.values()) {
    if (record.hash === sha256(raw + PEPPER)) return record;
  }
  return null;
}

export function codeStatus(record, now) {
  if (record.revokedAt) return 'revoked';
  if (record.usedAt) return 'used';
  if (record.expiresAt && Date.parse(record.expiresAt) < now) return 'expired';
  return 'unused';
}
