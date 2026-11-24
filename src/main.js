// Entry point: config, store, i18n, api, session restore, router, service worker.

import { loadConfig, setLanguage, state, initialLang, subscribe, emit } from './app/state.js';
import { getPrefs, applyTheme, watchTheme } from './app/prefs.js';
import { IdbStore, MemoryStore } from './store/idb.js';
import { createFileStore, requestPersist, estimateStorage } from './store/files.js';
import { createSyncEngine } from './sync/engine.js';
import { createClient } from './api/client.js';
import { loadRefreshToken, refreshSession, signOut } from './app/session.js';
import { register, guard, startRouter, navigate } from './app/router.js';
import { h, icon, mark, toast } from './app/ui.js';

const screens = {
  '/': () => import('./screens/trail.js'),
  '/me': () => import('./screens/me.js'),
  '/admin': () => import('./screens/admin.js'),
  '/access': () => import('./screens/access.js'),
  '/create': () => import('./screens/create.js'),
  '/login': () => import('./screens/login.js'),
  '/language': () => import('./screens/language.js'),
  '/progress': () => import('./screens/progress.js'),
  '/bite': () => import('./screens/bite.js'),
  '/practice': () => import('./screens/practice.js'),
  '/study': () => import('./screens/study.js'),
  '/mixer': () => import('./screens/mixer.js'),
  '/exports': () => import('./screens/exports.js'),
  '/library': () => import('./screens/library.js'),
  '/library/review': () => import('./screens/review.js'),
};

let bootError = null;

async function boot() {
  const prefs = getPrefs();
  applyTheme(prefs.theme);
  watchTheme(prefs.theme);
  state.prefTheme = prefs.theme;
  state.syncEnabled = prefs.sync;
  await setLanguage(prefs.lang);

  try {
    state.config = await loadConfig();
  } catch (err) {
    bootError = err;
    renderFatal();
    return;
  }

  state.api = createClient({
    baseUrl: state.config.apiBase,
    onUnauthorized: async () => {
      await signOut({ wipe: false });
      navigate('/login', { replace: true });
    },
  });
  state.api.setRefreshHandler(refreshSession);

  try {
    state.store = await IdbStore.open();
  } catch {
    state.store = new MemoryStore();
    state.store.memoryOnly = true;
  }
  state.files = createFileStore({ store: state.store, api: state.api });

  state.sync = createSyncEngine({
    store: state.store,
    api: state.api,
    isOnline: () => state.online && getPrefs().sync !== false,
    onStatus: ({ status, lastSyncAt, lastError }) => {
      state.syncStatus = status;
      state.lastSyncAt = lastSyncAt || state.lastSyncAt;
      state.lastError = lastError || null;
      emit('sync');
    },
  });
  await state.sync.hydrate();

  registerShell();
  subscribe(renderChrome);

  const el = document.getElementById('main');
  startRouter(el);
  renderChrome();
  window.addEventListener('online', () => {
    state.online = true;
    emit('network');
    syncIfEnabled();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    emit('network');
  });
  window.addEventListener('focus', syncIfEnabled);
  setInterval(syncIfEnabled, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncIfEnabled();
  });

  await restoreSession();
  await refreshStorage();
  emit('ready');
}

async function restoreSession() {
  const token = await loadRefreshToken();
  if (!token) return;
  const ok = await refreshSession();
  if (!ok) return;
  try {
    const { user, usage } = await state.api.me();
    state.user = user;
    state.usage = usage;
  } catch {
    return;
  }
  emit('session');
  if (state.sync) {
    // Empty local store (new device or wiped): pull everything back.
    const docs = await state.store.getAllKeys('docs');
    if (docs.length === 0) {
      const meta = await state.store.get('meta', 'wiped');
      if (meta || (await state.store.getAllKeys('meta')).length === 0) await state.sync.restore();
    }
    await state.sync.sync();
  }
}

function syncIfEnabled() {
  if (state.online && getPrefs().sync !== false && state.user) state.sync?.sync();
}

async function refreshStorage() {  const reading = await estimateStorage();
  const persisted = await requestPersist();
  state.storage = { ...reading, persisted, low: false };
  emit('storage');
}

function registerShell() {
  for (const [path, loader] of Object.entries(screens)) {
    register(path, async (mm) => {
      if (!state.user && !['/access', '/create', '/login', '/language'].includes(mm.path)) {
        navigate('/access', { replace: true });
        return null;
      }
      if (state.user && ['/access', '/create', '/login'].includes(mm.path)) {
        navigate('/', { replace: true });
        return null;
      }
      const mod = await loader();
      return mod.default(mm);
    });
  }
  register('/*', async () => {
    const mod = await import('./screens/notfound.js');
    return mod.default();
  });
  guard(({ mm, loggedIn }) => {
    if (!mm) return loggedIn ? '/404' : '/access';
    if (!loggedIn && !['/access', '/create', '/login', '/language', '/404'].includes(mm.path)) return '/access';
    if (loggedIn && ['/access', '/create', '/login'].includes(mm.path)) return '/';
    if (!loggedIn) return null;
    if (mm.path === '/admin' && state.user.role !== 'owner') return '/';
    return null;
  });
}

const TABS = [
  { path: '/', label: 'nav.trail', icon: 'trail' },
  { path: '/practice', label: 'nav.practice', icon: 'cards' },
  { path: '/talk', label: 'nav.talk', icon: 'mic', soon: true },
  { path: '/library', label: 'nav.library', icon: 'lib' },
  { path: '/me', label: 'nav.me', icon: 'me' },
];

let chrome = null;

function renderChrome() {
  if (!state.t) return;
  const loggedIn = Boolean(state.user);
  if (!loggedIn) {
    chrome?.remove();
    chrome = null;
    return;
  }
  if (chrome) {
    chrome.remove();
  }
  const path = (location.hash || '#/').replace(/^#/, '') || '/';
  chrome = h('nav', { class: 'tabbar', 'aria-label': state.t('nav.mainMenu') });
  for (const tab of TABS) {
    const active = path === tab.path;
    chrome.append(
      h(
        'a',
        {
          href: '#' + tab.path,
          'aria-current': active ? 'page' : null,
          onclick: tab.soon
            ? (e) => {
                e.preventDefault();
                if (tab.soon === '/exports') navigate('/exports');
                else toast(state.t('common.next') + ' · ' + state.t(tab.label));
              }
            : null,
        },
        icon(tab.icon, 22),
        h('span', {}, state.t(tab.label)),
      ),
    );
  }
  document.body.append(chrome);
  document.querySelector('.admin-fab')?.remove();
  document.querySelector('.admin-row')?.remove();
  if (state.user.role === 'owner') {
    const adminRow = h(
      'div',
      { class: 'panel row admin-row', style: { maxWidth: '720px', margin: '0 auto 12px' } },
      h('span', { class: 'small' }, state.t('admin.ownerOnly')),
      h('a', { class: 'btn sm', href: '#/admin' }, state.t('nav.admin')),
    );
    chrome.before(adminRow);
  }
  void mark;
}

function renderFatal() {
  const el = document.getElementById('main');
  el.className = 'main no-tabs';
  el.append(
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'authwrap' }, mark(72, 'fatal')),
      h('h1', { class: 'h1' }, 'Trailpack'),
      h('div', { class: 'notice bad' }, h('p', {}, 'The app could not load its configuration (config.json). The API base URL is missing or invalid.')),
      h('p', { class: 'mut' }, bootError ? String(bootError.message) : ''),
    ),
  );
}

boot().catch((err) => {
  console.error(err);
  renderFatal();
});
