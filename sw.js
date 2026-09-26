/* Bump this whenever a bundled asset changes in a way a stale copy would make
 * visibly wrong. It went v1 -> v2 when the theme changed from dark to light:
 * the activate handler deletes every cache whose name is not the current one,
 * so a device still holding the old dark style.css throws it away on the next
 * launch instead of serving it over the new build. */
const CACHE = 'sg4d-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './ads.js',
  './data.js',
  './checker.js',
  './stats.js',
  './app.js',
  './manifest.webmanifest',
  './data/history.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first for our own files, cache as the offline fallback. Cache-first
 * would keep serving an old app.js after an edit until CACHE changed — easy to
 * miss, and it makes every update look like it did nothing.
 *
 * The results feed is deliberately NOT handled here. It is a different origin,
 * so it falls out at the check below and is never served from a service-worker
 * cache: data.js owns freshness and knows how to label a result that might not
 * be the latest. A silent cache hit underneath it would put last week's draw on
 * screen with no warning, which is the one thing a results app must not do.
 *
 * The bundled seed IS cached, because it is a fixed file that ships with the
 * build and is only ever a floor under the live data, never a substitute. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const key = req.mode === 'navigate' ? './index.html' : req;

  e.respondWith(
    fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(key, copy));
        return res;
      })
      .catch(() => caches.match(key))
  );
});
