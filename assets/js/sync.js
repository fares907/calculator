/* ==========================================================================
   sync.js — المزامنة بين الأجهزة (الإصدار 3)
   --------------------------------------------------------------------------
   • سحابة الإخلاص جاهزة: تفعيل بضغطة، والجهاز التاني بيتربط برمز قصير.
   • بيتزامن: الحركات · الدفعات (حسابات العملاء والموردين) · الأصناف · الأسعار.
   • الأمان: الجداول مقفولة تماماً، والوصول عن طريق دوال محصورة في "غرفة"
     واحدة رقمها السري 128 بت — والسيرفر مش بيخزّن الرقم نفسه، بيخزّن بصمته.
   • المفتاح المكتوب هنا "publishable" — معمول عشان يتنشر، ولوحده مبيفتحش
     أي بيانات. البيانات محمية برقم الغرفة اللي جوه رمز الربط بس.
   ========================================================================== */
(function (global) {
  'use strict';

  /* سحابة شركة الإخلاص (Supabase — فرانكفورت) */
  const DEFAULT_CLOUD = {
    url: 'https://vkdyapmgwakzyuwaaezx.supabase.co',
    key: 'sb_publishable_cRdowxTbXKwgxwH70B86dA_1GvWHf5P'
  };

  const CFG_KEY = 'binaa_cloud_cfg';
  const CUR_KEY = 'binaa_sync_cursor';
  const CUR_PAY = 'binaa_sync_cursor_pay';
  const DEV_KEY = 'binaa_device_id';
  const LAST_KEY = 'binaa_last_sync';

  const POLL_MS = 8000;
  const PAGE = 500;

  let cfg = null, timer = null, running = false, lastError = '';
  const listeners = [];

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
  const validCfg = (c) => !!(c && /^https:\/\/[a-z0-9.-]+$/i.test(c.url || '') && typeof c.key === 'string' && c.key.length > 20 &&
                              /^[A-Za-z0-9]{20,64}$/.test(c.room || ''));
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
  const isDefault = (c) => c && c.url === DEFAULT_CLOUD.url;

  /* ---------- رمز الربط ----------
     على سحابة الإخلاص: IKH-<رقم الغرفة> (قصير وسهل يتبعت)
     على سحابة خاصة: BINAA-<base64> (فيه العنوان والمفتاح والغرفة) */
  function encodeCode(c) {
    if (isDefault(c)) return 'IKH-' + c.room;
    const json = JSON.stringify({ u: c.url, k: c.key, r: c.room });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    return 'BINAA-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeCode(code) {
    const raw = String(code || '').trim().replace(/\s+/g, '');
    const m = /^IKH-([A-Za-z0-9]{20,64})$/i.exec(raw);
    if (m) return { ...DEFAULT_CLOUD, room: m[1] };
    try {
      let s = raw.replace(/^BINAA-/i, '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))));
      const c = { url: String(o.u || '').replace(/\/+$/, ''), key: String(o.k || ''), room: String(o.r || '') };
      return validCfg(c) ? c : null;
    } catch (e) { return null; }
  }
  function newRoom() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- تحويل الشكل ---------- */
  const toRow = (m) => ({
    id: m.id, type: m.type, mat: m.mat, item: m.item || m.mat,
    qty_ton: m.qtyTon, unit_price: m.unitPrice, value: m.value,
    note: m.note || '', party: m.party || '', ref: m.ref || '', by_name: m.by || '',
    ts: m.ts, updated_at: m.updatedAt, del: m.del ? 1 : 0
  });
  const fromRow = (r) => ({
    id: r.id, type: r.type, mat: r.mat, item: r.item || r.mat,
    qtyTon: Number(r.qty_ton) || 0, unitPrice: Number(r.unit_price) || 0, value: Number(r.value) || 0,
    note: r.note || '', party: r.party || '', ref: r.ref || '', by: r.by_name || '',
    ts: Number(r.ts) || 0, updatedAt: Number(r.updated_at) || 0, del: r.del ? 1 : 0
  });
  const payToRow = (p) => ({
    id: p.id, party: p.party, dir: p.dir, amount: p.amount, method: p.method || '', note: p.note || '',
    ref: p.ref || '', by_name: p.by || '', ts: p.ts, updated_at: p.updatedAt, del: p.del ? 1 : 0
  });
  const payFromRow = (r) => ({
    id: r.id, party: r.party, dir: r.dir, amount: Number(r.amount) || 0, method: r.method || '', note: r.note || '',
    ref: r.ref || '', by: r.by_name || '', ts: Number(r.ts) || 0, updatedAt: Number(r.updated_at) || 0, del: r.del ? 1 : 0
  });

  /* ---------- نداء دالة على السيرفر ---------- */
  async function rpc(fn, body, c) {
    c = c || loadCfg();
    if (!c) throw new Error('مفيش إعدادات سحابة');
    const headers = { apikey: c.key, 'Content-Type': 'application/json' };
    /* المفاتيح القديمة (JWT) بتتبعت كمان في Authorization؛ الجديدة (sb_publishable) لأ */
    if (!c.key.startsWith('sb_')) headers.Authorization = 'Bearer ' + c.key;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(c.url + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (res.status === 404 || /PGRST202|Could not find the function/i.test(t)) {
          throw new Error('قاعدة البيانات محتاجة تحديث — شغّل ملف supabase-setup.sql الجديد');
        }
        if (res.status === 401 || res.status === 403) throw new Error('المفتاح مرفوض (' + res.status + ')');
        throw new Error('HTTP ' + res.status + ': ' + t.slice(0, 160));
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : null;
    } finally { clearTimeout(to); }
  }

  /* ---------- رفع وتنزيل (عام للحركات والدفعات) ---------- */
  async function pushKind(getDirty, markClean, toR, fn) {
    const c = loadCfg();
    let total = 0;
    for (let round = 0; round < 40; round++) {
      const dirty = await getDirty(PAGE);
      if (!dirty.length) break;
      await rpc(fn, { p_room: c.room, p_rows: dirty.map(toR) });
      await markClean(dirty);
      total += dirty.length;
      if (dirty.length < PAGE) break;
    }
    return total;
  }
  async function pullKind(fn, curKey, fromR, bulk) {
    const c = loadCfg();
    let got = 0;
    for (let round = 0; round < 200; round++) {
      const cursor = parseInt(ls.get(curKey) || '0', 10) || 0;
      const rows = await rpc(fn, { p_room: c.room, p_since: cursor, p_limit: PAGE });
      if (!rows || !rows.length) break;
      const list = rows.map(fromR);
      await bulk(list, true);
      ls.set(curKey, String(list.reduce((a, m) => Math.max(a, m.updatedAt), cursor)));
      got += list.length;
      if (rows.length < PAGE) break;
    }
    return got;
  }

  /* ---------- الأصناف والأسعار: الأحدث بيكسب ---------- */
  async function syncMeta() {
    const c = loadCfg();
    const remote = (await rpc('binaa_meta_pull', { p_room: c.room })) || [];
    const rm = Object.fromEntries(remote.map((r) => [r.k, r]));
    let changed = false;

    const itemsAt = Number(await Store.metaGet('items_at', 0)) || 0;
    if (rm.items && Number(rm.items.updated_at) > itemsAt) {
      await Store.setItems(rm.items.v, Number(rm.items.updated_at)); changed = true;
    } else if (itemsAt && (!rm.items || itemsAt > Number(rm.items.updated_at))) {
      await rpc('binaa_meta_push', { p_room: c.room, p_k: 'items', p_v: await Store.getItems(), p_updated_at: itemsAt });
    }

    const pricesAt = Number(await Store.metaGet('prices_at', 0)) || 0;
    if (rm.prices && Number(rm.prices.updated_at) > pricesAt) {
      const v = rm.prices.v || {};
      await Store.setSettings({ steelPriceTon: v.steelPriceTon, cementBagPrice: v.cementBagPrice, _stamp: Number(rm.prices.updated_at) });
      changed = true;
    } else if (pricesAt && (!rm.prices || pricesAt > Number(rm.prices.updated_at))) {
      const s = await Store.getSettings();
      await rpc('binaa_meta_push', { p_room: c.room, p_k: 'prices', p_v: { steelPriceTon: s.steelPriceTon, cementBagPrice: s.cementBagPrice }, p_updated_at: pricesAt });
    }
    return changed;
  }

  async function syncNow(silent) {
    if (!isOn()) return { skipped: true };
    if (running) return { busy: true };
    if (navigator.onLine === false) { lastError = 'مفيش اتصال بالإنترنت'; emit(); return { offline: true }; }
    running = true; lastError = ''; emit();
    try {
      const up = await pushKind((n) => Store.getDirty(n), (l) => Store.markClean(l), toRow, 'binaa_push') +
                 await pushKind((n) => Store.getDirtyPay(n), (l) => Store.markCleanPay(l), payToRow, 'binaa_push_pay');
      const downMoves = await pullKind('binaa_pull', CUR_KEY, fromRow, (l, c) => Store.bulkPut(l, c));
      const downPay = await pullKind('binaa_pull_pay', CUR_PAY, payFromRow, (l, c) => Store.bulkPutPay(l, c));
      const metaChanged = await syncMeta();
      if (downMoves) await Store.recomputeBalance();
      const down = downMoves + downPay;
      ls.set(LAST_KEY, String(Date.now()));
      if (!silent && (up || down)) {
        const parts = [];
        if (up) parts.push('رفع ' + up);
        if (down) parts.push('نزّل ' + down);
        App.toast('تمت المزامنة ✓ ' + parts.join(' · '), 'ok');
      }
      return { up, down, meta: metaChanged };
    } catch (err) {
      lastError = err && err.name === 'AbortError' ? 'الاتصال اتأخر' : (err && err.message) || 'فشلت المزامنة';
      if (!silent) App.toast('فشلت المزامنة: ' + lastError, 'err', 4800);
      return { error: lastError };
    } finally {
      running = false; emit();
    }
  }

  let changeCb = null;
  const notify = (r) => { if (r && (r.down || r.meta) && changeCb) changeCb(r); };
  const onVisible = () => { if (!document.hidden) syncNow(true).then(notify); };
  const onOnline = () => syncNow(true).then(notify);

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
    try { await rpc('binaa_pull', { p_room: c.room, p_since: Number.MAX_SAFE_INTEGER, p_limit: 1 }, c); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  function status() {
    const c = loadCfg();
    return { on: !!c, busy: running, error: lastError, lastSync: parseInt(ls.get(LAST_KEY) || '0', 10) || 0,
             device: deviceId(), room: c ? c.room : '', isDefault: isDefault(c) };
  }
  function onChange(fn) { listeners.push(fn); fn(status()); }
  function emit() { const s = status(); listeners.forEach((f) => { try { f(s); } catch (e) {} }); }
  function resetCursor() { ls.del(CUR_KEY); ls.del(CUR_PAY); }

  global.Sync = {
    DEFAULT_CLOUD, isOn, cfg: loadCfg, saveCfg, encodeCode, decodeCode, newRoom,
    syncNow, start, stop, test, status, onChange, deviceId, resetCursor
  };
})(window);
