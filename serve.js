/* ============================================================
   خادم معاينة محلي — عشان تشوف الموقع على جهازك
   شغّله من الترمنال:   node serve.js
   ثم اعمل Ctrl+Click على اللينك اللي هيطلع لك
   (الملف ده للمعاينة بس — مش جزء من الموقع)
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const START_PORT = 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel).replace(/^[\\/]+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الملف مش موجود: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
});

/* لو البورت مشغول، يجرب اللي بعده لحد ما يلاقي واحد فاضي */
let port = START_PORT;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < START_PORT + 20) {
    console.log('البورت ' + port + ' مشغول — بجرب ' + (port + 1) + '…');
    server.listen(++port);
  } else {
    console.error('مشكلة في تشغيل الخادم:', e.message);
    process.exit(1);
  }
});

server.listen(port, () => {
  /* عنوان الشبكة المحلية عشان تفتحه من الموبايل والآيباد */
  let lan = null;
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) {
      if (ni.family === 'IPv4' && !ni.internal) { lan = ni.address; break; }
    }
    if (lan) break;
  }

  /* الرسالة بالإنجليزي عشان متطلعش مكسّرة لو الترمنال مش UTF-8 */
  console.log('');
  console.log('  Server running - Ctrl+Click a link to open');
  console.log('');
  console.log('  PC:            http://localhost:' + port);
  if (lan) {
    console.log('  Phone / iPad:  http://' + lan + ':' + port);
    console.log('                 (same Wi-Fi network)');
  }
  console.log('');
  console.log('  Stop: Ctrl+C');
  console.log('');
});
