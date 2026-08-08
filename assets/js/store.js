/* ==========================================================================
   store.js — طبقة تخزين البيانات (IndexedDB)
   --------------------------------------------------------------------------
   ليه IndexedDB مش localStorage؟
     • localStorage سقفه ~5 ميجا وبيقع بعد ~10 آلاف سجل ويضيّع البيانات
     • localStorage بيحفظ كل حاجة نص واحد → لازم يعيد تحويل الملف كله مع كل حفظة
     • IndexedDB بيشيل مئات الميجات، وله فهارس، وبيقرا صفحة صفحة
   النتيجة: 15,000 سجل (وأكتر) من غير أي بطء.
   ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'binaa_warehouse';
  var DB_VER  = 1;
  var S_MOVES = 'moves';
  var S_META  = 'meta';

  var DEFAULT_SETTINGS = {
    steelPriceTon: 38700,
    cementBagPrice: 220,
    steelCapTon: 100,      // السعة القصوى للمخزن — لحساب النِسب
    cementCapTon: 200,
    steelLowTon: 10,       // حد التنبيه (اطلب بضاعة)
    cementLowTon: 20
  };

  var db = null;
  var readyPromise = null;
  var useFallback = false;

  /* ======================================================================
     خطة بديلة: لو المتصفح رافض IndexedDB (بيحصل لما تفتح الملف بـ file://
     في بعض المتصفحات) بنشتغل على localStorage عشان الصفحة متقفش.
     ====================================================================== */
  var FB = {
    key: 'binaa_wh_fallback',
    data: null,
    load: function () {
      if (this.data) return this.data;
      try {
        var raw = localStorage.getItem(this.key);
        this.data = raw ? JSON.parse(raw) : { moves: [], meta: {} };
      } catch (e) { this.data = { moves: [], meta: {} }; }
      if (!this.data.moves) this.data.moves = [];
      if (!this.data.meta)  this.data.meta = {};
      return this.data;
    },
    save: function () {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.data));
        return true;
      } catch (e) {
        // امتلأت المساحة
        return false;
      }
    }
  };

  /* ---------- فتح قاعدة البيانات ---------- */
  function open() {
    if (readyPromise) return readyPromise;

    readyPromise = new Promise(function (resolve) {
      var req;
      try {
        if (!global.indexedDB) throw new Error('no indexedDB');
        req = global.indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        useFallback = true; FB.load(); return resolve(null);
      }

      req.onupgradeneeded = function (ev) {
        var d = ev.target.result;

        if (!d.objectStoreNames.contains(S_MOVES)) {
          var st = d.createObjectStore(S_MOVES, { keyPath: 'id' });
          st.createIndex('ts', 'ts');                 // للترتيب والفلترة بالتاريخ
          st.createIndex('mat_ts', ['mat', 'ts']);    // فلترة بالمادة + ترتيب
          st.createIndex('type_ts', ['type', 'ts']);  // فلترة بالنوع + ترتيب
          st.createIndex('dirty', 'dirty');           // اللي لسه محتاج يترفع للسحابة
          st.createIndex('updatedAt', 'updatedAt');
          st.createIndex('del', 'del');               // للعد السريع للحركات السارية
        }
        if (!d.objectStoreNames.contains(S_META)) {
          d.createObjectStore(S_META, { keyPath: 'k' });
        }
      };

      req.onsuccess = function (ev) {
        db = ev.target.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} };
        resolve(db);
      };

      req.onerror = function () { useFallback = true; FB.load(); resolve(null); };
      req.onblocked = function () { useFallback = true; FB.load(); resolve(null); };

      // لو المتصفح علّق من غير ما يرد (بيحصل على file://)
      setTimeout(function () {
        if (!db && !useFallback) { useFallback = true; FB.load(); resolve(null); }
      }, 2500);
    });

    return readyPromise;
  }

  function tx(stores, mode) {
    return db.transaction(stores, mode);
  }
  function wrap(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function done(t) {
    return new Promise(function (res, rej) {
      t.oncomplete = function () { res(); };
      t.onerror = function () { rej(t.error); };
      t.onabort = function () { rej(t.error || new Error('aborted')); };
    });
  }

  /* ---------- الإعدادات والرصيد ---------- */
  function metaGet(key, fallbackValue) {
    return open().then(function () {
      if (useFallback) {
        var v = FB.load().meta[key];
        return v === undefined ? fallbackValue : v;
      }
      return wrap(tx([S_META], 'readonly').objectStore(S_META).get(key))
        .then(function (row) { return row ? row.v : fallbackValue; });
    });
  }

  function metaSet(key, value) {
    return open().then(function () {
      if (useFallback) { FB.load().meta[key] = value; FB.save(); return; }
      var t = tx([S_META], 'readwrite');
      t.objectStore(S_META).put({ k: key, v: value });
      return done(t);
    });
  }

  function getSettings() {
    return metaGet('settings', {}).then(function (s) {
      var out = {};
      for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
      for (var j in (s || {})) if (s[j] !== undefined && s[j] !== null) out[j] = s[j];
      return out;
    });
  }
  function setSettings(patch) {
    return getSettings().then(function (cur) {
      for (var k in patch) cur[k] = patch[k];
      return metaSet('settings', cur).then(function () { return cur; });
    });
  }

  function getBalance() {
    return metaGet('balance', null).then(function (b) {
      if (b && typeof b.steelTon === 'number') return b;
      return { steelTon: 0, cementTon: 0 };
    });
  }

  /* ======================================================================
     إضافة حركة — الحركة والرصيد بيتحفظوا في معاملة واحدة (transaction)
     يعني: يا الاتنين ينجحوا يا الاتنين يفشلوا. مستحيل الرصيد يبوظ.
     ====================================================================== */
  function addMove(m) {
    var now = Date.now();
    var move = {
      id: m.id || App.uid(),
      type: m.type,                       // 'in' استلام | 'out' صرف
      mat: m.mat,                         // 'steel' | 'cement'
      qtyTon: App.round3(m.qtyTon),
      unitPrice: App.round3(m.unitPrice || 0),  // سعر الطن وقت الحركة (لقطة سعرية)
      value: App.round3((m.qtyTon || 0) * (m.unitPrice || 0)),
      note: (m.note || '').toString().slice(0, 300),
      party: (m.party || '').toString().slice(0, 120),  // المورد أو جهة الصرف
      ref: (m.ref || '').toString().slice(0, 60),       // رقم الإذن/الفاتورة
      ts: m.ts || now,
      updatedAt: now,
      del: 0,
      dirty: 1                            // محتاج يترفع للسحابة
    };

    var delta = (move.type === 'in' ? 1 : -1) * move.qtyTon;

    return open().then(function () {
      if (useFallback) {
        var d = FB.load();
        d.moves.push(move);
        var bal = d.meta.balance || { steelTon: 0, cementTon: 0 };
        if (move.mat === 'steel') bal.steelTon = App.round3(bal.steelTon + delta);
        else bal.cementTon = App.round3(bal.cementTon + delta);
        d.meta.balance = bal;
        if (!FB.save()) throw new Error('QUOTA');
        return { move: move, balance: bal };
      }

      var t = tx([S_MOVES, S_META], 'readwrite');
      var meta = t.objectStore(S_META);
      t.objectStore(S_MOVES).put(move);

      var bal = null;
      meta.get('balance').onsuccess = function (ev) {
        var row = ev.target.result;
        bal = (row && row.v) ? row.v : { steelTon: 0, cementTon: 0 };
        if (move.mat === 'steel') bal.steelTon = App.round3(bal.steelTon + delta);
        else bal.cementTon = App.round3(bal.cementTon + delta);
        meta.put({ k: 'balance', v: bal });
      };

      return done(t).then(function () { return { move: move, balance: bal }; });
    });
  }

  /* ---------- التراجع عن حركة (حذف ناعم + عكس الرصيد) ----------
     بنعمل حذف "ناعم" (del=1) مش حذف حقيقي، عشان المزامنة تعرف
     تبلّغ الجهاز التاني إن الحركة دي اتلغت. */
  function removeMove(id) {
    return open().then(function () {
      if (useFallback) {
        var d = FB.load();
        var mv = null;
        for (var i = 0; i < d.moves.length; i++) {
          if (d.moves[i].id === id) { mv = d.moves[i]; break; }
        }
        if (!mv || mv.del) return null;
        mv.del = 1; mv.dirty = 1; mv.updatedAt = Date.now();
        var bal = d.meta.balance || { steelTon: 0, cementTon: 0 };
        var dl = (mv.type === 'in' ? -1 : 1) * mv.qtyTon;
        if (mv.mat === 'steel') bal.steelTon = App.round3(bal.steelTon + dl);
        else bal.cementTon = App.round3(bal.cementTon + dl);
        d.meta.balance = bal;
        FB.save();
        return { move: mv, balance: bal };
      }

      var t = tx([S_MOVES, S_META], 'readwrite');
      var moves = t.objectStore(S_MOVES);
      var meta = t.objectStore(S_META);
      var res = null;

      moves.get(id).onsuccess = function (ev) {
        var mv = ev.target.result;
        if (!mv || mv.del) { return; }
        mv.del = 1; mv.dirty = 1; mv.updatedAt = Date.now();
        moves.put(mv);

        var delta = (mv.type === 'in' ? -1 : 1) * mv.qtyTon;
        meta.get('balance').onsuccess = function (e2) {
          var row = e2.target.result;
          var bal = (row && row.v) ? row.v : { steelTon: 0, cementTon: 0 };
          if (mv.mat === 'steel') bal.steelTon = App.round3(bal.steelTon + delta);
          else bal.cementTon = App.round3(bal.cementTon + delta);
          meta.put({ k: 'balance', v: bal });
          res = { move: mv, balance: bal };
        };
      };

      return done(t).then(function () { return res; });
    });
  }

  /* ======================================================================
     قراءة صفحة من السجل
     --------------------------------------------------------------------
     ده سر السرعة: إحنا **معمرنا** بنقرا الـ 15,000 سجل عشان نعرض 50.
     من غير فلاتر: بنستخدم cursor.advance() → بيقفز على السجلات من غير
     ما يفكّها، فالتكلفة ثابتة مهما كان حجم البيانات.
     ====================================================================== */
  function query(opts) {
    opts = opts || {};
    var page = Math.max(1, opts.page || 1);
    var size = opts.pageSize || 25;
    var offset = (page - 1) * size;

    var fMat  = opts.mat  || '';        // '' | 'steel' | 'cement'
    var fType = opts.type || '';        // '' | 'in' | 'out'
    var fFrom = opts.from || null;      // epoch ms
    var fTo   = opts.to   || null;
    var fText = (opts.text || '').trim().toLowerCase();

    var hasFilter = !!(fMat || fType || fFrom || fTo || fText);

    function match(m) {
      if (m.del) return false;
      if (fMat  && m.mat  !== fMat)  return false;
      if (fType && m.type !== fType) return false;
      if (fFrom && m.ts < fFrom) return false;
      if (fTo   && m.ts > fTo)   return false;
      if (fText) {
        var hay = (m.note + ' ' + m.party + ' ' + m.ref).toLowerCase();
        if (hay.indexOf(fText) === -1) return false;
      }
      return true;
    }

    return open().then(function () {
      /* ---- الوضع البديل ---- */
      if (useFallback) {
        var all = FB.load().moves.filter(match).sort(function (a, b) { return b.ts - a.ts; });
        return { rows: all.slice(offset, offset + size), total: all.length, filtered: hasFilter };
      }

      var t = tx([S_MOVES], 'readonly');
      var idx = t.objectStore(S_MOVES).index('ts');

      /* ---- الحالة السريعة: من غير فلاتر ----
         count() على الفهرس بيرجّع العدد من غير ما يقرا أي سجل،
         و advance() بيقفز للصفحة المطلوبة على طول. يعني فتح الصفحة
         تكلفته واحدة سواء عندك 100 سجل أو 100,000. */
      var store = t.objectStore(S_MOVES);
      if (!hasFilter) {
        return Promise.all([
          wrap(store.count()),
          wrap(store.index('del').count(IDBKeyRange.only(0)))
        ]).then(function (r) {
          var rawTotal = r[0], active = r[1];
          var clean = (rawTotal === active);   // مفيش حركات ملغية

          return new Promise(function (resolve, reject) {
            var rows = [];
            var seen = 0;          // عدد السجلات السارية اللي عدّينا عليها
            var jumped = false;
            // 'prev' = من الأحدث للأقدم
            var cur = idx.openCursor(null, 'prev');
            cur.onerror = function () { reject(cur.error); };
            cur.onsuccess = function (ev) {
              var c = ev.target.result;
              if (!c) return resolve({ rows: rows, total: active, filtered: false });

              // القفزة السريعة ممكنة بس لو مفيش سجلات ملغية وسط الطريق
              if (clean && !jumped && offset > 0) { jumped = true; c.advance(offset); return; }
              jumped = true;

              var v = c.value;
              if (v.del) { c.continue(); return; }

              if (clean || seen >= offset) {
                rows.push(v);
                if (rows.length >= size) return resolve({ rows: rows, total: active, filtered: false });
              }
              seen++;
              c.continue();
            };
          });
        });
      }

      /* ---- مع فلاتر: مسح مع نطاق التاريخ لو موجود ---- */
      var range = null;
      if (fFrom && fTo) range = IDBKeyRange.bound(fFrom, fTo);
      else if (fFrom)   range = IDBKeyRange.lowerBound(fFrom);
      else if (fTo)     range = IDBKeyRange.upperBound(fTo);

      return new Promise(function (resolve, reject) {
        var rows = [];
        var total = 0;
        var cur = idx.openCursor(range, 'prev');
        cur.onerror = function () { reject(cur.error); };
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) return resolve({ rows: rows, total: total, filtered: true });
          var v = c.value;
          if (match(v)) {
            if (total >= offset && rows.length < size) rows.push(v);
            total++;
          }
          c.continue();
        };
      });
    });
  }

  /* ---------- إحصائيات (إجمالي الوارد/المنصرف والقيم) ---------- */
  function stats(opts) {
    opts = opts || {};
    var fFrom = opts.from || null, fTo = opts.to || null;
    var acc = {
      steel: { in: 0, out: 0, inVal: 0, outVal: 0 },
      cement: { in: 0, out: 0, inVal: 0, outVal: 0 },
      count: 0
    };
    function take(m) {
      if (m.del) return;
      if (fFrom && m.ts < fFrom) return;
      if (fTo && m.ts > fTo) return;
      var a = acc[m.mat]; if (!a) return;
      a[m.type] += m.qtyTon;
      a[m.type + 'Val'] += m.value;
      acc.count++;
    }
    return open().then(function () {
      if (useFallback) { FB.load().moves.forEach(take); return acc; }
      return new Promise(function (resolve, reject) {
        var range = null;
        if (fFrom && fTo) range = IDBKeyRange.bound(fFrom, fTo);
        else if (fFrom)   range = IDBKeyRange.lowerBound(fFrom);
        else if (fTo)     range = IDBKeyRange.upperBound(fTo);
        var cur = tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('ts').openCursor(range);
        cur.onerror = function () { reject(cur.error); };
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) return resolve(acc);
          take(c.value); c.continue();
        };
      });
    });
  }

  /* ======================================================================
     تجميع الحركات على فترات — للرسم البياني والتقارير
     --------------------------------------------------------------------
     opts: { from, to, bucket:'day'|'month', mat:''|'steel'|'cement' }
     بيرجّع خانة لكل يوم/شهر في المدى — حتى الفاضية — عشان الرسم
     يطلع متصل ومش ناقص فجوات.
     ====================================================================== */
  function bucketKey(ts, bucket) {
    var d = new Date(ts);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    return bucket === 'day' ? y + '-' + p2(m) + '-' + p2(d.getDate()) : y + '-' + p2(m);
  }

  var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                   'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  function bucketLabel(key, bucket) {
    var p = key.split('-');
    if (bucket === 'day') return p[2] + '/' + p[1];
    return AR_MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }

  function series(opts) {
    opts = opts || {};
    var from = opts.from, to = opts.to;
    var bucket = opts.bucket === 'day' ? 'day' : 'month';
    var mat = opts.mat || '';

    /* نجهّز كل الخانات في المدى مقدماً */
    var order = [];
    var map = {};
    var cur = new Date(from);
    if (bucket === 'day') cur.setHours(0, 0, 0, 0);
    else { cur.setDate(1); cur.setHours(0, 0, 0, 0); }

    var guard = 0;
    while (cur.getTime() <= to && guard++ < 1000) {
      var k = bucketKey(cur.getTime(), bucket);
      if (!map[k]) {
        map[k] = { key: k, label: bucketLabel(k, bucket),
                   inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0 };
        order.push(k);
      }
      if (bucket === 'day') cur.setDate(cur.getDate() + 1);
      else cur.setMonth(cur.getMonth() + 1);
    }

    var totals = { inTon: 0, outTon: 0, inVal: 0, outVal: 0, count: 0 };

    function take(m) {
      if (m.del) return;
      if (m.ts < from || m.ts > to) return;
      if (mat && m.mat !== mat) return;
      var b = map[bucketKey(m.ts, bucket)];
      if (!b) return;
      if (m.type === 'in') { b.inTon += m.qtyTon; b.inVal += m.value; totals.inTon += m.qtyTon; totals.inVal += m.value; }
      else { b.outTon += m.qtyTon; b.outVal += m.value; totals.outTon += m.qtyTon; totals.outVal += m.value; }
      b.count++; totals.count++;
    }

    return open().then(function () {
      if (useFallback) { FB.load().moves.forEach(take); return; }
      return new Promise(function (resolve, reject) {
        var range = IDBKeyRange.bound(from, to);
        var cur2 = tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('ts').openCursor(range);
        cur2.onerror = function () { reject(cur2.error); };
        cur2.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) return resolve();
          take(c.value); c.continue();
        };
      });
    }).then(function () {
      var rows = order.map(function (k) {
        var b = map[k];
        b.inTon = App.round3(b.inTon); b.outTon = App.round3(b.outTon);
        b.netTon = App.round3(b.inTon - b.outTon);
        return b;
      });
      totals.inTon = App.round3(totals.inTon);
      totals.outTon = App.round3(totals.outTon);
      totals.netTon = App.round3(totals.inTon - totals.outTon);
      return { buckets: rows, totals: totals, bucket: bucket, from: from, to: to, mat: mat };
    });
  }

  /* ---------- إعادة حساب الرصيد من السجل (زرار الإصلاح) ---------- */
  function recomputeBalance() {
    var bal = { steelTon: 0, cementTon: 0 };
    function take(m) {
      if (m.del) return;
      var d = (m.type === 'in' ? 1 : -1) * m.qtyTon;
      if (m.mat === 'steel') bal.steelTon += d; else bal.cementTon += d;
    }
    return open().then(function () {
      if (useFallback) { FB.load().moves.forEach(take); }
      else {
        return new Promise(function (resolve, reject) {
          var cur = tx([S_MOVES], 'readonly').objectStore(S_MOVES).openCursor();
          cur.onerror = function () { reject(cur.error); };
          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) return resolve();
            take(c.value); c.continue();
          };
        });
      }
    }).then(function () {
      bal.steelTon = App.round3(bal.steelTon);
      bal.cementTon = App.round3(bal.cementTon);
      return metaSet('balance', bal).then(function () { return bal; });
    });
  }

  /* ---------- كل الحركات (للتصدير) — على دفعات عشان مايعلّقش ---------- */
  function eachMove(cb) {
    return open().then(function () {
      if (useFallback) {
        FB.load().moves.forEach(function (m) { if (!m.del) cb(m); });
        return;
      }
      return new Promise(function (resolve, reject) {
        var cur = tx([S_MOVES], 'readonly').objectStore(S_MOVES).index('ts').openCursor(null, 'prev');
        cur.onerror = function () { reject(cur.error); };
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) return resolve();
          if (!c.value.del) cb(c.value);
          c.continue();
        };
      });
    });
  }

  /* ---------- استيراد دفعة (نسخة احتياطية أو مزامنة) ---------- */
  function bulkPut(list, markClean) {
    if (!list || !list.length) return Promise.resolve(0);
    return open().then(function () {
      if (useFallback) {
        var d = FB.load();
        var byId = {};
        d.moves.forEach(function (m, i) { byId[m.id] = i; });
        list.forEach(function (m) {
          if (markClean) m.dirty = 0;
          if (byId[m.id] !== undefined) d.moves[byId[m.id]] = m;
          else d.moves.push(m);
        });
        FB.save();
        return list.length;
      }
      var t = tx([S_MOVES], 'readwrite');
      var st = t.objectStore(S_MOVES);
      list.forEach(function (m) {
        if (markClean) m.dirty = 0;
        st.put(m);
      });
      return done(t).then(function () { return list.length; });
    });
  }

  /* ---------- الحركات اللي لسه محتاجة ترفع للسحابة ---------- */
  function getDirty(limit) {
    return open().then(function () {
      if (useFallback) {
        return FB.load().moves.filter(function (m) { return m.dirty === 1; }).slice(0, limit || 200);
      }
      return new Promise(function (resolve, reject) {
        var out = [];
        var cur = tx([S_MOVES], 'readonly').objectStore(S_MOVES)
                    .index('dirty').openCursor(IDBKeyRange.only(1));
        cur.onerror = function () { reject(cur.error); };
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c || out.length >= (limit || 200)) return resolve(out);
          out.push(c.value); c.continue();
        };
      });
    });
  }

  function markClean(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return open().then(function () {
      if (useFallback) {
        var d = FB.load();
        var set = {}; ids.forEach(function (i) { set[i] = 1; });
        d.moves.forEach(function (m) { if (set[m.id]) m.dirty = 0; });
        FB.save();
        return;
      }
      var t = tx([S_MOVES], 'readwrite');
      var st = t.objectStore(S_MOVES);
      ids.forEach(function (id) {
        st.get(id).onsuccess = function (ev) {
          var m = ev.target.result;
          if (m) { m.dirty = 0; st.put(m); }
        };
      });
      return done(t);
    });
  }

  /* ---------- مسح كل شيء ---------- */
  function wipe() {
    return open().then(function () {
      if (useFallback) {
        FB.data = { moves: [], meta: {} }; FB.save(); return;
      }
      var t = tx([S_MOVES, S_META], 'readwrite');
      t.objectStore(S_MOVES).clear();
      t.objectStore(S_META).delete('balance');
      return done(t);
    });
  }

  /* ---------- تعبئة بيانات تجريبية (للاختبار) ----------
     من الكونسول:  Store.seed(15000).then(()=>location.reload())  */
  function seed(n) {
    n = n || 15000;
    var notes = ['الدور الثالث', 'مشروع الشيخ زايد', 'عمارة 12', 'ورشة الحدادة',
                 'صب سقف', 'أساسات', 'مخزن فرعي', 'تشطيبات', ''];
    var parties = ['مصنع عز', 'مورد السويس', 'أسمنت العريش', 'مقاول الموقع', 'شركة النصر', ''];
    var batch = [];
    var now = Date.now();
    var bal = { steelTon: 0, cementTon: 0 };

    for (var i = 0; i < n; i++) {
      var mat = Math.random() < 0.5 ? 'steel' : 'cement';
      // نخلي الاستلام أكتر من الصرف عشان الرصيد ما ينزلش تحت الصفر
      var type = Math.random() < 0.56 ? 'in' : 'out';
      var qty = App.round3(Math.random() * 4 + 0.5);
      var price = mat === 'steel' ? 38700 : 4400;
      var d = (type === 'in' ? 1 : -1) * qty;
      if (mat === 'steel') {
        if (bal.steelTon + d < 0) { type = 'in'; d = qty; }
        bal.steelTon = App.round3(bal.steelTon + d);
      } else {
        if (bal.cementTon + d < 0) { type = 'in'; d = qty; }
        bal.cementTon = App.round3(bal.cementTon + d);
      }
      batch.push({
        id: App.uid(), type: type, mat: mat, qtyTon: qty,
        unitPrice: price, value: App.round3(qty * price),
        note: notes[i % notes.length],
        party: parties[i % parties.length],
        ref: 'REF-' + (10000 + i),
        // موزّعين على سنتين للخلف — عشان يشبهوا سجل شركة حقيقي
        ts: now - Math.floor((n - i) * (730 * 24 * 3600 * 1000 / n)) + Math.floor(Math.random() * 3600000),
        updatedAt: now, del: 0, dirty: 0
      });
    }

    // نكتب على دفعات 1000 عشان المتصفح ما يقفش
    function chunk(start) {
      if (start >= batch.length) return metaSet('balance', bal);
      return bulkPut(batch.slice(start, start + 1000), false)
        .then(function () { return chunk(start + 1000); });
    }
    return chunk(0).then(function () { return n; });
  }

  /* ---------- معلومات ---------- */
  function info() {
    return open().then(function () {
      return {
        engine: useFallback ? 'localStorage (احتياطي)' : 'IndexedDB',
        fallback: useFallback
      };
    });
  }

  global.Store = {
    ready: open,
    info: info,
    getSettings: getSettings, setSettings: setSettings,
    getBalance: getBalance, recomputeBalance: recomputeBalance,
    addMove: addMove, removeMove: removeMove,
    query: query, stats: stats, series: series, eachMove: eachMove,
    bulkPut: bulkPut, getDirty: getDirty, markClean: markClean,
    metaGet: metaGet, metaSet: metaSet,
    wipe: wipe, seed: seed
  };
})(window);
