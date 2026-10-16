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

  const freqOf = (f) => ([1, 3, 6, 12].includes(+f) ? +f : 1);

  // Kredyt na ziemię i dodatkowe kredyty w jednym kształcie.
  // purpose: 'main' | 'own' (współfinansuje zakup) | 'existing' (istniejące zobowiązanie, tylko raty).
  function mainLoan(inp, p) {
    const freq = freqOf(inp.frequency);
    const N = clamp(Math.round(num(inp.loanYears, 1)), 1, 40) * 12;
    return {
      name: 'Kredyt na ziemię', purpose: 'main', amount: p.loan, net: p.price - p.own, fee: p.fee, N, freq,
      grace: clamp(Math.round(num(inp.graceMonths)), 0, N - freq), graceType: inp.graceType,
      installmentType: inp.installmentType, day: clamp(Math.round(num(inp.paymentDay, 10)), 1, 28),
      fixed: false, margin: num(inp.margin), yearlyCosts: num(inp.yearlyLoanCosts),
    };
  }

  function extraLoan(e) {
    const freq = freqOf(e.frequency);
    const N = Math.ceil(clamp(Math.round(num(e.months, 12)), 1, 480) / freq) * freq; // wielokrotność częstotliwości
    const amount = Math.max(0, num(e.amount));
    const fee = e.purpose === 'existing' ? 0 : amount * num(e.feePct) / 100;
    return {
      name: String(e.name || ''), purpose: e.purpose === 'existing' ? 'existing' : 'own', amount, net: amount - fee, fee, N, freq,
      grace: clamp(Math.round(num(e.graceMonths)), 0, N - freq), graceType: e.graceType,
      installmentType: e.installmentType, day: clamp(Math.round(num(e.paymentDay, 10)), 1, 28),
      fixed: e.rateType === 'fixed', fixedRate: num(e.fixedRate), margin: num(e.margin), yearlyCosts: num(e.yearlyCosts),
    };
  }

  // Harmonogram jednego kredytu na osi analizy m = 0…M. Zmienne oprocentowanie: wspólna ścieżka stopy
  // referencyjnej (baseRate + lepkie zmiany) + marża kredytu + stres; stałe: fixedRate, bez stresu.
  function schedule(L, start, M, baseRate, overrides, ratePp, rateFrom) {
    let ovPtr = 0;
    let base = baseRate;
    let balance = L.amount;
    let accrued = 0;
    const rows = [{ m: 0, date: isoDate(start, L.day), rate: null, isPayment: false, inGrace: false, payment: 0, interest: 0, capital: 0, balance, accrued: 0, costs: 0 }];
    for (let m = 1; m <= M; m++) {
      const idx = start + m;
      const periodStart = idx - 1; // stopa obowiązująca w okresie odsetkowym (m-1, m]
      while (ovPtr < overrides.length && overrides[ovPtr][0] <= periodStart) base = overrides[ovPtr++][1];
      const stress = ratePp !== 0 && (rateFrom === null || periodStart >= rateFrom) ? ratePp : 0;
      const rate = L.fixed ? Math.max(0, L.fixedRate) : Math.max(0, base + L.margin + stress);
      const days = (dayMs(idx, L.day) - dayMs(idx - 1, L.day)) / DAY_MS;

      if (balance > 0) accrued += interest(balance, rate, days);

      let payment = 0, paidInterest = 0, capital = 0;
      const isPayment = m <= L.N && m % L.freq === 0 && (balance > 0 || accrued > 0);
      const inGrace = isPayment && m <= L.grace;
      if (isPayment) {
        if (inGrace && L.graceType === 'capitalize') {
          balance += accrued;
        } else if (inGrace) {
          paidInterest = accrued;
        } else {
          const remaining = (L.N - m) / L.freq + 1;
          if (remaining <= 1) capital = balance;
          else if (L.installmentType === 'decreasing') capital = balance / remaining;
          else capital = clamp(pmt(balance, rate, remaining, 12 / L.freq) - accrued, 0, balance);
          paidInterest = accrued;
          balance -= capital;
          if (balance < 1e-9) balance = 0;
        }
        payment = capital + paidInterest;
        accrued = 0;
      }
      const costs = m <= L.N && L.amount > 0 ? L.yearlyCosts / 12 : 0;
      rows.push({ m, date: isoDate(idx, L.day), rate, isPayment, inGrace, payment, interest: paidInterest, capital, balance, accrued, costs });
    }
    return rows;
  }

  // ---- symulacja jednego scenariusza (pętla po miesiącach) ----
  // opt: { ratePp, rateFrom ('YYYY-MM' lub '' = od początku), incomeFactor }
  function simulate(inp, today, opt = {}) {
    const ratePp = num(opt.ratePp);
    const rateFrom = opt.rateFrom ? monthIndex(opt.rateFrom) : null;
    const incomeFactor = opt.incomeFactor === undefined ? 1 : num(opt.incomeFactor, 1);

    const p = purchase(inp);
    const main = mainLoan(inp, p);
    const loans = [main, ...(Array.isArray(inp.extraLoans) ? inp.extraLoans : []).map(extraLoan)];
    const { N, freq, day } = main;
    const lastMonth = Math.max(...loans.map((l) => l.N));
    const horizonYears = Math.round(num(inp.horizonYears)) > 0 ? Math.round(num(inp.horizonYears)) : N / 12;
    const H = clamp(horizonYears, 1, 60) * 12;
    const M = Math.ceil(Math.max(lastMonth, H) / 12) * 12;
    const start = startIndex(inp, today);

    const overrides = Object.entries(inp.rateOverrides || {})
      .map(([k, v]) => [monthIndex(k), +v])
      .filter(([k, v]) => k !== null && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);
    loans.forEach((l) => { l.rows = schedule(l, start, M, num(inp.baseRate), overrides, l.fixed ? 0 : ratePp, rateFrom); });
    const existing = loans.filter((l) => l.purpose === 'existing');
    // Wypłata kredytów współfinansujących zakup wpływa do gotówki w miesiącu zakupu.
    const inflow = loans.reduce((s, l) => s + (l.purpose === 'own' ? l.net : 0), 0);

    const annualIncome = incomePerHa(inp) * num(inp.areaHa) * incomeFactor;
    // Dochód z ha = część zmienna (przychód: plon × cena, w trybie „kwotą” cały dochód) + część stała.
    // Korekty roczne i zmienność w symulacji dotyczą części zmiennej.
    const revPerHa = inp.incomeMode === 'simple' ? num(inp.netIncomePerHa) : num(inp.yieldT) * num(inp.pricePerT);
    const fixedPerHa = incomePerHa(inp) - revPerHa;
    const yearPct = inp.incomeYearPct || {};
    const incomeGrowth = num(inp.incomeGrowthPct) / 100;
    const landGrowth = num(inp.landGrowthPct) / 100;
    const incomeMonth = clamp(Math.round(num(inp.incomeMonth, 8)), 1, 12);

    // Sumy po kredytach w miesiącu m. Istniejące zobowiązania (ext*) wchodzą do obsługi długu i pokrycia,
    // ale nie do gotówki i majątku — istnieją niezależnie od zakupu.
    const sumAt = (list, k, m) => list.reduce((s, l) => s + l.rows[m][k], 0);
    const debtAt = (m) => ({
      payment: sumAt(loans, 'payment', m), interest: sumAt(loans, 'interest', m), capital: sumAt(loans, 'capital', m),
      balance: sumAt(loans, 'balance', m), accrued: sumAt(loans, 'accrued', m), loanCosts: sumAt(loans, 'costs', m),
      extOut: sumAt(existing, 'payment', m) + sumAt(existing, 'costs', m),
      extDebt: sumAt(existing, 'balance', m) + sumAt(existing, 'accrued', m),
    });

    const d0 = debtAt(0);
    let cumCash = -p.outlay + inflow;
    const debt0 = d0.balance - d0.extDebt;
    const harvests = [];
    const rows = [{
      m: 0, date: isoDate(start, day), rate: null, isPayment: false, inGrace: false,
      ...d0, income: 0, cash: cumCash, cumCash, debt: debt0,
      land: p.price, equity: p.price - debt0 + cumCash, equity0: p.price - debt0 + cumCash,
    }];

    for (let m = 1; m <= M; m++) {
      const idx = start + m;
      const mr = main.rows[m];
      const d = debtAt(m);

      let income = 0;
      if ((idx % 12) + 1 === incomeMonth) {
        const year = Math.floor(idx / 12);
        const yearFactor = Math.max(0, 1 + num(yearPct[year]) / 100);
        const scale = num(inp.areaHa) * Math.pow(1 + incomeGrowth, harvests.length) * incomeFactor;
        income = (revPerHa * yearFactor + fixedPerHa) * scale;
        harvests.push({ m, year, yearFactor, scale, income });
      }

      const cash = income - d.payment - d.loanCosts + d.extOut;
      cumCash += cash;
      const land = p.price * Math.pow(1 + landGrowth, m / 12);
      const debt = d.balance + d.accrued - d.extDebt; // dług związany z zakupem (bez istniejących zobowiązań)
      rows.push({
        m, date: isoDate(idx, day), rate: mr.rate, isPayment: mr.isPayment, inGrace: mr.inGrace,
        ...d, income, cash, cumCash, land, debt,
        equity: land - debt + cumCash,
        equity0: p.price - debt + cumCash,
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
        inLoan: y <= Math.ceil(lastMonth / 12),
      });
    }

    return { rows, years, harvests, revPerHa, purchase: p, loans, inflow, N, H, M, freq, start, day, annualIncome };
  }

  // Statystyki jednego kredytu. Odsetki = suma wpłat − kwota (więc z odsetkami skapitalizowanymi).
  function loanStats(l) {
    const lr = l.rows.slice(1, l.N + 1);
    const pays = lr.filter((r) => r.isPayment);
    const amort = pays.filter((r) => !r.inGrace);
    const totalPaid = pays.reduce((s, r) => s + r.payment, 0);
    const totalInterest = totalPaid - l.amount;
    const costs = lr.reduce((s, r) => s + r.costs, 0);
    const flows = lr.map((r) => -(r.payment + r.costs));
    flows.unshift(l.net);
    return {
      name: l.name, purpose: l.purpose, amount: l.amount, months: l.N, freq: l.freq, fixed: l.fixed,
      rate: l.rows.length > 1 ? l.rows[1].rate : null,
      firstPayment: pays.length ? pays[0].payment : 0,
      firstInstallment: amort.length ? amort[0].payment : 0,
      maxInstallment: pays.reduce((mx, r) => Math.max(mx, r.payment), 0),
      totalPaid, totalInterest, loanCostsTotal: costs, fee: l.fee,
      totalCost: totalInterest + l.fee + costs,
      rrso: l.amount > 0 ? annualize(irr(flows)) : null,
    };
  }

  // ---- podsumowanie scenariusza ----
  function summarize(sim, inp) {
    const { rows, years, H, freq } = sim;
    const target = num(inp.dscrTarget, 1.2) > 0 ? num(inp.dscrTarget, 1.2) : 1.2;
    const loanYears = years.filter((y) => y.inLoan);
    const loans = sim.loans.map(loanStats);
    const main = loans[0];
    const { firstPayment, firstInstallment, maxInstallment, totalPaid, totalInterest, loanCostsTotal, rrso } = main;

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
    const netGain = end.land - end.debt + end.cumCash;

    // NPV / IRR kapitału własnego (przepływy miesięczne, na końcu horyzontu ziemia minus dług).
    // Stopa dyskontowa = stopa alternatywna po Belce.
    const altNet = num(inp.alternativeRate) / 100 * (1 - BELKA);
    const rMonthly = Math.pow(1 + altNet, 1 / 12) - 1;
    const flows = horizonRows.map((r) => r.cash);
    flows[H] += end.land - end.debt;
    const npvValue = npv(rMonthly, flows);
    const irrValue = annualize(irr(flows));

    // Alternatywa: każda złotówka dołożona do ziemi (wkład, koszty, braki na raty) leży zamiast tego
    // na stopie alternatywnej, a nadwyżki też tam trafiają. Różnica majątku po H = NPV przeniesione na koniec.
    const delta = npvValue * Math.pow(1 + rMonthly, H);

    const allCost = loans.reduce((s, l) => s + l.totalCost, 0);

    return {
      loans, allCost, startCash: -rows[0].cash,
      target, status, minDscr, worstYear: worst ? worst.year : null,
      firstPayment, firstInstallment, maxInstallment, freq,
      firstInstallmentMonthly: firstInstallment / freq, maxInstallmentMonthly: maxInstallment / freq,
      totalInterest, totalPaid, loanCostsTotal,
      totalCost: main.totalCost,
      maxDebtService, requiredIncome, requiredPerHa, requiredMonthly: requiredIncome / 12, thresholdYield,
      expectedIncome: sim.annualIncome, expectedPerHa: incomePerHa(inp),
      deficitYears: deficitYears.map((y) => y.year), shortfall,
      paybackCash, paybackWealth, paybackWealth0,
      horizonMonths: H, end: { land: end.land, balance: end.debt, cumCash: end.cumCash },
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
    // Przesunięcie dotyczy kredytów o zmiennym oprocentowaniu.
    const maxBase = Math.max(num(inp.baseRate), ...Object.values(inp.rateOverrides || {}).map((v) => num(v)));
    const margins = [num(inp.margin), ...(inp.extraLoans || []).filter((l) => l.rateType !== 'fixed').map((l) => num(l.margin))];
    const loShift = -(maxBase + Math.max(...margins));
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

  // ---- symulacja zmiennych lat (Monte Carlo) ----
  // Przychód w każdym roku × max(0, 1 + σ·z), z ~ N(0, 1), niezależnie rok do roku, stałe ziarno.
  // Harmonogram kredytu nie zależy od dochodu, więc każdy wariant to scenariusz bazowy + różnice dochodu.
  const MC_RUNS = 500;
  const MC_SEED = 20261013;
  const MC_SAMPLES = 5;

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  const spread = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return { p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9) };
  };

  function monteCarlo(inp, base) {
    const sd = num(inp.incomeVolatilityPct) / 100;
    if (sd <= 0) return null;
    const { rows, years, harvests, H, revPerHa } = base;
    const s = base.summary;
    const target = s.target;
    const Hy = H / 12;
    const rand = mulberry32(MC_SEED);
    const normal = () => {
      let u = 0;
      while (u === 0) u = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };
    const rm = Math.pow(1 + s.altNetRate, 1 / 12) - 1;

    const incomeByYear = years.map(() => []);
    const cashByYear = Array.from({ length: Hy + 1 }, () => []);
    const equityByYear = Array.from({ length: Hy + 1 }, () => []);
    const counts = { ok: 0, warn: 0, bad: 0 };
    const shortfalls = [], deltas = [], paybackCash = [], paybackWealth = [], samples = [];
    let withDeficit = 0;

    for (let run = 0; run < MC_RUNS; run++) {
      const diff = harvests.map((h) => revPerHa * h.yearFactor * (Math.max(0, 1 + sd * normal()) - 1) * h.scale);

      let minDscr = Infinity, shortfall = 0;
      const incomes = years.map((y, i) => {
        const income = y.income + diff[i];
        incomeByYear[i].push(income);
        if (y.inLoan && y.debtService > 0) {
          minDscr = Math.min(minDscr, income / y.debtService);
          shortfall += Math.max(0, y.debtService - income);
        }
        return income;
      });
      counts[minDscr >= target ? 'ok' : minDscr >= 1 ? 'warn' : 'bad']++;
      if (shortfall > 0) withDeficit++;
      shortfalls.push(shortfall);
      if (run < MC_SAMPLES) samples.push(incomes);

      let cum = 0;
      cashByYear[0].push(rows[0].cumCash);
      equityByYear[0].push(rows[0].equity);
      for (let y = 1; y <= Hy; y++) {
        cum += diff[y - 1];
        cashByYear[y].push(rows[12 * y].cumCash + cum);
        equityByYear[y].push(rows[12 * y].equity + cum);
      }

      let d = s.delta;
      harvests.forEach((h, k) => { if (h.m <= H) d += diff[k] * Math.pow(1 + rm, H - h.m); });
      deltas.push(d);

      let acc = 0, k = 0, pc = null, pw = null;
      for (let m = 0; m <= H && (pc === null || pw === null); m++) {
        while (k < harvests.length && harvests[k].m === m) acc += diff[k++];
        if (pw === null && rows[m].equity + acc >= -1e-6) pw = m;
        if (pc === null && m > 0 && rows[m].cumCash + acc >= 0) pc = m;
      }
      if (pc !== null) paybackCash.push(pc);
      if (pw !== null) paybackWealth.push(pw);
    }

    return {
      runs: MC_RUNS, sd,
      share: { ok: counts.ok / MC_RUNS, warn: counts.warn / MC_RUNS, bad: counts.bad / MC_RUNS },
      deficitShare: withDeficit / MC_RUNS,
      shortfall: spread(shortfalls),
      delta: spread(deltas),
      paybackCashShare: paybackCash.length / MC_RUNS,
      paybackCash: paybackCash.length ? spread(paybackCash) : null,
      paybackWealthShare: paybackWealth.length / MC_RUNS,
      paybackWealth: paybackWealth.length ? spread(paybackWealth) : null,
      years: years.map((y, i) => ({ year: y.year, debtService: y.debtService, inLoan: y.inLoan, income: spread(incomeByYear[i]) })),
      cash: cashByYear.map(spread),
      equity: equityByYear.map(spread),
      samples,
    };
  }

  function calculate(inputs, today) {
    const base = run(inputs, today);
    const stressRate = run(inputs, today, { ratePp: num(inputs.stressRatePp), rateFrom: inputs.stressRateFrom });
    const stressIncome = run(inputs, today, { incomeFactor: 1 - num(inputs.stressIncomePct) / 100 });
    const warnings = [];
    const p = base.purchase;
    if (p.loan <= 0) warnings.push('Wkład własny pokrywa całą cenę — kredyt nie jest potrzebny.');
    if (num(inputs.graceMonths) >= base.N) warnings.push('Karencja nie może trwać przez cały okres kredytu — skrócono ją.');
    if (base.inflow > p.outlay + 0.5) warnings.push('Dodatkowe kredyty na zakup przekraczają gotówkę potrzebną na start — nadwyżka liczy się jako gotówka.');
    return {
      base, stressRate, stressIncome,
      thresholds: thresholds(inputs, today, base.summary.target),
      grid: grid(inputs, today), gridRates: GRID_RATES, gridIncome: GRID_INCOME,
      mc: monteCarlo(inputs, base),
      warnings,
    };
  }

  return { calculate, simulate, summarize, monteCarlo, pmt, interest, npv, irr, solve, annualize, incomePerHa, purchase, monthIndex, monthKey };
})();
if (typeof window === 'object') window.Calc = Calc;
if (typeof module === 'object') module.exports = Calc; // Node: test/calc.check.js
