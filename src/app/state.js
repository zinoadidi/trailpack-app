// App state, i18n wiring and config loading.
// The store is reactive by polling: screens subscribe and re-render on 'change'.
// It is deliberately tiny: no framework, no virtual DOM.

import { createTranslator, LOCALES } from '../i18n/format.js';
import { getPrefs } from './prefs.js';

const listeners = new Set();

export const state = {
  config: null,
  api: null,
  store: null,
  sync: null,
  user: null,
  usage: null,
  models: { default: 'muse', models: [] },
  lang: 'en',
  t: null,
  langRevision: 0,
  ready: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncStatus: 'idle',
  lastSyncAt: null,
  lastError: null,
  storage: { usage: 0, quota: 0, persisted: false, low: false },
  catalogues: {},
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type = 'change', detail = null) {
  for (const fn of listeners) fn(type, detail);
}

export async function loadCatalogue(lang) {
  const cached = state.catalogues[lang];
  if (cached) return cached;
  const mod = await import(`../i18n/${lang}.json`, { with: { type: 'json' } });
  const data = mod.default || mod;
  state.catalogues[lang] = data;
  return data;
}

/** Load a language and set state.t. Falls back to English for gaps. */
export async function setLanguage(lang) {
  const chosen = LOCALES.includes(lang) ? lang : 'en';
  const [catalogue, english] = await Promise.all([loadCatalogue(chosen), loadCatalogue('en')]);
  state.lang = chosen;
  state.t = createTranslator({ locale: chosen, catalogue, fallback: english });
  state.langRevision += 1;
  document.documentElement.lang = chosen;
  emit('language');
  return state.t;
}

export function t(key, values) {
  if (!state.t) return key;
  return state.t(key, values);
}

/** Load config.json with no cache, so a deploy changes the API base at once. */
export async function loadConfig(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('config.json?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('config.json missing');
  const cfg = await res.json();
  if (!cfg.apiBase || !/^https?:\/\//.test(cfg.apiBase)) throw new Error('apiBase must be a full http(s) URL');
  return cfg;
}

export function initialLang() {
  return getPrefs().lang;
}
