const CACHE_VERSION = 'horas-robotica-jovita-v13';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=13',
  '/app.js?v=13',
  '/config.js?v=13',
  '/manifest.webmanifest?v=13',
  '/icon-192.png?v=13',
  '/icon-512.png?v=13',
  '/icon-maskable-512.png?v=13',
  '/apple-touch-icon.png?v=13'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // Un archivo opcional con problemas no debe impedir la instalación del SW.
    await Promise.allSettled(
      APP_SHELL.map(async (url) => {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response.clone());
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('horas-robotica-jovita-') && key !== CACHE_VERSION)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase y cualquier servicio externo siempre siguen por la red.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('/index.html'))
          || (await caches.match('/'))
          || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request, { cache: 'no-cache' })
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }

    return (await network) || Response.error();
  })());
});
