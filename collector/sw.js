const CACHE_NAME = 'gas-v2-cache-v165'; // غيرت الرقم عشان يجبر المتصفح يحدث الكاش
const ASSETS = [
  './', // عشان يخزن صفحة الجذر (اللي فيها التحويل)
  './index.html',
  './manifest.json', // مهم جداً تخزنه
  './collector/index.html', // صفحة الكوليكتور
  './collector/app.js',
  './collector/importer.js',
  './collector/reading.html',
  './collector/style.css',
  './collector/dexie.min.js',
  './shared/db.js', // شيلت النقطتين اللي كانوا بيطلعوا لفوق
  './icons/icon-192x192.png', // يفضل تخزن الأيقونات الأساسية
  './icons/icon-512x512.png'
];

// تثبيت الـ Service Worker وتخزين الملفات
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

// تفعيله وتنظيف الكاش القديم
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// استراتيجية الجلب
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/downloads/') || e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
