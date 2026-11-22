/* ==========================================================================
   report.js — الرسوم البيانية + تقرير PDF
   الرسوم SVG مرسومة بالكود (من غير مكتبات) ومتحركة بـ CSS.
   الـ PDF: صفحة مصممة بنطبعها → "حفظ كـ PDF" — عشان العربي يطلع مظبوط 100%.
   ========================================================================== */
(function (global) {
  'use strict';

  const esc = (s) => App.esc(s);

  /* ألوان الشاشة بتتقري من الثيم الحالي؛ ألوان الطباعة ثابتة */
  function screenColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { in: v('--in'), out: v('--out'), grid: v('--line'), axis: v('--faint'), text: v('--muted'), brand: v('--brand') };
  }
  const PRINT_C = { in: '#16a34a', out: '#dc2626', grid: '#e3e7ef', axis: '#8b96ad', text: '#68738c', brand: '#b0653a' };

  const PERIODS = {
    m1: { label: 'آخر شهر', months: 1, bucket: 'day' },
    m3: { label: 'آخر 3 شهور', months: 3, bucket: 'month' },
    m6: { label: 'آخر 6 شهور', months: 6, bucket: 'month' },
    y1: { label: 'آخر سنة', months: 12, bucket: 'month' },
    y2: { label: 'آخر سنتين', months: 24, bucket: 'month' }
  };

  function rangeFor(key) {
    const p = PERIODS[key] || PERIODS.m6;
    const to = new Date(); to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setMonth(from.getMonth() - p.months + (p.bucket === 'day' ? 0 : 1));
    if (p.bucket === 'day') from.setDate(from.getDate() + 1); else from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from: from.getTime(), to: to.getTime(), bucket: p.bucket, label: p.label, key };
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  /* ======================================================================
     أعمدة الوارد والمنصرف
     ====================================================================== */
  function barChart(data, opts = {}) {
    const C = opts.print ? PRINT_C : screenColors();
    const rows = data.buckets;
    const W = opts.width || 900, H = opts.height || 300;
    const padT = 18, padB = 34, padR = 44, padL = 10;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const font = 'font-family="Readex Pro,Cairo,Segoe UI,sans-serif"';

    if (!rows.length || !data.totals.count) {
      return `<svg viewBox="0 0 ${W} ${H}" role="img" ${font}><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${C.text}" font-size="15">مفيش حركات في الفترة دي</text></svg>`;
    }

    const top = niceMax(Math.max(...rows.map((b) => Math.max(b.inTon, b.outTon))));
    const slot = plotW / rows.length;
    const barW = Math.max(2, Math.min(16, slot * 0.32));
    const gap = Math.min(3, slot * 0.06);
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="رسم بياني لحركة المخزون" ${font}>`;

    s += `<defs>
      <linearGradient id="${gid}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.in}"/><stop offset="1" stop-color="${C.in}" stop-opacity=".55"/></linearGradient>
      <linearGradient id="${gid}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.out}"/><stop offset="1" stop-color="${C.out}" stop-opacity=".55"/></linearGradient>
    </defs>`;

    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - (plotH * i) / 4;
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${C.grid}" ${i ? 'stroke-dasharray="3 5"' : ''}/>`;
      s += `<text x="${W - padR + 8}" y="${(y + 4).toFixed(1)}" fill="${C.axis}" font-size="11">${App.fmtD((top * i) / 4)}</text>`;
    }

    /* الأعمدة بالترتيب من اليمين (الأقدم) للشمال (الأحدث) — زي القراءة العربي */
    const everyN = Math.ceil(rows.length / (W < 560 ? 6 : 12));
    rows.forEach((b, idx) => {
      const cx = W - padR - slot * idx - slot / 2;
      const hIn = (b.inTon / top) * plotH, hOut = (b.outTon / top) * plotH;
      const tip = `data-tip="${esc(b.label)}|${App.fmtD(b.inTon)}|${App.fmtD(b.outTon)}"`;
      /* منطقة شفافة للتمرير عشان التلميح يشتغل على العمود كله */
      if (!opts.print) s += `<rect x="${(cx - slot / 2).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent" ${tip} class="chart-hit"/>`;
      if (b.inTon > 0) s += `<rect class="chart-bar" style="--d:${idx}" x="${(cx + gap / 2).toFixed(1)}" y="${(padT + plotH - hIn).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hIn).toFixed(1)}" rx="3" fill="url(#${gid}i)" pointer-events="none"/>`;
      if (b.outTon > 0) s += `<rect class="chart-bar" style="--d:${idx}" x="${(cx - barW - gap / 2).toFixed(1)}" y="${(padT + plotH - hOut).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hOut).toFixed(1)}" rx="3" fill="url(#${gid}o)" pointer-events="none"/>`;
      if ((rows.length - 1 - idx) % everyN === 0 || rows.length <= 12) {
        s += `<text x="${cx.toFixed(1)}" y="${padT + plotH + 20}" fill="${C.axis}" font-size="10.5" text-anchor="middle">${esc(b.label)}</text>`;
      }
    });
    s += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${C.axis}" stroke-opacity=".5"/>`;
    return s + '</svg>';
  }

  function legendHtml() {
    return '<div class="legend"><span><i style="background:var(--in)"></i>وارد (استلام)</span><span><i style="background:var(--out)"></i>منصرف (صرف)</span></div>';
  }

  /* تلميح عند المرور على الأعمدة */
  function wireTooltip(host) {
    if (host._tip) return;
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    host.appendChild(tip);
    host._tip = tip;
    const show = (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.classList.remove('show'); return; }
      const [label, inT, outT] = t.getAttribute('data-tip').split('|');
      tip.innerHTML = `<b>${esc(label)}</b><span class="ti">وارد: <span class="num">${esc(inT)}</span> طن</span><br><span class="to">منصرف: <span class="num">${esc(outT)}</span> طن</span>`;
      const hr = host.getBoundingClientRect(), r = t.getBoundingClientRect();
      tip.style.left = Math.min(hr.width - 70, Math.max(70, r.left - hr.left + r.width / 2)) + 'px';
      tip.style.top = (r.top - hr.top + 30) + 'px';
      tip.classList.add('show');
    };
    host.addEventListener('pointermove', show);
    host.addEventListener('pointerleave', () => tip.classList.remove('show'));
  }

  /* ======================================================================
     خط صغير (Sparkline) لكروت اللوحة
     ====================================================================== */
  function sparkline(values, color, w = 160, h = 44) {
    if (!values.length) return '';
    const max = Math.max(1, ...values), min = Math.min(0, ...values);
    const step = w / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => [w - i * step, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 'sp' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L ${pts[pts.length - 1][0].toFixed(1)} ${h} L ${w} ${h} Z" fill="url(#${id})"/>
      <path class="chart-line" style="--len:${Math.round(w * 2)}" d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  /* ======================================================================
     كروت ملخص الفترة
     ====================================================================== */
  function summaryTiles(data, forPrint) {
    const t = data.totals, net = t.netTon;
    const tiles = [
      ['إجمالي الوارد', App.fmtD(t.inTon) + ' طن', App.fmt(t.inVal) + ' ج', 'in', 'i-down'],
      ['إجمالي المنصرف', App.fmtD(t.outTon) + ' طن', App.fmt(t.outVal) + ' ج', 'out', 'i-up'],
      ['صافي التغيير', (net > 0 ? '+' : '') + App.fmtD(net) + ' طن', net >= 0 ? 'المخزون زاد' : 'المخزون نقص', net >= 0 ? 'in' : 'out', 'i-scale'],
      ['عدد الحركات', App.fmt(t.count), 'حركة في الفترة', '', 'i-list']
    ];
    if (forPrint) {
      const col = { in: '#16a34a', out: '#dc2626', '': '#b0653a' };
      return tiles.map(([l, v, s, k]) => `<div class="rp-tile" style="border-top-color:${col[k]}"><div class="rp-tile-l">${esc(l)}</div><div class="rp-tile-v" style="color:${col[k]}"><span class="num">${esc(v)}</span></div><div class="rp-tile-s">${esc(s)}</div></div>`).join('');
    }
    return tiles.map(([l, v, s, k, ic]) => `<div class="card kpi" style="padding:var(--sp-4)"><div class="kpi-top"><span class="kpi-label">${esc(l)}</span><span class="kpi-ic ${k}" style="width:32px;height:32px;border-radius:10px"><svg class="i i-sm"><use href="#${ic}"/></svg></span></div><div class="kpi-value ${k ? 't-' + k : ''}" style="font-size:1.25rem"><span class="num">${esc(v)}</span></div><div class="kpi-sub">${esc(s)}</div></div>`).join('');
  }

  /* ======================================================================
     تقرير PDF
     ====================================================================== */
  function buildReportHtml(o) {
    const d = o.data, rows = o.rows || [], capped = o.capped || 0;
    const itemName = (id) => (o.items && o.items[id]) || '';
    const css = `
      @page{size:A4;margin:12mm 10mm}
      *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{font-family:"Readex Pro",Cairo,"Segoe UI",Tahoma,sans-serif;direction:rtl;color:#1a2233;background:#fff;font-size:11px;line-height:1.55}
      .num{direction:ltr;display:inline-block;unicode-bidi:isolate;font-variant-numeric:tabular-nums}
      .rp-head{background:linear-gradient(135deg,#1b2236,#0d1220);color:#fff;padding:18px 20px;border-radius:12px;margin-bottom:14px;display:flex;justify-content:space-between;gap:16px}
      .rp-head h1{font-size:19px;font-weight:700;color:#f1c27d;margin-bottom:3px}
      .rp-head .sub{font-size:11px;color:#9aa4bd}
      .rp-head .meta{text-align:left;font-size:10px;color:#9aa4bd;line-height:1.85;white-space:nowrap}
      .rp-head .meta b{color:#f1c27d}
      .rp-tiles,.rp-bal{display:flex;gap:8px;margin-bottom:12px}
      .rp-tile,.rp-bal>div{flex:1;border:1px solid #e3e7ef;border-top:3px solid #999;border-radius:9px;padding:9px 12px;background:#fafbfd}
      .rp-bal>div{border-top-width:1px}
      .rp-tile-l,.rp-bal .l{font-size:9.5px;color:#68738c;font-weight:600;margin-bottom:3px}
      .rp-tile-v{font-size:16px;font-weight:700;line-height:1.2}
      .rp-bal .v{font-size:15px;font-weight:700}
      .rp-tile-s{font-size:9.5px;color:#8b96ad;margin-top:2px}
      .rp-sec{font-size:12px;font-weight:700;color:#8a5a2b;margin:16px 0 8px;padding-bottom:5px;border-bottom:2px solid #f1c27d}
      .rp-chart{border:1px solid #e3e7ef;border-radius:9px;padding:10px}
      .lg{display:flex;gap:16px;justify-content:center;font-size:10px;color:#68738c;margin-top:6px}
      .lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-inline-end:5px;vertical-align:middle}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      thead{display:table-header-group}
      th{background:#1b2236;color:#f1c27d;font-size:9.5px;font-weight:600;padding:7px 6px;text-align:right;white-space:nowrap}
      td{padding:6px;border-bottom:1px solid #e9edf4;font-size:10px;vertical-align:middle}
      tbody tr{page-break-inside:avoid}
      tbody tr:nth-child(even){background:#f7f9fc}
      .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:600;white-space:nowrap}
      .p-in{background:#dcfce7;color:#15803d}.p-out{background:#fee2e2;color:#b91c1c}
      .p-steel{background:#dbeafe;color:#1d4ed8}.p-cement{background:#fdf0d5;color:#8a5a2b}
      .muted{color:#9aa4b8}.val{color:#8a5a2b;font-weight:600}
      .rp-note{margin-top:10px;padding:8px 10px;background:#fff8e6;border:1px solid #f0d894;border-radius:6px;font-size:10px;color:#7a5c10}
      .rp-foot{margin-top:16px;padding-top:8px;border-top:1px solid #e9edf4;font-size:9px;color:#9aa4b8;display:flex;justify-content:space-between}`;

    const when = Date.now();
    let html = `<div class="rp-head"><div><h1>${esc(o.title || 'تقرير المخزن')}</h1><div class="sub">${esc(o.subtitle || 'حركة الوارد والمنصرف')}</div></div>
      <div class="meta">الفترة: <b>${esc(o.periodLabel)}</b><br>من <span class="num">${App.fmtDate(d.from)}</span> إلى <span class="num">${App.fmtDate(d.to)}</span><br>
      ${o.matLabel ? 'التصفية: <b>' + esc(o.matLabel) + '</b><br>' : ''}صدر في <span class="num">${App.fmtDate(when)}</span></div></div>`;

    if (o.balance) {
      html += `<div class="rp-sec">الرصيد الحالي في المخزن</div><div class="rp-bal">
        <div><div class="l">حديد</div><div class="v" style="color:#1d4ed8"><span class="num">${App.fmtD(o.balance.steelTon)}</span> طن</div></div>
        <div><div class="l">أسمنت</div><div class="v" style="color:#8a5a2b"><span class="num">${App.fmtD(o.balance.cementTon)}</span> طن</div></div>
        <div><div class="l">القيمة التقديرية</div><div class="v" style="color:#15803d"><span class="num">${App.fmt(o.balance.steelTon * o.prices.steelTon + o.balance.cementTon * o.prices.cementTon)}</span> ج</div></div></div>`;
    }
    html += `<div class="rp-sec">ملخص الفترة</div><div class="rp-tiles">${summaryTiles(d, true)}</div>`;
    html += `<div class="rp-sec">حركة المخزون</div><div class="rp-chart">${barChart(d, { width: 900, height: 280, print: true })}
      <div class="lg"><span><i style="background:#16a34a"></i>وارد</span><span><i style="background:#dc2626"></i>منصرف</span></div></div>`;

    if (rows.length) {
      html += `<div class="rp-sec">تفاصيل الحركات (<span class="num">${App.fmt(rows.length)}</span>)</div><table><thead><tr>
        <th>التاريخ</th><th>النوع</th><th>الصنف</th><th>الكمية</th><th>القيمة</th><th>الجهة</th><th>الإذن</th><th>ملاحظة</th></tr></thead><tbody>`;
      for (const m of rows) {
        const isSteel = m.mat === 'steel';
        const sub = isSteel ? App.fmt(m.qtyTon * 1000) + ' كجم' : App.fmt(m.qtyTon * 20) + ' شكارة';
        html += `<tr><td class="muted"><span class="num">${App.fmtDate(m.ts)}</span><br><span class="num" style="font-size:8.5px">${esc(App.fmtTime(m.ts))}</span></td>
          <td><span class="pill ${m.type === 'out' ? 'p-out">صرف' : 'p-in">استلام'}</span></td>
          <td><span class="pill ${isSteel ? 'p-steel' : 'p-cement'}">${esc(itemName(m.item) || (isSteel ? 'حديد' : 'أسمنت'))}</span></td>
          <td><b class="num">${App.fmtD(m.qtyTon)}</b> طن<br><span class="muted" style="font-size:8.5px">${sub}</span></td>
          <td class="val"><span class="num">${App.fmt(m.value)}</span> ج</td>
          <td>${m.party ? esc(m.party) : '<span class="muted">—</span>'}</td>
          <td><span class="num">${m.ref ? esc(m.ref) : '—'}</span></td>
          <td>${m.note ? esc(m.note) : '<span class="muted">—</span>'}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    if (capped) {
      html += `<div class="rp-note">⚠️ الفترة فيها <b>${App.fmt(capped)}</b> حركة. التقرير بيعرض أحدث <b>${App.fmt(rows.length)}</b> بس عشان الملف ما يكبرش — الملخص والرسم محسوبين على <b>كل</b> الحركات.</div>`;
    }
    html += `<div class="rp-foot"><span>نظام مواد البناء — ${esc(o.title || 'تقرير المخزن')}</span><span class="num">${App.fmtDateTime(when)}</span></div>`;

    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(o.title || 'تقرير المخزن')} — ${esc(o.periodLabel)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;600;700&display=swap">
      <style>${css}</style></head><body>${html}</body></html>`;
  }

  /* الطباعة عن طريق إطار مخفي (بيتفادى حظر النوافذ المنبثقة) */
  function printHtml(html) {
    document.getElementById('printFrame')?.remove();
    const f = document.createElement('iframe');
    f.id = 'printFrame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1000px;border:0;';
    document.body.appendChild(f);
    const doc = f.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    let fired = false;
    const go = () => {
      if (fired) return; fired = true;
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { App.toast('المتصفح رفض فتح الطباعة', 'err'); }
    };
    doc.fonts?.ready.then(() => setTimeout(go, 260));
    setTimeout(go, 1800);
  }

  global.Report = { PERIODS, rangeFor, barChart, legendHtml, wireTooltip, sparkline, summaryTiles, buildReportHtml, printHtml };
})(window);
