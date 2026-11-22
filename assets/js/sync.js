/* ==========================================================================
   sync.js — المزامنة بين الأجهزة (الإصدار 2 — مؤمّن)
   --------------------------------------------------------------------------
   الإصدار القديم كان بيقرا ويكتب في الجدول مباشرة، وسياسة قاعدة البيانات
   كانت "using (true)" — يعني أي حد معاه المفتاح العام (وهو مكتوب في رمز
   الربط) يقدر يقرا ويمسح بيانات **كل** الغرف. ده اتقفل:
     • الجدول نفسه بقى مقفول تماماً على المفتاح العام.
     • الوصول بقى عن طريق دالتين بس (binaa_pull / binaa_push) وكل دالة
       بتشتغل على غرفة واحدة لازم تعرف رقمها السري (128 بت).
     • مستحيل غرفة تكتب فوق حركة غرفة تانية.
   لازم تشغّل supabase-setup.sql الجديد مرة واحدة عشان ده يشتغل.
   ========================================================================== */
(function (global) {
  'use strict';

  const CFG_KEY = 'binaa_cloud_cfg';
  const CUR_KEY = 'binaa_sync_cursor';
  const DEV_KEY = 'binaa_device_id';
  const LAST_KEY = 'binaa_last_sync';

  const POLL_MS = 8000;
  const PAGE = 500;

  let cfg = null;
  let timer = null;
  let running = false;
  const listeners = [];
  let lastError = '';

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function deviceId() {
    let d = ls.get(DEV_KEY);
    if (!d) { d = App.uid().slice(0, 8); ls.set(DEV_KEY, d); }
    return d;
  }

  /* ---------- الإعدادات ---------- */
  function validCfg(c) {
    return !!(c && /^https:\/\/[a-z0-9.-]+$/i.test(c.url || '') && typeof c.key === 'string' && c.key.length > 20 &&
              /^[A-Za-z0-9]{20,64}$/.test(c.room || ''));
  }
  function loadCfg() {
    if (cfg !== null) return cfg;
    try { cfg = JSON.parse(ls.get(CFG_KEY) || 'null'); } catch (e) { cfg = null; }
    if (cfg && !validCfg(cfg)) cfg = null;
    return cfg;
  }
  function saveCfg(c) {
    cfg = c;
    if (c) ls.set(CFG_KEY, JSON.stringify(c)); else ls.del(CFG_KEY);
    emit();
  }
  const isOn = () => !!loadCfg();

  /* ---------- رمز الربط ---------- */
  function encodeCode(c) {
    const json = JSON.stringify({ u: c.url, k: c.key, r: c.room });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    return 'BINAA-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeCode(code) {
    try {
      let s = String(code).trim().replace(/^BINAA-/i, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bytes = Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
      const o = JSON.parse(new TextDecoder().decode(bytes));
      const c = { url: String(o.u || '').replace(/\/+$/, ''), key: String(o.k || ''), room: String(o.r || '') };
      return validCfg(c) ? c : null;
    } catch (e) { return null; }
  }
  /* رقم غرفة جديد: 32 حرف عشوائي (128 بت) — مستحيل تخمينه */
  function newRoom() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- تحويل الشكل ---------- */
  const toRow = (m) => ({
    id: m.id, type: m.type, mat: m.mat, item: m.item || m.mat,
    qty_ton: m.qtyTon, unit_price: m.unitPrice, value: m.value,
    note: m.note || '', party: m.party || '', ref: m.ref || '',
    ts: m.ts, updated_at: m.updatedAt, del: m.del ? 1 : 0
  });
  const fromRow = (r) => ({
    id: r.id, type: r.type, mat: r.mat, item: r.item || r.mat,
    qtyTon: Number(r.qty_ton) || 0, unitPrice: Number(r.unit_price) || 0, value: Number(r.value) || 0,
    note: r.note || '', party: r.party || '', ref: r.ref || '',
    ts: Number(r.ts) || 0, updatedAt: Number(r.updated_at) || 0, del: r.del ? 1 : 0
  });

  /* ---------- نداء دالة على السيرفر ---------- */
  async function rpc(fn, body, c) {
    c = c || loadCfg();
    if (!c) throw new Error('مفيش إعدادات سحابة');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(c.url + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (res.status === 404 || /PGRST202|Could not find the function/i.test(t)) {
          throw new Error('قاعدة البيانات محتاجة تحديث — شغّل ملف supabase-setup.sql الجديد');
        }
        throw new Error('HTTP ' + res.status + ': ' + t.slice(0, 160));
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : null;
    } finally { clearTimeout(to); }
  }

  /* ---------- رفع ---------- */
  async function push() {
    const c = loadCfg();
    let total = 0;
    for (let round = 0; round < 40; round++) {
      const dirty = await Store.getDirty(PAGE);
      if (!dirty.length) break;
      await rpc('binaa_push', { p_room: c.room, p_rows: dirty.map(toRow) });
      await Store.markClean(dirty);
      total += dirty.length;
      if (dirty.length < PAGE) break;
    }
    return total;
  }

  /* ---------- تنزيل ---------- */
  async function pull() {
    const c = loadCfg();
    let got = 0;
    for (let round = 0; round < 200; round++) {
      const cursor = parseInt(ls.get(CUR_KEY) || '0', 10) || 0;
      const rows = await rpc('binaa_pull', { p_room: c.room, p_since: cursor, p_limit: PAGE });
      if (!rows || !rows.length) break;
      const moves = rows.map(fromRow);
      await Store.bulkPut(moves, true);
      const maxTs = moves.reduce((a, m) => Math.max(a, m.updatedAt), cursor);
      ls.set(CUR_KEY, String(maxTs));
      got += moves.length;
      if (rows.length < PAGE) break;
    }
    if (got) await Store.recomputeBalance();
    return got;
  }

  async function syncNow(silent) {
    if (!isOn()) return { skipped: true };
    if (running) return { busy: true };
    if (navigator.onLine === false) { lastError = 'مفيش اتصال بالإنترنت'; emit(); return { offline: true }; }
    running = true; lastError = ''; emit();
    try {
      const up = await push();
      const down = await pull();
      ls.set(LAST_KEY, String(Date.now()));
      if (!silent && (up || down)) {
        const parts = [];
        if (up) parts.push('رفع ' + up);
        if (down) parts.push('نزّل ' + down);
        App.toast('تمت المزامنة ✓ ' + parts.join(' · '), 'ok');
      }
      return { up, down };
    } catch (err) {
      lastError = err && err.name === 'AbortError' ? 'الاتصال اتأخر' : (err && err.message) || 'فشلت المزامنة';
      if (!silent) App.toast('فشلت المزامنة: ' + lastError, 'err', 4800);
      return { error: lastError };
    } finally {
      running = false; emit();
    }
  }

  function onVisible() { if (!document.hidden) syncNow(true).then(notify); }
  function onOnline() { syncNow(true).then(notify); }
  let changeCb = null;
  function notify(r) { if (r && r.down && changeCb) changeCb(r); }

  function start(onRemoteChange) {
    stop();
    if (onRemoteChange) changeCb = onRemoteChange;
    if (!isOn()) { emit(); return; }
    syncNow(true).then(notify);
    timer = setInterval(() => { if (!document.hidden) syncNow(true).then(notify); }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    global.addEventListener('online', onOnline);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener('visibilitychange', onVisible);
    global.removeEventListener('online', onOnline);
  }

  async function test(c) {
    try {
      await rpc('binaa_pull', { p_room: c.room, p_since: Number.MAX_SAFE_INTEGER, p_limit: 1 }, c);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function status() {
    return {
      on: isOn(), busy: running, error: lastError,
      lastSync: parseInt(ls.get(LAST_KEY) || '0', 10) || 0,
      device: deviceId(), room: isOn() ? loadCfg().room : ''
    };
  }
  function onChange(fn) { listeners.push(fn); fn(status()); }
  function emit() { const s = status(); listeners.forEach((f) => { try { f(s); } catch (e) {} }); }

  function resetCursor() { ls.del(CUR_KEY); }

  global.Sync = {
    isOn, cfg: loadCfg, saveCfg, encodeCode, decodeCode, newRoom,
    syncNow, start, stop, test, status, onChange, deviceId, resetCursor
  };
})(window);
