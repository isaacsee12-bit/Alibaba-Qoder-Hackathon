// Service worker: cache-first for static app shell, network-first for /api/*.
const CACHE_NAME = 'fem-v2';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './modules/api.js',
  './modules/util.js',
  './modules/camera.js',
  './modules/classifier.js',
  './modules/classifier.worker.js',
  './modules/mockCv.js',
  './modules/inventory.js',
  './modules/alerts.js',
  './modules/insights.js',
  './modules/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './demo-images/banana.png',
  './demo-images/apple.png',
  './demo-images/bread.png',
  './demo-images/tomato.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // never cache mutations
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // network-first for API calls, falling back to last cached response
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || Response.error()))
    );
    return;
  }

  // cache-first for same-origin static assets
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        });
      })
    );
  }
  // cross-origin (e.g. model CDN) → default browser behavior
});
