/* ==========================================================================
   report.js — الرسم البياني + تقرير PDF
   --------------------------------------------------------------------------
   الرسم: SVG مرسوم بالكود، من غير أي مكتبة خارجية.
   الـ PDF: بنبني صفحة تقرير مصممة وبنطبعها → "حفظ كـ PDF".
           السبب: ده بيخلي العربي يطلع مظبوط 100% لأنه بيستخدم محرك
           الخطوط بتاع المتصفح نفسه. مكتبات الـ PDF الجاهزة بتكسّر
           الحروف العربية وبتوصلها غلط.
   ========================================================================== */
(function (global) {
  'use strict';

  var C = {
    in:      '#22c55e',
    inSoft:  '#16a34a',
    out:     '#ef4444',
    outSoft: '#dc2626',
    steel:   '#3b82f6',
    cement:  '#c8a96e',
    grid:    '#2a3a5c',
    axis:    '#5a6788',
    text:    '#e8eaf2',
    muted:   '#8892b0'
  };

  /* ---------- مدى الفترة ---------- */
  var PERIODS = {
    m1:  { label: 'آخر شهر',   months: 1,  bucket: 'day'   },
    m6:  { label: 'آخر 6 شهور', months: 6,  bucket: 'month' },
    y1:  { label: 'آخر سنة',   months: 12, bucket: 'month' },
    y2:  { label: 'آخر سنتين', months: 24, bucket: 'month' }
  };

  function rangeFor(key) {
    var p = PERIODS[key] || PERIODS.m6;
    var to = new Date(); to.setHours(23, 59, 59, 999);
    var from = new Date();
    from.setMonth(from.getMonth() - p.months + (p.bucket === 'day' ? 0 : 1));
    if (p.bucket === 'day') from.setDate(from.getDate() + 1);
    else from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from: from.getTime(), to: to.getTime(), bucket: p.bucket, label: p.label };
  }

  /* ---------- أدوات رسم ---------- */
  function niceMax(v) {
    if (v <= 0) return 10;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / mag;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  function esc(s) { return App.esc(s); }

  /* ======================================================================
     رسم الأعمدة: وارد ومنصرف لكل فترة
     ====================================================================== */
  function barChart(data, opts) {
    opts = opts || {};
    var rows = data.buckets;
    var W = opts.width || 900;
    var H = opts.height || 320;
    var padT = 24, padB = 46, padR = 16, padL = 58;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    if (!rows.length) {
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">' +
        '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" fill="' + C.muted +
        '" font-size="15" font-family="Cairo,sans-serif">مفيش حركات في الفترة دي</text></svg>';
    }

    var maxV = 0;
    rows.forEach(function (b) { maxV = Math.max(maxV, b.inTon, b.outTon); });
    var top = niceMax(maxV);

    var slot = plotW / rows.length;
    var barW = Math.max(2, Math.min(18, slot * 0.32));
    var gap = Math.min(3, slot * 0.06);

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" ' +
            'aria-label="رسم بياني لحركة المخزون" font-family="Cairo,Segoe UI,sans-serif">';

    /* خطوط الشبكة + أرقام المحور */
    var LINES = 4;
    for (var i = 0; i <= LINES; i++) {
      var y = padT + plotH - (plotH * i / LINES);
      var val = top * i / LINES;
      s += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
           '" stroke="' + C.grid + '" stroke-width="1" ' + (i ? 'stroke-dasharray="3 4"' : '') + '/>';
      s += '<text x="' + (W - padR + 6) + '" y="' + (y + 4).toFixed(1) + '" fill="' + C.axis +
           '" font-size="11" text-anchor="start">' + App.fmtD(val) + '</text>';
    }
    s += '<text x="' + (W - padR + 6) + '" y="' + (padT - 10) + '" fill="' + C.muted +
         '" font-size="10" text-anchor="start">طن</text>';

    /* الأعمدة */
    var everyN = Math.ceil(rows.length / (W < 560 ? 6 : 12));
    rows.forEach(function (b, idx) {
      var cx = padL + slot * idx + slot / 2;
      var hIn = top > 0 ? (b.inTon / top) * plotH : 0;
      var hOut = top > 0 ? (b.outTon / top) * plotH : 0;

      var xIn = cx - barW - gap / 2;
      var xOut = cx + gap / 2;

      if (b.inTon > 0) {
        s += '<rect x="' + xIn.toFixed(1) + '" y="' + (padT + plotH - hIn).toFixed(1) +
             '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, hIn).toFixed(1) +
             '" fill="' + C.in + '" rx="2"><title>' + esc(b.label) + ' — وارد ' + App.fmtD(b.inTon) + ' طن</title></rect>';
      }
      if (b.outTon > 0) {
        s += '<rect x="' + xOut.toFixed(1) + '" y="' + (padT + plotH - hOut).toFixed(1) +
             '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, hOut).toFixed(1) +
             '" fill="' + C.out + '" rx="2"><title>' + esc(b.label) + ' — منصرف ' + App.fmtD(b.outTon) + ' طن</title></rect>';
      }

      /* أسماء الفترات — بنعرض واحد كل شوية عشان ما يتلغبطوش.
         بنعد من الآخر عشان آخر فترة تتسمّى دايماً (هي الأهم). */
      if ((rows.length - 1 - idx) % everyN === 0 || rows.length <= 12) {
        s += '<text x="' + cx.toFixed(1) + '" y="' + (padT + plotH + 18) + '" fill="' + C.axis +
             '" font-size="10.5" text-anchor="middle">' + esc(b.label) + '</text>';
      }
    });

    /* محور القاعدة */
    s += '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) +
         '" stroke="' + C.axis + '" stroke-width="1.5"/>';

    /* المفتاح */
    var ly = H - 10;
    s += '<rect x="' + (W / 2 - 92) + '" y="' + (ly - 9) + '" width="11" height="11" rx="2" fill="' + C.in + '"/>' +
         '<text x="' + (W / 2 - 76) + '" y="' + ly + '" fill="' + C.muted + '" font-size="11.5">وارد</text>' +
         '<rect x="' + (W / 2 + 22) + '" y="' + (ly - 9) + '" width="11" height="11" rx="2" fill="' + C.out + '"/>' +
         '<text x="' + (W / 2 + 38) + '" y="' + ly + '" fill="' + C.muted + '" font-size="11.5">منصرف</text>';

    s += '</svg>';
    return s;
  }

  /* ======================================================================
     كروت الملخص
     ====================================================================== */
  function summaryTiles(data, forPrint) {
    var t = data.totals;
    var net = t.netTon;
    var netColor = net > 0 ? C.in : net < 0 ? C.out : C.muted;
    var netSign = net > 0 ? '+' : '';

    function tile(label, value, sub, color) {
      if (forPrint) {
        return '<div class="rp-tile" style="border-top-color:' + color + '">' +
                 '<div class="rp-tile-l">' + esc(label) + '</div>' +
                 '<div class="rp-tile-v" style="color:' + color + '">' + value + '</div>' +
                 '<div class="rp-tile-s">' + esc(sub) + '</div>' +
               '</div>';
      }
      return '<div class="stat" style="border-top:3px solid ' + color + '">' +
               '<div class="stat-label">' + esc(label) + '</div>' +
               '<div class="stat-value num" style="color:' + color + ';font-size:1.35rem">' + value + '</div>' +
               '<div class="stat-sub">' + esc(sub) + '</div>' +
             '</div>';
    }

    return tile('📥 إجمالي الوارد', App.fmtD(t.inTon) + ' طن', App.fmt(t.inVal) + ' ج', C.in) +
           tile('📤 إجمالي المنصرف', App.fmtD(t.outTon) + ' طن', App.fmt(t.outVal) + ' ج', C.out) +
           tile('⚖️ صافي التغيير', netSign + App.fmtD(net) + ' طن', net >= 0 ? 'المخزون زاد' : 'المخزون نقص', netColor) +
           tile('🔢 عدد الحركات', App.fmt(t.count), 'حركة في الفترة', C.cement);
  }

  /* ======================================================================
     تقرير PDF — صفحة مصممة بنطبعها
     ====================================================================== */
  function buildReportHtml(o) {
    var d = o.data;
    var t = d.totals;
    var rows = o.rows || [];
    var capped = o.capped || 0;

    var css = [
      '@page{size:A4;margin:12mm 10mm}',
      '*{margin:0;padding:0;box-sizing:border-box;',
      '  -webkit-print-color-adjust:exact;print-color-adjust:exact}',
      'body{font-family:Cairo,"Segoe UI",Tahoma,sans-serif;direction:rtl;color:#1a2233;background:#fff;font-size:11px;line-height:1.5}',
      '.num{direction:ltr;display:inline-block;unicode-bidi:isolate;font-variant-numeric:tabular-nums}',

      /* الترويسة */
      '.rp-head{background:linear-gradient(135deg,#192038,#0f1726);color:#fff;padding:18px 20px;border-radius:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}',
      '.rp-head h1{font-size:19px;font-weight:900;color:#e8c98e;margin-bottom:3px}',
      '.rp-head .sub{font-size:11px;color:#8892b0}',
      '.rp-head .meta{text-align:left;font-size:10px;color:#8892b0;line-height:1.8;white-space:nowrap}',
      '.rp-head .meta b{color:#e8c98e}',

      /* كروت الملخص */
      '.rp-tiles{display:flex;gap:8px;margin-bottom:14px}',
      '.rp-tile{flex:1;border:1px solid #dde3ee;border-top:3px solid #999;border-radius:8px;padding:10px 12px;background:#fafbfd}',
      '.rp-tile-l{font-size:9.5px;color:#68738c;font-weight:700;margin-bottom:4px}',
      '.rp-tile-v{font-size:17px;font-weight:900;line-height:1.15}',
      '.rp-tile-s{font-size:9.5px;color:#8b96ad;margin-top:2px}',

      /* أقسام */
      '.rp-sec{font-size:12px;font-weight:900;color:#8a6d2f;margin:16px 0 8px;padding-bottom:5px;border-bottom:2px solid #e8c98e}',

      /* الرسم */
      '.rp-chart{border:1px solid #dde3ee;border-radius:8px;padding:10px;background:#0f1726}',

      /* الرصيد الحالي */
      '.rp-bal{display:flex;gap:8px;margin-bottom:6px}',
      '.rp-bal div{flex:1;border:1px solid #dde3ee;border-radius:8px;padding:9px 12px;background:#fafbfd}',
      '.rp-bal .l{font-size:9.5px;color:#68738c;font-weight:700}',
      '.rp-bal .v{font-size:15px;font-weight:900}',

      /* الجدول */
      'table{width:100%;border-collapse:collapse;margin-top:4px}',
      'thead{display:table-header-group}',
      'th{background:#192038;color:#e8c98e;font-size:9.5px;font-weight:800;padding:7px 6px;text-align:right;white-space:nowrap}',
      'th:first-child{border-radius:0 6px 0 0}th:last-child{border-radius:6px 0 0 0}',
      'td{padding:6px;border-bottom:1px solid #e6eaf2;font-size:10px;vertical-align:middle}',
      'tbody tr{page-break-inside:avoid}',
      'tbody tr:nth-child(even){background:#f7f9fc}',
      '.pill{display:inline-block;padding:2px 7px;border-radius:20px;font-size:9px;font-weight:800;white-space:nowrap}',
      '.p-in{background:#dcfce7;color:#15803d}',
      '.p-out{background:#fee2e2;color:#b91c1c}',
      '.p-steel{background:#dbeafe;color:#1d4ed8}',
      '.p-cement{background:#fdf0d5;color:#8a6d2f}',
      '.muted{color:#9aa4b8}',
      '.val{color:#8a6d2f;font-weight:800}',

      '.rp-note{margin-top:10px;padding:8px 10px;background:#fff8e6;border:1px solid #f0d894;border-radius:6px;font-size:10px;color:#7a5c10}',
      '.rp-foot{margin-top:16px;padding-top:8px;border-top:1px solid #e6eaf2;font-size:9px;color:#9aa4b8;display:flex;justify-content:space-between}'
    ].join('');

    var when = new Date();
    var head =
      '<div class="rp-head">' +
        '<div><h1>📦 تقرير المخزن</h1>' +
        '<div class="sub">حديد وأسمنت — حركة الوارد والمنصرف</div></div>' +
        '<div class="meta">' +
          'الفترة: <b>' + esc(o.periodLabel) + '</b><br>' +
          'من <span class="num">' + App.fmtDate(d.from) + '</span> إلى <span class="num">' + App.fmtDate(d.to) + '</span><br>' +
          'المادة: <b>' + esc(o.matLabel) + '</b><br>' +
          'صدر في <span class="num">' + App.fmtDate(when.getTime()) + '</span>' +
        '</div>' +
      '</div>';

    var bal =
      '<div class="rp-sec">الرصيد الحالي في المخزن</div>' +
      '<div class="rp-bal">' +
        '<div><div class="l">🔩 حديد</div><div class="v" style="color:#1d4ed8"><span class="num">' +
          App.fmtD(o.balance.steelTon) + '</span> طن</div></div>' +
        '<div><div class="l">🏛️ أسمنت</div><div class="v" style="color:#8a6d2f"><span class="num">' +
          App.fmtD(o.balance.cementTon) + '</span> طن</div></div>' +
        '<div><div class="l">💰 القيمة التقديرية</div><div class="v" style="color:#15803d"><span class="num">' +
          App.fmt(o.balance.steelTon * o.prices.steelTon + o.balance.cementTon * o.prices.cementTon) +
          '</span> ج</div></div>' +
      '</div>';

    var tiles = '<div class="rp-sec">ملخص الفترة</div><div class="rp-tiles">' +
                summaryTiles(d, true) + '</div>';

    var chart = '<div class="rp-sec">حركة المخزون</div>' +
                '<div class="rp-chart">' + barChart(d, { width: 900, height: 300 }) + '</div>';

    var table = '';
    if (rows.length) {
      table = '<div class="rp-sec">تفاصيل الحركات (<span class="num">' + App.fmt(rows.length) + '</span>)</div>' +
        '<table><thead><tr>' +
          '<th>التاريخ</th><th>النوع</th><th>المادة</th><th>الكمية</th>' +
          '<th>القيمة</th><th>الجهة</th><th>الإذن</th><th>ملاحظة</th>' +
        '</tr></thead><tbody>';

      for (var i = 0; i < rows.length; i++) {
        var m = rows[i];
        var isOut = m.type === 'out';
        var isSteel = m.mat === 'steel';
        var sub = isSteel ? App.fmt(m.qtyTon * 1000) + ' كجم' : App.fmt(m.qtyTon * 20) + ' شكارة';
        table +=
          '<tr>' +
            '<td class="muted"><span class="num">' + App.fmtDate(m.ts) + '</span><br>' +
              '<span class="num" style="font-size:8.5px">' + esc(App.fmtTime(m.ts)) + '</span></td>' +
            '<td><span class="pill ' + (isOut ? 'p-out">📤 صرف' : 'p-in">📥 استلام') + '</span></td>' +
            '<td><span class="pill ' + (isSteel ? 'p-steel">🔩 حديد' : 'p-cement">🏛️ أسمنت') + '</span></td>' +
            '<td><b class="num">' + App.fmtD(m.qtyTon) + '</b> طن<br>' +
              '<span class="muted" style="font-size:8.5px">' + sub + '</span></td>' +
            '<td class="val"><span class="num">' + App.fmt(m.value) + '</span> ج</td>' +
            '<td>' + (m.party ? esc(m.party) : '<span class="muted">—</span>') + '</td>' +
            '<td><span class="num">' + (m.ref ? esc(m.ref) : '—') + '</span></td>' +
            '<td>' + (m.note ? esc(m.note) : '<span class="muted">—</span>') + '</td>' +
          '</tr>';
      }
      table += '</tbody></table>';
    }

    var note = capped
      ? '<div class="rp-note">⚠️ الفترة دي فيها <b>' + App.fmt(capped) + '</b> حركة. ' +
        'التقرير بيعرض أحدث <b>' + App.fmt(rows.length) + '</b> حركة عشان الملف ما يكبرش. ' +
        'الملخص والرسم البياني فوق محسوبين على <b>كل</b> الحركات.</div>'
      : '';

    var foot = '<div class="rp-foot"><span>نظام مواد البناء — تقرير المخزن</span>' +
               '<span class="num">' + App.fmtDateTime(when.getTime()) + '</span></div>';

    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
      '<title>تقرير المخزن — ' + esc(o.periodLabel) + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800;900&display=swap">' +
      '<style>' + css + '</style></head><body>' +
      head + bal + tiles + chart + table + note + foot +
      '</body></html>';
  }

  /* ---------- الطباعة عن طريق إطار مخفي (بيتفادى حظر النوافذ) ---------- */
  function printHtml(html) {
    var old = document.getElementById('printFrame');
    if (old) old.parentNode.removeChild(old);

    var f = document.createElement('iframe');
    f.id = 'printFrame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1000px;border:0;';
    document.body.appendChild(f);

    var doc = f.contentWindow.document;
    doc.open(); doc.write(html); doc.close();

    var fired = false;
    function go() {
      if (fired) return; fired = true;
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        App.toast('المتصفح رفض فتح الطباعة', 'err');
      }
    }
    // نستنى الخط والرسم يجهزوا
    if (f.contentWindow.document.fonts && f.contentWindow.document.fonts.ready) {
      f.contentWindow.document.fonts.ready.then(function () { setTimeout(go, 260); });
    }
    setTimeout(go, 1600);   // شبكة أمان لو الخط اتأخر
  }

  global.Report = {
    PERIODS: PERIODS,
    rangeFor: rangeFor,
    barChart: barChart,
    summaryTiles: summaryTiles,
    buildReportHtml: buildReportHtml,
    printHtml: printHtml,
    colors: C
  };
})(window);
