/* U-Tech ERP service worker.
 *
 * Deliberately conservative: business data is NEVER cached. `/api/` and
 * `/uploads/` always go to the network, so stock, billing and production
 * figures can never be served stale from a phone that lost connectivity.
 * What IS cached is the app shell (HTML/JS/CSS/icons) so the ERP installs
 * to the home screen, opens instantly, and still shows its login screen
 * when the factory Wi-Fi drops.
 *
 * Bump CACHE_VERSION whenever this file's strategy changes; old caches are
 * deleted on activate.
 */
const CACHE_VERSION = 'utech-erp-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Business data: network only, never cached, never faked offline.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  // Other origins (fonts CDN etc.): let the browser handle them.
  if (url.origin !== self.location.origin) return;

  // Page navigations: fresh HTML first (so deploys land immediately),
  // cached shell only when the network is gone.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Static assets (hashed build files, icons, manifest): serve from cache
  // instantly, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
