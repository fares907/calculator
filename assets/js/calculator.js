/* ==========================================================================
   calculator.js — الحاسبة (حساب لحظي وانت بتكتب)
   ========================================================================== */
(function () {
  'use strict';

  const { $, $$ } = App;
  const N = App.toNum, R3 = App.round3;
  const KG = 1000, BAGS = 20;
  const SAVE_KEY = 'binaa_calc_inputs';

  /* ربط خانتين (طن ↔ وحدة فرعية) */
  function link(a, b, factor) {
    $(a).addEventListener('input', () => { $(b).value = $(a).value === '' ? '' : R3(N($(a).value) * factor); update(); });
    $(b).addEventListener('input', () => { $(a).value = $(b).value === '' ? '' : R3(N($(b).value) / factor); update(); });
  }

  function update() {
    const steelTon = N($('#steelPriceTon').value), bag = N($('#cementPriceBag').value), cementTon = bag * BAGS;
    const sq = N($('#steelQtyTon').value), cq = N($('#cementQtyTon').value);
    const su = N($('#steelUsedTon').value), cu = N($('#cementUsedTon').value);
    const sr = Math.max(0, sq - su), cr = Math.max(0, cq - cu);
    const srv = sr * steelTon, crv = cr * cementTon, suv = su * steelTon, cuv = cu * cementTon;

    const warns = [];
    if (su > sq) warns.push(`الحديد المصروف (${App.fmtD(su)} طن) أكبر من المتاح (${App.fmtD(sq)} طن)`);
    if (cu > cq) warns.push(`الأسمنت المصروف (${App.fmtD(cu)} طن) أكبر من المتاح (${App.fmtD(cq)} طن)`);
    $('#warnHost').innerHTML = warns.length
      ? `<div class="alert alert-warn mb-4"><svg class="i"><use href="#i-alert"/></svg><div>${App.esc(warns.join(' — '))}</div></div>` : '';

    App.countTo($('#rTotal'), srv + crv);
    $('#rSteelVal').textContent = App.fmt(srv);
    $('#rCementVal').textContent = App.fmt(crv);
    App.countTo($('#rSteelTon'), sr, App.fmtD);
    App.countTo($('#rCementTon'), cr, App.fmtD);
    $('#rSteelKg').textContent = App.fmt(sr * KG);
    $('#rCementBags').textContent = App.fmt(cr * BAGS);
    $('#rSteelFrom').textContent = App.fmtD(sq);
    $('#rCementFrom').textContent = App.fmtD(cq);

    const sp = sq > 0 ? Math.min(100, (sr / sq) * 100) : 0, cp = cq > 0 ? Math.min(100, (cr / cq) * 100) : 0;
    $('#ringSteel').style.setProperty('--p', sp.toFixed(1));
    $('#ringCement').style.setProperty('--p', cp.toFixed(1));
    $('#pSteel').textContent = Math.round(sp) + '%';
    $('#pCement').textContent = Math.round(cp) + '%';

    App.countTo($('#rTotalUsed'), suv + cuv);
    $('#rSteelUsed').textContent = App.fmt(suv);
    $('#rCementUsed').textContent = App.fmt(cuv);
    save();
  }

  /* الأرقام بتتحفظ عشان لما ترجع تلاقيها زي ما سبتها */
  const save = App.debounce(() => {
    const data = {};
    $$('input[type=number]').forEach((el) => { data[el.id] = el.value; });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }, 400);
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (d) for (const [id, v] of Object.entries(d)) { const el = document.getElementById(id); if (el && el.type === 'number' && /^-?[\d.]*$/.test(String(v))) el.value = v; }
    } catch (e) {}
  }

  async function fromWarehouse() {
    const btn = $('#btnFromStore');
    btn.classList.add('is-loading');
    try {
      await Store.ready();
      const [s, b] = await Promise.all([Store.getSettings(), Store.getBalance()]);
      $('#steelPriceTon').value = s.steelPriceTon; $('#steelPriceKg').value = R3(s.steelPriceTon / KG);
      $('#cementPriceBag').value = s.cementBagPrice; $('#cementPriceTon').value = R3(s.cementBagPrice * BAGS);
      $('#steelQtyTon').value = b.steelTon; $('#steelQtyKg').value = R3(b.steelTon * KG);
      $('#cementQtyTon').value = b.cementTon; $('#cementQtyBag').value = R3(b.cementTon * BAGS);
      ['#steelUsedTon', '#steelUsedKg', '#cementUsedTon', '#cementUsedBag'].forEach((s2) => { $(s2).value = 0; });
      update();
      App.toast('اتجابت الأسعار والرصيد من المخزن ✓', 'ok');
    } catch (e) {
      App.toast('مقدرتش أقرا بيانات المخزن', 'err');
    }
    btn.classList.remove('is-loading');
  }

  function boot() {
    load();
    link('#steelPriceTon', '#steelPriceKg', 1 / KG);
    link('#cementPriceBag', '#cementPriceTon', BAGS);
    link('#steelQtyTon', '#steelQtyKg', KG);
    link('#cementQtyTon', '#cementQtyBag', BAGS);
    link('#steelUsedTon', '#steelUsedKg', KG);
    link('#cementUsedTon', '#cementUsedBag', BAGS);
    $('#btnFromStore').addEventListener('click', fromWarehouse);
    $('#btnReset').addEventListener('click', () => {
      ['#steelUsedTon', '#steelUsedKg', '#cementUsedTon', '#cementUsedBag'].forEach((s) => { $(s).value = 0; });
      update();
    });
    $$('input[type=number]').forEach((el) => el.addEventListener('focus', () => el.select()));
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
