// Small device settings kept in localStorage: theme and app language are
// needed before sign in, so they cannot live in IndexedDB behind a login.

import { THEME_IDS, THEME_COLOR, resolveTheme } from './themes.js';

const THEMES = THEME_IDS;
const LANGS = ['en', 'et', 'es', 'fr', 'fi'];
const KEY = 'trailpack.prefs';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked, session only */
  }
}

export function getPrefs() {
  const prefs = read();
  return {
    theme: THEMES.includes(prefs.theme) ? prefs.theme : 'system',
    lang: LANGS.includes(prefs.lang) ? prefs.lang : detectLang(),
    sound: Boolean(prefs.sound),
    sync: prefs.sync !== false,
  };
}

export function setPref(key, value) {
  const prefs = { ...read(), [key]: value };
  write(prefs);
  return getPrefs();
}

export function detectLang() {
  const nav = typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
  const base = nav.split('-')[0].toLowerCase();
  return LANGS.includes(base) ? base : 'en';
}

/** Resolve the theme preference to a theme id and apply it to the document. */
export function applyTheme(pref, root = typeof document !== 'undefined' ? document.documentElement : null) {
  const matchesLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  const theme = resolveTheme(pref, matchesLight);
  if (root) root.dataset.theme = theme;
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null;
  if (meta) meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.dark);
  return theme;
}

export function watchTheme(pref, apply = applyTheme) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (pref === 'system') apply('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export { THEMES, LANGS };