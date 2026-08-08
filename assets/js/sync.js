/* ==========================================================================
   sync.js — المزامنة بين الأجهزة
   --------------------------------------------------------------------------
   إزاي بتشتغل:
     • البرنامج بيشتغل أوفلاين على طول (IndexedDB). المزامنة إضافة فوقه.
     • كل حركة جديدة بتتعلّم dirty=1 → بتترفع أول ما يبقى فيه نت.
     • كل شوية بينزّل اللي اتغيّر عند الشريك ويدمجه.
     • لو النت قطع: الشغل بيكمل عادي، ويتزامن لوحده لما يرجع.

   الأمان:
     الوصول للبيانات محتاج "رمز الربط" — سلسلة سرية فيها عنوان قاعدة
     البيانات ومفتاحها ورقم الغرفة. من غير الرمز ده اللينك لوحده مبيوصّلش
     لأي بيانات. متبعتش الرمز لحد بره الشركة.
   ========================================================================== */
(function (global) {
  'use strict';

  var CFG_KEY  = 'binaa_cloud_cfg';
  var CUR_KEY  = 'binaa_sync_cursor';
  var DEV_KEY  = 'binaa_device_id';

  var POLL_MS = 8000;          // ينزّل تغييرات الشريك كل 8 ثواني
  var PAGE = 500;              // عدد السجلات في الدفعة الواحدة

  var cfg = null;
  var timer = null;
  var running = false;
  var listeners = [];
  var lastError = '';

  /* ---------- معرّف الجهاز ---------- */
  function deviceId() {
    var d = localStorage.getItem(DEV_KEY);
    if (!d) { d = App.uid().slice(0, 8); localStorage.setItem(DEV_KEY, d); }
    return d;
  }

  /* ---------- الإعدادات ---------- */
  function loadCfg() {
    if (cfg !== null) return cfg;
    try {
      var raw = localStorage.getItem(CFG_KEY);
      cfg = raw ? JSON.parse(raw) : null;
    } catch (e) { cfg = null; }
    return cfg;
  }
  function saveCfg(c) {
    cfg = c;
    if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CFG_KEY);
    emit();
  }
  function isOn() { var c = loadCfg(); return !!(c && c.url && c.key && c.room); }

  /* ---------- رمز الربط ---------- */
  function encodeCode(c) {
    var json = JSON.stringify({ u: c.url, k: c.key, r: c.room });
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return 'BINAA-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeCode(code) {
    try {
      var s = String(code).trim().replace(/^BINAA-/i, '').replace(/\s+/g, '');
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var o = JSON.parse(decodeURIComponent(escape(atob(s))));
      if (!o.u || !o.k || !o.r) return null;
      return { url: String(o.u).replace(/\/+$/, ''), key: o.k, room: o.r };
    } catch (e) { return null; }
  }
  function newRoom() { return App.uid().replace(/-/g, '').slice(0, 20); }

  /* ---------- تحويل بين شكل البيانات المحلي وشكل قاعدة البيانات ---------- */
  function toRow(m, room) {
    return {
      id: m.id, room: room,
      type: m.type, mat: m.mat,
      qty_ton: m.qtyTon, unit_price: m.unitPrice, value: m.value,
      note: m.note || '', party: m.party || '', ref: m.ref || '',
      ts: m.ts, updated_at: m.updatedAt, del: m.del ? 1 : 0
    };
  }
  function fromRow(r) {
    return {
      id: r.id, type: r.type, mat: r.mat,
      qtyTon: Number(r.qty_ton) || 0,
      unitPrice: Number(r.unit_price) || 0,
      value: Number(r.value) || 0,
      note: r.note || '', party: r.party || '', ref: r.ref || '',
      ts: Number(r.ts) || 0,
      updatedAt: Number(r.updated_at) || 0,
      del: r.del ? 1 : 0,
      dirty: 0
    };
  }

  /* ---------- نداء الشبكة ---------- */
  function api(path, opts) {
    var c = loadCfg();
    if (!c) return Promise.reject(new Error('مفيش إعدادات سحابة'));
    opts = opts || {};
    var headers = {
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    for (var h in (opts.headers || {})) headers[h] = opts.headers[h];

    var ctrl = null, timeoutId = null;
    if (global.AbortController) {
      ctrl = new AbortController();
      timeoutId = setTimeout(function () { ctrl.abort(); }, 20000);
    }

    return fetch(c.url + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ': ' + (t || '').slice(0, 200));
        });
      }
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') > -1 ? res.json() : null;
    }, function (err) {
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    });
  }

  /* ---------- رفع اللي اتعمل محلياً ---------- */
  function push() {
    var c = loadCfg();
    return Store.getDirty(PAGE).then(function (dirty) {
      if (!dirty.length) return 0;
      var rows = dirty.map(function (m) { return toRow(m, c.room); });
      return api('moves?on_conflict=id', {
        method: 'POST',
        body: rows,
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      }).then(function () {
        return Store.markClean(dirty.map(function (m) { return m.id; }));
      }).then(function () { return dirty.length; });
    });
  }

  /* ---------- تنزيل اللي عمله الشريك ---------- */
  function pull() {
    var c = loadCfg();
    var cursor = parseInt(localStorage.getItem(CUR_KEY) || '0', 10) || 0;

    var q = 'moves?room=eq.' + encodeURIComponent(c.room) +
            '&updated_at=gt.' + cursor +
            '&order=updated_at.asc&limit=' + PAGE;

    return api(q).then(function (rows) {
      if (!rows || !rows.length) return 0;
      var moves = rows.map(fromRow);
      var maxTs = cursor;
      moves.forEach(function (m) { if (m.updatedAt > maxTs) maxTs = m.updatedAt; });

      return Store.bulkPut(moves, true).then(function () {
        localStorage.setItem(CUR_KEY, String(maxTs));
        // الرصيد بيتعاد حسابه بعد أي دمج عشان يفضل مظبوط
        return Store.recomputeBalance();
      }).then(function () {
        // لو الدفعة كاملة يبقى فيه كمان — كمّل
        if (rows.length === PAGE) return pull().then(function (more) { return moves.length + more; });
        return moves.length;
      });
    });
  }

  /* ---------- دورة مزامنة كاملة ---------- */
  function syncNow(silent) {
    if (!isOn()) return Promise.resolve({ skipped: true });
    if (running) return Promise.resolve({ busy: true });
    if (global.navigator && navigator.onLine === false) {
      lastError = 'مفيش اتصال بالإنترنت';
      emit(); return Promise.resolve({ offline: true });
    }

    running = true; lastError = ''; emit();

    return push()
      .then(function (up) {
        return pull().then(function (down) { return { up: up, down: down }; });
      })
      .then(function (r) {
        running = false;
        localStorage.setItem('binaa_last_sync', String(Date.now()));
        emit();
        if (!silent && (r.up || r.down)) {
          var parts = [];
          if (r.up) parts.push('رفع ' + r.up);
          if (r.down) parts.push('نزّل ' + r.down);
          App.toast('تمت المزامنة ✓ ' + parts.join(' · '));
        }
        return r;
      })
      .catch(function (err) {
        running = false;
        lastError = err && err.message ? err.message : 'فشلت المزامنة';
        emit();
        if (!silent) App.toast('فشلت المزامنة: ' + lastError, 'err', 4200);
        return { error: lastError };
      });
  }

  /* ---------- التشغيل الدوري ---------- */
  function start() {
    stop();
    if (!isOn()) { emit(); return; }
    syncNow(true);
    timer = setInterval(function () {
      if (document.hidden) return;       // مانستهلكش بطارية والصفحة مقفولة
      syncNow(true);
    }, POLL_MS);

    document.addEventListener('visibilitychange', onVisible);
    global.addEventListener('online', onOnline);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener('visibilitychange', onVisible);
    global.removeEventListener('online', onOnline);
  }
  function onVisible() { if (!document.hidden) syncNow(true); }
  function onOnline() { syncNow(true); }

  /* ---------- اختبار الاتصال ---------- */
  function test(c) {
    var old = cfg;
    cfg = c;
    return api('moves?limit=1&select=id')
      .then(function () { cfg = old; return { ok: true }; })
      .catch(function (e) { cfg = old; return { ok: false, error: e.message }; });
  }

  /* ---------- الحالة ---------- */
  function status() {
    var last = parseInt(localStorage.getItem('binaa_last_sync') || '0', 10);
    return {
      on: isOn(),
      busy: running,
      error: lastError,
      lastSync: last || 0,
      device: deviceId(),
      room: isOn() ? loadCfg().room : ''
    };
  }
  function onChange(fn) { listeners.push(fn); fn(status()); }
  function emit() { var s = status(); listeners.forEach(function (f) { try { f(s); } catch (e) {} }); }

  global.Sync = {
    isOn: isOn, cfg: loadCfg, saveCfg: saveCfg,
    encodeCode: encodeCode, decodeCode: decodeCode, newRoom: newRoom,
    syncNow: syncNow, start: start, stop: stop, test: test,
    status: status, onChange: onChange,
    deviceId: deviceId
  };
})(window);
