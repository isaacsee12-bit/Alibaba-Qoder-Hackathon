// Service worker: cache-first for static app shell, network-first for /api/*.
const CACHE_NAME = 'freshtrack-v11';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './visual-refresh.css',
  './assistant.css',
  './premium-ui.css',
  './major-redesign.css',
  './premium-final.css',
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
  './modules/assistant.js',
  './modules/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/fresh-pantry.svg',
  './demo-images/banana.png',
  './demo-images/apple.png',
  './demo-images/bread.png',
  './demo-images/tomato.png',
  './demo-images/strawberry.svg',
  './demo-images/broccoli.svg',
  './demo-images/avocado.svg',
  './demo-images/yogurt.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // AI key state is security-sensitive and must never be served from a stale cache.
  if (
    url.origin === location.origin
    && (url.pathname === '/api/ai-key' || url.pathname === '/api/ai-status')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
