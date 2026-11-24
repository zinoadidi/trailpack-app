/* Trailpack service worker.
   One BUILD_ID names the cache: bumping it (scripts/stamp-build.mjs) retires
   every old asset at once. Shell is cached on install; everything else is
   cache-first with a background refresh, and navigation falls back to the
   cached shell so the app opens offline. */

const BUILD_ID = 'dev';
const CACHE = `trailpack-${BUILD_ID}`;
const SHELL = [
  '/',
  '/index.html',
  '/styles/app.css',
  '/styles/activities.css',
  '/styles/trail.css',
  '/src/main.js',
  '/src/build-id.js',
  '/src/api/client.js',
  '/src/app/state.js',
  '/src/app/router.js',
  '/src/app/ui.js',
  '/src/app/session.js',
  '/src/i18n/format.js',
  '/src/store/idb.js',
  '/src/store/files.js',
  '/src/sync/engine.js',
  '/src/screens/access.js',
  '/src/screens/create.js',
  '/src/screens/login.js',
  '/src/screens/trail.js',
  '/src/screens/me.js',
  '/src/screens/admin.js',
  '/src/screens/language.js',
  '/src/screens/notfound.js',
  '/manifest.webmanifest',
  '/icons/mark.svg',
  '/config.json',
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

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
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
