/* ==========================================================================
   store.js — طبقة تخزين البيانات (IndexedDB) — الإصدار 2
   --------------------------------------------------------------------------
   الجديد في الإصدار 2:
     • الأصناف: كل حركة مربوطة بصنف (حديد 12 مم، أسمنت مقاوم…) وكل صنف له رصيده
     • تعديل حركة (مش بس تراجع) — والرصيد بيتظبط في نفس المعاملة
     • دفتر الجهات (العملاء والموردين) + كشف حساب لكل جهة
     • تنظيف أي بيانات جاية من نسخة احتياطية أو من السحابة قبل ما تتخزن
   الحركات القديمة (من غير صنف) بتتربط أوتوماتيك بصنف "عام" للمادة بتاعتها.
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'binaa_warehouse';
  const DB_VER  = 3;
  const S_PAY   = 'payments';
  const S_MOVES = 'moves';
  const S_META  = 'meta';

  const DEFAULT_SETTINGS = {
    steelPriceTon: 38700,
    cementBagPrice: 220,
    steelCapTon: 100,
    cementCapTon: 200,
    steelLowTon: 10,
    cementLowTon: 20
  };

  /* الأصناف الافتراضية — الصنف "steel"/"cement" هو "العام" للحركات القديمة */
  const DEFAULT_ITEMS = [
    { id: 'steel',  mat: 'steel',  name: 'حديد (بدون مقاس)', low: 0 },
    { id: 'st-8',   mat: 'steel',  name: 'حديد 8 مم',  low: 0 },
    { id: 'st-10',  mat: 'steel',  name: 'حديد 10 مم', low: 0 },
    { id: 'st-12',  mat: 'steel',  name: 'حديد 12 مم', low: 0 },
    { id: 'st-16',  mat: 'steel',  name: 'حديد 16 مم', low: 0 },
    { id: 'st-18',  mat: 'steel',  name: 'حديد 18 مم', low: 0 },
    { id: 'st-22',  mat: 'steel',  name: 'حديد 22 مم', low: 0 },
    { id: 'st-25',  mat: 'steel',  name: 'حديد 25 مم', low: 0 },
    { id: 'st-32',  mat: 'steel',  name: 'حديد 32 مم', low: 0 },
    { id: 'cement', mat: 'cement', name: 'أسمنت (بدون نوع)', low: 0 },
    { id: 'cm-opc', mat: 'cement', name: 'أسمنت بورتلاندي عادي', low: 0 },
    { id: 'cm-src', mat: 'cement', name: 'أسمنت مقاوم للأملاح', low: 0 }
  ];

  const MATS = ['steel', 'cement'];
  const TYPES = ['in', 'out'];

  let db = null;
  let readyPromise = null;
  let useFallback = false;

  /* ======================================================================
     تنظيف وتوحيد شكل الحركة — أي حركة داخلة للتخزين بتعدي من هنا
     (من النموذج، من نسخة احتياطية، أو من السحابة). ده بيمنع إن ملف
     متلاعب فيه يحط بيانات غريبة أو ضخمة جوه قاعدة البيانات.
     ====================================================================== */
  const str = (v, max) => (v === null || v === undefined ? '' : String(v)).slice(0, max);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

  function normalizeMove(m, opts) {
    if (!m || typeof m !== 'object') return null;
    const id = str(m.id, 64);
    if (!ID_RE.test(id)) return null;
    const mat = MATS.includes(m.mat) ? m.mat : null;
    const type = TYPES.includes(m.type) ? m.type : null;
    if (!mat || !type) return null;
    const qty = App.round3(Math.abs(num(m.qtyTon)));
    if (qty > 1e7) return null;
    const unitPrice = App.round3(Math.abs(num(m.unitPrice)));
    let item = str(m.item, 40);
    if (!item || !/^[A-Za-z0-9_-]+$/.test(item)) item = mat;
    const ts = num(m.ts) || Date.now();
    return {
      id, type, mat, item,
      qtyTon: qty,
      unitPrice,
      value: App.round3(qty * unitPrice),
      note: str(m.note, 300),
      party: str(m.party, 120).trim(),
      ref: str(m.ref, 60),
      by: str(m.by, 40),
      ts,
      updatedAt: num(m.updatedAt) || Date.now(),
      del: m.del ? 1 : 0,
      dirty: opts && 'dirty' in opts ? opts.dirty : (m.dirty ? 1 : 0)
    };
  }

  /* ======================================================================
     خطة بديلة: localStorage لو المتصفح رافض IndexedDB (file:// في بعض المتصفحات)
     ====================================================================== */
  const FB = {
    key: 'binaa_wh_fallback',
    data: null,
    load() {
      if (this.data) return this.data;
      try {
        const raw = localStorage.getItem(this.key);
        this.data = raw ? JSON.parse(raw) : { moves: [], meta: {} };
      } catch (e) { this.data = { moves: [], meta: {} }; }
      this.data.moves ||= [];
      this.data.meta ||= {};
      this.data.pays ||= [];
      return this.data;
    },
    save() {
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); return true; }
      catch (e) { return false; }
    }
  };

  /* ---------- فتح قاعدة البيانات ---------- */
  function open() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve) => {
      let req;
      const fallback = () => { useFallback = true; FB.load(); resolve(null); };
      try {
        if (!global.indexedDB) throw new Error('no indexedDB');
        req = global.indexedDB.open(DB_NAME, DB_VER);
      } catch (e) { return fallback(); }

      req.onupgradeneeded = (ev) => {
        const d = ev.target.result;
        const t = ev.target.transaction;
        let st;
        if (!d.objectStoreNames.contains(S_MOVES)) {
          st = d.createObjectStore(S_MOVES, { keyPath: 'id' });
          st.createIndex('ts', 'ts');
          st.createIndex('mat_ts', ['mat', 'ts']);
          st.createIndex('type_ts', ['type', 'ts']);
          st.createIndex('dirty', 'dirty');
          st.createIndex('updatedAt', 'updatedAt');
          st.createIndex('del', 'del');
        } else {
          st = t.objectStore(S_MOVES);
        }
        if (!st.indexNames.contains('item_ts')) st.createIndex('item_ts', ['item', 'ts']);
        if (!d.objectStoreNames.contains(S_META)) d.createObjectStore(S_META, { keyPath: 'k' });
        if (!d.objectStoreNames.contains(S_PAY)) {
          const ps = d.createObjectStore(S_PAY, { keyPath: 'id' });
          ps.createIndex('ts', 'ts');
          ps.createIndex('dirty', 'dirty');
          ps.createIndex('party_ts', ['party', 'ts']);
        }

        /* ترقية v1 → v2: كل حركة قديمة تاخد صنف "عام" + نحسب أرصدة الأصناف */
        if (ev.oldVersion > 0 && ev.oldVersion < 2) {
          const itemBal = {};
          st.openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) {
              t.objectStore(S_META).put({ k: 'itemBal', v: itemBal });
              return;
            }
            const m = c.value;
            if (!m.item) { m.item = m.mat; c.update(m); }
            if (!m.del) itemBal[m.item] = App.round3((itemBal[m.item] || 0) + (m.type === 'in' ? 1 : -1) * m.qtyTon);
            c.continue();
          };
        }
      };

      req.onsuccess = (ev) => {
        db = ev.target.result;
        db.onversionchange = () => { try { db.close(); } catch (e) {} };
        resolve(db);
      };
      req.onerror = fallback;
      req.onblocked = fallback;
      setTimeout(() => { if (!db && !useFallback) fallback(); }, 2500);
    });
    return readyPromise;
  }

  const tx = (stores, mode) => db.transaction(stores, mode);
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const done = (t) => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
  });

  /* مسح كامل بالمؤشر — مع دالة لكل سجل */
  function scan(source, range, dir, fn) {
    return new Promise((resolve, reject) => {
      const cur = source.openCursor(range || null, dir || 'next');
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = (ev) => {
        const c = ev.target.result;
        if (!c) return resolve();
        if (fn(c.value) === false) return resolve();
        c.continue();
      };
    });
  }
  function tsRange(from, to) {
    if (from && to) return IDBKeyRange.bound(from, to);
    if (from) return IDBKeyRange.lowerBound(from);
    if (to) return IDBKeyRange.upperBound(to);
    return null;
  }

  /* ---------- الميتا ---------- */
  async function metaGet(key, fallbackValue) {
    await open();
    if (useFallback) { const v = FB.load().meta[key]; return v === undefined ? fallbackValue : v; }
    const row = await wrap(tx([S_META], 'readonly').objectStore(S_META).get(key));
    return row ? row.v : fallbackValue;
  }
  async function metaSet(key, value) {
    await open();
    if (useFallback) { FB.load().meta[key] = value; if (!FB.save()) throw new Error('QUOTA'); return; }
    const t = tx([S_META], 'readwrite');
    t.objectStore(S_META).put({ k: key, v: value });
    return done(t);
  }

  /* ---------- الإعدادات ---------- */
  async function getSettings() {
    const s = await metaGet('settings', {});
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (s && s[k] !== undefined && s[k] !== null && Number.isFinite(Number(s[k]))) out[k] = Number(s[k]);
    }
    return out;
  }
  async function setSettings(patch) {
    const cur = await getSettings();
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (patch && k in patch && Number.isFinite(Number(patch[k]))) cur[k] = Math.max(0, Number(patch[k]));
    }
    await metaSet('settings', cur);
    if (patch && ('steelPriceTon' in patch || 'cementBagPrice' in patch)) await metaSet('prices_at', (patch && patch._stamp) || Date.now());
    return cur;
  }

  /* ---------- الأصناف ---------- */
  function cleanItems(list) {
    const seen = new Set();
    const out = [];
    for (const it of Array.isArray(list) ? list : []) {
      if (!it || !MATS.includes(it.mat)) continue;
      const id = str(it.id, 40);
      if (!/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, mat: it.mat, name: str(it.name, 60).trim() || id, low: Math.max(0, num(it.low)), hidden: it.hidden ? 1 : 0 });
    }
    /* الصنفين العامين لازم يفضلوا موجودين */
    for (const m of MATS) if (!seen.has(m)) out.unshift(DEFAULT_ITEMS.find((d) => d.id === m));
    return out;
  }
  async function getItems() {
    const raw = await metaGet('items', null);
    return cleanItems(raw || DEFAULT_ITEMS);
  }
  async function setItems(list, stamp) {
    const clean = cleanItems(list);
    await metaSet('items', clean);
    await metaSet('items_at', stamp || Date.now());
    return clean;
  }

  /* ---------- الرصيد ---------- */
  const ZERO = () => ({ steelTon: 0, cementTon: 0 });
  async function getBalance() {
    const b = await metaGet('balance', null);
    return b && typeof b.steelTon === 'number' ? b : ZERO();
  }
  async function getItemBalances() {
    return (await metaGet('itemBal', null)) || {};
  }

  /* تطبيق أثر حركة على الرصيد (sign = 1 تطبيق، -1 إلغاء) */
  function applyMove(bal, itemBal, m, sign) {
    const d = sign * (m.type === 'in' ? 1 : -1) * m.qtyTon;
    if (m.mat === 'steel') bal.steelTon = App.round3(bal.steelTon + d);
    else bal.cementTon = App.round3(bal.cementTon + d);
    itemBal[m.item] = App.round3((itemBal[m.item] || 0) + d);
  }

  /* ======================================================================
     كتابة حركة (إضافة / تعديل / إلغاء) — الحركة والرصيدين في معاملة واحدة
     ====================================================================== */
  async function writeMove(id, mutate) {
    await open();
    if (useFallback) {
      const d = FB.load();
      const idx = id ? d.moves.findIndex((x) => x.id === id) : -1;
      const old = idx > -1 ? d.moves[idx] : null;
      const bal = d.meta.balance || ZERO();
      const ib = d.meta.itemBal || {};
      const next = mutate(old);
      if (!next) return null;
      if (old && !old.del) applyMove(bal, ib, old, -1);
      if (!next.del) applyMove(bal, ib, next, 1);
      if (idx > -1) d.moves[idx] = next; else d.moves.push(next);
      d.meta.balance = bal; d.meta.itemBal = ib;
      if (!FB.save()) throw new Error('QUOTA');
      return { move: next, balance: bal, itemBal: ib, old };
    }

    const t = tx([S_MOVES, S_META], 'readwrite');
    const moves = t.objectStore(S_MOVES);
    const meta = t.objectStore(S_META);
    let result = null;

    const proceed = (old) => {
      const next = mutate(old);
      if (!next) return;
      moves.put(next);
      meta.get('balance').onsuccess = (e1) => {
        const bal = (e1.target.result && e1.target.result.v) || ZERO();
        meta.get('itemBal').onsuccess = (e2) => {
          const ib = (e2.target.result && e2.target.result.v) || {};
          if (old && !old.del) applyMove(bal, ib, old, -1);
          if (!next.del) applyMove(bal, ib, next, 1);
          meta.put({ k: 'balance', v: bal });
          meta.put({ k: 'itemBal', v: ib });
          result = { move: next, balance: bal, itemBal: ib, old };
        };
      };
    };
    if (id) moves.get(id).onsuccess = (ev) => proceed(ev.target.result || null);
    else proceed(null);

    await done(t);
    return result;
  }

  function addMove(m) {
    const now = Date.now();
    const move = normalizeMove({ ...m, id: m.id || App.uid().replace(/[^A-Za-z0-9_-]/g, ''), ts: m.ts || now, updatedAt: now }, { dirty: 1 });
    if (!move || move.qtyTon <= 0) return Promise.reject(new Error('بيانات الحركة مش صحيحة'));
    return writeMove(null, () => move);
  }

  function updateMove(id, patch) {
    return writeMove(id, (old) => {
      if (!old || old.del) return null;
      const merged = normalizeMove({ ...old, ...patch, id: old.id, updatedAt: Date.now() }, { dirty: 1 });
      return merged && merged.qtyTon > 0 ? merged : null;
    });
  }

  /* حذف ناعم (del=1) عشان المزامنة تبلّغ الجهاز التاني */
  function removeMove(id) {
    return writeMove(id, (old) => (old && !old.del ? { ...old, del: 1, dirty: 1, updatedAt: Date.now() } : null));
  }
  /* استرجاع حركة اتلغت (زرار "تراجع" في التنبيه) */
  function restoreMove(id) {
    return writeMove(id, (old) => (old && old.del ? { ...old, del: 0, dirty: 1, updatedAt: Date.now() } : null));
  }

  async function getMove(id) {
    await open();
    if (useFallback) return FB.load().moves.find((m) => m.id === id) || null;
    return (await wrap(tx([S_MOVES], 'readonly').objectStore(S_MOVES).get(id))) || null;
  }

  /* ======================================================================
     قراءة صفحة من السجل — من غير ما نقرا السجل كله
     ====================================================================== */
  function makeMatcher(o) {
    const text = (o.text || '').trim().toLowerCase();
    const party = (o.party || '').trim();
    return (m) => {
      if (m.del) return false;
      if (o.mat && m.mat !== o.mat) return false;
      if (o.type && m.type !== o.type) return false;
      if (o.item && m.item !== o.item) return false;
      if (party && m.party !== party) return false;
      if (o.from && m.ts < o.from) return false;
      if (o.to && m.ts > o.to) return false;
      if (text) {
        const hay = (m.note + ' ' + m.party + ' ' + m.ref).toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    };
  }

  async function query(opts = {}) {
    const page = Math.max(1, opts.page || 1);
    const size = opts.pageSize || 25;
    const offset = (page - 1) * size;
    const hasFilter = !!(opts.mat || opts.type || opts.item || opts.party || opts.from || opts.to || (opts.text || '').trim());
    const match = makeMatcher(opts);

    await open();
    if (useFallback) {
      const all = FB.load().moves.filter(match).sort((a, b) => b.ts - a.ts);
      return { rows: all.slice(offset, offset + size), total: all.length, filtered: hasFilter };
    }

    const t = tx([S_MOVES], 'readonly');
    const store = t.objectStore(S_MOVES);
    const idx = store.index('ts');

    if (!hasFilter) {
      /* الحالة السريعة: عد من الفهرس + قفزة مباشرة للصفحة */
      const [rawTotal, active] = await Promise.all([wrap(store.count()), wrap(store.index('del').count(IDBKeyRange.only(0)))]);
      const clean = rawTotal === active;
      return new Promise((resolve, reject) => {
        const rows = [];
        let seen = 0, jumped = false;
        const cur = idx.openCursor(null, 'prev');
        cur.onerror = () => reject(cur.error);
        cur.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return resolve({ rows, total: active, filtered: false });
          if (clean && !jumped && offset > 0) { jumped = true; c.advance(offset); return; }
          jumped = true;
          const v = c.value;
          if (v.del) { c.continue(); return; }
          if (clean || seen >= offset) {
            rows.push(v);
            if (rows.length >= size) return resolve({ rows, total: active, filtered: false });
          }
          seen++;
          c.continue();
        };
      });
    }

    /* بالفلاتر: لو فيه صنف نستخدم فهرس item_ts (أسرع بكتير) */
    const rows = [];
    let total = 0;
    let source = idx, range = tsRange(opts.from, opts.to);
    if (opts.item && store.indexNames.contains('item_ts')) {
      source = store.index('item_ts');
      range = IDBKeyRange.bound([opts.item, opts.from || 0], [opts.item, opts.to || Number.MAX_SAFE_INTEGER]);
    }
    await scan(source, range, 'prev', (v) => {
      if (match(v)) {
        if (total >= offset && rows.length < size) rows.push(v);
        total++;
      }
    });
    return { rows, total, filtered: true };
  }

  /* ---------- مرور على كل الحركات السارية (من الأحدث) ---------- */
  async function eachMove(cb, opts) {
    await open();
    const match = opts ? makeMatcher(opts) : (m) => !m.del;
    if (useFallback) {
      [...FB.load().moves].sort((a, b) => b.ts - a.ts).forEach((m) => { if (match(m)) cb(m); });
      return;
    }
    const range = opts ? tsRange(opts.from, opts.to) : null;
    await scan(tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('ts'), range, 'prev', (m) => { if (match(m)) cb(m); });
  }

  /* ======================================================================
     تجميع على فترات (للرسم البياني والتقارير)
     ====================================================================== */
  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                     'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const p2 = (n) => (n < 10 ? '0' + n : '' + n);
  function bucketKey(ts, bucket) {
    const d = new Date(ts);
    return bucket === 'day' ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
  }
  function bucketLabel(key, bucket) {
    const p = key.split('-');
    return bucket === 'day' ? p[2] + '/' + p[1] : AR_MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }

  async function series(opts = {}) {
    const { from, to } = opts;
    const bucket = opts.bucket === 'day' ? 'day' : 'month';
    const order = [], map = {};
    const cur = new Date(from);
    cur.setHours(0, 0, 0, 0);
    if (bucket === 'month') cur.setDate(1);
    let guard = 0;
    while (cur.getTime() <= to && guard++ < 1000) {
      const k = bucketKey(cur.getTime(), bucket);
      if (!map[k]) {
        map[k] = { key: k, label: bucketLabel(k, bucket), inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0 };
        order.push(k);
      }
      if (bucket === 'day') cur.setDate(cur.getDate() + 1); else cur.setMonth(cur.getMonth() + 1);
    }
    const totals = { inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0 };
    const byItem = {};
    await eachMove((m) => {
      const b = map[bucketKey(m.ts, bucket)];
      if (!b) return;
      const side = m.type === 'in' ? 'in' : 'out';
      b[side + 'Ton'] += m.qtyTon; b[side + 'Val'] += m.value; b.count++;
      totals[side + 'Ton'] += m.qtyTon; totals[side + 'Val'] += m.value; totals.count++;
      const bi = (byItem[m.item] ||= { inTon: 0, outTon: 0 });
      bi[side + 'Ton'] += m.qtyTon;
    }, { from, to, mat: opts.mat || '', item: opts.item || '' });

    const rows = order.map((k) => {
      const b = map[k];
      b.inTon = App.round3(b.inTon); b.outTon = App.round3(b.outTon);
      b.netTon = App.round3(b.inTon - b.outTon);
      return b;
    });
    totals.inTon = App.round3(totals.inTon);
    totals.outTon = App.round3(totals.outTon);
    totals.netTon = App.round3(totals.inTon - totals.outTon);
    return { buckets: rows, totals, byItem, bucket, from, to, mat: opts.mat || '' };
  }

  /* ======================================================================
     دفتر الجهات: كل عميل/مورد وإجمالي تعاملاته
     ====================================================================== */
  async function parties() {
    const map = new Map();
    await eachMove((m) => {
      if (!m.party) return;
      let p = map.get(m.party);
      if (!p) { p = { name: m.party, inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0, last: 0 }; map.set(m.party, p); }
      const side = m.type === 'in' ? 'in' : 'out';
      p[side + 'Ton'] += m.qtyTon; p[side + 'Val'] += m.value; p.count++;
      if (m.ts > p.last) p.last = m.ts;
    });
    return [...map.values()].map((p) => ({
      ...p, inTon: App.round3(p.inTon), outTon: App.round3(p.outTon)
    })).sort((a, b) => b.last - a.last);
  }

  /* ---------- إعادة حساب الرصيد من السجل ---------- */
  async function recomputeBalance() {
    const bal = ZERO(), ib = {};
    await eachMove((m) => applyMove(bal, ib, m, 1));
    await metaSet('balance', bal);
    await metaSet('itemBal', ib);
    return bal;
  }

  /* ---------- استيراد دفعة (نسخة احتياطية أو مزامنة) ----------
     كل سجل بيتنضف. ولو عندنا نسخة أحدث من نفس الحركة ما بنكتبش فوقها. */
  async function bulkPut(list, markClean) {
    if (!list || !list.length) return 0;
    const clean = list.map((m) => normalizeMove(m, markClean ? { dirty: 0 } : undefined)).filter(Boolean);
    await open();
    if (useFallback) {
      const d = FB.load();
      const byId = new Map(d.moves.map((m, i) => [m.id, i]));
      for (const m of clean) {
        const i = byId.get(m.id);
        if (i === undefined) d.moves.push(m);
        else if ((d.moves[i].updatedAt || 0) <= m.updatedAt) d.moves[i] = m;
      }
      if (!FB.save()) throw new Error('QUOTA');
      return clean.length;
    }
    const t = tx([S_MOVES], 'readwrite');
    const st = t.objectStore(S_MOVES);
    for (const m of clean) {
      st.get(m.id).onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur || (cur.updatedAt || 0) <= m.updatedAt) st.put(m);
      };
    }
    await done(t);
    return clean.length;
  }

  async function getDirty(limit = 200) {
    await open();
    if (useFallback) return FB.load().moves.filter((m) => m.dirty === 1).slice(0, limit);
    const out = [];
    await scan(tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('dirty'), IDBKeyRange.only(1), 'next', (v) => {
      out.push(v);
      return out.length < limit;
    });
    return out;
  }

  /* بنعلّم الحركة نضيفة بس لو ما اتعدلتش تاني أثناء الرفع */
  async function markClean(list) {
    if (!list || !list.length) return;
    const want = new Map(list.map((m) => [m.id, m.updatedAt]));
    await open();
    if (useFallback) {
      FB.load().moves.forEach((m) => { if (want.has(m.id) && want.get(m.id) === m.updatedAt) m.dirty = 0; });
      FB.save();
      return;
    }
    const t = tx([S_MOVES], 'readwrite');
    const st = t.objectStore(S_MOVES);
    for (const [id, upd] of want) {
      st.get(id).onsuccess = (ev) => {
        const m = ev.target.result;
        if (m && m.updatedAt === upd) { m.dirty = 0; st.put(m); }
      };
    }
    return done(t);
  }

  async function wipe() {
    await open();
    if (useFallback) { FB.data = { moves: [], pays: [], meta: { settings: FB.load().meta.settings, items: FB.load().meta.items } }; FB.save(); return; }
    const t = tx([S_MOVES, S_META, S_PAY], 'readwrite');
    t.objectStore(S_MOVES).clear();
    t.objectStore(S_PAY).clear();
    t.objectStore(S_META).delete('balance');
    t.objectStore(S_META).delete('itemBal');
    return done(t);
  }

  async function count() {
    await open();
    if (useFallback) return FB.load().moves.filter((m) => !m.del).length;
    return wrap(tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('del').count(IDBKeyRange.only(0)));
  }

  /* ---------- بيانات تجريبية: Store.seed(15000).then(()=>location.reload()) ---------- */
  async function seed(n = 15000) {
    const notes = ['الدور الثالث', 'مشروع الشيخ زايد', 'عمارة 12', 'ورشة الحدادة', 'صب سقف', 'أساسات', 'مخزن فرعي', 'تشطيبات', ''];
    const partiesL = ['مصنع عز', 'مورد السويس', 'أسمنت العريش', 'مقاول الموقع', 'شركة النصر', 'الحاج محمود', ''];
    const items = await getItems();
    const steelItems = items.filter((i) => i.mat === 'steel' && i.id !== 'steel');
    const cementItems = items.filter((i) => i.mat === 'cement' && i.id !== 'cement');
    const now = Date.now();
    const bal = ZERO(), ib = {};
    const batch = [];
    for (let i = 0; i < n; i++) {
      const mat = Math.random() < 0.5 ? 'steel' : 'cement';
      const pool = mat === 'steel' ? steelItems : cementItems;
      const item = pool[i % pool.length].id;
      let type = Math.random() < 0.56 ? 'in' : 'out';
      const qty = App.round3(Math.random() * 4 + 0.5);
      if (type === 'out' && (ib[item] || 0) - qty < 0) type = 'in';
      const m = normalizeMove({
        id: App.uid().replace(/[^A-Za-z0-9_-]/g, ''), type, mat, item, qtyTon: qty,
        unitPrice: mat === 'steel' ? 38700 : 4400,
        note: notes[i % notes.length], party: partiesL[i % partiesL.length], ref: 'REF-' + (10000 + i),
        ts: now - Math.floor((n - i) * (730 * 864e5 / n)) + Math.floor(Math.random() * 36e5),
        updatedAt: now
      }, { dirty: 0 });
      applyMove(bal, ib, m, 1);
      batch.push(m);
    }
    for (let s = 0; s < batch.length; s += 1000) await bulkPut(batch.slice(s, s + 1000), true);
    await metaSet('balance', bal);
    await metaSet('itemBal', ib);
    return n;
  }

  /* ======================================================================
     الدفعات — حسابات العملاء والموردين
     dir: 'in' = استلمنا فلوس (من عميل) · 'out' = دفعنا فلوس (لمورد)
     الدفعة اللي اتعملت أوتوماتيك مع حركة "كاش" مربوطة بيها: ref = 'M:<id الحركة>'
     ====================================================================== */
  function normalizePay(p, opts) {
    if (!p || typeof p !== 'object') return null;
    const id = str(p.id, 64);
    if (!ID_RE.test(id)) return null;
    if (p.dir !== 'in' && p.dir !== 'out') return null;
    const party = str(p.party, 120).trim();
    if (!party) return null;
    const amount = App.round3(Math.abs(num(p.amount)));
    if (amount > 1e12) return null;
    return {
      id, party, dir: p.dir, amount,
      method: str(p.method, 20), note: str(p.note, 300), ref: str(p.ref, 60), by: str(p.by, 40),
      ts: num(p.ts) || Date.now(), updatedAt: num(p.updatedAt) || Date.now(),
      del: p.del ? 1 : 0,
      dirty: opts && 'dirty' in opts ? opts.dirty : (p.dirty ? 1 : 0)
    };
  }
  async function putPay(p) {
    await open();
    if (useFallback) {
      const d = FB.load(); const i = d.pays.findIndex((x) => x.id === p.id);
      if (i > -1) d.pays[i] = p; else d.pays.push(p);
      if (!FB.save()) throw new Error('QUOTA');
      return p;
    }
    const t = tx([S_PAY], 'readwrite'); t.objectStore(S_PAY).put(p); await done(t); return p;
  }
  async function getPay(id) {
    await open();
    if (useFallback) return FB.load().pays.find((x) => x.id === id) || null;
    return (await wrap(tx([S_PAY], 'readonly').objectStore(S_PAY).get(id))) || null;
  }
  async function addPayment(p) {
    const now = Date.now();
    const pay = normalizePay({ ...p, id: p.id || App.uid(), ts: p.ts || now, updatedAt: now }, { dirty: 1 });
    if (!pay || pay.amount <= 0) throw new Error('بيانات الدفعة مش صحيحة');
    return putPay(pay);
  }
  async function updatePayment(id, patch) {
    const old = await getPay(id);
    if (!old) return null;
    const p = normalizePay({ ...old, ...patch, id, updatedAt: Date.now() }, { dirty: 1 });
    return p ? putPay(p) : null;
  }
  async function eachPayment(cb, opts = {}) {
    await open();
    const ok = (p) => !p.del && (!opts.party || p.party === opts.party) && (!opts.from || p.ts >= opts.from) && (!opts.to || p.ts <= opts.to);
    if (useFallback) { [...FB.load().pays].sort((a, b) => b.ts - a.ts).forEach((p) => { if (ok(p)) cb(p); }); return; }
    const st = tx([S_PAY], 'readonly').objectStore(S_PAY);
    if (opts.party) {
      await scan(st.index('party_ts'), IDBKeyRange.bound([opts.party, 0], [opts.party, Number.MAX_SAFE_INTEGER]), 'prev', (p) => { if (ok(p)) cb(p); });
    } else {
      await scan(st.index('ts'), null, 'prev', (p) => { if (ok(p)) cb(p); });
    }
  }
  /* الدفعة المربوطة بحركة (كاش) */
  async function linkedPayment(moveId) {
    let found = null;
    await open();
    const ref = 'M:' + moveId;
    if (useFallback) return FB.load().pays.find((p) => p.ref === ref) || null;
    await scan(tx([S_PAY], 'readonly').objectStore(S_PAY), null, 'next', (p) => { if (p.ref === ref) { found = p; return false; } });
    return found;
  }
  /* بنظبط الدفعة المربوطة بعد إضافة/تعديل/إلغاء حركة */
  async function syncLinkedPayment(move, cash) {
    if (!move) return;
    const cur = await linkedPayment(move.id);
    const want = cash !== undefined ? cash : !!(cur && !cur.del);
    if (!move.party || move.del || !want || !(move.value > 0)) {
      if (cur && !cur.del) await updatePayment(cur.id, { del: 1 });
      return;
    }
    const data = { party: move.party, dir: move.type === 'out' ? 'in' : 'out', amount: move.value, method: 'cash', ts: move.ts, by: move.by, del: 0,
                   note: (move.type === 'out' ? 'تحصيل كاش مع إذن صرف' : 'سداد كاش مع إذن استلام') };
    if (cur) await updatePayment(cur.id, data);
    else await addPayment({ ...data, ref: 'M:' + move.id });
  }
  async function getDirtyPay(limit = 200) {
    await open();
    if (useFallback) return FB.load().pays.filter((p) => p.dirty === 1).slice(0, limit);
    const out = [];
    await scan(tx([S_PAY], 'readonly').objectStore(S_PAY).index('dirty'), IDBKeyRange.only(1), 'next', (v) => { out.push(v); return out.length < limit; });
    return out;
  }
  async function markCleanPay(list) {
    if (!list || !list.length) return;
    const want = new Map(list.map((p) => [p.id, p.updatedAt]));
    await open();
    if (useFallback) { FB.load().pays.forEach((p) => { if (want.get(p.id) === p.updatedAt) p.dirty = 0; }); FB.save(); return; }
    const t = tx([S_PAY], 'readwrite'); const st = t.objectStore(S_PAY);
    for (const [id, upd] of want) st.get(id).onsuccess = (ev) => { const p = ev.target.result; if (p && p.updatedAt === upd) { p.dirty = 0; st.put(p); } };
    return done(t);
  }
  async function bulkPutPay(list, markClean) {
    const clean = (list || []).map((p) => normalizePay(p, markClean ? { dirty: 0 } : undefined)).filter(Boolean);
    if (!clean.length) return 0;
    await open();
    if (useFallback) {
      const d = FB.load(); const byId = new Map(d.pays.map((p, i) => [p.id, i]));
      for (const p of clean) { const i = byId.get(p.id); if (i === undefined) d.pays.push(p); else if (d.pays[i].updatedAt <= p.updatedAt) d.pays[i] = p; }
      FB.save(); return clean.length;
    }
    const t = tx([S_PAY], 'readwrite'); const st = t.objectStore(S_PAY);
    for (const p of clean) st.get(p.id).onsuccess = (ev) => { const cur = ev.target.result; if (!cur || cur.updatedAt <= p.updatedAt) st.put(p); };
    await done(t);
    return clean.length;
  }

  /* ======================================================================
     كشف حساب جهة: الحركات + الدفعات بالترتيب مع رصيد متحرك
     الرصيد الموجب = الجهة عليها فلوس لينا · السالب = إحنا علينا فلوس للجهة
     ====================================================================== */
  async function statement(party) {
    const rows = [];
    await eachMove((m) => rows.push({ kind: 'move', ts: m.ts, m, debit: m.type === 'out' ? m.value : 0, credit: m.type === 'in' ? m.value : 0 }), { party });
    await eachPayment((p) => rows.push({ kind: 'pay', ts: p.ts, p, debit: p.dir === 'out' ? p.amount : 0, credit: p.dir === 'in' ? p.amount : 0 }), { party });
    rows.sort((a, b) => a.ts - b.ts);
    let bal = 0, debit = 0, credit = 0;
    for (const r of rows) { bal += r.debit - r.credit; debit += r.debit; credit += r.credit; r.balance = App.round3(bal); }
    return { party, rows, debit: App.round3(debit), credit: App.round3(credit), balance: App.round3(bal) };
  }

  /* ---------- أرصدة كل الجهات (للدفتر) ---------- */
  async function partyAccounts() {
    const list = await parties();
    const map = new Map(list.map((p) => [p.name, { ...p, payIn: 0, payOut: 0 }]));
    await eachPayment((p) => {
      let a = map.get(p.party);
      if (!a) { a = { name: p.party, inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0, last: p.ts, payIn: 0, payOut: 0 }; map.set(p.party, a); }
      if (p.dir === 'in') a.payIn += p.amount; else a.payOut += p.amount;
      if (p.ts > a.last) a.last = p.ts;
    });
    return [...map.values()].map((a) => ({ ...a, balance: App.round3((a.outVal - a.payIn) - (a.inVal - a.payOut)) })).sort((a, b) => b.last - a.last);
  }

  /* ======================================================================
     تحليلات الأصناف: متوسط تكلفة الشراء + معدل الصرف اليومي (آخر 30 يوم)
     ====================================================================== */
  async function itemInsights() {
    const since = Date.now() - 30 * 864e5;
    const acc = {};
    await eachMove((m) => {
      const a = (acc[m.item] ||= { inTon: 0, inVal: 0, out30: 0, outTon: 0, outVal: 0 });
      if (m.type === 'in') { a.inTon += m.qtyTon; a.inVal += m.value; }
      else { a.outTon += m.qtyTon; a.outVal += m.value; if (m.ts >= since) a.out30 += m.qtyTon; }
    });
    const out = {};
    for (const [id, a] of Object.entries(acc)) {
      const avgCost = a.inTon > 0 ? a.inVal / a.inTon : 0;
      out[id] = {
        avgCost: App.round3(avgCost),
        dailyOut: App.round3(a.out30 / 30),
        profit: avgCost > 0 ? App.round3(a.outVal - a.outTon * avgCost) : null
      };
    }
    return out;
  }

  async function info() {
    await open();
    return { engine: useFallback ? 'localStorage (احتياطي)' : 'IndexedDB', fallback: useFallback };
  }

  global.Store = {
    ready: open, info,
    getSettings, setSettings, DEFAULT_SETTINGS,
    getItems, setItems, DEFAULT_ITEMS,
    getBalance, getItemBalances, recomputeBalance,
    addMove, updateMove, removeMove, restoreMove, getMove,
    query, series, eachMove, parties, count,
    bulkPut, getDirty, markClean, normalizeMove,
    addPayment, updatePayment, getPay, eachPayment, syncLinkedPayment, linkedPayment,
    getDirtyPay, markCleanPay, bulkPutPay, normalizePay,
    statement, partyAccounts, itemInsights,
    metaGet, metaSet, wipe, seed
  };
})(window);
