/* Trailpack service worker.
   One BUILD_ID names the cache: bumping it (scripts/stamp-build.mjs) retires
   every old asset at once. Shell is cached on install; everything else is
   cache-first with a background refresh, and navigation falls back to the
   cached shell so the app opens offline. */

const BUILD_ID = 'dev';
const CACHE = `trailpack-${BUILD_ID}`;
const SHELL = [
  './',
  './index.html',
  './styles/app.css',
  './styles/activities.css',
  './styles/trail.css',
  './src/main.js',
  './src/register-sw.js',
  './src/build-id.js',
  './src/api/client.js',
  './src/app/state.js',
  './src/app/prefs.js',
  './src/app/themes.js',
  './src/app/router.js',
  './src/app/ui.js',
  './src/app/session.js',
  './src/i18n/format.js',
  ...['en', 'et', 'es', 'fr', 'fi'].map((lang) => `./src/i18n/${lang}.json`),
  './src/store/idb.js',
  './src/store/files.js',
  './src/sync/engine.js',
  './src/screens/access.js',
  './src/screens/create.js',
  './src/screens/login.js',
  './src/screens/trail.js',
  './src/screens/me.js',
  './src/screens/admin.js',
  './src/screens/language.js',
  './src/screens/notfound.js',
  // Include lazy-loaded routes and activity modules, not just the boot shell:
  // an existing Pack must be usable offline even before each screen was visited.
  ...['bundle', 'zip'].map((name) => `./src/export/${name}.js`),
  ...['achievements', 'bite', 'certificate', 'export-run', 'export', 'lens', 'levels',
    'points', 'profile', 'screen-helpers', 'sfx', 'shortcuts', 'store', 'streaks',
    'wire-run', 'wire'].map((name) => `./src/game/${name}.js`),
  ...['_helpers', 'answer-box', 'blitz', 'cloze', 'flash', 'index', 'listen-plan',
    'listen', 'match', 'order', 'quiz', 'registry', 'shared', 'spot-mistake',
    'sweep', 'swipe', 'teach-back', 'true-false', 'voice']
    .map((name) => `./src/screens/activities/${name}.js`),
  ...['activity-bridge', 'bite', 'discover', 'exports', 'game-widgets', 'lens-bar',
    'library', 'mixer-logic', 'mixer-matrix', 'mixer', 'practice-deck', 'practice-result',
    'practice-round', 'practice-run', 'practice', 'progress-data', 'progress', 'replacement-offer', 'review-edit',
    'review', 'review-questions', 'study', 'trail-camp-card', 'trail-deadline', 'trail-empty', 'trail-home-logic',
    'trail-home-widgets', 'trail-sprint'].map((name) => `./src/screens/${name}.js`),
  ...['activities', 'additions', 'chunker', 'hygiene', 'ingest', 'library', 'mastery', 'match',
    'mixer-settings', 'mixer', 'pack', 'progress-store', 'prompts', 'replacement', 'session', 'store',
    'trail-normalise', 'trail'].map((name) => `./src/study/${name}.js`),
  './manifest.webmanifest',
  './icons/mark.svg',
  './config.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isApi(url) {
  return url.pathname.startsWith('/api/') || /\/api\/v\d+\//.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API calls or cross origin requests.
  if (isApi(url) || url.origin !== self.location.origin) return;

  // Config is fetched with a unique query to avoid stale deploys. Use the
  // stable cache key only as an offline fallback, never ahead of the network.
  if (url.pathname === new URL('./config.json', self.registration.scope).pathname) {
    event.respondWith(fetch(req).then(async (res) => {
      if (res.ok) await (await caches.open(CACHE)).put('./config.json', res.clone());
      return res;
    }).catch(() => caches.match('./config.json')));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
