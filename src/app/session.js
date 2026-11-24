// Session: sign in, refresh, sign out. The refresh token lives in IndexedDB
// (meta "refreshToken"), the access token only in memory, in the API client.

import { state, emit } from './state.js';
import { getPrefs, setPref, adoptAccountTheme } from './prefs.js';

const REFRESH_KEY = 'refreshToken';
let cachedSession = false;

export async function saveTokens(session) {
  cachedSession = false;
  state.api.setAccessToken(session.accessToken);
  state.user = session.user;
  await state.store.put('meta', { key: REFRESH_KEY, value: session.refreshToken });
  await state.store.put('meta', { key: 'me', value: { user: session.user, usage: null, at: Date.now() } });
}

export async function loadRefreshToken() {
  const row = await state.store.get('meta', REFRESH_KEY);
  return row ? row.value : null;
}

/** One refresh in flight at a time, shared by all callers. */
let refreshing = null;

export async function refreshSession({ restoreOnNetworkError = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const token = await loadRefreshToken();
    if (!token) return false;
    try {
      const next = await state.api.refresh(token);
      await saveTokens(next);
      emit('session');
      return true;
    } catch (err) {
      // A rejected token cannot establish a later offline session. Preserve a
      // newer token if another tab rotated it while this request was in flight.
      if ((err?.status === 401 || err?.status === 403) && await loadRefreshToken() === token) {
        await state.store.delete('meta', REFRESH_KEY);
        await state.store.delete('meta', 'me');
      }
      if (restoreOnNetworkError && err?.code === 'network') await restoreOfflineSession({ serverUnavailable: true });
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(session) {
  await saveTokens(session);
  const theme = adoptAccountTheme(session.user?.theme);
  if (theme) state.prefTheme = theme;
  emit('session');
  return session.user;
}

export async function signOut({ wipe = false } = {}) {
  cachedSession = false;
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
  if (state.sync) {
    await state.sync.hydrate();
    // Only a genuinely empty device is safe to restore automatically: local
    // documents, queued writes or a prior cursor may belong to another account.
    const [docs, outbox, cursor] = await Promise.all([
      state.store.getAllKeys('docs'), state.store.getAllKeys('outbox'), state.store.get('meta', 'cursor'),
    ]);
    if (!docs.length && !outbox.length && !cursor) await state.sync.restore();
  }
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

/** Permit local study offline only for a device with a previously saved session. */
export async function restoreOfflineSession({ serverUnavailable = false } = {}) {
  if ((state.online && !serverUnavailable) || !(await loadRefreshToken())) return false;
  const cached = await cachedMe();
  if (!cached?.user) return false;
  state.user = cached.user;
  state.usage = cached.usage;
  cachedSession = true;
  const theme = adoptAccountTheme(state.user.theme);
  if (theme) state.prefTheme = theme;
  emit('session');
  return true;
}

/** Revalidate locally restored sessions even when the learner disabled sync. */
export async function revalidateCachedSession() {
  if (!cachedSession) return 'valid';
  if (!state.online) return 'pending';
  if (await refreshSession()) return 'valid';
  if (!cachedSession) return 'valid';
  if (await loadRefreshToken()) return 'pending';
  cachedSession = false;
  state.api.setAccessToken(null);
  state.user = null;
  state.usage = null;
  emit('session');
  return 'rejected';
}
