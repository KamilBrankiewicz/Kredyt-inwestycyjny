// node test/calc.check.js — jedyny automatyczny check: asserty silnika (bez npm).
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');
const { DEFAULTS, withDefaults, validateImport } = require('../js/storage.js');

const TODAY = '2026-10-13';
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} ≠ ${expected} (±${tol})`);
const inputs = (patch) => withDefaults({ ...DEFAULTS, startMonth: '2026-11', ...patch });
let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

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
  const inp = inputs({ yieldT: 11 });
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
  const t = Calc.calculate(inputs({ incomeMode: 'simple', netIncomePerHa: -100 }), TODAY).thresholds;
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
  const costs = Calc.calculate(inputs({ yieldT: 11 }), TODAY).base.summary;
  assert.ok(costs.paybackWealth0 > 0);
});

check('stopa alternatywna netto = IRR → NPV i zysk vs alternatywa ≈ 0', () => {
  const irrAnnual = Calc.calculate(inputs({}), TODAY).base.summary.irr;
  const s = Calc.calculate(inputs({ alternativeRate: irrAnnual * 100 / 0.81 }), TODAY).base.summary;
  near(s.npv, 0, 1, 'NPV');
  near(s.delta, 0, 2, 'delta');
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
