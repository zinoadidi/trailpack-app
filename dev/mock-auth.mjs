// Access and auth routes (public).

import {
  HttpError,
  send,
  checkPassword,
  createUser,
  findByEmail,
  issueSession,
  rotateSession,
  revokeSession,
  parseCode,
  codeStatus,
} from './mock-lib.mjs';

const attempts = new Map(); // ip -> {count, until}

function rateLimit(data, req) {
  const ip = req.socket.remoteAddress || 'local';
  const entry = attempts.get(ip);
  const now = data.now();
  if (entry && entry.until > now) throw new HttpError(429, 'too_many', 'Too many tries, wait a moment');
  if (!entry || entry.until <= now) attempts.set(ip, { count: 0, until: 0 });
  const rec = attempts.get(ip);
  rec.count += 1;
  if (rec.count > 30) rec.until = now + 60_000;
}

export async function handleHealth(data, res) {
  send(res, 200, { ok: true, version: 'dev-mock', time: new Date(data.now()).toISOString() });
}

export async function handleAccessCheck(data, req, res, body) {
  rateLimit(data, req);
  const record = parseCode(data, body.code);
  if (!record || codeStatus(record, data.now()) !== 'unused') {
    throw new HttpError(400, 'invalid_code');
  }
  send(res, 200, { ok: true });
}

export async function handleRedeem(data, req, res, body) {
  rateLimit(data, req);
  const record = parseCode(data, body.code);
  if (!record || codeStatus(record, data.now()) !== 'unused') {
    throw new HttpError(400, 'invalid_code');
  }
  if (findByEmail(data, body.email)) {
    // Same generic answer: nothing leaks about existing accounts.
    throw new HttpError(400, 'invalid_code');
  }
  if (typeof body.password !== 'string' || body.password.length < 10) {
    throw new HttpError(400, 'weak_password', 'Use at least 10 characters');
  }
  record.usedAt = new Date(data.now()).toISOString();
  const user = createUser(data, {
    name: body.name,
    email: body.email,
    password: body.password,
    lang: body.lang || 'en',
  });
  user.codeId = record.id;
  user.dailyTokenBudget = record.dailyTokenBudget || 200000;
  const session = issueSession(data, user);
  delete session._family;
  send(res, 201, session);
}

export async function handleLogin(data, req, res, body) {
  rateLimit(data, req);
  const user = findByEmail(data, body.email);
  if (!user || !checkPassword(user, body.password)) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is wrong');
  }
  const session = issueSession(data, user);
  delete session._family;
  send(res, 200, session);
}

export async function handleRefresh(data, req, res, body) {
  const next = rotateSession(data, body.refreshToken);
  delete next._family;
  send(res, 200, next);
}

export async function handleLogout(data, req, res, body) {
  revokeSession(data, body.refreshToken);
  send(res, 204);
}

export async function handleBootstrap(data, req, res, body) {
  const hasOwner = [...data.users.values()].some((u) => u.role === 'owner');
  if (hasOwner) throw new HttpError(404, 'not_found');
  if (body.setupToken !== data.ownerSetupToken) throw new HttpError(404, 'not_found');
  const user = createUser(data, { ...body, role: 'owner' });
  const session = issueSession(data, user);
  delete session._family;
  send(res, 201, session);
}
