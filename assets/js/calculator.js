/* ==========================================================================
   calculator.js — منطق صفحة الحاسبة
   ========================================================================== */
(function () {
  'use strict';

  var $ = App.$, N = App.toNum, R3 = App.round3;
  var KG = 1000, BAGS = 20;

  /* ---------- ربط خانتين ببعض (طن ↔ وحدة فرعية) ---------- */
  function link(aSel, bSel, factor, after) {
    var a = $(aSel), b = $(bSel);
    a.addEventListener('input', function () {
      b.value = a.value === '' ? '' : R3(N(a.value) * factor);
      if (after) after();
    });
    b.addEventListener('input', function () {
      a.value = b.value === '' ? '' : R3(N(b.value) / factor);
      if (after) after();
    });
  }

  function prices() {
    var st = N($('#steelPriceTon').value);
    var bag = N($('#cementPriceBag').value);
    return { steelTon: st, bag: bag, cementTon: bag * BAGS };
  }

  /* ---------- تحديث قيم المخزون فوراً ---------- */
  function updateBadges() {
    var p = prices();
    $('#steelStockVal').textContent = App.fmt(N($('#steelQtyTon').value) * p.steelTon);
    $('#cementStockVal').textContent = App.fmt(N($('#cementQtyTon').value) * p.cementTon);
  }

  /* ---------- الحساب ---------- */
  function calculate() {
    var p = prices();
    var sq = N($('#steelQtyTon').value), cq = N($('#cementQtyTon').value);
    var su = N($('#steelUsedTon').value), cu = N($('#cementUsedTon').value);

    var sr = sq - su, cr = cq - cu;
    var srf = Math.max(0, sr), crf = Math.max(0, cr);
    var srv = srf * p.steelTon, crv = crf * p.cementTon;
    var suv = su * p.steelTon, cuv = cu * p.cementTon;

    /* تحذيرات */
    var warns = [];
    if (su > sq) warns.push('الحديد المصروف (' + App.fmtD(su) + ' طن) أكبر من المخزون (' + App.fmtD(sq) + ' طن)');
    if (cu > cq) warns.push('الأسمنت المصروف (' + App.fmtD(cu) + ' طن) أكبر من المخزون (' + App.fmtD(cq) + ' طن)');
    $('#warnHost').innerHTML = warns.length
      ? '<div class="alert alert-warn"><span>⚠️</span><div>' + App.esc(warns.join(' — ')) + '</div></div>'
      : '';

    /* المتبقي */
    $('#rSteelTon').textContent = App.fmtD(srf) + ' طن';
    $('#rSteelKg').textContent = '= ' + App.fmt(srf * KG) + ' كجم';
    $('#rSteelFrom').textContent = 'من أصل ' + App.fmtD(sq) + ' طن';

    $('#rCementTon').textContent = App.fmtD(crf) + ' طن';
    $('#rCementBags').textContent = '= ' + App.fmt(crf * BAGS) + ' شكارة';
    $('#rCementFrom').textContent = 'من أصل ' + App.fmtD(cq) + ' طن';

    /* النسب */
    var sp = sq > 0 ? Math.min(100, Math.max(0, sr / sq * 100)) : 0;
    var cp = cq > 0 ? Math.min(100, Math.max(0, cr / cq * 100)) : 0;
    $('#pSteelPct').textContent = Math.round(sp) + '%';
    $('#pCementPct').textContent = Math.round(cp) + '%';
    $('#pSteelBar').style.width = sp + '%';
    $('#pCementBar').style.width = cp + '%';

    /* القيم */
    $('#rSteelVal').textContent = App.fmt(srv) + ' ج';
    $('#rSteelNote').textContent = App.fmtD(srf) + ' طن × ' + App.fmt(p.steelTon) + ' ج/طن';
    $('#rCementVal').textContent = App.fmt(crv) + ' ج';
    $('#rCementNote').textContent = App.fmt(crf * BAGS) + ' شكارة × ' + App.fmt(p.bag) + ' ج/شكارة';

    $('#rTotal').textContent = App.fmt(srv + crv) + ' جنيه';
    $('#rTotalSub').textContent = 'حديد: ' + App.fmt(srv) + ' + أسمنت: ' + App.fmt(crv);

    $('#rSteelUsed').textContent = App.fmt(suv) + ' ج';
    $('#rSteelUsedNote').textContent = App.fmtD(su) + ' طن × ' + App.fmt(p.steelTon) + ' ج/طن';
    $('#rCementUsed').textContent = App.fmt(cuv) + ' ج';
    $('#rCementUsedNote').textContent = App.fmt(cu * BAGS) + ' شكارة × ' + App.fmt(p.bag) + ' ج/شكارة';
    $('#rTotalUsed').textContent = App.fmt(suv + cuv) + ' ج';

    var res = $('#results');
    res.hidden = false;
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- جيب الأسعار والرصيد من المخزن ---------- */
  function pullFromWarehouse() {
    App.toast('بجيب من المخزن…');
    Store.ready()
      .then(function () { return Promise.all([Store.getSettings(), Store.getBalance()]); })
      .then(function (r) {
        var s = r[0], b = r[1];

        $('#steelPriceTon').value = s.steelPriceTon;
        $('#steelPriceKg').value = R3(s.steelPriceTon / KG);
        $('#cementPriceBag').value = s.cementBagPrice;
        $('#cementPriceTon').value = R3(s.cementBagPrice * BAGS);

        $('#steelQtyTon').value = b.steelTon;
        $('#steelQtyKg').value = R3(b.steelTon * KG);
        $('#cementQtyTon').value = b.cementTon;
        $('#cementQtyBag').value = R3(b.cementTon * BAGS);

        $('#steelUsedTon').value = 0; $('#steelUsedKg').value = 0;
        $('#cementUsedTon').value = 0; $('#cementUsedBag').value = 0;

        updateBadges();
        App.toast('تم جلب الأسعار والرصيد من المخزن ✓');
      })
      .catch(function () { App.toast('مقدرتش أقرا بيانات المخزن', 'err'); });
  }

  /* ---------- التشغيل ---------- */
  function boot() {
    link('#steelPriceTon', '#steelPriceKg', 1 / KG, updateBadges);
    link('#cementPriceBag', '#cementPriceTon', BAGS, updateBadges);
    link('#steelQtyTon', '#steelQtyKg', KG, updateBadges);
    link('#cementQtyTon', '#cementQtyBag', BAGS, updateBadges);
    link('#steelUsedTon', '#steelUsedKg', KG);
    link('#cementUsedTon', '#cementUsedBag', BAGS);

    $('#btnCalc').addEventListener('click', calculate);
    $('#btnFromStore').addEventListener('click', pullFromWarehouse);

    // Enter في أي خانة = احسب
    App.$$('input[type=number]').forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); calculate(); }
      });
    });

    updateBadges();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
