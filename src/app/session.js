// Session: sign in, refresh, sign out. The refresh token lives in IndexedDB
// (meta "refreshToken"), the access token only in memory, in the API client.

import { state, emit } from './state.js';
import { getPrefs, setPref } from './prefs.js';

const REFRESH_KEY = 'refreshToken';

export function saveTokens(session) {
  state.api.setAccessToken(session.accessToken);
  state.user = session.user;
  return state.store.put('meta', { key: REFRESH_KEY, value: session.refreshToken });
}

export async function loadRefreshToken() {
  const row = await state.store.get('meta', REFRESH_KEY);
  return row ? row.value : null;
}

/** One refresh in flight at a time, shared by all callers. */
let refreshing = null;

export async function refreshSession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const token = await loadRefreshToken();
    if (!token) return false;
    try {
      const next = await state.api.refresh(token);
      await saveTokens(next);
      emit('session');
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(session) {
  await saveTokens(session);
  emit('session');
  return session.user;
}

export async function signOut({ wipe = false } = {}) {
  const token = await loadRefreshToken();
  if (token) {
    try {
      await state.api.logout(token);
    } catch {
      /* offline sign out still clears local tokens */
    }
  }
  state.api.setAccessToken(null);
  state.user = null;
  await state.store.delete('meta', REFRESH_KEY);
  await state.store.delete('meta', 'me');
  if (wipe) {
    await state.store.wipe();
    await state.store.put('meta', { key: 'wiped', value: true });
  }
  emit('session');
}

/** Start a session from an auth payload (redeem, login, refresh). */
export async function startSession(payload) {
  await signIn(payload);
  if (state.sync) await state.sync.hydrate();
  return payload.user;
}

export async function patchMe(patch) {
  const user = await state.api.updateMe(patch);
  state.user = user;
  // Language is remembered per device as well, so the next load starts there.
  if (patch.lang) applyPrefLang(patch.lang);
  emit('session');
  return user;
}

function applyPrefLang(lang) {
  if (getPrefs().lang !== lang) {
    setPref('lang', lang);
  }
}

export async function reloadMe() {
  const { user, usage } = await state.api.me();
  state.user = user;
  state.usage = usage;
  await state.store.put('meta', { key: 'me', value: { user, usage, at: Date.now() } });
  emit('me');
  return { user, usage };
}

export async function cachedMe() {
  const row = await state.store.get('meta', 'me');
  return row ? row.value : null;
}
