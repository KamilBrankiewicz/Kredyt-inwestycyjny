// node test/calc.check.js — jedyny automatyczny check: asserty silnika (bez npm).
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');
const Storage = require('../js/storage.js');
const { DEFAULTS, EXTRA_LOAN_DEFAULTS, withDefaults, validateImport } = Storage;

const TODAY = '2026-10-13';
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} ≠ ${expected} (±${tol})`);
const inputs = (patch) => withDefaults({ ...DEFAULTS, startMonth: '2026-11', ...patch });
let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

check('pusty start: pola z DEFAULTS, stopa referencyjna wpisana', () => {
  Storage.BLANK_START.forEach((k) => assert.ok(k in DEFAULTS, k));
  assert.ok(!Storage.BLANK_START.includes('baseRate'));
  assert.equal(Storage.blankInputs().areaHa, null);
  assert.equal(Storage.blankInputs().baseRate, DEFAULTS.baseRate);
});

check('stary dochód (plon/cena/koszty albo kwotą) → przychód i zysk, wynik bez zmian', () => {
  const old = withDefaults({ incomeMode: 'detailed', yieldT: 8, pricePerT: 1000, directCostsPerHa: 4000, subsidiesPerHa: 900, landTaxPerHa: 300 });
  assert.equal(old.revenuePerHa, 8000);
  assert.equal(old.profitPerHa, 4600);
  assert.ok(!('yieldT' in old) && !('incomeMode' in old));
  const simple = withDefaults({ incomeMode: 'simple', netIncomePerHa: 2500 });
  assert.equal(simple.revenuePerHa, 2500);
  assert.equal(simple.profitPerHa, 2500);
  const legacyDefaults = withDefaults({ incomeMode: 'detailed' });
  assert.equal(legacyDefaults.revenuePerHa, DEFAULTS.revenuePerHa);
  assert.equal(legacyDefaults.profitPerHa, DEFAULTS.profitPerHa);
  assert.equal(withDefaults({ incomeMode: 'detailed', yieldT: null }).revenuePerHa, null);
});

check('przychód progowy: zysk przy nim = wymagany dochód/ha', () => {
  const s = Calc.calculate(inputs({}), TODAY).base.summary;
  near(s.thresholdRevenue - (DEFAULTS.revenuePerHa - DEFAULTS.profitPerHa), s.requiredPerHa, 1e-9, 'próg');
});

check('PMT 100 000 zł, 6%, 120 mies.', () => near(Calc.pmt(100000, 6, 120), 1110.21, 0.005, 'PMT'));
check('PMT 500 000 zł, 6%, 300 mies.', () => near(Calc.pmt(500000, 6, 300), 3221.51, 0.005, 'PMT'));
check('PMT kwartalne 100 000 zł, 6%, 40 rat', () => near(Calc.pmt(100000, 6, 40, 4), 3342.71, 0.005, 'PMT'));
check('Odsetki Actual/365: 100 000 zł, 6%, 31 dni', () => near(Calc.interest(100000, 6, 31), 509.59, 0.005, 'odsetki'));

// Harmonogram: suma kapitału = kwota, saldo końcowe 0 — oba typy rat, karencja, częstotliwości.
for (const installmentType of ['annuity', 'decreasing']) {
  for (const frequency of [1, 3, 6, 12]) {
    for (const [graceMonths, graceType] of [[0, 'interest'], [12, 'interest'], [12, 'capitalize']]) {
      check(`harmonogram ${installmentType}, co ${frequency} mies., karencja ${graceMonths} ${graceType}`, () => {
        const sim = Calc.simulate(inputs({ installmentType, frequency, graceMonths, graceType, feeFinanced: true }), TODAY);
        const capital = sim.rows.reduce((s, r) => s + r.capital, 0);
        const capitalized = graceType === 'capitalize' && graceMonths
          ? sim.rows.filter((r) => r.inGrace).length && capital - sim.purchase.loan : 0;
        assert.ok(capital >= sim.purchase.loan - 0.01, 'kapitał ≥ kwota');
        if (!capitalized) near(capital, sim.purchase.loan, 0.01, 'suma kapitału');
        assert.equal(sim.rows[sim.N].balance, 0, 'saldo końcowe');
        assert.equal(sim.rows.filter((r) => r.isPayment).length, sim.N / frequency, 'liczba rat');
        sim.rows.forEach((r) => assert.ok(Number.isFinite(r.payment) && r.capital >= 0, 'rata skończona, kapitał ≥ 0'));
      });
    }
  }
}

check('rata równa przy stałej stopie ≈ PMT (30/360 vs Actual/365 różni się groszami)', () => {
  const r = Calc.calculate(inputs({ feePct: 0, frequency: 1 }), TODAY);
  const expected = Calc.pmt(r.base.purchase.loan, DEFAULTS.baseRate + DEFAULTS.margin, r.base.N);
  near(r.base.summary.firstInstallment, expected, expected * 0.01, 'pierwsza rata');
});

check('stopa 0%: rata = saldo / n, bez NaN', () => {
  const sim = Calc.simulate(inputs({ baseRate: 0, margin: 0, feePct: 0 }), TODAY);
  const pays = sim.rows.filter((r) => r.isPayment);
  pays.forEach((r) => near(r.payment, sim.purchase.loan / sim.N, 1e-6, 'rata przy 0%'));
});

check('irr([-100, 110]) = 10%', () => near(Calc.irr([-100, 110]), 0.1, 1e-9, 'irr'));
check('irr bez zmiany znaku → null', () => assert.equal(Calc.irr([100, 110]), null));
check('irr z dodatnim pierwszym przepływem (kierunek bisekcji)', () => near(Calc.irr([100, -110]), 0.1, 1e-9, 'irr'));

const rrsoFlows = (net) => [net, ...Array(120).fill(-1110.205)];
check('RRSO 100 000 zł, rata 1 110,205 × 120', () => near(Calc.annualize(Calc.irr(rrsoFlows(100000))), 0.0617, 0.00005, 'RRSO'));
check('RRSO z prowizją 2% (wypłata netto 98 000 zł)', () => near(Calc.annualize(Calc.irr(rrsoFlows(98000))), 0.0664, 0.00005, 'RRSO'));

check('nadpisanie stopy jest lepkie i działa od swojego miesiąca', () => {
  const sim = Calc.simulate(inputs({ rateOverrides: { '2028-03': 6 } }), TODAY);
  const rateIn = (key) => sim.rows.find((r) => r.date.startsWith(key)).rate; // okres kończący się w danym miesiącu
  near(rateIn('2028-03'), DEFAULTS.baseRate + DEFAULTS.margin, 1e-9, 'przed zmianą');
  near(rateIn('2028-04'), 6 + DEFAULTS.margin, 1e-9, 'po zmianie');
  near(rateIn('2035-01'), 6 + DEFAULTS.margin, 1e-9, 'lepkie');
});

check('stress stopy od daty podnosi ratę dopiero od tej daty', () => {
  const r = Calc.calculate(inputs({ stressRateFrom: '2028-01', stressRatePp: 2 }), TODAY);
  const b = r.base.rows, s = r.stressRate.rows;
  near(s[6].payment, b[6].payment, 1e-9, 'przed stresem');
  assert.ok(s[30].payment > b[30].payment + 100, 'po stresie wyższa');
});

check('dochód wpływa raz w roku, w miesiącu żniw', () => {
  const sim = Calc.simulate(inputs({ incomeMonth: 8 }), TODAY);
  const incomeRows = sim.rows.filter((r) => r.income !== 0);
  assert.equal(incomeRows.length, sim.M / 12);
  incomeRows.forEach((r) => assert.equal(r.date.slice(5, 7), '08'));
});

check('wymagany dochód = najwyższa roczna obsługa długu × bufor; pokrycie liniowe względem dochodu', () => {
  const inp = inputs({});
  const r = Calc.calculate(inp, TODAY);
  const s = r.base.summary;
  const maxDs = Math.max(...r.base.years.filter((y) => y.inLoan).map((y) => y.debtService));
  near(s.requiredIncome, maxDs * inp.dscrTarget, 1e-6, 'wymagany dochód');
  near(r.stressIncome.summary.minDscr, s.minDscr * (1 - inp.stressIncomePct / 100), 1e-9, 'liniowość');
});

check('próg stopy: przy znalezionym przesunięciu min. pokrycie = bufor', () => {
  const inp = inputs({ revenuePerHa: 9900, profitPerHa: 6850 });
  const r = Calc.calculate(inp, TODAY);
  const shift = r.thresholds.rateShift.value;
  assert.ok(shift !== null, 'próg wyznaczony');
  const sim = Calc.simulate(inp, TODAY, { ratePp: shift });
  near(Calc.summarize(sim, inp).minDscr, inp.dscrTarget, 1e-4, 'pokrycie na progu');
});

check('próg stopy ze ścieżką zmian stopy: dolna granica schodzi do 0% wszędzie', () => {
  const inp = inputs({ rateOverrides: { '2028-11': 6 } });
  const t = Calc.calculate(inp, TODAY).thresholds;
  assert.ok(t.rateShift.value !== null, 'próg wyznaczony mimo ścieżki');
  near(Calc.summarize(Calc.simulate(inp, TODAY, { ratePp: t.rateShift.value }), inp).minDscr, inp.dscrTarget, 1e-4, 'pokrycie na progu');
});

check('próg ceny i wkładu: na progu min. pokrycie = bufor', () => {
  const inp = inputs({});
  const t = Calc.calculate(inp, TODAY).thresholds;
  assert.ok(t.maxPricePerHa.value !== null && t.minOwn.value !== null);
  const at = (patch) => Calc.summarize(Calc.simulate({ ...inp, ...patch }, TODAY), inp).minDscr;
  near(at({ pricePerHa: t.maxPricePerHa.value }), inp.dscrTarget, 1e-4, 'cena');
  near(at({ ownContribution: t.minOwn.value }), inp.dscrTarget, 1e-4, 'wkład');
});

check('próg niewyznaczalny → null z przyczyną, bez NaN', () => {
  const t = Calc.calculate(inputs({ profitPerHa: -100 }), TODAY).thresholds;
  assert.equal(t.rateShift.value, null);
  assert.equal(t.rateShift.reason, 'never');
});

check('horyzont < okres kredytu: saldo do spłaty odjęte od wyniku', () => {
  const inp = inputs({ horizonYears: 5 });
  const r = Calc.calculate(inp, TODAY);
  const s = r.base.summary, end = r.base.rows[60];
  assert.ok(s.end.balance > 0);
  near(s.netGain, end.land - end.balance - end.accrued + end.cumCash, 1e-6, 'zysk netto');
});

check('zwrot majątkowy bez kosztów i bez wzrostu = od razu; z kosztami później', () => {
  const zero = Calc.calculate(inputs({ pccExempt: true, notaryCosts: 0, valuationCosts: 0, feePct: 0 }), TODAY).base.summary;
  assert.equal(zero.paybackWealth0, 0);
  const costs = Calc.calculate(inputs({ revenuePerHa: 9900, profitPerHa: 6850 }), TODAY).base.summary;
  assert.ok(costs.paybackWealth0 > 0);
});

check('stopa alternatywna netto = IRR → NPV i zysk vs alternatywa ≈ 0', () => {
  const irrAnnual = Calc.calculate(inputs({}), TODAY).base.summary.irr;
  const s = Calc.calculate(inputs({ alternativeRate: irrAnnual * 100 / 0.81 }), TODAY).base.summary;
  near(s.npv, 0, 1, 'NPV');
  near(s.delta, 0, 2, 'delta');
});

check('korekta roku: −50% przychodu w roku żniw, koszty bez zmian', () => {
  const base = Calc.simulate(inputs({}), TODAY);
  const year = base.harvests[2].year;
  const sim = Calc.simulate(inputs({ incomeYearPct: { [year]: -50 } }), TODAY);
  const rev = DEFAULTS.revenuePerHa, net = DEFAULTS.profitPerHa;
  near(sim.harvests[2].income, (rev * 0.5 + net - rev) * DEFAULTS.areaHa, 1e-6, 'dochód w roku z korektą');
  near(sim.harvests[1].income, base.harvests[1].income, 1e-9, 'inne lata bez zmian');
});

check('Monte Carlo: różnice dochodu dają ten sam wynik co pełna symulacja', () => {
  // Korekta roku przez pełną symulację vs scenariusz bazowy + metoda różnic używana w MC.
  const inp = inputs({ horizonYears: 20 });
  const base = Calc.calculate(inp, TODAY).base;
  const year = base.harvests[4].year;
  const full = Calc.calculate({ ...inp, incomeYearPct: { [year]: -40 } }, TODAY).base.summary;
  const diff = full.end.cumCash - base.summary.end.cumCash;
  near(diff, base.revPerHa * -0.4 * base.harvests[4].scale, 1e-6, 'różnica gotówki');
  const rm = Math.pow(1 + base.summary.altNetRate, 1 / 12) - 1;
  near(full.delta, base.summary.delta + diff * Math.pow(1 + rm, base.H - base.harvests[4].m), 1e-4, 'zysk vs lokata');
});

check('Monte Carlo: σ = 0 → brak symulacji; σ > 0 → udziały sumują się do 1, percentyle uporządkowane', () => {
  assert.equal(Calc.calculate(inputs({ incomeVolatilityPct: 0 }), TODAY).mc, null);
  const mc = Calc.calculate(inputs({ incomeVolatilityPct: 25 }), TODAY).mc;
  near(mc.share.ok + mc.share.warn + mc.share.bad, 1, 1e-9, 'udziały');
  mc.years.forEach((y) => assert.ok(y.income.p10 <= y.income.p50 && y.income.p50 <= y.income.p90));
  assert.equal(mc.samples.length, 5);
});

check('Monte Carlo: mała zmienność → mediana ≈ wynik bazowy', () => {
  const r = Calc.calculate(inputs({ incomeVolatilityPct: 0.01 }), TODAY);
  near(r.mc.delta.p50, r.base.summary.delta, 50, 'zysk vs lokata');
  near(r.mc.years[0].income.p50, r.base.years[0].income, 10, 'dochód roku 1');
});

// ---- wiele kredytów ----
const extra = (patch) => ({ ...EXTRA_LOAN_DEFAULTS, ...patch });

check('podział kredytu na dwa o tych samych warunkach = jeden kredyt (obsługa, pokrycie, zysk)', () => {
  const one = Calc.calculate(inputs({ feePct: 0 }), TODAY).base;
  const split = Calc.calculate(inputs({
    feePct: 0, ownContribution: DEFAULTS.ownContribution + 200000,
    extraLoans: [extra({ amount: 200000, months: DEFAULTS.loanYears * 12, margin: DEFAULTS.margin, paymentDay: DEFAULTS.paymentDay })],
  }), TODAY).base;
  one.years.forEach((y, i) => near(split.years[i].debtService, y.debtService, 1e-6, 'obsługa w roku ' + y.year));
  near(split.summary.minDscr, one.summary.minDscr, 1e-9, 'min. pokrycie');
  near(split.summary.delta, one.summary.delta, 1e-6, 'zysk vs lokata');
  near(split.summary.startCash, one.summary.startCash, 1e-6, 'gotówka na start');
  near(split.summary.loans[0].totalInterest + split.summary.loans[1].totalInterest, one.summary.totalInterest, 1e-6, 'odsetki razem');
});

check('dodatkowy kredyt: własny harmonogram spłaca kwotę, saldo końcowe 0, raty co częstotliwość', () => {
  const sim = Calc.simulate(inputs({ extraLoans: [extra({ amount: 150000, months: 60, frequency: 3, installmentType: 'decreasing', graceMonths: 6 })] }), TODAY);
  const l = sim.loans[1];
  near(l.rows.reduce((s, r) => s + r.capital, 0), 150000, 0.01, 'suma kapitału');
  assert.equal(l.rows[60].balance, 0, 'saldo po 60 mies.');
  assert.equal(l.rows.filter((r) => r.isPayment).length, 20, 'liczba rat');
  assert.equal(l.rows.slice(61).some((r) => r.payment || r.costs), false, 'po okresie nic');
});

check('kredyt współfinansujący zakup: wypłata minus prowizja wpływa do gotówki na start', () => {
  const base = Calc.simulate(inputs({}), TODAY);
  const sim = Calc.simulate(inputs({ extraLoans: [extra({ amount: 100000, feePct: 2 })] }), TODAY);
  near(sim.rows[0].cash, base.rows[0].cash + 98000, 1e-6, 'gotówka m = 0');
  near(sim.rows[0].equity, base.rows[0].equity - 2000, 1e-6, 'majątek m = 0: tylko prowizja');
});

check('istniejące zobowiązanie: obniża pokrycie, nie zmienia gotówki, majątku ani zysku vs lokata', () => {
  const base = Calc.calculate(inputs({}), TODAY).base;
  const r = Calc.calculate(inputs({ extraLoans: [extra({ purpose: 'existing', amount: 80000, months: 48 })] }), TODAY).base;
  assert.ok(r.summary.minDscr < base.summary.minDscr - 0.01, 'pokrycie niższe');
  assert.ok(r.years[0].debtService > base.years[0].debtService, 'obsługa wyższa');
  near(r.summary.end.cumCash, base.summary.end.cumCash, 1e-6, 'gotówka');
  near(r.summary.delta, base.summary.delta, 1e-6, 'zysk vs lokata');
  near(r.summary.end.balance, base.summary.end.balance, 1e-6, 'dług na końcu');
});

check('zobowiązanie dłuższe niż kredyt na ziemię: lata analizy i pokrycie obejmują jego okres', () => {
  const r = Calc.calculate(inputs({ loanYears: 10, extraLoans: [extra({ purpose: 'existing', months: 150 })] }), TODAY).base;
  assert.equal(r.years.length, 13);
  assert.equal(r.years.filter((y) => y.inLoan).length, 13);
  assert.ok(r.years[11].debtService > 0, 'rok 12 z obsługą');
});

check('stałe oprocentowanie: stres stopy nie zmienia rat tego kredytu', () => {
  const r = Calc.calculate(inputs({ extraLoans: [extra({ rateType: 'fixed', fixedRate: 2 })] }), TODAY);
  r.base.loans[1].rows.forEach((x, i) => near(r.stressRate.loans[1].rows[i].payment, x.payment, 1e-9, 'rata'));
  near(r.base.loans[1].rows[5].rate, 2, 1e-12, 'oprocentowanie stałe');
  assert.ok(r.stressRate.loans[0].rows[30].payment > r.base.loans[0].rows[30].payment, 'kredyt na ziemię w stresie wyższy');
});

check('zobowiązanie 0% (np. syndyk): raty równe kwota / liczba rat, zero odsetek', () => {
  const sim = Calc.simulate(inputs({ extraLoans: [extra({ purpose: 'existing', amount: 120000, months: 60, rateType: 'fixed', fixedRate: 0 })] }), TODAY);
  const pays = sim.loans[1].rows.filter((r) => r.isPayment);
  assert.equal(pays.length, 60);
  pays.forEach((r) => { near(r.payment, 2000, 1e-6, 'rata'); assert.equal(r.interest, 0); });
});

check('zmienne oprocentowanie dodatkowego kredytu idzie za zmianami stopy referencyjnej', () => {
  const sim = Calc.simulate(inputs({ rateOverrides: { '2028-03': 6 }, extraLoans: [extra({ margin: 1 })] }), TODAY);
  const rateIn = (key) => sim.loans[1].rows.find((r) => r.date.startsWith(key)).rate;
  near(rateIn('2028-03'), DEFAULTS.baseRate + 1, 1e-9, 'przed zmianą');
  near(rateIn('2028-04'), 6 + 1, 1e-9, 'po zmianie');
});

check('próg stopy z dwoma kredytami: na progu min. pokrycie = bufor', () => {
  const inp = inputs({ revenuePerHa: 10800, profitPerHa: 7750, extraLoans: [extra({ amount: 50000, margin: 4 })] });
  const t = Calc.calculate(inp, TODAY).thresholds;
  assert.ok(t.rateShift.value !== null);
  near(Calc.summarize(Calc.simulate(inp, TODAY, { ratePp: t.rateShift.value }), inp).minDscr, inp.dscrTarget, 1e-4, 'pokrycie na progu');
});

check('nadwyżka gospodarstwa: wchodzi do pokrycia, wymaganego dochodu i braku; gotówka i zysk bez zmian', () => {
  const F = 60000;
  const ex = [extra({ purpose: 'existing', amount: 200000, months: 60 })];
  const base = Calc.calculate(inputs({ extraLoans: ex }), TODAY);
  const r = Calc.calculate(inputs({ extraLoans: ex, farmIncome: F }), TODAY);
  const s0 = base.base.summary, s = r.base.summary;
  const ly = r.base.years.filter((y) => y.inLoan && y.debtService > 0);
  near(s.minDscr, Math.min(...ly.map((y) => (y.income + F) / y.debtService)), 1e-12, 'min. pokrycie');
  near(s.requiredIncome, s0.requiredIncome - F, 1e-6, 'wymagany dochód z ziemi');
  near(s.shortfall, ly.reduce((a, y) => a + Math.max(0, y.debtService - y.income - F), 0), 1e-6, 'brak na raty');
  near(s.delta, s0.delta, 1e-9, 'zysk vs lokata');
  near(s.end.cumCash, s0.end.cumCash, 1e-9, 'gotówka');
  near(r.grid[1].cells[2].dscr, s.minDscr, 1e-12, 'siatka: bieżący punkt');
  near(r.stressIncome.summary.minDscr, Math.min(...r.stressIncome.years.filter((y) => y.inLoan && y.debtService > 0)
    .map((y) => (y.income + F) / y.debtService)), 1e-12, 'stres dochodu: nadwyżka stała');
  const big = Calc.calculate(inputs({ extraLoans: ex, farmIncome: 1e7 }), TODAY);
  assert.equal(big.base.summary.requiredIncome, 0, 'wymagany dochód nie ujemny');
  assert.equal(big.mc.share.ok, 1, 'symulacja: wszystko ok');
  const t = r.thresholds.maxPricePerHa.value;
  assert.ok(t !== null);
  near(Calc.summarize(Calc.simulate(inputs({ extraLoans: ex, farmIncome: F, pricePerHa: t }), TODAY), inputs({})).minDscr, DEFAULTS.dscrTarget, 1e-3, 'próg ceny');
});

check('szczyt gotówki i rezerwa', () => {
  const r = Calc.calculate(inputs({}), TODAY);
  const s = r.base.summary;
  near(s.peakCash, -Math.min(...r.base.rows.map((x) => x.cumCash)), 1e-6, 'szczyt = −min gotówki (bez F i istniejących)');
  assert.ok(s.peakCash > s.startCash, 'raty przed pierwszymi żniwami podnoszą szczyt ponad start');
  assert.equal(s.cashStatus, null, 'gotówka 0 → bez sprawdzania');
  assert.equal(s.risk, s.status);
  const peak = s.peakCash;
  assert.equal(Calc.calculate(inputs({ cashAvailable: peak - 1 }), TODAY).base.summary.cashStatus, 'bad');
  assert.equal(Calc.calculate(inputs({ cashAvailable: peak + 1 }), TODAY).base.summary.cashStatus, 'warn');
  assert.equal(Calc.calculate(inputs({ cashAvailable: peak + s.maxDebtService }), TODAY).base.summary.cashStatus, 'ok');
  // Nadwyżka gospodarstwa dopływa co miesiąc, raty istniejących kredytów wypływają.
  const F = 120000;
  const sf = Calc.calculate(inputs({ farmIncome: F }), TODAY);
  let liq = 0;
  const min = Math.min(...sf.base.rows.map((x) => x.cumCash + (liq += x.m > 0 ? F / 12 - x.extOut : 0)));
  near(sf.base.summary.peakCash, Math.max(0, -min), 1e-6, 'szczyt z nadwyżką gospodarstwa');
  const ex = Calc.calculate(inputs({ extraLoans: [{ ...EXTRA_LOAN_DEFAULTS, purpose: 'existing' }] }), TODAY);
  assert.ok(ex.base.summary.peakCash > s.peakCash, 'istniejące raty zwiększają szczyt');
});

check('werdykt łączny = najgorszy z bazowego i stresów', () => {
  const RANK = { ok: 0, warn: 1, bad: 2 };
  for (const patch of [{}, { farmIncome: 60000 }, { farmIncome: 45000 }, { farmIncome: 1e6 }, { farmIncome: 1e6, cashAvailable: 1000 }]) {
    const r = Calc.calculate(inputs(patch), TODAY);
    const risks = [r.base, r.stressRate, r.stressIncome].map((x) => x.summary.risk);
    assert.equal(RANK[r.verdict.status], Math.max(...risks.map((k) => RANK[k])), JSON.stringify(patch));
    assert.equal(r.verdict.status, Calc.verdict(inputs(patch), TODAY).status, 'Calc.verdict = calculate');
  }
  const r = Calc.calculate(inputs({ farmIncome: 45000 }), TODAY);
  assert.equal(r.base.summary.status, 'ok');
  assert.notEqual(r.verdict.status, 'ok', 'bazowy ok, stres nie → werdykt nie ok');
  assert.notEqual(r.verdict.scenario, 'base');
});

check('import: extraLoans musi być tablicą obiektów o dobrych typach', () => {
  const sc = (extraLoans) => ({ version: 1, scenarios: [{ id: 'a', updatedAt: '2026-10-16', name: 'x', inputs: { extraLoans } }] });
  assert.ok(validateImport(sc({})));
  assert.ok(validateImport(sc([{ amount: '5' }])));
  assert.equal(validateImport(sc([{ amount: 5 }])), null);
  assert.equal(withDefaults({ extraLoans: [{ amount: 5 }] }).extraLoans[0].months, EXTRA_LOAN_DEFAULTS.months);
});

check('domyślne parametry: wszystkie liczby skończone', () => {
  const r = Calc.calculate(inputs({}), TODAY);
  for (const [k, v] of Object.entries(r.base.summary)) {
    if (typeof v === 'number' && k !== 'minDscr') assert.ok(Number.isFinite(v), k);
  }
});

check('ten sam input + today dwa razy → identyczny wynik', () => {
  assert.deepEqual(Calc.calculate(inputs({}), TODAY), Calc.calculate(inputs({}), TODAY));
  assert.deepEqual(Calc.calculate(withDefaults({}), TODAY), Calc.calculate(withDefaults({}), TODAY));
});

check('import: zły typ pola odrzucony', () => {
  const bad = { version: 1, scenarios: [{ id: 'a', updatedAt: '2026-10-13', name: 'x', inputs: { areaHa: '20' } }] };
  assert.ok(validateImport(bad));
  assert.equal(validateImport({ version: 1, scenarios: [] }), null);
});

console.log(`\n${n} sprawdzeń OK`);
