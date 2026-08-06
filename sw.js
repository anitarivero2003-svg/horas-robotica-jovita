const CACHE_VERSION = 'horas-robotica-jovita-v12';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Los datos de Supabase y otros servicios externos siempre continúan por red.
  if (url.origin !== self.location.origin) return;

  // Para navegación usamos red primero y la portada en caché como respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => (
          (await caches.match('/index.html')) ||
          (await caches.match('/')) ||
          Response.error()
        ))
    );
    return;
  }

  // Archivos estáticos: respuesta rápida desde caché y actualización en segundo plano.
  event.respondWith((async () => {
    const cachedResponse = await caches.match(request);
    const networkRequest = fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cachedResponse) {
      event.waitUntil(networkRequest);
      return cachedResponse;
    }

    return (await networkRequest) || Response.error();
  })());
});
