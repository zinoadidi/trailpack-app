// Account routes: /me and /me/password.

import { HttpError, send, publicUser, checkPassword, hashPassword, randomString } from './mock-lib.mjs';

export function usageToday(data, user) {
  const day = new Date(data.now()).toISOString().slice(0, 10);
  let tokens = 0;
  for (const row of data.usage) if (row.userId === user.id && row.day === day) tokens += row.tokens;
  return { tokensToday: tokens, budgetToday: user.dailyTokenBudget };
}

export async function handleMeGet(data, user, res) {
  send(res, 200, { user: publicUser(user), usage: usageToday(data, user) });
}

const LANGS = ['en', 'et', 'es', 'fr', 'fi'];
const MODELS = ['auto', 'muse', 'deepseek-flash'];
const THEMES = ['dark', 'light', 'ocean', 'matcha', 'system'];

export async function handleMePatch(data, user, res, body) {
  if (body.lang !== undefined) {
    if (!LANGS.includes(body.lang)) throw new HttpError(400, 'invalid_lang');
    user.lang = body.lang;
  }
  if (body.studyLang !== undefined) {
    if (!LANGS.includes(body.studyLang)) throw new HttpError(400, 'invalid_lang');
    user.studyLang = body.studyLang;
  }
  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme)) throw new HttpError(400, 'invalid_theme');
    user.theme = body.theme;
  }
  if (body.model !== undefined) {
    if (!MODELS.includes(body.model)) throw new HttpError(400, 'invalid_model');
    user.model = body.model;
  }
  if (body.name !== undefined) user.name = String(body.name).slice(0, 120);
  send(res, 200, publicUser(user));
}

export async function handlePassword(data, user, res, body) {
  if (!checkPassword(user, body.current)) throw new HttpError(400, 'invalid_credentials');
  if (typeof body.next !== 'string' || body.next.length < 10) throw new HttpError(400, 'weak_password');
  user.salt = randomString();
  user.passwordHash = hashPassword(body.next, user.salt);
  send(res, 204);
}

export async function handleDeleteMe(data, user, res, body) {
  if (!checkPassword(user, body.password)) throw new HttpError(400, 'invalid_credentials');
  for (const [hash, session] of data.sessions) if (session.userId === user.id) data.sessions.delete(hash);
  data.docs.delete(user.id);
  data.files.delete(user.id);
  data.users.delete(user.id);
  send(res, 204);
}
