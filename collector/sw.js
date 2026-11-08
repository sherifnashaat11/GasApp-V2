const CACHE_NAME = 'gas-v2-cache-v164'; // V3.2
const ASSETS = [
  './index.html',
  './app.js',
  './importer.js',
  './reading.html',
  './style.css',
  './dexie.min.js',
  '../shared/db.js'
];

// تثبيت الـ Service Worker وتخزين الملفات
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // استخدام Promise.allSettled لتجاهل أي ملف غير موجود بدلاً من إيقاف العملية
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

// استراتيجية الجلب: Cache First (لتسريع التطبيق)
self.addEventListener('fetch', (e) => {
  // تجاهل طلبات الـ API أو الملفات المشفرة
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
