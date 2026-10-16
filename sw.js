// Bump CACHE_NAME przy KAŻDEJ zmianie JS/CSS/HTML (razem ze znacznikiem „vN” w index.html).
const CACHE_NAME = 'kredyt-inwestycyjny-v4';
const CACHE_PREFIX = 'kredyt-inwestycyjny-';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/calc.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Wspólny origin z Licznikiem Kalorii: kasujemy wyłącznie własne, stare cache.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Nawigacja: network-first — nowy index.html dociera natychmiast.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Zasoby: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
