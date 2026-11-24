import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../src/app/state.js';
import { startSession, refreshSession, restoreOfflineSession, revalidateCachedSession, signOut } from '../src/app/session.js';
import { MemoryStore } from '../src/store/idb.js';

const payload = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'user' } };

async function setup() {
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  state.prefTheme = 'system';
  state.online = true;
  state.store = new MemoryStore();
  state.api = { setAccessToken() {} };
  const calls = [];
  state.sync = { hydrate: async () => calls.push('hydrate'), restore: async () => calls.push('restore') };
  return calls;
}

test('fresh device sign-in restores remote data', async () => {
  const calls = await setup();
  await startSession(payload);
  assert.deepEqual(calls, ['hydrate', 'restore']);
});

test('offline restoration requires a cached user and refresh token', async () => {
  await setup();
  state.online = false;
  await startSession(payload);
  state.user = null;
  assert.equal(await restoreOfflineSession(), true);
  assert.equal(state.user.id, 'user');
  await signOut();
  assert.equal(await restoreOfflineSession(), false);
});

test('cached user cannot restore an online failed session', async () => {
  await setup();
  await startSession(payload);
  state.user = null;
  state.online = true;
  assert.equal(await restoreOfflineSession(), false);
  assert.equal(state.user, null);
});

test('a server-rejected refresh cannot later be used for offline restoration', async () => {
  await setup();
  await startSession(payload);
  state.api.refresh = async () => { throw Object.assign(new Error('revoked'), { status: 401 }); };
  assert.equal(await refreshSession(), false);
  state.user = null;
  state.online = false;
  assert.equal(await restoreOfflineSession(), false);
});

test('transient refresh errors preserve the cached session for offline use', async () => {
  await setup();
  await startSession(payload);
  state.api.refresh = async () => { throw Object.assign(new Error('network'), { status: 0 }); };
  assert.equal(await refreshSession(), false);
  state.user = null;
  state.online = false;
  assert.equal(await restoreOfflineSession(), true);
});

test('boot can restore local study when the API is unreachable despite an online network', async () => {
  await setup();
  await startSession(payload);
  state.user = null;
  state.api.refresh = async () => { throw Object.assign(new Error('network'), { code: 'network', status: 0 }); };
  assert.equal(await refreshSession({ restoreOnNetworkError: true }), false);
  assert.equal(state.user?.id, 'user');
});

test('boot does not restore locally after an explicit server rejection', async () => {
  await setup();
  await startSession(payload);
  state.user = null;
  state.api.refresh = async () => { throw Object.assign(new Error('rejected'), { status: 401 }); };
  assert.equal(await refreshSession({ restoreOnNetworkError: true }), false);
  assert.equal(state.user, null);
});

test('revalidating a revoked cached session clears the user', async () => {
  await setup();
  await startSession(payload);
  state.online = false;
  await restoreOfflineSession();
  state.online = true;
  state.api.refresh = async () => { throw Object.assign(new Error('revoked'), { status: 401 }); };
  assert.equal(await revalidateCachedSession(), 'rejected');
  assert.equal(state.user, null);
});

test('revalidating a cached session preserves it on transient errors and retries', async () => {
  await setup();
  await startSession(payload);
  state.online = false;
  await restoreOfflineSession();
  state.online = true;
  state.api.refresh = async () => { throw Object.assign(new Error('network'), { code: 'network', status: 0 }); };
  assert.equal(await revalidateCachedSession(), 'pending');
  assert.equal(state.user.id, 'user');
  state.api.refresh = async () => payload;
  assert.equal(await revalidateCachedSession(), 'valid');
});

test('a rejected old refresh does not erase a token rotated by another tab', async () => {
  await setup();
  await startSession(payload);
  state.api.refresh = async () => {
    await state.store.put('meta', { key: 'refreshToken', value: 'newer' });
    throw Object.assign(new Error('revoked'), { status: 401 });
  };
  assert.equal(await refreshSession(), false);
  assert.equal((await state.store.get('meta', 'refreshToken')).value, 'newer');
});

test('a fresh device adopts the saved account theme', async () => {
  await setup();
  await startSession({ ...payload, user: { id: 'user', theme: 'matcha' } });
  assert.equal(state.prefTheme, 'matcha');
});

test('an explicit device theme is not overwritten at sign-in', async () => {
  await setup();
  localStorage.setItem('trailpack.prefs', JSON.stringify({ theme: 'ocean' }));
  state.prefTheme = 'ocean';
  await startSession({ ...payload, user: { id: 'user', theme: 'matcha' } });
  assert.equal(state.prefTheme, 'ocean');
});

test('sign-in does not auto-restore over existing local data or a previous cursor', async () => {
  for (const existing of ['docs', 'outbox', 'cursor']) {
    const calls = await setup();
    if (existing === 'cursor') await state.store.put('meta', { key: 'cursor', value: 2 });
    else await state.store.put(existing, { collection: 'packs', id: 'local' });
    await startSession(payload);
    assert.deepEqual(calls, ['hydrate'], existing);
  }
});
