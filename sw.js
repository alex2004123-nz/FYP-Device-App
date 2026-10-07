// Offline support: always try the network first so new deploys show up straight away,
// and fall back to the last cached copy when there's no connection.
const CACHE = 'pap-v1';
const PRECACHE = [
  './', 'style.css', 'graph.js', 'script.js', 'ui.js', 'theme.js', 'view.js', 'manifest.json',
  'apple-touch-icon.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    // no-cache: always check the server, so a new deploy never mixes with old cached files
    // (page loads can't take options, and the browser checks those anyway)
    (request.mode === 'navigate' ? fetch(request) : fetch(request, { cache: 'no-cache' }))
      .then((response) => {
        // Redirected responses can't be replayed for page loads, so don't cache them
        if (response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || (request.mode === 'navigate' ? caches.match('./') : Response.error())
        )
      )
  );
});
