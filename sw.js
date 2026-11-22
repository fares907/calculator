/* ==========================================================================
   sw.js — تشغيل من غير نت (PWA)
   الصفحات: الشبكة الأول وبعدين النسخة المحفوظة (عشان التحديثات توصل على طول)
   الملفات الثابتة: النسخة المحفوظة الأول وبنحدّثها في الخلفية
   طلبات المزامنة (Supabase) مبتتحفظش أبداً.
   ========================================================================== */
const VERSION = 'binaa-v3.2.0';
const CORE = [
  './', 'index.html', 'calculator.html', 'warehouse.html', 'manifest.webmanifest',
  'assets/css/app.css?v=3.2.0', 'assets/icon.svg', 'assets/icon-maskable.svg', 'assets/icon-192.png', 'assets/apple-touch-icon.png',
  'assets/js/core.js?v=3.2.0', 'assets/js/icons.js?v=3.2.0', 'assets/js/store.js?v=3.2.0', 'assets/js/sync.js?v=3.2.0',
  'assets/js/report.js?v=3.2.0', 'assets/vendor/qrcode-2.0.4.js?v=3.2.0', 'assets/js/warehouse.js?v=3.2.0', 'assets/js/calculator.js?v=3.2.0'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
      fetch(req, { cache: 'no-cache' }).then((res) => {
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
