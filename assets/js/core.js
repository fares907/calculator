/* ==========================================================================
   core.js — أدوات مشتركة بين كل الصفحات
   سكربت عادي (مش module) عشان يشتغل حتى لو فتحت الملف بالدبل-كليك
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- اختصارات ---------- */
  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- الأمان: تنظيف أي نص قبل ما يتحط في الصفحة ----------
     ده بيمنع إن حد يكتب كود في خانة الملاحظات ويكسر الصفحة */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- الأرقام ---------- */
  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // تقريب لـ 3 خانات عشرية — بيمنع أخطاء الكسور العشرية في الجافاسكربت
  function round3(n) { return Math.round((toNum(n) + Number.EPSILON) * 1000) / 1000; }

  // رقم صحيح بفواصل الألوف: 1,161,000
  function fmt(n) {
    return Math.round(toNum(n)).toLocaleString('en-US');
  }

  // رقم بكسور (لحد 3 خانات) من غير أصفار زيادة: 12.5 مش 12.500
  function fmtD(n) {
    var v = round3(n);
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }

  // فلوس
  function money(n) { return fmt(n) + ' ج'; }

  /* ---------- التاريخ ----------
     بنخزّن الوقت كرقم (epoch ms) مش كنص — عشان نقدر نرتّب ونفلتر ونصدّر صح */
  function fmtDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var p = function (x) { return x < 10 ? '0' + x : '' + x; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h < 12 ? 'ص' : 'م';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }
  function fmtDateTime(ts) { return fmtDate(ts) + ' · ' + fmtTime(ts); }

  // تحويل <input type="date"> لأول/آخر لحظة في اليوم
  function dayStart(str) { var d = new Date(str + 'T00:00:00'); return isNaN(d) ? null : d.getTime(); }
  function dayEnd(str)   { var d = new Date(str + 'T23:59:59.999'); return isNaN(d) ? null : d.getTime(); }

  /* ---------- معرّف فريد ----------
     Date.now() لوحده مش كفاية: حركتين في نفس الملي ثانية بيبقى ليهم نفس الرقم */
  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 10);
    var r2 = Math.random().toString(36).slice(2, 10);
    return t + '-' + r + '-' + r2;
  }

  /* ---------- تأخير التنفيذ (debounce) ----------
     عشان منحفظش مع كل حرف بيتكتب */
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait || 300);
    };
  }

  /* ---------- التوست ---------- */
  var toastHost = null;
  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
    return toastHost;
  }
  function toast(msg, kind, ms) {
    var host = ensureToastHost();
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, ms || 2800);
  }

  /* ---------- نافذة تأكيد (بديل confirm البشع بتاع المتصفح) ---------- */
  function ensureModalHost() {
    var host = $('#modalHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'modalHost';
    host.className = 'modal-host';
    document.body.appendChild(host);
    return host;
  }

  function dialog(opts) {
    return new Promise(function (resolve) {
      var host = ensureModalHost();
      var danger = !!opts.danger;
      host.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-grip"></div>' +
          '<h3>' + esc(opts.title || 'تأكيد') + '</h3>' +
          '<p class="modal-text">' + (opts.html || esc(opts.text || '')) + '</p>' +
          '<div class="modal-actions">' +
            '<button class="btn ' + (danger ? 'btn-out' : 'btn-primary') + '" data-act="ok">' +
              esc(opts.okText || 'تمام') + '</button>' +
            '<button class="btn btn-ghost" data-act="cancel">' +
              esc(opts.cancelText || 'إلغاء') + '</button>' +
          '</div>' +
        '</div>';
      host.classList.add('open');

      function close(val) {
        host.classList.remove('open');
        host.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }

      host.onclick = function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        else if (act === 'cancel') close(false);
        else if (e.target === host) close(false);
      };
      document.addEventListener('keydown', onKey);

      var okBtn = host.querySelector('[data-act="ok"]');
      if (okBtn) okBtn.focus();
    });
  }

  function confirmBox(text, opts) {
    opts = opts || {};
    return dialog({
      title: opts.title || 'تأكيد',
      text: text,
      okText: opts.okText || 'أيوه، كمّل',
      cancelText: opts.cancelText || 'لأ، إلغاء',
      danger: opts.danger !== false
    });
  }

  /* ---------- تنزيل ملف ---------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob
      ? content
      : new Blob(['﻿' + content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /* ---------- تصدير ---------- */
  global.App = {
    $: $, $$: $$,
    esc: esc,
    toNum: toNum, round3: round3,
    fmt: fmt, fmtD: fmtD, money: money,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime,
    dayStart: dayStart, dayEnd: dayEnd,
    uid: uid, debounce: debounce,
    toast: toast, dialog: dialog, confirm: confirmBox,
    download: download, toCSV: toCSV
  };
})(window);
