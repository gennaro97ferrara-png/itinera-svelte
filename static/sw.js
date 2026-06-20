const CACHE = 'itinera-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
);
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
);
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); return r; })
      .catch(() => caches.match(e.request))
  );
});
