/* ==========================================================================
   warehouse.js — منطق تطبيق المخزن (الإصدار 2)
   الشاشات: اللوحة · حركة جديدة · السجل · الأصناف · التقارير والجهات
   ========================================================================== */
(function () {
  'use strict';

  const { $, $$, esc } = App;
  const N = App.toNum, R3 = App.round3;
  const PAGE_SIZE = 25;
  const KG = 1000, BAGS = 20;
  const MAX_PDF_ROWS = 800;
  const VIEWS = ['dash', 'move', 'log', 'items', 'reports'];

  const state = {
    view: 'dash',
    type: 'out', mat: 'steel',
    settings: null,
    balance: { steelTon: 0, cementTon: 0 },
    itemBal: {},
    items: [],
    filters: { text: '', mat: '', type: '', item: '', party: '', from: null, to: null },
    page: 1, total: 0,
    period: 'm6', chartMat: '', chartData: null, chartRange: null,
    dashPeriod: 'm6',
    parties: null,
    priceTouched: false,
    editing: null,
    editingItem: null
  };

  /* ---------- أدوات ---------- */
  const itemMap = () => Object.fromEntries(state.items.map((i) => [i.id, i]));
  const itemName = (id) => (itemMap()[id] || {}).name || (id === 'cement' ? 'أسمنت' : 'حديد');
  const matName = (m) => (m === 'steel' ? 'حديد' : 'أسمنت');
  const subOf = (mat, ton) => (mat === 'steel' ? App.fmt(ton * KG) + ' كجم' : App.fmt(ton * BAGS) + ' شكارة');
  const icon = (id, cls) => `<svg class="i ${cls || ''}"><use href="#i-${id}"/></svg>`;
  function setSeg(seg, btn) {
    const btns = $$('.seg-btn', seg);
    btns.forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    seg.style.setProperty('--i', btns.indexOf(btn));
  }
  function errMsg(e) { return (e && e.message) || ''; }

  /* ======================================================================
     1. الأسعار
     ====================================================================== */
  function prices() {
    const s = state.settings;
    return { steelTon: s.steelPriceTon, cementBag: s.cementBagPrice, cementTon: s.cementBagPrice * BAGS };
  }
  const priceFor = (mat) => (mat === 'steel' ? prices().steelTon : prices().cementTon);

  const savePrices = App.debounce(async () => {
    state.settings = await Store.setSettings({ steelPriceTon: N($('#steelPriceTon').value), cementBagPrice: N($('#cementPriceBag').value) });
  }, 500);

  function fillPrices() {
    const s = state.settings;
    $('#steelPriceTon').value = s.steelPriceTon;
    $('#steelPriceKg').value = R3(s.steelPriceTon / KG);
    $('#cementPriceBag').value = s.cementBagPrice;
    $('#cementPriceTon').value = R3(s.cementBagPrice * BAGS);
  }

  function wirePrices() {
    const link = (a, b, f, setKey) => {
      $(a).addEventListener('input', () => {
        $(b).value = $(a).value === '' ? '' : R3(N($(a).value) * f);
        setKey();
      });
    };
    const afterSteel = () => { state.settings.steelPriceTon = N($('#steelPriceTon').value); changed(); };
    const afterCement = () => { state.settings.cementBagPrice = N($('#cementPriceBag').value); changed(); };
    const changed = () => { renderBalance(); if (!state.priceTouched) $('#priceInp').value = priceFor(state.mat); renderPreview(); savePrices(); };
    link('#steelPriceTon', '#steelPriceKg', 1 / KG, afterSteel);
    link('#steelPriceKg', '#steelPriceTon', KG, afterSteel);
    link('#cementPriceBag', '#cementPriceTon', BAGS, afterCement);
    link('#cementPriceTon', '#cementPriceBag', 1 / BAGS, afterCement);
  }

  /* ======================================================================
     2. الرصيد واللوحة
     ====================================================================== */
  function renderBalance() {
    const b = state.balance, s = state.settings, p = prices();
    const sv = b.steelTon * p.steelTon, cv = b.cementTon * p.cementTon;
    App.countTo($('#kTotal'), sv + cv);
    App.countTo($('#kSteel'), b.steelTon, App.fmtD);
    App.countTo($('#kCement'), b.cementTon, App.fmtD);
    $('#kSteelKg').textContent = App.fmt(b.steelTon * KG);
    $('#kSteelVal').textContent = App.compact(sv);
    $('#kCementBags').textContent = App.fmt(b.cementTon * BAGS);
    $('#kCementVal').textContent = App.compact(cv);

    const pct = (v, cap) => (cap > 0 ? Math.min(100, Math.max(0, (v / cap) * 100)) : 0);
    const sp = pct(b.steelTon, s.steelCapTon), cp = pct(b.cementTon, s.cementCapTon);
    $('#ringSteel').style.setProperty('--p', sp.toFixed(1));
    $('#ringCement').style.setProperty('--p', cp.toFixed(1));
    $('#ringSteelTx').textContent = Math.round(sp) + '%';
    $('#ringCementTx').textContent = Math.round(cp) + '%';
    $('#ringSteel').style.setProperty('--c', b.steelTon <= s.steelLowTon ? 'var(--out)' : 'var(--steel)');
    $('#ringCement').style.setProperty('--c', b.cementTon <= s.cementLowTon ? 'var(--out)' : 'var(--cement)');

    /* تنبيهات النقص — على مستوى المادة وعلى مستوى كل صنف */
    const warns = [];
    if (b.steelTon <= s.steelLowTon) warns.push(`الحديد كله <b class="num">${App.fmtD(b.steelTon)}</b> طن`);
    if (b.cementTon <= s.cementLowTon) warns.push(`الأسمنت كله <b class="num">${App.fmtD(b.cementTon)}</b> طن`);
    for (const it of state.items) {
      if (it.hidden || !(it.low > 0)) continue;
      const v = state.itemBal[it.id] || 0;
      if (v <= it.low) warns.push(`${esc(it.name)}: <b class="num">${App.fmtD(v)}</b> طن`);
    }
    $('#lowAlert').innerHTML = warns.length
      ? `<div class="alert alert-warn reveal">${icon('alert')}<div><strong>المخزون قرب يخلص — محتاج طلبية</strong><br>${warns.join(' · ')}</div></div>`
      : '';
  }

  async function loadDash() {
    const r = Report.rangeFor(state.dashPeriod);
    const host = $('#dashChart');
    try {
      const [data, recent, last30] = await Promise.all([
        Store.series({ from: r.from, to: r.to, bucket: r.bucket }),
        Store.query({ page: 1, pageSize: 6 }),
        Store.series({ ...Report.rangeFor('m1') })
      ]);
      host.innerHTML = Report.barChart(data, { width: 720, height: 280 });
      Report.wireTooltip(host);
      $('#dashLegend').innerHTML = Report.legendHtml();
      renderRecent(recent.rows);
      App.countTo($('#k30'), last30.totals.count);
      $('#spark30').innerHTML = Report.sparkline(last30.buckets.map((b) => b.count), getComputedStyle(document.documentElement).getPropertyValue('--in').trim());
    } catch (e) {
      host.innerHTML = `<div class="alert alert-error">${icon('alert')}<div>مشكلة في التحميل: ${esc(errMsg(e))}</div></div>`;
    }
  }

  function renderRecent(rows) {
    const host = $('#recentHost');
    if (!rows.length) {
      host.innerHTML = `<div class="empty"><div class="empty-ic">${icon('box', 'i-lg')}</div><p>مفيش حركات لسه</p><button class="btn btn-primary btn-sm mt-3" data-go="move" type="button">${icon('plus', 'i-sm')}أول حركة</button></div>`;
      return;
    }
    host.innerHTML = rows.map((m, i) => `
      <div class="recent-row reveal" style="--d:${i}">
        <span class="recent-ic ${m.type}">${icon(m.type === 'in' ? 'down' : 'up')}</span>
        <div class="recent-main"><b>${esc(itemName(m.item))}${m.party ? ' · ' + esc(m.party) : ''}</b><span>${esc(App.relTime(m.ts))}</span></div>
        <div class="recent-qty ${m.type}"><span class="num">${m.type === 'in' ? '+' : '−'}${App.fmtD(m.qtyTon)}</span> طن</div>
      </div>`).join('');
  }

  /* ======================================================================
     3. التنقل بين الشاشات
     ====================================================================== */
  function go(view, opts = {}) {
    if (!VIEWS.includes(view)) view = 'dash';
    const changed = view !== state.view || !$('.view.is-active');
    const apply = () => {
      state.view = view;
      $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
      $$('[data-go]').forEach((b) => {
        if (b.closest('.sidebar') || b.closest('.tabbar')) {
          if (b.dataset.go === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        }
      });
      if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    };
    if (changed) App.transition(apply); else apply();
    if (changed && !opts.keepScroll) window.scrollTo({ top: 0, behavior: App.reduceMotion() ? 'auto' : 'instant' });
    onEnter(view);
  }

  function onEnter(view) {
    if (view === 'dash') { renderBalance(); loadDash(); }
    else if (view === 'move') { renderPreview(); setTimeout(() => { if (matchMedia('(pointer:fine)').matches) $('#qtyTon').focus(); }, 350); }
    else if (view === 'log') loadLog();
    else if (view === 'items') renderItems();
    else if (view === 'reports') loadReports();
  }

  function wireNav() {
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) { e.preventDefault(); go(g.dataset.go); }
      const q = e.target.closest('[data-quick]');
      if (q) { setType(q.dataset.quick); go('move'); }
    });
    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1);
      if (VIEWS.includes(v) && v !== state.view) go(v);
    });

    /* اختصارات الكيبورد */
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && state.view === 'move') { e.preventDefault(); submitMove(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N' || e.key === 'ى') { e.preventDefault(); go('move'); }
      else if (e.key === '/') { e.preventDefault(); go('log'); setTimeout(() => $('#fText').focus(), 300); }
      else if (/^[1-5]$/.test(e.key)) go(['dash', 'move', 'log', 'items', 'reports'][+e.key - 1]);
    });
  }

  /* ======================================================================
     4. نموذج الحركة
     ====================================================================== */
  function setType(t) {
    state.type = t;
    const seg = $('#typeSeg');
    seg.dataset.v = t;
    setSeg(seg, $(`[data-type="${t}"]`, seg));
    const btn = $('#actionBtn');
    btn.className = 'btn btn-lg btn-block mt-4 ' + (t === 'out' ? 'btn-out' : 'btn-in');
    $('span', btn).textContent = t === 'out' ? 'تسجيل الصرف' : 'تسجيل الاستلام';
    $('#partyLabel').textContent = t === 'out' ? 'جهة الصرف (العميل)' : 'المورد';
    $('#partyInp').placeholder = t === 'out' ? 'مثال: مقاول الموقع' : 'مثال: مصنع عز';
    renderPreview();
  }

  function fillItemSelect(sel, mat, selected) {
    const list = state.items.filter((i) => (!mat || i.mat === mat) && (!i.hidden || i.id === selected));
    sel.innerHTML = list.map((i) => `<option value="${esc(i.id)}">${esc(i.name)} — ${App.fmtD(state.itemBal[i.id] || 0)} طن</option>`).join('');
    if (selected && list.some((i) => i.id === selected)) sel.value = selected;
  }

  function setMat(mat) {
    state.mat = mat;
    $$('#matPick .mat-opt').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mat === mat ? 'true' : 'false'));
    const prev = $('#itemSelect').value;
    fillItemSelect($('#itemSelect'), mat, prev);
    $('#subUnit').textContent = mat === 'steel' ? 'كجم' : 'شكارة';
    $('#qtySubLabel').textContent = mat === 'steel' ? 'الكمية بالكيلو' : 'الكمية بالشكارة';
    const t = N($('#qtyTon').value);
    $('#qtySub').value = t ? R3(t * (mat === 'steel' ? KG : BAGS)) : '';
    state.priceTouched = false;
    $('#priceInp').value = priceFor(mat);
    renderPreview();
  }

  function renderPreview() {
    if (!state.settings) return;
    const qty = N($('#qtyTon').value);
    const item = $('#itemSelect').value || state.mat;
    const unit = N($('#priceInp').value);
    const now = state.itemBal[item] || 0;
    const matNow = state.mat === 'steel' ? state.balance.steelTon : state.balance.cementTon;
    const sign = state.type === 'in' ? 1 : -1;
    const after = R3(now + sign * qty);
    App.countTo($('#pvValue'), qty * unit);
    $('#pvItem').textContent = itemName(item);
    $('#pvNow').textContent = App.fmtD(now);
    $('#pvAfter').textContent = App.fmtD(after);
    $('#pvMatAfter').textContent = App.fmtD(R3(matNow + sign * qty));
    const over = state.type === 'out' && qty > 0 && qty > now + 1e-9;
    $('#previewCard').classList.toggle('is-over', over);
    $('#pvErr').hidden = !over;
    if (over) $('#pvErrTx').innerHTML = `رصيد <b>${esc(itemName(item))}</b> <b class="num">${App.fmtD(now)}</b> طن بس — مينفعش تصرف <b class="num">${App.fmtD(qty)}</b> طن.`;
    $('#actionBtn').disabled = over;
  }

  function wireForm() {
    $('#typeSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) setType(b.dataset.type); });
    $('#matPick').addEventListener('click', (e) => { const b = e.target.closest('[data-mat]'); if (b) setMat(b.dataset.mat); });
    $('#itemSelect').addEventListener('change', renderPreview);
    const f = () => (state.mat === 'steel' ? KG : BAGS);
    $('#qtyTon').addEventListener('input', () => { const v = $('#qtyTon').value; $('#qtySub').value = v === '' ? '' : R3(N(v) * f()); renderPreview(); });
    $('#qtySub').addEventListener('input', () => { const v = $('#qtySub').value; $('#qtyTon').value = v === '' ? '' : R3(N(v) / f()); renderPreview(); });
    $('#priceInp').addEventListener('input', () => { state.priceTouched = true; renderPreview(); });
    $('#moveForm').addEventListener('submit', (e) => { e.preventDefault(); submitMove(); });
  }

  let submitting = false;
  async function submitMove() {
    if (submitting) return;
    const qty = R3(N($('#qtyTon').value));
    if (qty <= 0) { App.toast('اكتب كمية أكبر من صفر', 'err'); $('#qtyTon').focus(); return; }
    const item = $('#itemSelect').value || state.mat;
    const have = state.itemBal[item] || 0;
    if (state.type === 'out' && qty > have + 1e-9) { App.toast(`رصيد ${itemName(item)} ${App.fmtD(have)} طن بس`, 'err', 3600); return; }

    const btn = $('#actionBtn');
    submitting = true; btn.classList.add('is-loading');
    const tsVal = $('#tsInp').value;
    const ts = tsVal ? new Date(tsVal).getTime() : Date.now();
    try {
      const res = await Store.addMove({
        type: state.type, mat: state.mat, item, qtyTon: qty, unitPrice: N($('#priceInp').value),
        note: $('#noteInp').value.trim(), party: $('#partyInp').value.trim(), ref: $('#refInp').value.trim(),
        ts: Number.isFinite(ts) ? ts : Date.now()
      });
      applyResult(res);
      ['#qtyTon', '#qtySub', '#noteInp', '#refInp', '#tsInp'].forEach((s) => { $(s).value = ''; });
      fillItemSelect($('#itemSelect'), state.mat, item);
      renderPreview();
      const id = res.move.id;
      App.toast(`${state.type === 'out' ? 'تم الصرف' : 'تم الاستلام'} ✓ ${App.fmtD(qty)} طن ${itemName(item)}`, 'ok', 6000, {
        label: 'تراجع',
        run: async () => { const r = await Store.removeMove(id); if (r) { applyResult(r); App.toast('اتلغت الحركة', 'info'); pushSoon(); } }
      });
      pushSoon();
    } catch (err) {
      App.toast(err && err.message === 'QUOTA' ? 'مساحة التخزين امتلأت — خُد نسخة احتياطية' : 'مشكلة في الحفظ: ' + errMsg(err), 'err', 5000);
    } finally {
      submitting = false; btn.classList.remove('is-loading');
    }
  }

  function applyResult(res) {
    if (!res) return;
    state.balance = res.balance;
    state.itemBal = res.itemBal;
    state.parties = null;
    renderBalance();
    refreshPartyList(); updateCount();
    if (state.view !== 'move') onEnter(state.view);
  }
  function pushSoon() { if (Sync.isOn()) Sync.syncNow(true); }

  /* ======================================================================
     5. السجل
     ====================================================================== */
  async function loadLog() {
    const f = state.filters;
    const host = $('#logHost');
    if (!host.children.length) host.innerHTML = '<div class="skel" style="height:220px"></div>';
    try {
      const res = await Store.query({ page: state.page, pageSize: PAGE_SIZE, ...f });
      state.total = res.total;
      renderLog(res.rows);
      renderPager();
      renderActiveFilters();
      $('#logCount').textContent = res.filtered ? `${App.fmt(res.total)} حركة مطابقة` : `${App.fmt(res.total)} حركة مسجلة`;
    } catch (e) {
      host.innerHTML = `<div class="alert alert-error">${icon('alert')}<div>مشكلة في قراءة السجل: ${esc(errMsg(e))}</div></div>`;
    }
  }

  function anyFilter() { const f = state.filters; return !!(f.text || f.mat || f.type || f.item || f.party || f.from || f.to); }

  function renderLog(rows) {
    const host = $('#logHost');
    if (!rows.length) {
      const any = anyFilter();
      host.innerHTML = `<div class="empty"><div class="empty-ic">${icon(any ? 'search' : 'box', 'i-lg')}</div><p>${any ? 'مفيش حركات مطابقة للفلاتر' : 'مفيش حركات لسه — ابدأ بصرف أو استلام'}</p></div>`;
      return;
    }
    let html = '<table class="dtable"><thead><tr><th>النوع</th><th>الصنف</th><th>الكمية</th><th>القيمة</th><th>الجهة</th><th>الإذن</th><th>ملاحظة</th><th>التاريخ</th><th></th></tr></thead><tbody>';
    rows.forEach((m, i) => {
      const out = m.type === 'out';
      html += `<tr class="${out ? 'r-out' : 'r-in'}" style="--d:${i}">
        <td data-label="النوع"><span class="badge ${out ? 'b-out' : 'b-in'}">${icon(out ? 'up' : 'down')}${out ? 'صرف' : 'استلام'}</span></td>
        <td data-label="الصنف"><span class="badge ${m.mat === 'steel' ? 'b-steel' : 'b-cement'}">${esc(itemName(m.item))}</span></td>
        <td data-label="الكمية"><span><b class="num t-strong">${App.fmtD(m.qtyTon)}</b> طن</span><span class="t-sub">${subOf(m.mat, m.qtyTon)}</span></td>
        <td data-label="القيمة"><span><span class="num t-val">${App.fmt(m.value)}</span> ج</span><span class="t-sub num">${App.fmt(m.unitPrice)} ج/طن</span></td>
        <td data-label="الجهة">${m.party ? `<button class="t-brand" style="text-align:start" data-party="${esc(m.party)}" type="button">${esc(m.party)}</button>` : '<span class="t-faint">—</span>'}</td>
        <td data-label="الإذن">${m.ref ? '<span class="num">' + esc(m.ref) + '</span>' : '<span class="t-faint">—</span>'}</td>
        <td data-label="ملاحظة" class="c-wide">${m.note ? esc(m.note) : '<span class="t-faint">—</span>'}</td>
        <td data-label="التاريخ"><span class="num" style="font-size:.8rem">${App.fmtDate(m.ts)}</span><span class="t-sub">${esc(App.fmtTime(m.ts))}</span></td>
        <td class="c-act">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(m.id)}" type="button">${icon('edit', 'i-sm')}تعديل</button>
          <button class="btn btn-ghost btn-sm btn-icon" data-undo="${esc(m.id)}" type="button" aria-label="إلغاء الحركة" title="إلغاء الحركة">${icon('trash', 'i-sm')}</button>
        </td></tr>`;
    });
    host.innerHTML = html + '</tbody></table>';
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    $('#pager').hidden = state.total <= PAGE_SIZE;
    const first = (state.page - 1) * PAGE_SIZE + 1, last = Math.min(state.total, state.page * PAGE_SIZE);
    $('#pagerInfo').innerHTML = `<span class="num">${App.fmt(first)}–${App.fmt(last)}</span> من <span class="num">${App.fmt(state.total)}</span> · صفحة <span class="num">${state.page}/${pages}</span>`;
    $('#btnPrev').disabled = state.page <= 1;
    $('#btnNext').disabled = state.page >= pages;
  }

  function renderActiveFilters() {
    const f = state.filters, chips = [];
    if (f.item) chips.push(['item', 'الصنف: ' + itemName(f.item)]);
    if (f.party) chips.push(['party', 'الجهة: ' + f.party]);
    if (f.from) chips.push(['from', 'من ' + App.fmtDate(f.from)]);
    if (f.to) chips.push(['to', 'إلى ' + App.fmtDate(f.to)]);
    let html = chips.map(([k, t]) => `<button class="chip" aria-pressed="true" data-clear="${k}" type="button">${esc(t)} ${icon('x', 'i-sm')}</button>`).join('');
    if (anyFilter()) html += `<button class="btn btn-ghost btn-sm" data-clear="all" type="button">${icon('refresh', 'i-sm')}مسح الفلاتر</button>`;
    if (f.party) html += `<button class="btn btn-primary btn-sm" id="btnStatement" type="button">${icon('printer', 'i-sm')}كشف حساب ${esc(f.party)}</button>`;
    $('#activeFilters').innerHTML = html;
    $('#activeFilters').hidden = !html;
  }

  function readFilters() {
    const f = state.filters;
    f.text = $('#fText').value.trim();
    f.mat = $('#fMat').value;
    f.type = $('#fType').value;
    f.item = $('#fItem').value;
    f.party = $('#fParty').value.trim();
    f.from = $('#fFrom').value ? App.dayStart($('#fFrom').value) : null;
    f.to = $('#fTo').value ? App.dayEnd($('#fTo').value) : null;
    if (f.item && f.mat && (itemMap()[f.item] || {}).mat !== f.mat) { f.item = ''; $('#fItem').value = ''; }
  }
  function writeFilters() {
    const f = state.filters;
    $('#fText').value = f.text; $('#fMat').value = f.mat; $('#fType').value = f.type;
    fillFilterItems(); $('#fItem').value = f.item; $('#fParty').value = f.party;
    $('#fFrom').value = f.from ? new Date(f.from).toISOString().slice(0, 10) : '';
    $('#fTo').value = f.to ? new Date(f.to - 1).toISOString().slice(0, 10) : '';
    if (f.party || f.from || f.to) $('#moreFilters').hidden = false;
  }
  function fillFilterItems() {
    const mat = $('#fMat').value, cur = $('#fItem').value;
    $('#fItem').innerHTML = '<option value="">كل الأصناف</option>' +
      state.items.filter((i) => !mat || i.mat === mat).map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
    $('#fItem').value = cur;
  }
  function showLogFor(patch) {
    state.filters = { text: '', mat: '', type: '', item: '', party: '', from: null, to: null, ...patch };
    state.page = 1;
    writeFilters();
    go('log');
  }

  function wireLog() {
    $('#logHost').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return openEdit(ed.dataset.edit);
      const pb = e.target.closest('[data-party]');
      if (pb) return showLogFor({ party: pb.dataset.party });
      const un = e.target.closest('[data-undo]');
      if (!un) return;
      const ok = await App.confirm('الحركة هتتلغي والرصيد هيرجع زي ما كان. تقدر ترجّعها من زرار "تراجع" اللي هيظهر.', { title: 'إلغاء الحركة', okText: 'أيوه، الغيها' });
      if (!ok) return;
      const id = un.dataset.undo;
      const r = await Store.removeMove(id);
      if (!r) return App.toast('الحركة مش موجودة', 'err');
      applyResult(r);
      App.toast('اتلغت الحركة', 'ok', 6000, { label: 'تراجع', run: async () => { const x = await Store.restoreMove(id); if (x) { applyResult(x); App.toast('رجعت الحركة ✓', 'ok'); pushSoon(); } } });
      pushSoon();
    });

    $('#btnPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadLog(); $('#logHost').scrollIntoView({ behavior: 'smooth' }); } });
    $('#btnNext').addEventListener('click', () => { state.page++; loadLog(); $('#logHost').scrollIntoView({ behavior: 'smooth' }); });

    const apply = App.debounce(() => { readFilters(); state.page = 1; loadLog(); }, 250);
    ['#fText', '#fType', '#fItem', '#fFrom', '#fTo', '#fParty'].forEach((s) => { $(s).addEventListener('input', apply); $(s).addEventListener('change', apply); });
    $('#fMat').addEventListener('change', () => { fillFilterItems(); apply(); });
    $('#btnMoreFilters').addEventListener('click', () => { $('#moreFilters').hidden = !$('#moreFilters').hidden; });

    $('#activeFilters').addEventListener('click', (e) => {
      if (e.target.closest('#btnStatement')) return partyStatement(state.filters.party);
      const c = e.target.closest('[data-clear]');
      if (!c) return;
      const k = c.dataset.clear;
      if (k === 'all') state.filters = { text: '', mat: '', type: '', item: '', party: '', from: null, to: null };
      else state.filters[k] = k === 'from' || k === 'to' ? null : '';
      state.page = 1; writeFilters(); loadLog();
    });

    $('#btnExportCsv').addEventListener('click', exportCsv);
    $('#btnLogPdf').addEventListener('click', () => pdfForFilters('سجل الحركات'));
  }

  /* ---------- تعديل حركة ---------- */
  async function openEdit(id) {
    const m = await Store.getMove(id);
    if (!m || m.del) return App.toast('الحركة مش موجودة', 'err');
    state.editing = m;
    $('#eType').value = m.type;
    fillItemSelect($('#eItem'), m.mat, m.item);
    $('#eQty').value = m.qtyTon;
    $('#ePrice').value = m.unitPrice;
    $('#eParty').value = m.party;
    $('#eRef').value = m.ref;
    $('#eTs').value = App.toLocalInput(m.ts);
    $('#eNote').value = m.note;
    $('#editDlg').returnValue = '';
    $('#editDlg').showModal();
  }

  function wireEdit() {
    const dlg = App.wireSheet($('#editDlg'));
    dlg.addEventListener('close', async () => {
      const m = state.editing; state.editing = null;
      if (!m) return;
      try {
        if (dlg.returnValue === 'save') {
          const qty = R3(N($('#eQty').value));
          if (qty <= 0) return App.toast('الكمية لازم تكون أكبر من صفر', 'err');
          const ts = new Date($('#eTs').value).getTime();
          const r = await Store.updateMove(m.id, {
            type: $('#eType').value, item: $('#eItem').value, qtyTon: qty, unitPrice: N($('#ePrice').value),
            party: $('#eParty').value.trim(), ref: $('#eRef').value.trim(), note: $('#eNote').value.trim(),
            ts: Number.isFinite(ts) ? ts : m.ts
          });
          if (!r) return App.toast('مقدرتش أعدّل الحركة', 'err');
          applyResult(r);
          App.toast('اتعدلت الحركة ✓', 'ok', 6000, { label: 'تراجع', run: async () => { const x = await Store.updateMove(m.id, r.old); if (x) { applyResult(x); App.toast('رجعت زي ما كانت', 'ok'); pushSoon(); } } });
          pushSoon();
        } else if (dlg.returnValue === 'delete') {
          const r = await Store.removeMove(m.id);
          if (r) {
            applyResult(r);
            App.toast('اتلغت الحركة', 'ok', 6000, { label: 'تراجع', run: async () => { const x = await Store.restoreMove(m.id); if (x) { applyResult(x); pushSoon(); } } });
            pushSoon();
          }
        }
      } catch (e) { App.toast('مشكلة: ' + errMsg(e), 'err'); }
    });
  }

  /* ======================================================================
     6. الأصناف
     ====================================================================== */
  function renderItems() {
    const card = (it, i) => {
      const v = state.itemBal[it.id] || 0;
      const low = it.low > 0 && v <= it.low;
      const cap = it.mat === 'steel' ? state.settings.steelCapTon : state.settings.cementCapTon;
      const w = cap > 0 ? Math.min(100, Math.max(0, (v / cap) * 100)) : 0;
      return `<div class="card item-card reveal ${low ? 'is-low' : ''}" style="--d:${i}">
        <div class="item-head"><span class="item-name">${esc(it.name)}</span>
          <button class="btn btn-ghost btn-sm btn-icon" data-item-edit="${esc(it.id)}" type="button" aria-label="تعديل الصنف">${icon('edit', 'i-sm')}</button></div>
        <div class="kpi-value ${it.mat === 'steel' ? 't-steel' : 't-cement'}"><span class="num">${App.fmtD(v)}</span><small>طن</small></div>
        <div class="kpi-sub">${subOf(it.mat, v)} · <span class="num">${App.compact(v * priceFor(it.mat))}</span> ج</div>
        <div class="bar ${low ? 'low' : it.mat}"><span style="--w:${w.toFixed(1)}%"></span></div>
        <div class="row mt-3" style="justify-content:space-between">
          ${it.low > 0 ? `<span class="badge ${low ? 'b-out' : 'b-soft'}">${low ? icon('alert') + 'تحت الحد' : 'حد التنبيه ' + App.fmtD(it.low)}</span>` : '<span class="t-faint" style="font-size:.74rem">من غير حد تنبيه</span>'}
          <button class="btn btn-ghost btn-sm" data-item-log="${esc(it.id)}" type="button">${icon('list', 'i-sm')}الحركات</button>
        </div></div>`;
    };
    const vis = state.items.filter((i) => !i.hidden || Math.abs(state.itemBal[i.id] || 0) > 0);
    $('#itemsSteel').innerHTML = vis.filter((i) => i.mat === 'steel').map(card).join('');
    $('#itemsCement').innerHTML = vis.filter((i) => i.mat === 'cement').map(card).join('');
  }

  function openItem(id) {
    const it = id ? itemMap()[id] : null;
    state.editingItem = it;
    $('#itemDlgTitle').textContent = it ? 'تعديل الصنف' : 'صنف جديد';
    $('#iMat').value = it ? it.mat : state.mat;
    $('#iMat').disabled = !!it;
    $('#iName').value = it ? it.name : '';
    $('#iLow').value = it && it.low ? it.low : '';
    $('#iHide').hidden = !it || it.id === 'steel' || it.id === 'cement';
    $('#itemDlg').returnValue = '';
    $('#itemDlg').showModal();
  }

  function wireItems() {
    $('#btnAddItem').addEventListener('click', () => openItem(null));
    document.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-item-edit]');
      if (ed) openItem(ed.dataset.itemEdit);
      const lg = e.target.closest('[data-item-log]');
      if (lg) showLogFor({ item: lg.dataset.itemLog });
    });
    const dlg = App.wireSheet($('#itemDlg'));
    dlg.addEventListener('close', async () => {
      const act = dlg.returnValue;
      if (act !== 'save' && act !== 'hide') return;
      const it = state.editingItem;
      const list = state.items.map((x) => ({ ...x }));
      if (act === 'hide' && it) {
        list.find((x) => x.id === it.id).hidden = 1;
      } else {
        const name = $('#iName').value.trim();
        if (!name) return App.toast('اكتب اسم الصنف', 'err');
        const low = Math.max(0, N($('#iLow').value));
        if (it) Object.assign(list.find((x) => x.id === it.id), { name, low, hidden: 0 });
        else list.push({ id: 'u-' + App.uid().slice(0, 8), mat: $('#iMat').value, name, low });
      }
      state.items = await Store.setItems(list);
      afterItemsChange();
      App.toast(act === 'hide' ? 'اتخفى الصنف' : 'اتحفظ الصنف ✓', 'ok');
    });
  }
  function afterItemsChange() {
    fillItemSelect($('#itemSelect'), state.mat, $('#itemSelect').value);
    fillFilterItems();
    renderItems(); renderBalance(); renderPreview();
  }

  /* ======================================================================
     7. التقارير والجهات
     ====================================================================== */
  async function loadReports() {
    const r = Report.rangeFor(state.period);
    const host = $('#chartHost');
    try {
      const data = await Store.series({ from: r.from, to: r.to, bucket: r.bucket, mat: state.chartMat });
      state.chartData = data; state.chartRange = r;
      $('#chartSummary').innerHTML = Report.summaryTiles(data, false);
      host.innerHTML = Report.barChart(data, { width: 900, height: innerWidth < 600 ? 300 : 320 });
      Report.wireTooltip(host);
      $('#chartLegend').innerHTML = Report.legendHtml();
      renderByItem(data);
    } catch (e) {
      host.innerHTML = `<div class="alert alert-error">${icon('alert')}<div>مشكلة في الرسم: ${esc(errMsg(e))}</div></div>`;
    }
    renderParties();
  }

  function renderByItem(data) {
    const rows = Object.entries(data.byItem).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.inTon + b.outTon) - (a.inTon + a.outTon));
    $('#byItemSub').textContent = state.chartRange ? state.chartRange.label : '';
    if (!rows.length) { $('#byItemHost').innerHTML = `<div class="empty"><p>مفيش حركة في الفترة دي</p></div>`; return; }
    const max = Math.max(...rows.map((r) => Math.max(r.inTon, r.outTon)), 1);
    $('#byItemHost').innerHTML = rows.map((r, i) => `
      <div class="reveal" style="--d:${i};padding:var(--sp-2) 0">
        <div class="row" style="justify-content:space-between;font-size:.86rem"><b>${esc(itemName(r.id))}</b>
          <span class="t-muted"><span class="t-in num">+${App.fmtD(R3(r.inTon))}</span> · <span class="t-out num">−${App.fmtD(R3(r.outTon))}</span></span></div>
        <div class="bar" style="--c1:var(--in);--c2:var(--in);height:6px;margin-top:6px"><span style="--w:${(r.inTon / max * 100).toFixed(1)}%"></span></div>
        <div class="bar" style="--c1:var(--out);--c2:var(--out);height:6px;margin-top:4px"><span style="--w:${(r.outTon / max * 100).toFixed(1)}%"></span></div>
      </div>`).join('');
  }

  async function renderParties() {
    if (!state.parties) state.parties = await Store.parties();
    const q = ($('#partySearch').value || '').trim();
    const list = state.parties.filter((p) => !q || p.name.includes(q)).slice(0, 60);
    $('#partiesHost').innerHTML = list.length ? list.map((p) => `
      <button class="party-row" data-party="${esc(p.name)}" type="button">
        <div><b>${esc(p.name)}</b><div class="party-stats">
          ${p.outTon ? `<span class="t-out">صرف <span class="num">${App.fmtD(p.outTon)}</span> طن</span>` : ''}
          ${p.inTon ? `<span class="t-in">استلام <span class="num">${App.fmtD(p.inTon)}</span> طن</span>` : ''}
          <span><span class="num">${App.fmt(p.count)}</span> حركة · ${esc(App.relTime(p.last))}</span></div></div>
        <span class="num t-val">${App.compact(p.outVal + p.inVal)} ج</span>
      </button>`).join('')
      : `<div class="empty"><div class="empty-ic">${icon('users', 'i-lg')}</div><p>${q ? 'مفيش جهة بالاسم ده' : 'لسه مفيش جهات — اكتب اسم الجهة وانت بتسجل الحركة'}</p></div>`;
  }

  async function refreshPartyList() {
    if (!state.parties) state.parties = await Store.parties();
    $('#partiesList').innerHTML = state.parties.slice(0, 200).map((p) => `<option value="${esc(p.name)}"></option>`).join('');
  }

  function wireReports() {
    const segWire = (sel, key, after) => $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('[data-period]'); if (!b) return;
      setSeg($(sel), b); state[key] = b.dataset.period; after();
    });
    segWire('#periodSeg', 'period', loadReports);
    segWire('#dashPeriod', 'dashPeriod', loadDash);
    $('#matChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mat]'); if (!b) return;
      $$('#matChips .chip').forEach((c) => c.setAttribute('aria-pressed', c === b ? 'true' : 'false'));
      state.chartMat = b.dataset.mat; loadReports();
    });
    $('#partiesHost').addEventListener('click', (e) => { const b = e.target.closest('[data-party]'); if (b) showLogFor({ party: b.dataset.party }); });
    $('#partySearch').addEventListener('input', App.debounce(renderParties, 200));
    $('#btnPdf').addEventListener('click', makePdf);
  }

  /* ---------- PDF ---------- */
  async function buildAndPrint(o) {
    App.toast('بجهّز التقرير…', 'info');
    const rows = []; let total = 0;
    await Store.eachMove((m) => { total++; if (rows.length < MAX_PDF_ROWS) rows.push(m); }, o.filter);
    const html = Report.buildReportHtml({
      ...o, rows, capped: total > rows.length ? total : 0,
      items: Object.fromEntries(state.items.map((i) => [i.id, i.name])),
      balance: o.withBalance ? state.balance : null, prices: prices()
    });
    Report.printHtml(html);
    App.toast('اختار "حفظ كـ PDF" من نافذة الطباعة', 'warn', 5200);
  }

  async function makePdf() {
    const btn = $('#btnPdf'); btn.classList.add('is-loading');
    try {
      const r = state.chartRange || Report.rangeFor(state.period);
      const data = state.chartData || await Store.series({ from: r.from, to: r.to, bucket: r.bucket, mat: state.chartMat });
      await buildAndPrint({
        data, periodLabel: r.label, withBalance: true,
        matLabel: state.chartMat ? matName(state.chartMat) + ' فقط' : '',
        filter: { from: r.from, to: r.to, mat: state.chartMat }
      });
    } catch (e) { App.toast('مشكلة في التقرير: ' + errMsg(e), 'err'); }
    btn.classList.remove('is-loading');
  }

  async function pdfForFilters(title, subtitle) {
    const f = state.filters;
    const to = f.to || Date.now();
    const from = f.from || Report.rangeFor('y2').from;
    const bucket = to - from <= 45 * 864e5 ? 'day' : 'month';
    try {
      const data = await Store.series({ from, to, bucket, mat: f.mat, item: f.item });
      const bits = [f.mat && matName(f.mat), f.item && itemName(f.item), f.type && (f.type === 'in' ? 'استلام' : 'صرف'), f.text && '"' + f.text + '"'].filter(Boolean);
      await buildAndPrint({
        data, title, subtitle, periodLabel: f.from || f.to ? 'فترة مخصصة' : 'آخر سنتين',
        matLabel: bits.join(' · '), withBalance: !f.party, filter: { ...f, from, to }
      });
    } catch (e) { App.toast('مشكلة في التقرير: ' + errMsg(e), 'err'); }
  }
  function partyStatement(name) { pdfForFilters('كشف حساب: ' + name, 'كل التعاملات مع الجهة دي'); }

  /* ======================================================================
     8. التصدير والنسخ الاحتياطي
     ====================================================================== */
  async function exportCsv() {
    const rows = [['التاريخ', 'الوقت', 'النوع', 'المادة', 'الصنف', 'الكمية (طن)', 'الوحدة الفرعية', 'سعر الطن', 'القيمة (ج)', 'الجهة', 'رقم الإذن', 'ملاحظة']];
    await Store.eachMove((m) => rows.push([
      App.fmtDate(m.ts), App.fmtTime(m.ts), m.type === 'out' ? 'صرف' : 'استلام', matName(m.mat), itemName(m.item),
      m.qtyTon, subOf(m.mat, m.qtyTon), m.unitPrice, m.value, m.party, m.ref, m.note
    ]), state.filters);
    if (rows.length === 1) return App.toast('مفيش حركات للتصدير', 'warn');
    App.download('سجل-المخزن-' + new Date().toISOString().slice(0, 10) + '.csv', App.toCSV(rows), 'text/csv');
    App.toast(`تم تصدير ${App.fmt(rows.length - 1)} حركة ✓`, 'ok');
  }

  async function backup() {
    const moves = [];
    await Store.eachMove((m) => moves.push(m));
    const payload = { app: 'binaa-warehouse', version: 2, exportedAt: Date.now(), settings: state.settings, items: state.items, moves };
    App.download('نسخة-المخزن-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload), 'application/json');
    App.toast(`اتحفظت نسخة فيها ${App.fmt(moves.length)} حركة ✓`, 'ok');
  }

  function restore(file) {
    if (file.size > 60 * 1024 * 1024) return App.toast('الملف كبير زيادة عن اللزوم', 'err');
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { return App.toast('الملف مش صالح', 'err'); }
      if (!data || data.app !== 'binaa-warehouse' || !Array.isArray(data.moves)) return App.toast('الملف ده مش نسخة من المخزن', 'err');
      const clean = data.moves.map((m) => Store.normalizeMove(m, { dirty: 1 })).filter(Boolean);
      const bad = data.moves.length - clean.length;
      const ok = await App.confirm(`هيتم دمج ${App.fmt(clean.length)} حركة مع الموجود${bad ? ` (و${App.fmt(bad)} سجل تالف هيتجاهل)` : ''}. المكرر بيتحدّث، مفيش حاجة بتتمسح.`, { title: 'استرجاع نسخة', okText: 'أيوه، ادمج', danger: false });
      if (!ok) return;
      try {
        for (let s = 0; s < clean.length; s += 1000) await Store.bulkPut(clean.slice(s, s + 1000), false);
        if (Array.isArray(data.items)) {
          const have = new Set(state.items.map((i) => i.id));
          state.items = await Store.setItems([...state.items, ...data.items.filter((i) => i && !have.has(i.id))]);
        }
        if (data.settings) state.settings = await Store.setSettings(data.settings);
        await refreshAll();
        fillPrices(); fillSettingsForm(); afterItemsChange();
        App.toast('تم الاسترجاع ✓', 'ok');
        pushSoon();
      } catch (e) { App.toast('مشكلة في الاسترجاع: ' + errMsg(e), 'err'); }
    };
    reader.readAsText(file);
  }

  /* ======================================================================
     9. الإعدادات والمزامنة
     ====================================================================== */
  function fillSettingsForm() {
    const s = state.settings;
    $('#setSteelCap').value = s.steelCapTon; $('#setCementCap').value = s.cementCapTon;
    $('#setSteelLow').value = s.steelLowTon; $('#setCementLow').value = s.cementLowTon;
  }

  function wireSettings() {
    const dlg = App.wireSheet($('#settingsDlg'));
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-settings]')) { renderCloudBox(); dlg.showModal(); }
    });
    const save = App.debounce(async () => {
      state.settings = await Store.setSettings({
        steelCapTon: N($('#setSteelCap').value), cementCapTon: N($('#setCementCap').value),
        steelLowTon: N($('#setSteelLow').value), cementLowTon: N($('#setCementLow').value)
      });
      renderBalance();
    }, 400);
    ['#setSteelCap', '#setCementCap', '#setSteelLow', '#setCementLow'].forEach((s) => $(s).addEventListener('input', save));

    $('#btnBackup').addEventListener('click', backup);
    $('#btnRestore').addEventListener('click', () => $('#restoreFile').click());
    $('#restoreFile').addEventListener('change', function () { if (this.files[0]) restore(this.files[0]); this.value = ''; });
    $('#btnRecalc').addEventListener('click', async () => { await Store.recomputeBalance(); await refreshAll(); App.toast('اتعاد حساب الرصيد من السجل ✓', 'ok'); });
    $('#btnWipe').addEventListener('click', async () => {
      const ok = await App.confirm('ده هيمسح كل الحركات والرصيد من الجهاز ده نهائياً (الأسعار والأصناف بتفضل). خُد نسخة احتياطية الأول!', { title: 'مسح كل الحركات', okText: 'أيوه، امسح' });
      if (!ok) return;
      await Store.wipe();
      await refreshAll();
      App.toast('اتمسحت كل الحركات', 'ok');
    });
  }

  function renderCloudBox() {
    const box = $('#cloudBox');
    const st = Sync.status();
    if (!st.on) {
      box.innerHTML = `
        <div class="alert mb-3">${icon('cloud')}<div>المزامنة مقفولة — البيانات على الجهاز ده بس.<br>عشان الشريك يشوف نفس الأرقام، فعّل المزامنة.</div></div>
        <div class="field mb-3"><label for="pairIn">عندك رمز ربط من الشريك؟ الصقه هنا</label><input type="text" class="input" id="pairIn" placeholder="BINAA-…" dir="ltr" autocomplete="off" spellcheck="false"></div>
        <button class="btn btn-primary btn-block" id="btnPair" type="button">${icon('link')}ربط الجهاز</button>
        <details class="mt-4"><summary class="t-muted" style="cursor:pointer;font-size:.84rem">إعداد جديد من الصفر (أول جهاز)</summary>
          <div class="field mt-3"><label for="supaUrl">عنوان المشروع (Project URL)</label><input type="url" class="input" id="supaUrl" placeholder="https://xxxx.supabase.co" dir="ltr"></div>
          <div class="field mt-3"><label for="supaKey">المفتاح العام (anon / publishable key)</label><input type="text" class="input" id="supaKey" placeholder="eyJhbGciOi…" dir="ltr" autocomplete="off" spellcheck="false"></div>
          <button class="btn btn-primary btn-block mt-3" id="btnConnect" type="button">تفعيل المزامنة</button>
          <p class="hint mt-3">لازم تشغّل ملف <b>supabase-setup.sql</b> الأول — الخطوات في README.md.</p>
        </details>`;
      $('#btnPair').addEventListener('click', () => {
        const c = Sync.decodeCode($('#pairIn').value);
        if (!c) return App.toast('الرمز مش مظبوط', 'err');
        connectWith(c);
      });
      $('#btnConnect').addEventListener('click', () => {
        const url = $('#supaUrl').value.trim().replace(/\/+$/, '');
        const key = $('#supaKey').value.trim();
        if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) return App.toast('العنوان لازم يبدأ بـ https://', 'err');
        if (key.length < 20) return App.toast('المفتاح مش مظبوط', 'err');
        connectWith({ url, key, room: Sync.newRoom() });
      });
      return;
    }
    const code = Sync.encodeCode(Sync.cfg());
    box.innerHTML = `
      <div class="alert alert-ok mb-3">${icon('cloud')}<div><strong>المزامنة شغالة</strong><br>آخر مزامنة: ${esc(st.lastSync ? App.relTime(st.lastSync) : 'لسه')}${st.error ? `<br><span class="t-out">${esc(st.error)}</span>` : ''}</div></div>
      <div class="field mb-3"><label for="pairOut">رمز الربط — ابعته للشريك</label>
        <textarea class="input" id="pairOut" rows="3" readonly dir="ltr" style="font-size:12px;word-break:break-all;text-align:left">${esc(code)}</textarea>
        <span class="hint">⚠️ الرمز ده مفتاح البيانات — متبعتوش لحد بره الشركة.</span></div>
      <div class="grid-2">
        <button class="btn btn-ghost" id="btnCopyCode" type="button">${icon('copy')}نسخ الرمز</button>
        <button class="btn btn-ghost" id="btnSyncNow" type="button">${icon('refresh')}زامن دلوقتي</button>
        <button class="btn btn-danger-ghost btn-sm span-all" id="btnUnlink" type="button">فصل الجهاز عن السحابة</button>
      </div>`;
    $('#btnCopyCode').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); App.toast('اتنسخ الرمز ✓', 'ok'); }
      catch (e) { $('#pairOut').select(); App.toast('حدد الرمز وانسخه يدوي', 'warn'); }
    });
    $('#btnSyncNow').addEventListener('click', async () => { await Sync.syncNow(false); await refreshAll(); renderCloudBox(); });
    $('#btnUnlink').addEventListener('click', async () => {
      const ok = await App.confirm('الجهاز ده هيفصل عن السحابة. البيانات هتفضل موجودة عليه.', { title: 'فصل المزامنة', okText: 'أيوه، افصل' });
      if (!ok) return;
      Sync.stop(); Sync.saveCfg(null); Sync.resetCursor();
      renderCloudBox(); App.toast('اتفصلت المزامنة', 'ok');
    });
  }

  async function connectWith(c) {
    App.toast('بختبر الاتصال…', 'info');
    const r = await Sync.test(c);
    if (!r.ok) { App.toast('فشل الاتصال: ' + r.error, 'err', 6000); return; }
    Sync.saveCfg(c);
    Sync.resetCursor();
    Sync.start(refreshAll);
    App.toast('اتوصلنا ✓ بنزامن دلوقتي…', 'ok');
    await Sync.syncNow(false);
    await refreshAll();
    renderCloudBox();
  }

  function wireSyncPill() {
    Sync.onChange((s) => {
      $$('[data-sync-pill]').forEach((p) => { p.className = 'sync-pill' + (s.busy ? ' busy' : s.error ? ' err' : s.on ? ' on' : ''); });
      $$('[data-sync-text]').forEach((t) => { t.textContent = s.busy ? 'بيزامن…' : s.error ? 'خطأ' : s.on ? 'متزامن' : 'محلي'; });
    });
    document.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-sync-pill]')) return;
      if (!Sync.isOn()) { renderCloudBox(); $('#settingsDlg').showModal(); return; }
      await Sync.syncNow(false); refreshAll();
    });
  }

  /* ======================================================================
     10. التحديث الشامل والتشغيل
     ====================================================================== */
  async function refreshAll() {
    [state.balance, state.itemBal, state.items] = await Promise.all([Store.getBalance(), Store.getItemBalances(), Store.getItems()]);
    state.parties = null;
    fillItemSelect($('#itemSelect'), state.mat, $('#itemSelect').value);
    renderBalance(); renderPreview(); refreshPartyList(); updateCount();
    onEnter(state.view);
  }
  async function updateCount() { $('#countInfo').textContent = App.fmt(await Store.count()) + ' حركة'; }

  function greet() {
    const h = new Date().getHours();
    $('#greet').textContent = h < 12 ? 'صباح الخير' : h < 17 ? 'نهارك سعيد' : 'مساء الخير';
    $('#todayTxt').textContent = new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function boot() {
    try {
      await Store.ready();
      const inf = await Store.info();
      $('#engineInfo').innerHTML = inf.fallback
        ? esc(inf.engine) + ' — <span class="t-out">افتح الموقع من لينك http/https مش ملف مباشر عشان يشتغل بكامل قوته</span>'
        : esc(inf.engine);
      [state.settings, state.balance, state.itemBal, state.items] =
        await Promise.all([Store.getSettings(), Store.getBalance(), Store.getItemBalances(), Store.getItems()]);

      greet(); fillPrices(); fillSettingsForm();
      wirePrices(); wireNav(); wireForm(); wireLog(); wireEdit(); wireItems(); wireReports(); wireSettings(); wireSyncPill();
      fillFilterItems();
      setMat('steel'); setType('out');
      refreshPartyList(); updateCount();

      const start = location.hash.slice(1);
      go(VIEWS.includes(start) ? start : 'dash');

      if (Sync.isOn()) Sync.start(refreshAll);
    } catch (err) {
      console.error(err);
      App.toast('مشكلة في التشغيل: ' + errMsg(err), 'err', 8000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
