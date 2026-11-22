/* ==========================================================================
   sw.js — تشغيل من غير نت (PWA)
   الصفحات: الشبكة الأول وبعدين النسخة المحفوظة (عشان التحديثات توصل على طول)
   الملفات الثابتة: النسخة المحفوظة الأول وبنحدّثها في الخلفية
   طلبات المزامنة (Supabase) مبتتحفظش أبداً.
   ========================================================================== */
const VERSION = 'binaa-v3.1.0';
const CORE = [
  './', 'index.html', 'calculator.html', 'warehouse.html', 'manifest.webmanifest',
  'assets/css/app.css', 'assets/icon.svg', 'assets/icon-maskable.svg', 'assets/icon-192.png', 'assets/apple-touch-icon.png',
  'assets/js/core.js', 'assets/js/icons.js', 'assets/js/store.js', 'assets/js/sync.js',
  'assets/js/report.js', 'assets/vendor/qrcode-2.0.4.js', 'assets/js/warehouse.js', 'assets/js/calculator.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;          // Supabase وأي حاجة تانية: من غير تدخل

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
