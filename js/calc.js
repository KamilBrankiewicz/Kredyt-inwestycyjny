// Silnik: czyste funkcje. Zero DOM, zero Storage, zero new Date() — „dziś” przychodzi parametrem.
// Wzory i kolejność kroków: docs/CALCULATIONS.md.
const Calc = (() => {
  const DAY_MS = 86400000;
  const BELKA = 0.19;
  const PCC = 0.02;

  // ---- narzędzia finansowe ----

  // Rata równa od salda na n rat; perYear = liczba rat w roku.
  function pmt(balance, ratePct, n, perYear = 12) {
    if (n <= 0) return balance;
    const r = ratePct / 100 / perYear;
    if (r === 0) return balance / n;
    return balance * r / (1 - Math.pow(1 + r, -n));
  }

  // Odsetki Actual/365.
  function interest(balance, ratePct, days) {
    return balance * ratePct / 100 * days / 365;
  }

  // NPV przepływów co okres (indeks = numer okresu), r na okres.
  function npv(r, flows) {
    let s = 0;
    for (let t = 0; t < flows.length; t++) if (flows[t]) s += flows[t] / Math.pow(1 + r, t);
    return s;
  }

  // Bisekcja do szerokości przedziału tol: zwraca x z f(x) ≈ 0 albo null, gdy na krańcach nie ma zmiany znaku.
  // Kierunek zawężania wynika z porównania znaków, więc nie zależy od znaku pierwszego przepływu.
  function solve(f, lo, hi, tol = 1e-12) {
    let flo = f(lo);
    const fhi = f(hi);
    if (Number.isNaN(flo) || Number.isNaN(fhi)) return null;
    if (flo === 0) return lo;
    if (fhi === 0) return hi;
    if (Math.sign(flo) === Math.sign(fhi)) return null;
    for (let i = 0; i < 200 && hi - lo > tol; i++) {
      const mid = (lo + hi) / 2;
      const fmid = f(mid);
      if (Number.isNaN(fmid)) return null;
      if (fmid === 0) return mid;
      if (Math.sign(fmid) === Math.sign(flo)) { lo = mid; flo = fmid; } else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // IRR na okres. Przedział [-50%, +100%] na okres wystarcza dla przepływów miesięcznych.
  function irr(flows) {
    return solve((r) => npv(r, flows), -0.5, 1);
  }

  const annualize = (rPeriod, perYear = 12) => (rPeriod === null ? null : Math.pow(1 + rPeriod, perYear) - 1);

  // ---- daty: miesiąc jako indeks y*12 + (m-1) ----

  function monthIndex(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    return m && +m[2] >= 1 && +m[2] <= 12 ? +m[1] * 12 + (+m[2] - 1) : null;
  }
  const monthKey = (idx) => Math.floor(idx / 12) + '-' + String((idx % 12) + 1).padStart(2, '0');
  const dayMs = (idx, day) => Date.UTC(Math.floor(idx / 12), idx % 12, day);
  const isoDate = (idx, day) => monthKey(idx) + '-' + String(day).padStart(2, '0');

  function startIndex(inp, today) {
    const own = monthIndex(inp.startMonth);
    if (own !== null) return own;
    const t = monthIndex(String(today || '').slice(0, 7));
    return (t === null ? 2026 * 12 : t) + 1;
  }

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const num = (x, fallback = 0) => (Number.isFinite(+x) ? +x : fallback);

  // ---- wielkości pochodne od parametrów ----

  function incomePerHa(inp) {
    return inp.incomeMode === 'simple'
      ? num(inp.netIncomePerHa)
      : num(inp.yieldT) * num(inp.pricePerT) - num(inp.directCostsPerHa) + num(inp.subsidiesPerHa) - num(inp.landTaxPerHa);
  }

  function purchase(inp) {
    const price = num(inp.areaHa) * num(inp.pricePerHa);
    const own = clamp(num(inp.ownContribution), 0, price);
    const pcc = inp.pccExempt ? 0 : price * PCC;
    const oneOff = num(inp.notaryCosts) + num(inp.valuationCosts) + num(inp.otherCosts) + pcc;
    const fee = (price - own) * num(inp.feePct) / 100;
    const loan = price - own + (inp.feeFinanced ? fee : 0);
    const outlay = own + oneOff + (inp.feeFinanced ? 0 : fee); // gotówka wyłożona w miesiącu zakupu
    return { price, own, pcc, oneOff, fee, loan, outlay };
  }

  // ---- symulacja jednego scenariusza (pętla po miesiącach) ----
  // opt: { ratePp, rateFrom ('YYYY-MM' lub '' = od początku), incomeFactor }
  function simulate(inp, today, opt = {}) {
    const ratePp = num(opt.ratePp);
    const rateFrom = opt.rateFrom ? monthIndex(opt.rateFrom) : null;
    const incomeFactor = opt.incomeFactor === undefined ? 1 : num(opt.incomeFactor, 1);

    const p = purchase(inp);
    const freq = [1, 3, 6, 12].includes(+inp.frequency) ? +inp.frequency : 1;
    const N = clamp(Math.round(num(inp.loanYears, 1)), 1, 40) * 12;
    const horizonYears = Math.round(num(inp.horizonYears)) > 0 ? Math.round(num(inp.horizonYears)) : N / 12;
    const H = clamp(horizonYears, 1, 60) * 12;
    const M = Math.max(N, H);
    const grace = clamp(Math.round(num(inp.graceMonths)), 0, N - freq);
    const day = clamp(Math.round(num(inp.paymentDay, 10)), 1, 28);
    const margin = num(inp.margin);
    const start = startIndex(inp, today);

    const overrides = Object.entries(inp.rateOverrides || {})
      .map(([k, v]) => [monthIndex(k), +v])
      .filter(([k, v]) => k !== null && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);
    let ovPtr = 0;
    let base = num(inp.baseRate);

    const annualIncome = incomePerHa(inp) * num(inp.areaHa) * incomeFactor;
    const incomeGrowth = num(inp.incomeGrowthPct) / 100;
    const landGrowth = num(inp.landGrowthPct) / 100;
    const incomeMonth = clamp(Math.round(num(inp.incomeMonth, 8)), 1, 12);
    const yearlyCosts = num(inp.yearlyLoanCosts);

    let balance = p.loan;
    let accrued = 0;
    let cumCash = -p.outlay;
    let harvests = 0;
    const rows = [{
      m: 0, date: isoDate(start, day), rate: null, isPayment: false, inGrace: false,
      payment: 0, interest: 0, capital: 0, balance, accrued: 0, income: 0, loanCosts: 0,
      cash: -p.outlay, cumCash, land: p.price, equity: p.price - balance + cumCash, equity0: p.price - balance + cumCash,
    }];

    for (let m = 1; m <= M; m++) {
      const idx = start + m;
      const periodStart = idx - 1; // stopa obowiązująca w okresie odsetkowym (m-1, m]
      while (ovPtr < overrides.length && overrides[ovPtr][0] <= periodStart) base = overrides[ovPtr++][1];
      const stress = ratePp !== 0 && (rateFrom === null || periodStart >= rateFrom) ? ratePp : 0;
      const rate = Math.max(0, base + margin + stress);
      const days = (dayMs(idx, day) - dayMs(idx - 1, day)) / DAY_MS;

      if (balance > 0) accrued += interest(balance, rate, days);

      let payment = 0, paidInterest = 0, capital = 0, loanCosts = 0;
      const isPayment = m <= N && m % freq === 0 && (balance > 0 || accrued > 0);
      const inGrace = isPayment && m <= grace;
      if (isPayment) {
        if (inGrace && inp.graceType === 'capitalize') {
          balance += accrued;
        } else if (inGrace) {
          paidInterest = accrued;
        } else {
          const remaining = (N - m) / freq + 1;
          if (remaining <= 1) capital = balance;
          else if (inp.installmentType === 'decreasing') capital = balance / remaining;
          else capital = clamp(pmt(balance, rate, remaining, 12 / freq) - accrued, 0, balance);
          paidInterest = accrued;
          balance -= capital;
          if (balance < 1e-9) balance = 0;
        }
        payment = capital + paidInterest;
        accrued = 0;
      }
      if (m <= N && p.loan > 0) loanCosts = yearlyCosts / 12;

      let income = 0;
      if ((idx % 12) + 1 === incomeMonth) income = annualIncome * Math.pow(1 + incomeGrowth, harvests++);

      const cash = income - payment - loanCosts;
      cumCash += cash;
      const land = p.price * Math.pow(1 + landGrowth, m / 12);
      rows.push({
        m, date: isoDate(idx, day), rate, isPayment, inGrace,
        payment, interest: paidInterest, capital, balance, accrued, income, loanCosts,
        cash, cumCash, land,
        equity: land - balance - accrued + cumCash,
        equity0: p.price - balance - accrued + cumCash,
      });
    }

    // Lata analizy liczone od miesiąca zakupu: rok y = miesiące (12(y-1), 12y].
    const years = [];
    for (let y = 1; y <= M / 12; y++) {
      const slice = rows.slice(12 * (y - 1) + 1, 12 * y + 1);
      const sum = (k) => slice.reduce((s, r) => s + r[k], 0);
      const debtService = sum('payment') + sum('loanCosts');
      const income = sum('income');
      const rates = slice.map((r) => r.rate);
      years.push({
        year: y, from: slice[0].date, to: slice[slice.length - 1].date,
        payments: sum('payment'), capital: sum('capital'), interest: sum('interest'), loanCosts: sum('loanCosts'),
        debtService, income, cash: sum('cash'),
        balance: slice[slice.length - 1].balance,
        rateMin: Math.min(...rates), rateMax: Math.max(...rates),
        dscr: debtService > 0 ? income / debtService : Infinity,
        inLoan: y <= N / 12,
      });
    }

    return { rows, years, purchase: p, N, H, M, freq, start, day, annualIncome };
  }

  // ---- podsumowanie scenariusza ----
  function summarize(sim, inp) {
    const { rows, years, purchase: p, N, H, freq } = sim;
    const target = num(inp.dscrTarget, 1.2) > 0 ? num(inp.dscrTarget, 1.2) : 1.2;
    const loanRows = rows.slice(1, N + 1);
    const pays = loanRows.filter((r) => r.isPayment);
    const amort = pays.filter((r) => !r.inGrace);
    const loanYears = years.filter((y) => y.inLoan);

    const firstPayment = pays.length ? pays[0].payment : 0;
    const firstInstallment = amort.length ? amort[0].payment : 0;
    const maxInstallment = pays.reduce((mx, r) => Math.max(mx, r.payment), 0);
    const totalPaid = pays.reduce((s, r) => s + r.payment, 0);
    const totalInterest = totalPaid - p.loan; // obejmuje też odsetki skapitalizowane w karencji
    const loanCostsTotal = loanRows.reduce((s, r) => s + r.loanCosts, 0);

    // Pokrycie obsługi długu (rocznie).
    let worst = null;
    loanYears.forEach((y) => { if (y.debtService > 0 && (!worst || y.dscr < worst.dscr)) worst = y; });
    const minDscr = worst ? worst.dscr : Infinity;
    const maxDebtService = loanYears.reduce((mx, y) => Math.max(mx, y.debtService), 0);
    const requiredIncome = maxDebtService * target;
    const area = num(inp.areaHa);
    const requiredPerHa = area > 0 ? requiredIncome / area : null;
    const thresholdYield = inp.incomeMode !== 'simple' && num(inp.pricePerT) > 0 && requiredPerHa !== null
      ? (requiredPerHa + num(inp.directCostsPerHa) - num(inp.subsidiesPerHa) + num(inp.landTaxPerHa)) / num(inp.pricePerT)
      : null;
    const deficitYears = loanYears.filter((y) => y.income < y.debtService);
    const shortfall = deficitYears.reduce((s, y) => s + (y.debtService - y.income), 0);
    const status = minDscr >= target ? 'ok' : minDscr >= 1 ? 'warn' : 'bad';

    // Zwrot.
    const horizonRows = rows.slice(0, H + 1);
    const firstMonth = (pred) => { const r = horizonRows.find(pred); return r ? r.m : null; };
    const paybackCash = firstMonth((r) => r.m > 0 && r.cumCash >= 0);
    const paybackWealth = firstMonth((r) => r.equity >= -1e-6);
    const paybackWealth0 = firstMonth((r) => r.equity0 >= -1e-6);

    // Bilans na koniec horyzontu: ziemia − dług + skumulowana gotówka (bez oprocentowania gotówki).
    const end = rows[H];
    const netGain = end.land - end.balance - end.accrued + end.cumCash;

    // NPV / IRR kapitału własnego (przepływy miesięczne, na końcu horyzontu ziemia minus dług).
    // Stopa dyskontowa = stopa alternatywna po Belce.
    const altNet = num(inp.alternativeRate) / 100 * (1 - BELKA);
    const rMonthly = Math.pow(1 + altNet, 1 / 12) - 1;
    const flows = horizonRows.map((r) => r.cash);
    flows[H] += end.land - end.balance - end.accrued;
    const npvValue = npv(rMonthly, flows);
    const irrValue = annualize(irr(flows));

    // Alternatywa: każda złotówka dołożona do ziemi (wkład, koszty, braki na raty) leży zamiast tego
    // na stopie alternatywnej, a nadwyżki też tam trafiają. Różnica majątku po H = NPV przeniesione na koniec.
    const delta = npvValue * Math.pow(1 + rMonthly, H);

    // RRSO: wypłata netto (kwota bez prowizji) i wszystkie wpłaty na kredyt.
    const loanFlows = loanRows.map((r) => -(r.payment + r.loanCosts));
    loanFlows.unshift(p.price - p.own);
    const rrso = p.loan > 0 ? annualize(irr(loanFlows)) : null;

    return {
      target, status, minDscr, worstYear: worst ? worst.year : null,
      firstPayment, firstInstallment, maxInstallment, freq,
      firstInstallmentMonthly: firstInstallment / freq, maxInstallmentMonthly: maxInstallment / freq,
      totalInterest, totalPaid, loanCostsTotal,
      totalCost: totalInterest + p.fee + loanCostsTotal,
      maxDebtService, requiredIncome, requiredPerHa, requiredMonthly: requiredIncome / 12, thresholdYield,
      expectedIncome: sim.annualIncome, expectedPerHa: incomePerHa(inp),
      deficitYears: deficitYears.map((y) => y.year), shortfall,
      paybackCash, paybackWealth, paybackWealth0,
      horizonMonths: H, end: { land: end.land, balance: end.balance + end.accrued, cumCash: end.cumCash },
      netGain, delta, npv: npvValue, irr: irrValue, altNetRate: altNet, rrso,
      rent: num(inp.rentPerHa) * area,
    };
  }

  function run(inp, today, opt) {
    const sim = simulate(inp, today, opt);
    return { ...sim, summary: summarize(sim, inp) };
  }

  const minDscrOf = (inp, today, opt) => {
    const sim = simulate(inp, today, opt);
    return summarize(sim, inp).minDscr;
  };

  // ---- progi opłacalności (bisekcja na całym silniku) — kryterium: min. pokrycie = bufor ----
  // value = null → reason: 'always' (spina się w całym przedziale) albo 'never' (nigdzie).
  function thresholds(inp, today, target) {
    const crit = (opt, patch) => minDscrOf(patch ? { ...inp, ...patch } : inp, today, opt) - target;
    const result = (value, okAtEdge) => ({ value, reason: value !== null ? null : okAtEdge ? 'always' : 'never' });

    // Równoległe przesunięcie stopy od początku kredytu, od stopy 0% do +30 pp.
    const fRate = (s) => crit({ ratePp: s });
    // Dolna granica: oprocentowanie 0% we wszystkich miesiącach, także tych ze zmianami stopy.
    const maxBase = Math.max(num(inp.baseRate), ...Object.values(inp.rateOverrides || {}).map((v) => num(v)));
    const loShift = -(maxBase + num(inp.margin));
    const rateShift = result(solve(fRate, loShift, 30, 1e-3), fRate(30) >= 0);

    const area = num(inp.areaHa);
    const loPrice = area > 0 ? num(inp.ownContribution) / area + 1 : 1;
    const hiPrice = Math.max(num(inp.pricePerHa) * 10, loPrice * 2);
    const fPrice = (x) => crit({}, { pricePerHa: x });
    const maxPricePerHa = result(solve(fPrice, loPrice, hiPrice, 1), fPrice(hiPrice) >= 0);

    const fOwn = (x) => crit({}, { ownContribution: x });
    const minOwn = fOwn(0) >= 0
      ? { value: 0, reason: null }
      : result(solve(fOwn, 0, area * num(inp.pricePerHa) * 0.999, 1), false);

    return {
      rateShift,
      // Oprocentowanie (stopa + marża) na progu; stopa referencyjna mogłaby wyjść ujemna.
      maxTotalRate: rateShift.value === null ? null : num(inp.baseRate) + num(inp.margin) + rateShift.value,
      maxPricePerHa,
      minOwn,
    };
  }

  // Siatka wrażliwości: min. pokrycie przy (zmiana stopy × zmiana dochodu).
  // Pokrycie jest liniowe względem mnożnika dochodu, więc wystarczy jedna symulacja na wiersz.
  const GRID_RATES = [-1, 0, 1, 2, 3, 4];
  const GRID_INCOME = [-30, -15, 0, 15, 30];
  function grid(inp, today) {
    return GRID_RATES.map((pp) => {
      const d = minDscrOf(inp, today, { ratePp: pp });
      return { pp, cells: GRID_INCOME.map((pct) => ({ pct, dscr: d * (1 + pct / 100) })) };
    });
  }

  function calculate(inputs, today) {
    const base = run(inputs, today);
    const stressRate = run(inputs, today, { ratePp: num(inputs.stressRatePp), rateFrom: inputs.stressRateFrom });
    const stressIncome = run(inputs, today, { incomeFactor: 1 - num(inputs.stressIncomePct) / 100 });
    const warnings = [];
    const p = base.purchase;
    if (p.loan <= 0) warnings.push('Wkład własny pokrywa całą cenę — kredyt nie jest potrzebny.');
    if (num(inputs.graceMonths) >= base.N) warnings.push('Karencja nie może trwać przez cały okres kredytu — skrócono ją.');
    return {
      base, stressRate, stressIncome,
      thresholds: thresholds(inputs, today, base.summary.target),
      grid: grid(inputs, today), gridRates: GRID_RATES, gridIncome: GRID_INCOME,
      warnings,
    };
  }

  return { calculate, simulate, summarize, pmt, interest, npv, irr, solve, annualize, incomePerHa, purchase, monthIndex, monthKey };
})();
if (typeof window === 'object') window.Calc = Calc;
if (typeof module === 'object') module.exports = Calc; // Node: test/calc.check.js
