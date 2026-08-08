/* ==========================================================================
   warehouse.js — منطق صفحة المخزن
   ========================================================================== */
(function () {
  'use strict';

  var $ = App.$, esc = App.esc, N = App.toNum, R3 = App.round3;

  var PAGE_SIZE = 25;

  var state = {
    tab: 'out',
    page: 1,
    total: 0,
    settings: null,
    balance: { steelTon: 0, cementTon: 0 },
    filters: { text: '', mat: '', type: '', from: null, to: null },
    period: 'm6',          // الفترة المعروضة في الرسم
    chartMat: '',          // '' | 'steel' | 'cement'
    chartData: null,
    chartRange: null
  };

  var BAGS_PER_TON = 20;
  var KG_PER_TON = 1000;

  /* ======================================================================
     1. الأسعار
     ====================================================================== */
  function currentPrices() {
    var steelTon = N($('#steelPriceTon').value);
    var bag = N($('#cementPriceBag').value);
    return { steelTon: steelTon, cementBag: bag, cementTon: bag * BAGS_PER_TON };
  }

  var savePrices = App.debounce(function () {
    var p = currentPrices();
    Store.setSettings({ steelPriceTon: p.steelTon, cementBagPrice: p.cementBag })
      .then(function (s) { state.settings = s; });
  }, 500);   // مش مع كل حرف — بعد ما يبطّل كتابة بنص ثانية

  function wirePrices() {
    $('#steelPriceTon').addEventListener('input', function () {
      $('#steelPriceKg').value = R3(N(this.value) / KG_PER_TON);
      renderBalance(); renderPreview(); savePrices();
    });
    $('#steelPriceKg').addEventListener('input', function () {
      $('#steelPriceTon').value = R3(N(this.value) * KG_PER_TON);
      renderBalance(); renderPreview(); savePrices();
    });
    $('#cementPriceBag').addEventListener('input', function () {
      $('#cementPriceTon').value = R3(N(this.value) * BAGS_PER_TON);
      renderBalance(); renderPreview(); savePrices();
    });
    $('#cementPriceTon').addEventListener('input', function () {
      $('#cementPriceBag').value = R3(N(this.value) / BAGS_PER_TON);
      renderBalance(); renderPreview(); savePrices();
    });
  }

  function fillPrices() {
    var s = state.settings;
    $('#steelPriceTon').value = s.steelPriceTon;
    $('#steelPriceKg').value = R3(s.steelPriceTon / KG_PER_TON);
    $('#cementPriceBag').value = s.cementBagPrice;
    $('#cementPriceTon').value = R3(s.cementBagPrice * BAGS_PER_TON);
  }

  /* ======================================================================
     3. الرصيد
     ====================================================================== */
  function renderBalance() {
    var b = state.balance, s = state.settings, p = currentPrices();

    $('#balSteelTon').textContent = App.fmtD(b.steelTon) + ' طن';
    $('#balSteelKg').textContent = App.fmt(b.steelTon * KG_PER_TON) + ' كجم';
    $('#balSteelVal').textContent = App.fmt(b.steelTon * p.steelTon);

    $('#balCementTon').textContent = App.fmtD(b.cementTon) + ' طن';
    $('#balCementBags').textContent = App.fmt(b.cementTon * BAGS_PER_TON) + ' شكارة';
    $('#balCementVal').textContent = App.fmt(b.cementTon * p.cementTon);

    var sc = N(s.steelCapTon), cc = N(s.cementCapTon);
    var sp = sc > 0 ? Math.min(100, Math.max(0, b.steelTon / sc * 100)) : 0;
    var cp = cc > 0 ? Math.min(100, Math.max(0, b.cementTon / cc * 100)) : 0;
    $('#barSteel').style.width = sp + '%';
    $('#barCement').style.width = cp + '%';
    $('#capSteel').textContent = sc > 0 ? Math.round(sp) + '% من سعة ' + App.fmtD(sc) + ' طن' : '';
    $('#capCement').textContent = cc > 0 ? Math.round(cp) + '% من سعة ' + App.fmtD(cc) + ' طن' : '';

    $('#barSteel').parentNode.className = 'bar ' + (b.steelTon <= N(s.steelLowTon) ? 'bar-low' : 'bar-steel');
    $('#barCement').parentNode.className = 'bar ' + (b.cementTon <= N(s.cementLowTon) ? 'bar-low' : 'bar-cement');

    // تنبيه نقص المخزون
    var warns = [];
    if (b.steelTon <= N(s.steelLowTon)) warns.push('الحديد وصل ' + App.fmtD(b.steelTon) + ' طن');
    if (b.cementTon <= N(s.cementLowTon)) warns.push('الأسمنت وصل ' + App.fmtD(b.cementTon) + ' طن');
    $('#lowAlert').innerHTML = warns.length
      ? '<div class="alert alert-warn"><span>⚠️</span><div><strong>المخزون قرب يخلص</strong><br>' +
        esc(warns.join(' · ')) + ' — محتاج طلبية.</div></div>'
      : '';
  }

  /* ======================================================================
     4. التبويبات والنموذج
     ====================================================================== */
  function setTab(t) {
    state.tab = t;
    $('#tabOut').setAttribute('aria-selected', t === 'out' ? 'true' : 'false');
    $('#tabIn').setAttribute('aria-selected', t === 'in' ? 'true' : 'false');
    var btn = $('#actionBtn');
    btn.className = 'btn btn-lg btn-block ' + (t === 'out' ? 'btn-out' : 'btn-in');
    btn.textContent = t === 'out' ? '📤 تسجيل الصرف' : '📥 تسجيل الاستلام';
    $('#partyLabel').textContent = t === 'out' ? 'جهة الصرف' : 'المورد';
    $('#partyInp').placeholder = t === 'out' ? 'مثال: مقاول الموقع' : 'مثال: مصنع عز';
    renderPreview();
  }

  function subFactor() {
    return $('#matSelect').value === 'steel' ? KG_PER_TON : BAGS_PER_TON;
  }

  function wireForm() {
    $('#tabOut').addEventListener('click', function () { setTab('out'); });
    $('#tabIn').addEventListener('click', function () { setTab('in'); });

    $('#matSelect').addEventListener('change', function () {
      $('#subUnit').textContent = this.value === 'steel' ? 'كجم' : 'شكارة';
      $('#qtyTon').value = '';
      $('#qtySub').value = '';
      renderPreview();
    });

    $('#qtyTon').addEventListener('input', function () {
      var v = this.value;
      $('#qtySub').value = v === '' ? '' : R3(N(v) * subFactor());
      renderPreview();
    });
    $('#qtySub').addEventListener('input', function () {
      var v = this.value;
      $('#qtyTon').value = v === '' ? '' : R3(N(v) / subFactor());
      renderPreview();
    });

    $('#moveForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submitMove();
    });
  }

  function renderPreview() {
    var qty = N($('#qtyTon').value);
    var box = $('#movePreview');
    if (qty <= 0) { box.style.display = 'none'; return; }

    var mat = $('#matSelect').value;
    var p = currentPrices();
    var unit = mat === 'steel' ? p.steelTon : p.cementTon;
    var value = qty * unit;
    var bal = mat === 'steel' ? state.balance.steelTon : state.balance.cementTon;
    var after = state.tab === 'in' ? bal + qty : bal - qty;
    var matName = mat === 'steel' ? 'حديد' : 'أسمنت';

    var over = state.tab === 'out' && qty > bal;
    box.className = 'alert ' + (over ? 'alert-error' : 'alert-info');
    box.style.display = 'flex';
    box.innerHTML = over
      ? '<span>🚫</span><div>المخزون فيه <strong class="num">' + App.fmtD(bal) + '</strong> طن ' + matName +
        ' بس — مينفعش تصرف <strong class="num">' + App.fmtD(qty) + '</strong> طن.</div>'
      : '<span>🧮</span><div>القيمة ≈ <strong class="num">' + App.fmt(value) + '</strong> جنيه · ' +
        'الرصيد بعد العملية: <strong class="num">' + App.fmtD(after) + '</strong> طن ' + matName + '</div>';
  }

  function submitMove() {
    var mat = $('#matSelect').value;
    var qty = R3(N($('#qtyTon').value));
    if (qty <= 0) { App.toast('اكتب كمية أكبر من صفر', 'err'); $('#qtyTon').focus(); return; }

    var bal = mat === 'steel' ? state.balance.steelTon : state.balance.cementTon;
    var matName = mat === 'steel' ? 'حديد' : 'أسمنت';

    if (state.tab === 'out' && qty > bal) {
      App.toast('المخزون فيه ' + App.fmtD(bal) + ' طن ' + matName + ' بس!', 'err', 3600);
      return;
    }

    var p = currentPrices();
    var unit = mat === 'steel' ? p.steelTon : p.cementTon;

    var btn = $('#actionBtn');
    btn.disabled = true;

    Store.addMove({
      type: state.tab, mat: mat, qtyTon: qty, unitPrice: unit,
      note: $('#noteInp').value.trim(),
      party: $('#partyInp').value.trim(),
      ref: $('#refInp').value.trim()
    }).then(function (res) {
      state.balance = res.balance;
      $('#qtyTon').value = ''; $('#qtySub').value = '';
      $('#noteInp').value = ''; $('#partyInp').value = ''; $('#refInp').value = '';
      renderBalance(); renderPreview();
      state.page = 1;
      loadLog(); loadChart();
      App.toast((state.tab === 'out' ? 'تم الصرف ✓ ' : 'تم الاستلام ✓ ') +
                App.fmtD(qty) + ' طن ' + matName);
      if (Sync.isOn()) Sync.syncNow(true);
    }).catch(function (err) {
      if (err && err.message === 'QUOTA') {
        App.toast('مساحة التخزين امتلأت — خُد نسخة احتياطية', 'err', 5000);
      } else {
        App.toast('حصلت مشكلة في الحفظ: ' + (err && err.message ? err.message : ''), 'err', 4200);
      }
    }).then(function () { btn.disabled = false; });
  }

  /* ======================================================================
     5. السجل
     ====================================================================== */
  function loadLog() {
    var f = state.filters;
    return Store.query({
      page: state.page, pageSize: PAGE_SIZE,
      mat: f.mat, type: f.type, from: f.from, to: f.to, text: f.text
    }).then(function (res) {
      state.total = res.total;
      renderLog(res.rows);
      renderPager();
    }).catch(function (err) {
      $('#logHost').innerHTML =
        '<div class="alert alert-error"><span>⚠️</span><div>مشكلة في قراءة السجل: ' +
        esc(err && err.message ? err.message : '') + '</div></div>';
    });
  }

  function renderLog(rows) {
    var host = $('#logHost');

    if (!rows.length) {
      var any = state.filters.text || state.filters.mat || state.filters.type ||
                state.filters.from || state.filters.to;
      host.innerHTML = '<div class="empty"><span class="emoji">' + (any ? '🔍' : '📭') + '</span><p>' +
        (any ? 'مفيش حركات مطابقة للفلاتر' : 'مفيش حركات لسه — ابدأ بصرف أو استلام') + '</p></div>';
      return;
    }

    var html = '<div class="table-scroll"><table class="dtable"><thead><tr>' +
      '<th>النوع</th><th>المادة</th><th>الكمية</th><th>القيمة</th>' +
      '<th>الجهة</th><th>الإذن</th><th>ملاحظة</th><th>التاريخ</th><th></th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      var isOut = m.type === 'out';
      var isSteel = m.mat === 'steel';
      var sub = isSteel
        ? App.fmt(m.qtyTon * KG_PER_TON) + ' كجم'
        : App.fmt(m.qtyTon * BAGS_PER_TON) + ' شكارة';

      html +=
        '<tr class="' + (isOut ? 'row-out' : 'row-in') + '">' +
          '<td data-label="النوع"><span class="badge ' + (isOut ? 'badge-out">📤 صرف' : 'badge-in">📥 استلام') + '</span></td>' +
          '<td data-label="المادة"><span class="badge ' + (isSteel ? 'badge-steel">🔩 حديد' : 'badge-cement">🏛️ أسمنت') + '</span></td>' +
          '<td data-label="الكمية"><strong class="num">' + App.fmtD(m.qtyTon) + '</strong> طن' +
            '<span class="text-muted" style="font-size:.7rem;display:block">' + sub + '</span></td>' +
          '<td data-label="القيمة"><span class="text-cement num">' + App.fmt(m.value) + '</span> ج</td>' +
          '<td data-label="الجهة">' + (m.party ? esc(m.party) : '<span class="text-muted">—</span>') + '</td>' +
          '<td data-label="الإذن">' + (m.ref ? '<span class="num">' + esc(m.ref) + '</span>' : '<span class="text-muted">—</span>') + '</td>' +
          '<td data-label="ملاحظة" class="cell-wide">' + (m.note ? esc(m.note) : '<span class="text-muted">—</span>') + '</td>' +
          '<td data-label="التاريخ"><span class="text-muted" style="font-size:.72rem">' +
            esc(App.fmtDateTime(m.ts)) + '</span></td>' +
          '<td class="cell-actions"><button class="btn btn-ghost btn-sm" data-undo="' + esc(m.id) + '" ' +
            'type="button" title="تراجع عن الحركة">↩ تراجع</button></td>' +
        '</tr>';
    }

    html += '</tbody></table></div>';
    host.innerHTML = html;
  }

  function renderPager() {
    var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    if (state.page > pages) { state.page = pages; }
    var pager = $('#pager');

    if (state.total === 0) { pager.hidden = true; return; }
    pager.hidden = false;

    var first = (state.page - 1) * PAGE_SIZE + 1;
    var last = Math.min(state.total, state.page * PAGE_SIZE);
    $('#pagerInfo').innerHTML =
      '<span class="num">' + first + '–' + last + '</span> من <span class="num">' +
      App.fmt(state.total) + '</span> حركة · صفحة <span class="num">' + state.page + '/' + pages + '</span>';

    $('#btnPrev').disabled = state.page <= 1;
    $('#btnNext').disabled = state.page >= pages;
  }

  function wireLog() {
    $('#logHost').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-undo]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-undo');
      App.confirm('هيتم إلغاء الحركة دي والرصيد هيترجع زي ما كان. تمام؟', {
        title: '↩ تراجع عن الحركة', okText: 'أيوه، ارجع'
      }).then(function (ok) {
        if (!ok) return;
        return Store.removeMove(id).then(function (res) {
          if (!res) { App.toast('الحركة مش موجودة', 'err'); return; }
          state.balance = res.balance;
          renderBalance(); renderPreview();
          loadLog(); loadChart();
          App.toast('تم التراجع ✓');
          if (Sync.isOn()) Sync.syncNow(true);
        });
      });
    });

    $('#btnPrev').addEventListener('click', function () {
      if (state.page > 1) { state.page--; loadLog(); scrollToLog(); }
    });
    $('#btnNext').addEventListener('click', function () {
      var pages = Math.ceil(state.total / PAGE_SIZE);
      if (state.page < pages) { state.page++; loadLog(); scrollToLog(); }
    });
  }

  function scrollToLog() {
    var el = $('#logHost');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ======================================================================
     6. الفلاتر
     ====================================================================== */
  function wireFilters() {
    $('#btnFilters').addEventListener('click', function () {
      var box = $('#filterBox');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#fText').focus();
    });

    var apply = App.debounce(function () {
      state.filters.text = $('#fText').value.trim();
      state.filters.mat  = $('#fMat').value;
      state.filters.type = $('#fType').value;
      state.filters.from = $('#fFrom').value ? App.dayStart($('#fFrom').value) : null;
      state.filters.to   = $('#fTo').value ? App.dayEnd($('#fTo').value) : null;
      state.page = 1;
      loadLog();
    }, 280);

    ['#fText', '#fMat', '#fType', '#fFrom', '#fTo'].forEach(function (sel) {
      $(sel).addEventListener('input', apply);
      $(sel).addEventListener('change', apply);
    });

    $('#btnClearFilters').addEventListener('click', function () {
      $('#fText').value = ''; $('#fMat').value = ''; $('#fType').value = '';
      $('#fFrom').value = ''; $('#fTo').value = '';
      state.filters = { text: '', mat: '', type: '', from: null, to: null };
      state.page = 1;
      loadLog();
    });
  }

  /* ======================================================================
     6b. الرسم البياني
     ====================================================================== */
  function loadChart() {
    var r = Report.rangeFor(state.period);
    var host = $('#chartHost');
    host.innerHTML = '<div class="empty"><p>جاري الحساب…</p></div>';

    return Store.series({ from: r.from, to: r.to, bucket: r.bucket, mat: state.chartMat })
      .then(function (data) {
        state.chartData = data;
        state.chartRange = r;
        $('#chartSummary').innerHTML = Report.summaryTiles(data, false);
        host.innerHTML = Report.barChart(data, {
          width: 900,
          height: window.innerWidth < 600 ? 260 : 320
        });
      })
      .catch(function (err) {
        host.innerHTML = '<div class="alert alert-error"><span>⚠️</span><div>مشكلة في الرسم: ' +
                         esc(err && err.message ? err.message : '') + '</div></div>';
      });
  }

  function wireChart() {
    $('#periodSeg').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-period]') : null;
      if (!b) return;
      state.period = b.getAttribute('data-period');
      App.$$('#periodSeg .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      loadChart();
    });

    $('#matSeg').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-mat]') : null;
      if (!b) return;
      state.chartMat = b.getAttribute('data-mat');
      App.$$('#matSeg .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      loadChart();
    });

    $('#btnPdf').addEventListener('click', makePdf);
  }

  /* ======================================================================
     6c. تقرير PDF
     ====================================================================== */
  var MAX_PDF_ROWS = 800;

  function makePdf() {
    var btn = $('#btnPdf');
    btn.disabled = true;
    App.toast('بجهّز التقرير…');

    var r = state.chartRange || Report.rangeFor(state.period);
    var rows = [];
    var total = 0;

    Store.eachMove(function (m) {
      if (m.ts < r.from || m.ts > r.to) return;
      if (state.chartMat && m.mat !== state.chartMat) return;
      total++;
      if (rows.length < MAX_PDF_ROWS) rows.push(m);
    }).then(function () {
      var matLabel = state.chartMat === 'steel' ? 'حديد فقط'
                   : state.chartMat === 'cement' ? 'أسمنت فقط' : 'حديد وأسمنت';

      var html = Report.buildReportHtml({
        data: state.chartData,
        rows: rows,
        capped: total > rows.length ? total : 0,
        periodLabel: r.label,
        matLabel: matLabel,
        balance: state.balance,
        prices: currentPrices()
      });

      Report.printHtml(html);
      App.toast('اختار "حفظ كـ PDF" من نافذة الطباعة', 'warn', 5200);
    }).catch(function (err) {
      App.toast('مشكلة في التقرير: ' + (err && err.message ? err.message : ''), 'err', 4200);
    }).then(function () { btn.disabled = false; });
  }

  /* ======================================================================
     7. التصدير والنسخ الاحتياطي
     ====================================================================== */
  function exportCsv() {
    App.toast('بجهّز الملف…');
    var rows = [['التاريخ', 'الوقت', 'النوع', 'المادة', 'الكمية (طن)', 'الوحدة الفرعية',
                 'سعر الطن', 'القيمة (ج)', 'الجهة', 'رقم الإذن', 'ملاحظة']];
    var f = state.filters;
    function pass(m) {
      if (f.mat && m.mat !== f.mat) return false;
      if (f.type && m.type !== f.type) return false;
      if (f.from && m.ts < f.from) return false;
      if (f.to && m.ts > f.to) return false;
      if (f.text) {
        var hay = (m.note + ' ' + m.party + ' ' + m.ref).toLowerCase();
        if (hay.indexOf(f.text.toLowerCase()) === -1) return false;
      }
      return true;
    }

    Store.eachMove(function (m) {
      if (!pass(m)) return;
      rows.push([
        App.fmtDate(m.ts), App.fmtTime(m.ts),
        m.type === 'out' ? 'صرف' : 'استلام',
        m.mat === 'steel' ? 'حديد' : 'أسمنت',
        m.qtyTon,
        m.mat === 'steel' ? (m.qtyTon * KG_PER_TON) + ' كجم' : (m.qtyTon * BAGS_PER_TON) + ' شكارة',
        m.unitPrice, m.value, m.party, m.ref, m.note
      ]);
    }).then(function () {
      if (rows.length === 1) { App.toast('مفيش حركات للتصدير', 'warn'); return; }
      var name = 'سجل-المخزن-' + new Date().toISOString().slice(0, 10) + '.csv';
      App.download(name, App.toCSV(rows), 'text/csv');
      App.toast('تم تصدير ' + App.fmt(rows.length - 1) + ' حركة ✓');
    });
  }

  function backup() {
    App.toast('بجهّز النسخة…');
    var moves = [];
    Store.eachMove(function (m) { moves.push(m); }).then(function () {
      var payload = {
        app: 'binaa-warehouse', version: 1,
        exportedAt: Date.now(),
        settings: state.settings,
        balance: state.balance,
        moves: moves
      };
      var name = 'نسخة-المخزن-' + new Date().toISOString().slice(0, 10) + '.json';
      App.download(name, JSON.stringify(payload), 'application/json');
      App.toast('تم حفظ نسخة فيها ' + App.fmt(moves.length) + ' حركة ✓');
    });
  }

  function restore(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (e) { App.toast('الملف مش صالح', 'err'); return; }

      if (!data || !Array.isArray(data.moves)) { App.toast('الملف مش نسخة مخزن', 'err'); return; }

      App.confirm('هيتم دمج ' + App.fmt(data.moves.length) +
                  ' حركة مع اللي موجود. الحركات المكررة هتتحدّث. تمام؟', {
        title: '⬆️ استرجاع نسخة', okText: 'أيوه، ادمج', danger: false
      }).then(function (ok) {
        if (!ok) return;
        var clean = data.moves.map(function (m) {
          m.dirty = 1;                        // يترفع للسحابة بعدين
          m.del = m.del ? 1 : 0;
          m.updatedAt = m.updatedAt || Date.now();
          return m;
        });
        return Store.bulkPut(clean, false)
          .then(function () { return Store.recomputeBalance(); })
          .then(function (bal) {
            state.balance = bal;
            if (data.settings) return Store.setSettings(data.settings);
          })
          .then(function (s) {
            if (s) { state.settings = s; fillPrices(); fillSettingsForm(); }
            state.page = 1;
            renderBalance(); loadLog();
            App.toast('تم الاسترجاع ✓');
          });
      });
    };
    reader.readAsText(file);
  }

  /* ======================================================================
     8. الإعدادات
     ====================================================================== */
  function openSettings() { $('#settingsHost').classList.add('open'); renderCloudBox(); }
  function closeSettings() { $('#settingsHost').classList.remove('open'); }

  function fillSettingsForm() {
    var s = state.settings;
    $('#setSteelCap').value = s.steelCapTon;
    $('#setCementCap').value = s.cementCapTon;
    $('#setSteelLow').value = s.steelLowTon;
    $('#setCementLow').value = s.cementLowTon;
  }

  function wireSettings() {
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnCloseSettings').addEventListener('click', closeSettings);
    $('#settingsHost').addEventListener('click', function (e) {
      if (e.target === $('#settingsHost')) closeSettings();
    });

    var saveCaps = App.debounce(function () {
      Store.setSettings({
        steelCapTon: N($('#setSteelCap').value),
        cementCapTon: N($('#setCementCap').value),
        steelLowTon: N($('#setSteelLow').value),
        cementLowTon: N($('#setCementLow').value)
      }).then(function (s) { state.settings = s; renderBalance(); });
    }, 450);

    ['#setSteelCap', '#setCementCap', '#setSteelLow', '#setCementLow'].forEach(function (sel) {
      $(sel).addEventListener('input', saveCaps);
    });

    $('#btnExportCsv').addEventListener('click', exportCsv);
    $('#btnBackup').addEventListener('click', backup);
    $('#btnRestore').addEventListener('click', function () { $('#restoreFile').click(); });
    $('#restoreFile').addEventListener('change', function () {
      if (this.files && this.files[0]) restore(this.files[0]);
      this.value = '';
    });

    $('#btnRecalc').addEventListener('click', function () {
      App.toast('بعيد الحساب…');
      Store.recomputeBalance().then(function (bal) {
        state.balance = bal; renderBalance();
        App.toast('تم إعادة حساب الرصيد من السجل ✓');
      });
    });

    $('#btnWipe').addEventListener('click', function () {
      App.confirm('ده هيمسح كل الحركات والرصيد من الجهاز ده نهائياً. خُد نسخة احتياطية الأول!', {
        title: '🗑️ مسح كل البيانات', okText: 'أيوه، امسح الكل'
      }).then(function (ok) {
        if (!ok) return;
        return Store.wipe().then(function () {
          state.balance = { steelTon: 0, cementTon: 0 };
          state.page = 1;
          renderBalance(); loadLog();
          App.toast('تم مسح كل البيانات');
        });
      });
    });
  }

  /* ---------- صندوق المزامنة ---------- */
  function renderCloudBox() {
    var box = $('#cloudBox');
    var st = Sync.status();

    if (!st.on) {
      box.innerHTML =
        '<div class="alert alert-info"><span>💡</span><div>' +
          'المزامنة مقفولة — البيانات على الجهاز ده بس.<br>' +
          'عشان الشريك يشوف نفس الأرقام، فعّل المزامنة.' +
        '</div></div>' +
        '<div class="field" style="margin-bottom:var(--sp-3)">' +
          '<label for="pairIn">عندك رمز ربط من الشريك؟ الصقه هنا</label>' +
          '<input type="text" class="input" id="pairIn" placeholder="BINAA-…">' +
        '</div>' +
        '<button class="btn btn-primary btn-block" id="btnPair" type="button">🔗 ربط الجهاز</button>' +
        '<details style="margin-top:var(--sp-4)">' +
          '<summary style="cursor:pointer;font-size:.82rem;color:var(--muted)">إعداد جديد من الصفر (أول جهاز)</summary>' +
          '<div class="field" style="margin-top:var(--sp-3)">' +
            '<label for="supaUrl">عنوان المشروع (Project URL)</label>' +
            '<input type="url" class="input" id="supaUrl" placeholder="https://xxxx.supabase.co">' +
          '</div>' +
          '<div class="field" style="margin-top:var(--sp-3)">' +
            '<label for="supaKey">المفتاح العام (anon key)</label>' +
            '<input type="text" class="input" id="supaKey" placeholder="eyJhbGciOi…">' +
          '</div>' +
          '<button class="btn btn-primary btn-block" id="btnConnect" style="margin-top:var(--sp-3)" type="button">' +
            'تفعيل المزامنة</button>' +
          '<p class="hint" style="margin-top:var(--sp-3);line-height:1.7">' +
            'الخطوات مشروحة بالتفصيل في ملف <strong>README.md</strong> جنب الموقع.</p>' +
        '</details>';

      $('#btnPair').addEventListener('click', function () {
        var c = Sync.decodeCode($('#pairIn').value);
        if (!c) { App.toast('الرمز مش مظبوط', 'err'); return; }
        connectWith(c);
      });
      $('#btnConnect').addEventListener('click', function () {
        var url = $('#supaUrl').value.trim().replace(/\/+$/, '');
        var key = $('#supaKey').value.trim();
        if (!url || !key) { App.toast('اكتب العنوان والمفتاح', 'err'); return; }
        connectWith({ url: url, key: key, room: Sync.newRoom() });
      });
      return;
    }

    var code = Sync.encodeCode(Sync.cfg());
    var lastTxt = st.lastSync ? App.fmtDateTime(st.lastSync) : 'لسه';
    box.innerHTML =
      '<div class="alert alert-ok"><span>☁️</span><div>' +
        '<strong>المزامنة شغالة</strong><br>آخر مزامنة: ' + esc(lastTxt) +
        (st.error ? '<br><span class="text-red">' + esc(st.error) + '</span>' : '') +
      '</div></div>' +
      '<div class="field" style="margin-bottom:var(--sp-3)">' +
        '<label>رمز الربط — ابعته للشريك عشان يشوف نفس البيانات</label>' +
        '<textarea class="input" id="pairOut" rows="3" readonly ' +
          'style="font-size:12px;word-break:break-all;direction:ltr;text-align:left">' + esc(code) + '</textarea>' +
        '<span class="hint">⚠️ الرمز ده مفتاح البيانات — متبعتوش لحد بره الشركة.</span>' +
      '</div>' +
      '<div class="grid-2" style="gap:var(--sp-2)">' +
        '<button class="btn btn-ghost" id="btnCopyCode" type="button">📋 نسخ الرمز</button>' +
        '<button class="btn btn-ghost" id="btnSyncNow" type="button">🔄 زامن دلوقتي</button>' +
        '<button class="btn btn-danger-ghost btn-sm span-all" id="btnUnlink" type="button">✂️ فصل الجهاز عن السحابة</button>' +
      '</div>';

    $('#btnCopyCode').addEventListener('click', function () {
      var ta = $('#pairOut');
      ta.select(); ta.setSelectionRange(0, 99999);
      var done = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { App.toast('تم نسخ الرمز ✓'); });
        done = true;
      }
      if (!done) { try { document.execCommand('copy'); App.toast('تم نسخ الرمز ✓'); } catch (e) {} }
    });
    $('#btnSyncNow').addEventListener('click', function () {
      Sync.syncNow(false).then(function () { refreshAfterSync(); renderCloudBox(); });
    });
    $('#btnUnlink').addEventListener('click', function () {
      App.confirm('الجهاز ده هيفصل عن السحابة. البيانات هتفضل موجودة عليه.', {
        title: '✂️ فصل المزامنة', okText: 'أيوه، افصل'
      }).then(function (ok) {
        if (!ok) return;
        Sync.stop(); Sync.saveCfg(null);
        localStorage.removeItem('binaa_sync_cursor');
        renderCloudBox(); App.toast('تم فصل المزامنة');
      });
    });
  }

  function connectWith(c) {
    App.toast('بختبر الاتصال…');
    Sync.saveCfg(c);
    Sync.test(c).then(function (r) {
      if (!r.ok) {
        Sync.saveCfg(null);
        App.toast('فشل الاتصال: ' + r.error, 'err', 5200);
        renderCloudBox();
        return;
      }
      localStorage.removeItem('binaa_sync_cursor');
      Sync.start();
      App.toast('اتوصلنا ✓ بنزامن دلوقتي…');
      Sync.syncNow(false).then(function () { refreshAfterSync(); renderCloudBox(); });
    });
  }

  function refreshAfterSync() {
    Store.getBalance().then(function (b) {
      state.balance = b;
      renderBalance();
      loadLog(); loadChart();
    });
  }

  /* ======================================================================
     9. مؤشر المزامنة
     ====================================================================== */
  function wireSyncPill() {
    var pill = $('#syncPill'), txt = $('#syncText');
    Sync.onChange(function (s) {
      pill.className = 'sync-pill' + (s.busy ? ' busy' : s.error ? ' err' : s.on ? ' on' : '');
      txt.textContent = s.busy ? 'بيزامن…' : s.error ? 'خطأ' : s.on ? 'متزامن' : 'محلي';
    });
    pill.addEventListener('click', function () {
      if (!Sync.isOn()) { openSettings(); return; }
      Sync.syncNow(false).then(refreshAfterSync);
    });
  }

  /* ======================================================================
     9. التشغيل
     ====================================================================== */
  function boot() {
    Store.ready().then(function () {
      return Store.info();
    }).then(function (inf) {
      $('#engineInfo').textContent = inf.engine;
      if (inf.fallback) {
        $('#engineInfo').innerHTML = esc(inf.engine) +
          ' — <span class="text-red">المتصفح رافض IndexedDB. افتح الموقع من لينك http/https مش ملف مباشر.</span>';
      }
      return Promise.all([Store.getSettings(), Store.getBalance()]);
    }).then(function (r) {
      state.settings = r[0];
      state.balance = r[1];

      fillPrices();
      fillSettingsForm();
      wirePrices();
      wireForm();
      wireLog();
      wireFilters();
      wireChart();
      wireSettings();
      wireSyncPill();

      setTab('out');
      renderBalance();
      return Promise.all([loadLog(), loadChart()]);
    }).then(function () {
      if (Sync.isOn()) {
        Sync.start();
        // بعد أول مزامنة نحدّث الشاشة
        setTimeout(function () { refreshAfterSync(); }, 2500);
      }
    }).catch(function (err) {
      console.error(err);
      App.toast('حصلت مشكلة في التشغيل: ' + (err && err.message ? err.message : ''), 'err', 6000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
