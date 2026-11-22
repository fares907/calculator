/* ==========================================================================
   core.js — أدوات مشتركة بين كل الصفحات
   سكربت عادي (مش module) عشان يشتغل حتى لو فتحت الملف بالدبل-كليك
   ========================================================================== */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  /* ---------- الأمان: تنظيف النص قبل ما يتحط في الصفحة ---------- */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- الأرقام ---------- */
  const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const round3 = (n) => Math.round((toNum(n) + Number.EPSILON) * 1000) / 1000;
  const fmt = (n) => Math.round(toNum(n)).toLocaleString('en-US');
  const fmtD = (n) => round3(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const money = (n) => fmt(n) + ' ج';
  /* اختصار للأرقام الكبيرة: 1.2M / 350K */
  function compact(n) {
    const v = toNum(n), a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
    if (a >= 1e4) return (v / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
    return fmt(v);
  }

  /* ---------- التاريخ ---------- */
  const p2 = (x) => (x < 10 ? '0' + x : '' + x);
  function fmtDate(ts) {
    const d = new Date(ts);
    return isNaN(d) ? '—' : p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + p2(m) + ' ' + (h < 12 ? 'ص' : 'م');
  }
  const fmtDateTime = (ts) => fmtDate(ts) + ' · ' + fmtTime(ts);
  function relTime(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'دلوقتي';
    const m = Math.round(s / 60);
    if (m < 60) return 'من ' + m + ' دقيقة';
    const h = Math.round(m / 60);
    if (h < 24) return 'من ' + h + ' ساعة';
    const d = Math.round(h / 24);
    if (d < 30) return 'من ' + d + ' يوم';
    return fmtDate(ts);
  }
  const dayStart = (str) => { const d = new Date(str + 'T00:00:00'); return isNaN(d) ? null : d.getTime(); };
  const dayEnd = (str) => { const d = new Date(str + 'T23:59:59.999'); return isNaN(d) ? null : d.getTime(); };
  /* قيمة لخانة datetime-local */
  function toLocalInput(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /* ---------- معرّف فريد بصيغة UUID ----------
     crypto.randomUUID مش موجودة لما تفتح الموقع من عنوان الشبكة المحلية
     (http://192.168…) — فبنعمل UUID صحيح بنفسنا من getRandomValues اللي
     شغالة في كل مكان. ده كان بيبوّظ الرفع للسحابة في النسخة القديمة. */
  function uid() {
    if (global.crypto && crypto.randomUUID && global.isSecureContext) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function debounce(fn, wait = 300) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }

  const reduceMotion = () => global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- انتقال ناعم بين حالات الصفحة (View Transitions API) ---------- */
  function transition(fn) {
    if (document.startViewTransition && !reduceMotion()) return document.startViewTransition(fn);
    fn();
    return null;
  }

  /* ---------- عدّاد متحرك للأرقام ---------- */
  const counters = new WeakMap();
  function countTo(el, value, format, suffix) {
    if (!el) return;
    format = format || fmt;
    suffix = suffix || '';
    const from = counters.has(el) ? counters.get(el) : 0;
    counters.set(el, value);
    if (reduceMotion() || from === value) { el.textContent = format(value) + suffix; return; }
    const start = performance.now(), dur = 700;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 4);
      el.textContent = format(from + (value - from) * e) + suffix;
      if (k < 1 && counters.get(el) === value) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- الوضع الليلي / النهاري ---------- */
  const THEME_KEY = 'binaa_theme';
  function getTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (t === 'light' || t === 'dark') return t;
    return global.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f4f5f8' : '#0b0f19';
  }
  function toggleTheme(ev) {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    /* دايرة بتكبر من مكان الضغطة */
    if (ev && ev.clientX !== undefined) {
      document.documentElement.style.setProperty('--vt-x', ev.clientX + 'px');
      document.documentElement.style.setProperty('--vt-y', ev.clientY + 'px');
    }
    document.documentElement.classList.add('theme-vt');
    const vt = transition(() => applyTheme(next));
    const clear = () => document.documentElement.classList.remove('theme-vt');
    if (vt) vt.finished.then(clear, clear); else clear();
  }
  applyTheme(getTheme());

  /* ---------- التوست (مع زرار اختياري زي "تراجع") ---------- */
  let toastHost = null;
  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
    return toastHost;
  }
  const TOAST_ICON = { ok: '✓', err: '!', warn: '⚠', info: 'i' };
  function toast(msg, kind, ms, action) {
    kind = kind || 'info';
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    const ic = document.createElement('span');
    ic.className = 'toast-ic';
    ic.textContent = TOAST_ICON[kind] || 'i';
    const tx = document.createElement('span');
    tx.className = 'toast-tx';
    tx.textContent = msg;
    el.append(ic, tx);
    let timer;
    const close = () => {
      clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 320);
    };
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-act';
      b.textContent = action.label;
      b.addEventListener('click', () => { close(); action.run(); });
      el.appendChild(b);
    }
    host.appendChild(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    timer = setTimeout(close, ms || (action ? 6000 : 2800));
    return close;
  }

  /* ---------- نافذة تأكيد بعنصر <dialog> الأصلي ---------- */
  function dialog(opts) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet sheet-sm';
      dlg.innerHTML =
        '<form method="dialog" class="sheet-body">' +
          '<div class="sheet-grip"></div>' +
          '<div class="confirm-ic ' + (opts.danger ? 'is-danger' : '') + '">' + (opts.danger ? '!' : '?') + '</div>' +
          '<h3 class="sheet-title">' + esc(opts.title || 'تأكيد') + '</h3>' +
          '<p class="sheet-text">' + (opts.html || esc(opts.text || '')) + '</p>' +
          '<div class="sheet-actions">' +
            '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" value="ok">' + esc(opts.okText || 'تمام') + '</button>' +
            '<button class="btn btn-ghost" value="cancel">' + esc(opts.cancelText || 'إلغاء') + '</button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); setTimeout(() => dlg.remove(), 300); });
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
      dlg.showModal();
    });
  }
  function confirmBox(text, opts = {}) {
    return dialog({
      title: opts.title || 'تأكيد', text,
      okText: opts.okText || 'أيوه، كمّل', cancelText: opts.cancelText || 'لأ، إلغاء',
      danger: opts.danger !== false
    });
  }

  /* فتح/قفل أي <dialog> مع قفل بالضغط برّه */
  function wireSheet(dlg) {
    if (!dlg || dlg._wired) return dlg;
    dlg._wired = true;
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    return dlg;
  }

  /* ---------- تنزيل ملف ---------- */
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob(['﻿' + content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /* ---------- CSV ----------
     حماية من "حقن الصيغ" (CSV/Formula Injection): أي خانة نصية بتبدأ بـ
     = + - @ أو Tab بيتحط قبلها ' — عشان Excel ما ينفذهاش كمعادلة لو حد
     كتب في الملاحظة مثلاً =HYPERLINK(...). الأرقام بتفضل أرقام. */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

  /* ---------- الأوفلاين: تسجيل الـ Service Worker ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    global.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
  registerSW();

  /* زرار الثيم في أي صفحة + زرار القفل في أي نافذة */
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    if (e.target.closest('[data-theme-toggle]')) toggleTheme(e);
    const c = e.target.closest('[data-close]');
    if (c && c.closest('dialog')) c.closest('dialog').close('cancel');
  });

  global.App = {
    $, $$, esc,
    toNum, round3, fmt, fmtD, money, compact,
    fmtDate, fmtTime, fmtDateTime, relTime, dayStart, dayEnd, toLocalInput,
    uid, debounce, transition, countTo, reduceMotion,
    getTheme, toggleTheme,
    toast, dialog, confirm: confirmBox, wireSheet,
    download, toCSV
  };
})(window);
