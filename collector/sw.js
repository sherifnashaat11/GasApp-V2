const CACHE_NAME = 'gas-v2-cache-v5';
const ASSETS = [
  './index.html', './app.js', './style.css', './dexie.min.js', './reading.html',
  './shared/db.js', './shared/subscriber-key.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/downloads/') || e.request.url.includes('/api/')) return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
