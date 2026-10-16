// Renderowanie, formularz, walidacja, formatowanie, wykresy SVG. Nie dotyka localStorage (tylko przez Storage).
const UI = (() => {
  let inputs;            // bieżące parametry (pola z błędem zachowują ostatnią poprawną wartość)
  let errors = {};       // { klucz pola: komunikat }
  let result = null;     // Calc.calculate(ostatni poprawny stan)
  let currentId = null;  // wczytany scenariusz
  let view = 'result';
  let scheduleMode = 'years';
  let scheduleLoan = 0;  // indeks kredytu w widoku rat
  let recalcTimer = null;
  let toastTimer = null;
  const compareIds = new Set();

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  // ---------------------------------------------------------------- formatowanie

  const numFormats = {};
  const numFmt = (d) => numFormats[d] || (numFormats[d] = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const inputFmt = (d) => numFormats['i' + d] || (numFormats['i' + d] = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: d }));
  const PLN0 = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
  const PLN2 = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const zl = (x) => (fin(x) ? PLN0.format(Math.round(x) || 0) : '—');
  const zl2 = (x) => (fin(x) ? PLN2.format(x) : '—');
  const signedZl = (x) => (fin(x) ? (x > 0.5 ? '+' : x < -0.5 ? '−' : '') + PLN0.format(Math.abs(Math.round(x))) : '—');
  const pct = (x, d = 1) => (fin(x) ? numFmt(d).format(x) + '%' : '—');
  const num = (x, d = 0) => (fin(x) ? numFmt(d).format(x) : '—');
  const pp = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + inputFmt(2).format(Math.abs(x)) + ' pp';

  const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10, h = n % 100;
    return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
  }
  const yearsLabel = (n) => n + ' ' + plural(n, 'rok', 'lata', 'lat');
  const afterYears = (n) => 'po ' + n + ' ' + (n === 1 ? 'roku' : 'latach');
  function formatMonths(n) {
    const y = Math.floor(n / 12), m = n % 12;
    const parts = [];
    if (y) parts.push(yearsLabel(y));
    if (m) parts.push(m + ' ' + plural(m, 'miesiąc', 'miesiące', 'miesięcy'));
    return parts.join(' i ') || '0 miesięcy';
  }
  const ymParts = (s) => ({ y: +String(s).slice(0, 4), m: +String(s).slice(5, 7) });
  const humanMonth = (s) => { const p = ymParts(s); return MONTHS[p.m - 1] + ' ' + p.y; };
  const fromMonth = (s) => { const p = ymParts(s); return 'od ' + MONTHS_GEN[p.m - 1] + ' ' + p.y; };
  const shortMonth = (s) => { const p = ymParts(s); return MONTHS_SHORT[p.m - 1] + ' ' + p.y; };
  const dateLabel = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Spacje, „zł”, „%”, przecinek → Number. Puste → null, śmieci → NaN.
  function parsePlnNumber(s) {
    const t = String(s == null ? '' : s)
      .replace(/[\s  ]/g, '')
      .replace(/zł|%|pp|ha/gi, '')
      .replace(',', '.')
      .replace('−', '-');
    if (t === '') return null;
    return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
  }

  const compact = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return numFmt(a >= 1e7 ? 0 : 1).format(v / 1e6) + ' mln';
    if (a >= 1e3) return numFmt(0).format(v / 1e3) + ' tys.';
    return numFmt(0).format(v);
  };

  // ---------------------------------------------------------------- definicja formularza

  const FREQ = [[1, 'co miesiąc'], [3, 'co kwartał'], [6, 'co pół roku'], [12, 'raz w roku']];
  const FREQ_NAME = { 1: 'miesięczna', 3: 'kwartalna', 6: 'półroczna', 12: 'roczna' };
  const MONTH_OPTS = MONTHS.map((m, i) => [i + 1, cap(m)]);
  const price = (i) => (+i.areaHa || 0) * (+i.pricePerHa || 0);

  // Pole: k, label, t ('num' domyślnie | 'sel' | 'chk' | 'month' | 'date'), unit, min, max(i), int, dec,
  // optional (puste = 0 albo ''), show(i), hint(i, ctx), placeholder(i). Grupa: { adv: tytuł, fields }.
  const SECTIONS = [
    {
      title: 'Ziemia', fields: [
        { k: 'areaHa', label: 'Powierzchnia', unit: 'ha', min: 0.01, max: () => 100000, dec: 2 },
        { k: 'pricePerHa', label: 'Cena', unit: 'zł/ha', min: 1, max: () => 10000000, hint: (i, c) => 'Łącznie: ' + zl(c.p.price) },
        {
          k: 'ownContribution', label: 'Wkład własny', unit: 'zł', min: 0, max: price, maxMsg: 'Wkład nie może przekraczać ceny ziemi.',
          hint: (i, c) => (c.p.price > 0 ? pct(c.p.own / c.p.price * 100, 0) + ' ceny · kredyt: ' + zl(c.p.loan) : ''),
        },
        {
          k: 'pccExempt', t: 'chk', label: 'Zwolnienie z PCC (np. powiększenie gospodarstwa rodzinnego)',
          hint: (i, c) => (i.pccExempt ? 'Bez podatku PCC.' : 'PCC 2%: ' + zl(c.p.pcc) + '. Zaznacz, jeśli przysługuje Ci zwolnienie.'),
        },
        { k: 'notaryCosts', label: 'Notariusz i wpis do księgi wieczystej', unit: 'zł', min: 0, hint: (i, c) => 'Wszystkie koszty zakupu: ' + zl(c.p.oneOff) },
        {
          adv: 'Inne koszty zakupu', fields: [
            { k: 'valuationCosts', label: 'Operat szacunkowy (wycena)', unit: 'zł', min: 0, optional: true },
            { k: 'otherCosts', label: 'Inne koszty jednorazowe', unit: 'zł', min: 0, optional: true },
          ],
        },
      ],
    },
    {
      title: 'Kredyt', fields: [
        { k: 'startMonth', t: 'month', label: 'Zakup i uruchomienie kredytu', hint: (i) => firstPaymentHint(i) },
        { k: 'loanYears', label: 'Okres kredytu', unit: 'lat', min: 1, max: () => 30, int: true },
        { k: 'frequency', t: 'sel', label: 'Raty płatne', opts: FREQ, numeric: true },
        { k: 'installmentType', t: 'sel', label: 'Rodzaj rat', opts: [['annuity', 'równe'], ['decreasing', 'malejące']] },
        { k: 'baseRate', label: 'Stopa referencyjna (WIBOR / WIRON)', unit: '%', min: 0, max: () => 30, dec: 2 },
        { k: 'baseRateDate', t: 'date', label: 'Data notowania stopy', optional: true },
        { k: 'margin', label: 'Marża banku', unit: 'pp', min: 0, max: () => 20, dec: 2, hint: (i) => 'Oprocentowanie: ' + pct((+i.baseRate || 0) + (+i.margin || 0), 2) },
        {
          adv: 'Prowizja, karencja, zmiany stopy', fields: [
            { k: 'feePct', label: 'Prowizja', unit: '%', min: 0, max: () => 10, dec: 2, hint: (i, c) => zl(c.p.fee) },
            { k: 'feeFinanced', t: 'chk', label: 'Prowizja doliczona do kredytu' },
            {
              k: 'graceMonths', label: 'Karencja w spłacie kapitału', unit: 'mies.', min: 0, int: true, optional: true,
              max: (i) => (+i.loanYears || 1) * 12 - (+i.frequency || 1), maxMsg: 'Karencja musi być krótsza niż okres kredytu.',
            },
            { k: 'graceType', t: 'sel', label: 'W karencji', opts: [['interest', 'płacę same odsetki'], ['capitalize', 'odsetki doliczane do salda']], show: (i) => +i.graceMonths > 0 },
            { k: 'paymentDay', label: 'Dzień płatności raty', min: 1, max: () => 28, int: true },
            { k: 'yearlyLoanCosts', label: 'Ubezpieczenie i inne koszty kredytu', unit: 'zł/rok', min: 0, optional: true },
            { custom: 'overrides' },
          ],
        },
      ],
    },
    {
      title: 'Obecne gospodarstwo i inne kredyty', fields: [
        {
          k: 'farmIncome', label: 'Nadwyżka z obecnego gospodarstwa na raty', unit: 'zł/rok', min: 0, optional: true,
          hint: () => 'Dochód gospodarstwa bez kupowanej ziemi, po kosztach i utrzymaniu rodziny. Liczy się tylko do pokrycia rat; zysk i zwrot z zakupu liczymy bez niej.',
        },
        {
          k: 'cashAvailable', label: 'Gotówka, którą masz na zakup i rezerwę', unit: 'zł', min: 0, optional: true,
          hint: () => 'Razem z wkładem własnym. Sprawdzamy, czy wystarczy w najgorszym momencie — też w stres teście. Puste = bez sprawdzania.',
        },
        { custom: 'extraLoans' },
      ],
    },
    {
      title: 'Dochód z kupionej ziemi', fields: [
        {
          k: 'revenuePerHa', label: 'Przychód (dochód brutto) z ha', unit: 'zł/ha', min: 0,
          hint: () => 'Ze sprzedaży plonu, przed kosztami. Ta część waha się z roku na rok — od niej liczymy odchylenia.',
        },
        {
          k: 'profitPerHa', label: 'Zysk z ha', unit: 'zł/ha', min: -100000,
          hint: (i) => 'Po kosztach uprawy, z dopłatami, po podatku rolnym, przed ratą kredytu.' +
            (i.revenuePerHa != null && i.profitPerHa != null ? ' Koszty stałe (przychód − zysk): ' + zl(i.revenuePerHa - i.profitPerHa) + '/ha.' : ''),
        },
        {
          k: 'incomeMonth', t: 'sel', label: 'Miesiąc wpływu dochodu', opts: MONTH_OPTS, numeric: true,
          hint: (i, c) => 'Zysk: ' + zl(c.perHa * (+i.areaHa || 0)) + '/rok',
        },
        {
          adv: 'Wzrost dochodu, dzierżawa', fields: [
            { k: 'incomeGrowthPct', label: 'Wzrost dochodu', unit: '%/rok', min: -20, max: () => 20, dec: 2, optional: true },
            { k: 'rentPerHa', label: 'Czynsz dzierżawny w okolicy (dla porównania)', unit: 'zł/ha', min: 0, optional: true },
          ],
        },
        {
          adv: 'Zmienne lata: symulacja i dochód rok po roku', fields: [
            {
              k: 'incomeVolatilityPct', label: 'Zmienność przychodu z roku na rok', unit: '±%', min: 0, max: () => 100, dec: 1,
              hint: (i) => (+i.incomeVolatilityPct > 0
                ? `Odchylenie standardowe przychodu; koszty stałe się nie wahają. Mniej więcej co szósty rok wypada o ponad ${num(+i.incomeVolatilityPct, 0)}% gorzej od założeń. 0 = bez symulacji.`
                : 'Symulacja wyłączona.'),
            },
            { custom: 'yearIncome' },
          ],
        },
      ],
    },
    {
      title: 'Ocena', fields: [
        {
          k: 'horizonYears', label: 'Horyzont analizy', unit: 'lat', min: 0, max: () => 50, int: true, optional: true,
          placeholder: (i) => String(i.loanYears ?? ''), hint: () => 'Puste = okres kredytu.',
        },
        { k: 'landGrowthPct', label: 'Wzrost ceny ziemi', unit: '%/rok', min: -20, max: () => 20, dec: 2, hint: () => '0 = wariant ostrożny.' },
        { k: 'alternativeRate', label: 'Stopa alternatywna (lokata, obligacje)', unit: '%', min: 0, max: () => 30, dec: 2, hint: (i) => 'Po podatku Belki: ' + pct((+i.alternativeRate || 0) * 0.81, 2) },
        {
          k: 'dscrTarget', label: 'Bufor bezpieczeństwa', unit: '×', min: 1, max: () => 3, dec: 2,
          hint: (i) => 'Dochód ma być o ' + pct(((+i.dscrTarget || 1) - 1) * 100, 0) + ' wyższy niż raty. Banki zwykle wymagają 1,2–1,3.',
        },
        {
          adv: 'Stres test', fields: [
            { k: 'stressRatePp', label: 'Wzrost stopy', unit: 'pp', min: 0, max: () => 20, dec: 2 },
            { k: 'stressRateFrom', t: 'month', label: 'Od miesiąca', optional: true, hint: () => 'Puste = od początku kredytu.' },
            { k: 'stressIncomePct', label: 'Spadek dochodu', unit: '%', min: 0, max: () => 100, dec: 1 },
          ],
        },
      ],
    },
  ];
  const FIELDS = [];
  SECTIONS.forEach((s) => s.fields.forEach((f) => (f.adv ? f.fields.forEach((g) => g.k && FIELDS.push(g)) : f.k && FIELDS.push(f))));

  // Pola jednego dodatkowego kredytu (element inputs.extraLoans). Funkcje dostają ten kredyt.
  const own = (l) => l.purpose !== 'existing';
  const variable = (l) => l.rateType !== 'fixed';
  const EXTRA_FIELDS = [
    { k: 'name', t: 'text', label: 'Nazwa' },
    {
      k: 'purpose', t: 'sel', label: 'Rodzaj',
      opts: [['own', 'współfinansuje zakup ziemi'], ['existing', 'istniejące zobowiązanie']],
      hint: (l) => (own(l)
        ? 'Wypłata zmniejsza gotówkę potrzebną na start; raty, odsetki i saldo wchodzą do wszystkich wyników.'
        : 'Raty wchodzą do pokrycia i wymaganego dochodu; zysk i zwrot z zakupu liczymy bez nich.'),
    },
    { k: 'amount', label: 'Kwota (przy istniejącym: saldo do spłaty)', unit: 'zł', min: 0, max: () => 100000000 },
    { k: 'months', label: 'Okres (przy istniejącym: pozostały)', unit: 'mies.', min: 1, max: () => 480, int: true, hint: (l) => formatMonths(+l.months || 0) },
    { k: 'frequency', t: 'sel', label: 'Raty płatne', opts: FREQ, numeric: true },
    { k: 'installmentType', t: 'sel', label: 'Rodzaj rat', opts: [['annuity', 'równe'], ['decreasing', 'malejące']] },
    { k: 'rateType', t: 'sel', label: 'Oprocentowanie', opts: [['variable', 'zmienne: stopa referencyjna + marża'], ['fixed', 'stałe (także 0%)']] },
    {
      k: 'margin', label: 'Marża', unit: 'pp', min: 0, max: () => 20, dec: 2, show: variable,
      hint: (l) => 'Oprocentowanie: ' + pct((+inputs.baseRate || 0) + (+l.margin || 0), 2) + '. Stopa referencyjna i jej zmiany jak w kredycie na ziemię.',
    },
    { k: 'fixedRate', label: 'Oprocentowanie stałe', unit: '%', min: 0, max: () => 30, dec: 2, show: (l) => !variable(l), hint: () => '0% = bez oprocentowania (np. rozłożona płatność syndykowi). Stres stopy i progi stopy go nie zmieniają.' },
    { k: 'feePct', label: 'Prowizja', unit: '%', min: 0, max: () => 10, dec: 2, show: own, hint: (l) => zl((+l.amount || 0) * (+l.feePct || 0) / 100) + ', płatna z wypłaty' },
    {
      k: 'graceMonths', label: 'Karencja w spłacie kapitału', unit: 'mies.', min: 0, int: true,
      max: (l) => (+l.months || 1) - (+l.frequency || 1), maxMsg: 'Karencja musi być krótsza niż okres kredytu.',
    },
    { k: 'graceType', t: 'sel', label: 'W karencji', opts: [['interest', 'płacę same odsetki'], ['capitalize', 'odsetki doliczane do salda']], show: (l) => +l.graceMonths > 0 },
    { k: 'paymentDay', label: 'Dzień płatności raty', min: 1, max: () => 28, int: true },
    { k: 'yearlyCosts', label: 'Ubezpieczenie i inne koszty', unit: 'zł/rok', min: 0 },
  ];
  const elKey = (n, k) => 'el' + n + '-' + k;

  function nextMonth(today) {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    return m === 12 ? (y + 1) + '-01' : y + '-' + pad(m + 1);
  }
  function addMonthsYm(ym, n) {
    const idx = Calc.monthIndex(ym);
    return idx === null ? null : Calc.monthKey(idx + n);
  }
  function firstPaymentHint(i) {
    const f = +i.frequency || 1;
    const first = addMonthsYm(i.startMonth, f);
    if (!first) return '';
    const grace = +i.graceMonths || 0;
    const capital = grace > 0 ? addMonthsYm(i.startMonth, Math.ceil((grace + 1) / f) * f) : null;
    return 'Pierwsza rata: ' + humanMonth(first) + (capital ? ' · spłata kapitału od: ' + humanMonth(capital) : '');
  }

  // ---------------------------------------------------------------- formularz: render i odczyt

  function fieldValue(f, src = inputs) {
    const v = src[f.k];
    if (f.t === 'month' || f.t === 'date' || f.t === 'text') return v || '';
    if (v == null || (f.optional && !v)) return '';
    return inputFmt(f.dec || 0).format(v);
  }

  // n podane → pole n-tego dodatkowego kredytu (EXTRA_FIELDS).
  function renderField(f, n) {
    const extra = n !== undefined;
    const src = extra ? inputs.extraLoans[n] : inputs;
    const key = extra ? elKey(n, f.k) : f.k;
    const id = 'f-' + key;
    const data = extra ? `data-el="${n}" data-ek="${f.k}"` : `data-k="${f.k}"`;
    let control;
    if (f.t === 'chk') {
      return `<div class="field check" data-field="${key}"><label><input type="checkbox" id="${id}" ${data}${src[f.k] ? ' checked' : ''}>${escapeHtml(f.label)}</label><div class="hint"></div></div>`;
    }
    if (f.t === 'sel') {
      control = `<select id="${id}" ${data}>${f.opts.map(([v, l]) => `<option value="${escapeHtml(v)}"${String(src[f.k]) === String(v) ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
    } else if (f.t === 'month' || f.t === 'date') {
      control = `<input type="${f.t}" id="${id}" ${data} value="${escapeHtml(fieldValue(f, src))}">`;
    } else if (f.t === 'text') {
      control = `<input type="text" id="${id}" ${data} maxlength="60" value="${escapeHtml(fieldValue(f, src))}">`;
    } else {
      const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder(inputs))}"` : '';
      control = `<input type="text" inputmode="decimal" id="${id}" ${data} value="${escapeHtml(fieldValue(f, src))}"${ph}>`;
    }
    return `<div class="field" data-field="${key}"><label for="${id}">${escapeHtml(f.label)}</label>` +
      `<div class="input-wrap">${control}${f.unit ? `<span class="unit">${escapeHtml(f.unit)}</span>` : ''}</div>` +
      '<div class="hint"></div><div class="error"></div></div>';
  }

  function renderOverrides() {
    const rows = Object.entries(inputs.rateOverrides).sort(([a], [b]) => a.localeCompare(b));
    return '<div class="field" id="overrides"><label>Zmiany stopy referencyjnej (obowiązują do następnej zmiany)</label>' +
      rows.map(([k, v], n) => `<div class="override-row" data-ov="${n}">` +
        `<input type="month" data-ov-month value="${escapeHtml(k)}" aria-label="Od miesiąca">` +
        `<input type="text" inputmode="decimal" data-ov-rate value="${escapeHtml(inputFmt(2).format(v))}" aria-label="Stopa referencyjna, %">` +
        `<button type="button" class="btn btn-small" data-action="ov-remove" aria-label="Usuń zmianę">✕</button></div>`).join('') +
      '<div class="error" id="overrides-error"></div>' +
      '<button type="button" class="btn btn-small" data-action="ov-add">+ Dodaj zmianę stopy</button></div>';
  }

  // Korekty przychodu dla kolejnych żniw (rok kalendarzowy). Lista zależy od zakupu, okresu, horyzontu i miesiąca żniw.
  function yearIncomeSig() {
    return Calc.simulate(inputs, todayIso()).harvests.map((h) => h.year).join(',');
  }
  function renderYearIncome() {
    const sig = yearIncomeSig();
    const years = sig ? sig.split(',') : [];
    return `<div class="field" id="year-income" data-sig="${sig}"><label>Korekta przychodu w danym roku, np. −40 przy suszy, +15 w dobrym roku (puste = bez zmian)</label>` +
      '<div class="year-grid">' + years.map((y, n) => {
        const v = inputs.incomeYearPct[y];
        return `<label class="year-cell"><span>${y} <small class="muted">rok ${n + 1}</small></span>` +
          `<span class="input-wrap"><input type="text" inputmode="decimal" data-year="${y}" value="${v ? escapeHtml(inputFmt(1).format(v)) : ''}" placeholder="0"><span class="unit">%</span></span></label>`;
      }).join('') + '</div><div class="error" id="year-income-error"></div></div>';
  }
  function refreshYearIncome() {
    const el = $('year-income');
    if (el && el.dataset.sig !== yearIncomeSig()) el.outerHTML = renderYearIncome();
  }

  function renderForm() {
    const CUSTOM = { overrides: renderOverrides, yearIncome: renderYearIncome, extraLoans: renderExtraLoans };
    const item = (g) => (g.custom ? CUSTOM[g.custom]() : renderField(g));
    const html = SECTIONS.map((s) => `<div class="section"><h2>${escapeHtml(s.title)}</h2>` +
      s.fields.map((f) => (f.adv
        ? `<details class="adv"><summary>${escapeHtml(f.adv)}</summary>${f.fields.map(item).join('')}</details>`
        : item(f))).join('') + '</div>').join('');
    // Zachowaj otwarte sekcje „Zaawansowane” przy ponownym renderze.
    const open = [...document.querySelectorAll('#params-form details.adv')].map((d) => d.open);
    $('params-form').innerHTML = html;
    document.querySelectorAll('#params-form details.adv').forEach((d, n) => { if (open[n]) d.open = true; });
    updateFormState();
  }

  function rerenderOverrides() {
    const el = $('overrides');
    if (el) el.outerHTML = renderOverrides();
  }

  function renderExtraLoans() {
    return '<div id="extra-loans"><p class="muted small">Każdy kredyt ma własny harmonogram. Raty wszystkich kredytów sumują się w pokryciu, wymaganym dochodzie i werdykcie. Startują razem z kredytem na ziemię.</p>' +
      inputs.extraLoans.map((l, n) => `<fieldset class="extra-loan" data-el-card="${n}"><legend>${escapeHtml(l.name || 'Kredyt ' + (n + 2))}</legend>` +
        EXTRA_FIELDS.map((f) => renderField(f, n)).join('') +
        `<button type="button" class="btn btn-small btn-danger" data-action="el-remove" data-n="${n}">Usuń ten kredyt</button></fieldset>`).join('') +
      '<button type="button" class="btn btn-small" data-action="el-add">+ Dodaj kredyt lub zobowiązanie</button></div>';
  }
  function rerenderExtraLoans() {
    const el = $('extra-loans');
    if (el) el.outerHTML = renderExtraLoans();
  }

  // Komunikat błędu pola liczbowego albo null. v: wynik parsePlnNumber (null = puste).
  function numError(f, v, ctx) {
    if (v === null) return f.optional ? null : 'Wpisz wartość.';
    if (Number.isNaN(v)) return 'To nie jest liczba.';
    if (f.int && !Number.isInteger(v)) return 'Wpisz liczbę całkowitą.';
    const max = f.max ? f.max(ctx) : Infinity;
    if (f.min !== undefined && v < f.min) return 'Minimum: ' + inputFmt(2).format(f.min) + (f.unit ? ' ' + f.unit : '') + '.';
    if (v > max) return f.maxMsg || 'Maksimum: ' + inputFmt(2).format(max) + (f.unit ? ' ' + f.unit : '') + '.';
    return null;
  }

  const readControl = (f, el) => (f.t === 'chk' ? el.checked
    : f.t === 'sel' ? (f.numeric ? Number(el.value) : el.value)
      : f.t === 'month' || f.t === 'date' || f.t === 'text' ? el.value
        : parsePlnNumber(el.value));

  // Czyta wszystkie pola z DOM, waliduje, aktualizuje `inputs` (tylko poprawne wartości) i `errors`.
  function readForm() {
    const cand = {};
    FIELDS.forEach((f) => {
      const el = $('f-' + f.k);
      if (el) cand[f.k] = readControl(f, el);
    });
    const merged = { ...inputs, ...cand };
    const errs = {};
    FIELDS.forEach((f) => {
      if (!(f.k in cand) || (f.show && !f.show(merged))) return;
      const v = cand[f.k];
      if (f.t === 'month') { if (!v && !f.optional) errs[f.k] = 'Wybierz miesiąc.'; return; }
      if (f.t !== undefined && f.t !== 'num') return;
      if (v === null && f.optional) { cand[f.k] = 0; return; }
      const e = numError(f, v, merged);
      if (e) errs[f.k] = e;
    });
    Object.keys(errs).forEach((k) => delete cand[k]);

    // Dodatkowe kredyty: błędne pole zachowuje ostatnią poprawną wartość.
    if ($('extra-loans')) {
      cand.extraLoans = inputs.extraLoans.map((prev, n) => {
        const lc = {};
        EXTRA_FIELDS.forEach((f) => { const el = $('f-' + elKey(n, f.k)); if (el) lc[f.k] = readControl(f, el); });
        const lm = { ...prev, ...lc };
        EXTRA_FIELDS.forEach((f) => {
          if (!(f.k in lc) || f.t || (f.show && !f.show(lm))) return;
          const e = numError(f, lc[f.k], lm);
          if (e) { errs[elKey(n, f.k)] = e; delete lc[f.k]; }
        });
        return { ...prev, ...lc };
      });
    }

    // Zmiany stopy.
    const overrides = {};
    let ovError = '';
    document.querySelectorAll('#overrides .override-row').forEach((row) => {
      const month = row.querySelector('[data-ov-month]').value;
      const rate = parsePlnNumber(row.querySelector('[data-ov-rate]').value);
      if (!month) ovError = 'Każda zmiana stopy potrzebuje miesiąca.';
      else if (rate === null || Number.isNaN(rate) || rate < 0 || rate > 30) ovError = 'Stopa w zmianach: od 0 do 30%.';
      else overrides[month] = rate;
    });
    if (ovError) errs.overrides = ovError; else cand.rateOverrides = overrides;

    // Korekty roczne: lata spoza listy zostają (np. po skróceniu horyzontu).
    const yearPct = { ...inputs.incomeYearPct };
    let yearError = '';
    document.querySelectorAll('#year-income [data-year]').forEach((el) => {
      const v = parsePlnNumber(el.value);
      if (v === null || v === 0) delete yearPct[el.dataset.year];
      else if (Number.isNaN(v) || v < -100 || v > 300) yearError = 'Korekta roku: liczba od −100 do 300%.';
      else yearPct[el.dataset.year] = v;
    });
    if (yearError) errs.yearIncome = yearError; else cand.incomeYearPct = yearPct;

    inputs = { ...inputs, ...cand };
    errors = errs;
  }

  function updateFormState() {
    const ctx = { p: Calc.purchase(inputs), perHa: Calc.incomePerHa(inputs) };
    FIELDS.forEach((f) => {
      const wrap = document.querySelector(`[data-field="${f.k}"]`);
      if (!wrap) return;
      wrap.hidden = f.show ? !f.show(inputs) : false;
      const hint = wrap.querySelector('.hint');
      if (hint) hint.textContent = f.hint ? f.hint(inputs, ctx) : '';
      const err = wrap.querySelector('.error');
      const missing = !!errors[f.k] && inputs[f.k] == null; // jeszcze nie wpisane — bez czerwieni
      if (err) err.textContent = missing ? 'Uzupełnij.' : errors[f.k] || '';
      wrap.classList.toggle('invalid', !!errors[f.k] && !missing);
      wrap.classList.toggle('missing', missing);
      if (f.placeholder) { const el = $('f-' + f.k); if (el) el.placeholder = f.placeholder(inputs); }
    });
    inputs.extraLoans.forEach((l, n) => EXTRA_FIELDS.forEach((f) => {
      const key = elKey(n, f.k);
      const wrap = document.querySelector(`[data-field="${key}"]`);
      if (!wrap) return;
      wrap.hidden = f.show ? !f.show(l) : false;
      const hint = wrap.querySelector('.hint');
      if (hint) hint.textContent = f.hint ? f.hint(l) : '';
      const err = wrap.querySelector('.error');
      if (err) err.textContent = errors[key] || '';
      wrap.classList.toggle('invalid', !!errors[key]);
    }));
    document.querySelectorAll('#extra-loans [data-el-card]').forEach((card, n) => {
      const l = inputs.extraLoans[n];
      if (l) card.querySelector('legend').textContent = l.name || 'Kredyt ' + (n + 2);
    });
    const ovErr = $('overrides-error');
    if (ovErr) ovErr.textContent = errors.overrides || '';
    const yearErr = $('year-income-error');
    if (yearErr) yearErr.textContent = errors.yearIncome || '';
  }

  const hasErrors = () => Object.keys(errors).length > 0;

  // ---------------------------------------------------------------- przeliczenie

  function recalc(immediate) {
    clearTimeout(recalcTimer);
    const go = () => {
      if (!hasErrors()) result = Calc.calculate(inputs, todayIso());
      Storage.saveDraft(inputs);
      renderAll();
    };
    if (immediate) go(); else recalcTimer = setTimeout(go, 120);
  }

  function handleParamInput(e) {
    if (e.target.matches('details, summary')) return;
    readForm();
    if (!e.target.dataset.year) refreshYearIncome();
    updateFormState();
    recalc(false);
  }

  // Po wyjściu z pola: sformatuj liczbę po polsku (spacje tysięcy).
  function handleParamChange(e) {
    const k = e.target.dataset.k;
    const f = FIELDS.find((x) => x.k === k);
    if (f && (!f.t || f.t === 'num') && !errors[k]) e.target.value = fieldValue(f);
    const ek = e.target.dataset.ek, n = +e.target.dataset.el;
    const g = EXTRA_FIELDS.find((x) => x.k === ek);
    if (g && !g.t && !errors[elKey(n, ek)] && inputs.extraLoans[n]) e.target.value = fieldValue(g, inputs.extraLoans[n]);
    if (e.target.matches('[data-ov-month]')) { readForm(); rerenderOverrides(); updateFormState(); }
  }

  function handleParamClick(e) {
    const action = e.target.dataset.action;
    if (action === 'ov-add') {
      readForm();
      const keys = Object.keys(inputs.rateOverrides).sort();
      const last = keys.length ? keys[keys.length - 1] : inputs.startMonth;
      let month = addMonthsYm(last, 12) || nextMonth(todayIso());
      while (month in inputs.rateOverrides) month = addMonthsYm(month, 1);
      inputs.rateOverrides = { ...inputs.rateOverrides, [month]: keys.length ? inputs.rateOverrides[last] : inputs.baseRate };
      rerenderOverrides();
      updateFormState();
      recalc(true);
    } else if (action === 'ov-remove') {
      e.target.closest('.override-row').remove();
      readForm();
      rerenderOverrides();
      updateFormState();
      recalc(true);
    } else if (action === 'el-add' || action === 'el-remove') {
      readForm();
      const list = [...inputs.extraLoans];
      if (action === 'el-add') {
        list.push({ ...Storage.EXTRA_LOAN_DEFAULTS, name: 'Kredyt ' + (list.length + 2), margin: inputs.margin, paymentDay: inputs.paymentDay });
      } else {
        list.splice(+e.target.dataset.n, 1);
        // Błędy pól dodatkowych kredytów są indeksowane — po usunięciu ich numeracja się przesuwa.
        Object.keys(errors).filter((k) => /^el\d/.test(k)).forEach((k) => delete errors[k]);
      }
      inputs = { ...inputs, extraLoans: list };
      rerenderExtraLoans();
      updateFormState();
      recalc(true);
    }
  }

  // ---------------------------------------------------------------- render wyników

  const STATUS = {
    ok: { label: 'Spina się', icon: '✓' },
    warn: { label: 'Na granicy', icon: '!' },
    bad: { label: 'Nie spina się', icon: '✕' },
  };
  const badge = (status) => `<span class="badge ${status}">${STATUS[status].icon}</span>`;

  function paybackText(m, sum, rows) {
    if (m === null) return 'nie w ' + yearsLabel(sum.horizonMonths / 12);
    if (m === 0) return 'od razu';
    return Math.ceil(m / 12) + '. rok';
  }
  function paybackWhen(m, rows) {
    return m ? ' (' + humanMonth(rows[m].date) + ')' : '';
  }

  // Pola liczbowe, których użytkownik jeszcze nie wpisał (pusty start).
  const missingFields = () => FIELDS.filter((f) => (!f.t || f.t === 'num') && !f.optional && inputs[f.k] == null && !(f.show && !f.show(inputs)));

  function renderStart() {
    const list = missingFields().map((f) => '<li>' + escapeHtml(f.label) + '</li>').join('');
    const note = '<div class="empty">Wpisz parametry zakupu, kredytu i dochodu — wynik pojawi się, gdy wszystkie będą uzupełnione.</div>';
    $('verdict').innerHTML = '<div class="card"><h3>Uzupełnij parametry</h3>' +
      '<p class="small muted">Stopa referencyjna i założenia oceny są wpisane. Resztę podajesz Ty.</p>' +
      (list ? '<p class="small">Brakuje:</p><ul class="small missing-list">' + list + '</ul>' : '<p class="warn small">Popraw zaznaczone pola.</p>') +
      '<button type="button" class="next-step" data-action="params">Uzupełnij parametry ›</button></div>';
    $('sheet-verdict').innerHTML = '<span class="muted">Uzupełnij parametry</span>';
    ['tiles', 'result-cards', 'schedule-note'].forEach((id) => { $(id).innerHTML = ''; });
    $('schedule-table').innerHTML = note;
    $('sensitivity').innerHTML = note;
  }

  function renderAll() {
    $('summary-bar').hidden = !result;
    if (!result) { renderStart(); if (view === 'scenarios') renderScenarios(); return; }
    const stale = hasErrors();
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('stale', stale && v.id !== 'view-scenarios'));
    renderSheetVerdict();
    renderSummaryBar();
    if (view === 'result') renderResult();
    if (view === 'schedule') renderSchedule();
    if (view === 'sensitivity') renderSensitivity();
    if (view === 'scenarios') renderScenarios();
  }

  function renderSheetVerdict() {
    const s = result.base.summary, v = result.verdict;
    $('sheet-verdict').innerHTML = hasErrors()
      ? '<span class="warn">Uzupełnij lub popraw zaznaczone pola</span>'
      : `${badge(v.status)} <b>${STATUS[v.status].label}</b>${v.scenario !== 'base' ? ' (w stres teście)' : ''}<br><span class="muted">rata ${zl(s.firstInstallment)} · wymagany ${zl(s.requiredIncome)}/rok</span>`;
  }

  function renderSummaryBar() {
    const i = inputs;
    const income = `zysk ${zl(i.profitPerHa)}/ha`;
    const name = currentId ? (Storage.getScenario(currentId)?.name || '') : '';
    $('summary-bar').innerHTML = `<span>${name ? '<b>' + escapeHtml(name) + '</b> · ' : ''}${inputFmt(2).format(i.areaHa)} ha × ${zl(i.pricePerHa)} · ${yearsLabel(i.loanYears)} · ${pct(i.baseRate + i.margin, 2)}${i.extraLoans.length ? ' · + ' + i.extraLoans.length + ' ' + plural(i.extraLoans.length, 'kredyt', 'kredyty', 'kredytów') : ''} · ${escapeHtml(income)}</span><span class="edit">Zmień ›</span>`;
  }

  function verdictCause(s) {
    const cov = pct(s.minDscr * 100, 0);
    const tgt = pct(s.target * 100, 0);
    const k = s.loans.length > 1 ? `wszystkich ${s.loans.length} kredytów` : 'kredytu';
    if (!fin(s.minDscr)) return 'Bez kredytu — nie ma rat do pokrycia.';
    const farm = s.farmIncome > 0;
    const src = farm ? 'Dochód z ziemi i gospodarstwa' : 'Dochód z ziemi';
    if (s.status === 'ok') return `${src} pokrywa raty z zapasem: w najgorszym roku ${cov} rocznej obsługi ${k} (wymagane ${tgt}).`;
    if (s.status === 'warn') return `${src} pokrywa raty, ale bez wymaganego zapasu: w najgorszym roku ${cov} obsługi ${k}, a bufor to ${tgt}.`;
    const n = s.deficitYears.length;
    const income = farm ? `${zl(s.expectedIncome)} + ${zl(s.farmIncome)} z gospodarstwa` : zl(s.expectedIncome);
    return `Dochód ${income}/rok nie wystarcza na raty: w najgorszym roku pokrywa ${cov} obsługi ${k} (${zl(s.maxDebtService)}/rok). ` +
      (farm ? `Ponad nadwyżkę gospodarstwa brakuje łącznie` : `Z reszty gospodarstwa trzeba dołożyć łącznie`) +
      ` ${zl(s.shortfall)} w ${n} ${plural(n, 'roku', 'latach', 'latach')}.`;
  }

  // Nazwy scenariuszy stresu (werdykt, tabela stresu).
  const stressLabel = (key) => (key === 'stressRate'
    ? `stopie wyższej o ${pp(inputs.stressRatePp)}${inputs.stressRateFrom ? ' ' + fromMonth(inputs.stressRateFrom) : ''}`
    : `dochodzie niższym o ${num(inputs.stressIncomePct, 0)}%`);

  function cashCause(s) {
    const when = s.peakMonth ? ` (${humanMonth(result.base.rows[s.peakMonth].date)})` : '';
    if (s.cashStatus === 'bad') return `Zabraknie gotówki: w najgorszym momencie${when} trzeba mieć ${zl(s.peakCash)}, a masz ${zl(s.cashAvailable)} — brakuje ${zl(-s.cashLeft)}.`;
    return `Gotówki wystarczy, ale po najgorszym momencie${when} zostaje tylko ${zl(s.cashLeft)} — mniej niż pół roku rat (${zl(s.maxDebtService / 2)}).`;
  }

  // Przyczyna werdyktu łącznego: wynik bazowy, potem każdy stres i płynność, które dają ten sam (najgorszy) status.
  function verdictText(v) {
    const base = result.base.summary;
    const parts = [verdictCause(base)];
    if (v.status === 'ok') return parts[0];
    ['stressRate', 'stressIncome'].forEach((key) => {
      const s = result[key].summary;
      if (s.status === v.status && base.status !== v.status) {
        parts.push(`Przy ${stressLabel(key)} — ${STATUS[s.status].label.toLowerCase()}: w najgorszym roku pokrycie ${pct(s.minDscr * 100, 0)}` +
          (s.shortfall > 0 ? `, brakuje ${zl(s.shortfall)}.` : '.'));
      }
    });
    const cashKey = ['base', 'stressRate', 'stressIncome'].find((key) => result[key].summary.cashStatus === v.status);
    if (cashKey) parts.push((cashKey !== 'base' ? `Przy ${stressLabel(cashKey)}: ` : '') + cashCause(result[cashKey].summary));
    return parts.join(' ');
  }

  function nextStep(v, s) {
    const t = result.thresholds;
    if (s.status === 'bad' && t.maxPricePerHa.value !== null) return { text: `Zobacz progi: zakup spina się przy cenie do ${zl(t.maxPricePerHa.value)}/ha`, goto: 'sensitivity' };
    if (s.status === 'bad') return { text: 'Sprawdź w Wrażliwości, co musiałoby się zmienić', goto: 'sensitivity' };
    if (v.status !== 'ok') return { text: 'Zobacz stres test w Wrażliwości', goto: 'sensitivity' };
    return { text: 'Zapisz ten wariant i porównaj z innym', action: 'save' };
  }

  function renderResult() {
    const r = result.base, s = r.summary, v = result.verdict;
    const st = STATUS[v.status];
    const step = nextStep(v, s);
    const H = s.horizonMonths / 12;
    $('verdict').innerHTML = (hasErrors() ? '<p class="stale-note">Uzupełnij lub popraw zaznaczone pola w parametrach — poniżej ostatni poprawny wynik.</p>' : '') +
      `<div class="card verdict ${v.status}">` +
      `<div class="verdict-status">${badge(v.status)}${st.label}</div>` +
      `<p class="verdict-cause">${verdictText(v)}</p>` +
      '<p class="small muted">Werdykt = najgorszy wynik z wariantu bazowego i stres testu' + (s.cashAvailable > 0 ? ', razem z rezerwą gotówki' : '') + '.</p>' +
      `<p class="verdict-profit ${s.delta >= 0 ? 'pos' : 'neg'}">Na tle lokaty ${pct(inputs.alternativeRate, 2)} (po podatku ${pct(s.altNetRate * 100, 2)}): ${signedZl(s.delta)} ${afterYears(H)}</p>` +
      (result.mc ? `<p class="small muted">W ${result.mc.runs} symulacjach zmiennych lat (przychód ±${num(result.mc.sd * 100, 0)}%): spina się ${share(result.mc.share.ok)}, na granicy ${share(result.mc.share.warn)}, nie spina się ${share(result.mc.share.bad)} wariantów.</p>` : '') +
      result.warnings.map((w) => `<p class="warn small">${escapeHtml(w)}</p>`).join('') +
      `<button type="button" class="next-step" data-goto="${step.goto || ''}" data-action="${step.action || ''}">${escapeHtml(step.text)}</button>` +
      '</div>';

    // Kafle.
    const sr = result.stressRate.summary;
    const f = s.freq;
    const graceLine = inputs.graceMonths > 0
      ? `<br>w karencji: <b>${inputs.graceType === 'capitalize' ? '0 zł (odsetki doliczane)' : zl(s.firstPayment)}</b>` : '';
    const extras = s.loans.length > 1;
    const allLine = extras
      ? `<br>wszystkie kredyty: ≈ <b>${zl(r.years[0].debtService / 12)}</b>/mies. w 1. roku, najwięcej ${zl(s.maxDebtService / 12)}/mies.` : '';
    const tiles = [
      `<div class="tile"><div class="tile-label">Rata ${FREQ_NAME[f]}${extras ? ' (kredyt na ziemię)' : ''}</div>` +
      `<div class="tile-value">${zl(s.firstInstallment)}</div>` +
      `<div class="tile-sub">${f > 1 ? `≈ <b>${zl(s.firstInstallmentMonthly)}</b> miesięcznie<br>` : ''}najwyższa ${zl(s.maxInstallment)} · przy ${pp(inputs.stressRatePp)}: <b>${zl(sr.maxInstallment)}</b>${graceLine}${allLine}</div></div>`,

      `<div class="tile"><div class="tile-label">Wymagany dochód${s.farmIncome > 0 ? ' z kupionej ziemi' : ''}</div>` +
      `<div class="tile-value">${zl(s.requiredIncome)}<span class="small muted"> /rok</span></div>` +
      `<div class="tile-sub"><b>${zl(s.requiredPerHa)}/ha</b> · ${zl(s.requiredMonthly)}/mies.` +
      (s.thresholdRevenue !== null ? `<br>przychód progowy: <b>${zl(s.thresholdRevenue)}/ha</b>` : '') +
      `<br>zakładasz: ${zl(s.expectedPerHa)}/ha` +
      (s.farmIncome > 0 ? `<br>po odjęciu nadwyżki gospodarstwa ${zl(s.farmIncome)}/rok` : '') + '</div></div>',

      `<div class="tile"><div class="tile-label">Zwrot</div>` +
      `<div class="tile-value">${paybackText(s.paybackCash, s)}<span class="small muted"> gotówką</span></div>` +
      `<div class="tile-sub">z wartością ziemi: <b>${paybackText(s.paybackWealth, s)}</b>${paybackWhen(s.paybackWealth, r.rows)}` +
      (inputs.landGrowthPct !== 0 ? `<br>bez wzrostu ceny ziemi: <b>${paybackText(s.paybackWealth0, s)}</b>` : '') +
      (s.paybackCash ? `<br>gotówka wraca: ${humanMonth(r.rows[s.paybackCash].date)}` : '') + '</div></div>',
    ];
    $('tiles').innerHTML = tiles.join('');

    const p = r.purchase;
    $('result-cards').innerHTML =
      thresholdsCard() +
      `<div class="card chart"><h3>Dochód a raty, rok po roku</h3>${flowChart(r)}</div>` +
      `<div class="card chart"><h3>Gotówka i majątek</h3>${cashChart(r)}</div>` +
      `<div class="card"><h3>Zakup</h3>` +
      kv('Cena ziemi', zl(p.price)) + kv('Podatek PCC', zl(p.pcc)) +
      kv('Notariusz, wycena, inne', zl(p.oneOff - p.pcc)) + kv('Wkład własny', zl(p.own)) +
      kv('Prowizja' + (inputs.feeFinanced ? ' (w kredycie)' : ''), zl(p.fee)) + kv('Kwota kredytu', zl(p.loan)) +
      (r.inflow ? kv('Inne kredyty na zakup (po prowizji)', '−' + zl(r.inflow)) : '') +
      kv('Gotówka potrzebna na start', zl(s.startCash)) +
      kv('Najwięcej gotówki zaangażowanej' + (s.peakMonth ? ` (${humanMonth(r.rows[s.peakMonth].date)})` : ''), zl(s.peakCash), true) +
      kv(`To samo przy ${stressLabel('stressIncome')}`, zl(result.stressIncome.summary.peakCash)) +
      (s.cashAvailable > 0
        ? kv('Zostaje z Twojej gotówki', `<span class="${s.cashLeft >= 0 ? 'pos' : 'neg'}">${signedZl(s.cashLeft)}</span>`) +
          kv(`… przy ${stressLabel('stressIncome')}`, `<span class="${result.stressIncome.summary.cashLeft >= 0 ? 'pos' : 'neg'}">${signedZl(result.stressIncome.summary.cashLeft)}</span>`)
        : '') +
      '<p class="muted small">Szczyt: start plus raty do pierwszych żniw i lata, w których dochód nie pokrywa rat (z nadwyżką gospodarstwa i ratami istniejących kredytów).</p></div>' +
      `<div class="card"><h3>Koszt kredytu${extras ? ' na ziemię' : ''}</h3>` +
      kv('Odsetki łącznie', zl(s.totalInterest)) + kv('Prowizja', zl(p.fee)) + kv('Ubezpieczenie i inne', zl(s.loanCostsTotal)) +
      kv('Całkowity koszt kredytu', zl(s.totalCost), true) + kv('Suma wszystkich rat', zl(s.totalPaid)) + kv('RRSO', s.rrso === null ? '—' : pct(s.rrso * 100, 2)) + '</div>' +
      (extras ? loansCard(s) : '') +
      `<div class="card"><h3>Opłacalność ${afterYears(H)}</h3>` +
      kv('Wartość ziemi', zl(s.end.land)) + kv('Kredyt do spłaty', zl(s.end.balance)) +
      kv('Gotówka: wpływy − wydatki', signedZl(s.end.cumCash)) +
      kv('Bilans (bez odsetek od gotówki)', signedZl(s.netGain), true) +
      kv('Zysk vs lokata ' + pct(inputs.alternativeRate, 2), `<span class="${s.delta >= 0 ? 'pos' : 'neg'}">${signedZl(s.delta)}</span>`) +
      kv('NPV (dziś)', signedZl(s.npv)) + kv('IRR (roczna stopa zwrotu)', s.irr === null ? 'nie da się wyznaczyć' : pct(s.irr * 100, 2)) +
      (s.rent > 0 ? `<p class="muted small">Wydzierżawienie tej ziemi dałoby ok. ${zl(s.rent)}/rok (${zl(inputs.rentPerHa)}/ha); zakładany dochód z uprawy to ${zl(s.expectedIncome)}/rok.</p>` : '') + '</div>';
  }

  const PURPOSE = { main: 'główny', own: 'na zakup', existing: 'istniejące' };
  function loansCard(s) {
    const rateOf = (l) => (l.fixed ? pct(l.rate, 2) + ' stałe' : pct(l.rate, 2));
    const sum = (k) => s.loans.reduce((a, l) => a + l[k], 0);
    return '<div class="card"><h3>Wszystkie kredyty</h3><div class="table-scroll"><table><thead><tr><th>Kredyt</th><th>Rodzaj</th><th>Kwota</th><th>Okres</th><th>Oproc.</th><th>Pierwsza rata</th><th>Odsetki</th><th>Koszt całk.</th><th>RRSO</th></tr></thead><tbody>' +
      s.loans.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td>${PURPOSE[l.purpose]}</td><td>${zl(l.amount)}</td><td>${formatMonths(l.months)}</td><td>${rateOf(l)}</td>` +
        `<td>${zl(l.firstInstallment)}${l.freq > 1 ? ' <span class="small muted">' + FREQ_NAME[l.freq] + '</span>' : ''}</td><td>${zl(l.totalInterest)}</td><td>${zl(l.totalCost)}</td><td>${l.rrso === null ? '—' : pct(l.rrso * 100, 2)}</td></tr>`).join('') +
      `</tbody><tfoot><tr><td>Razem</td><td></td><td>${zl(sum('amount'))}</td><td></td><td></td><td></td><td>${zl(sum('totalInterest'))}</td><td>${zl(s.allCost)}</td><td></td></tr></tfoot></table></div>` +
      '<p class="muted small">Pokrycie, wymagany dochód i werdykt liczą raty wszystkich kredytów. Zysk, zwrot i bilans pomijają istniejące zobowiązania — istnieją niezależnie od zakupu.</p></div>';
  }

  const kv = (label, value, total) => `<div class="kv${total ? ' total' : ''}"><span>${label}</span><span>${value}</span></div>`;

  function thresholdsCard() {
    const t = result.thresholds;
    const s = result.base.summary;
    const rate = inputs.baseRate + inputs.margin;
    const priceLine = t.maxPricePerHa.value !== null
      ? `cena do <b>${zl(t.maxPricePerHa.value)}/ha</b> (wpisana: ${zl(inputs.pricePerHa)})`
      : t.maxPricePerHa.reason === 'always' ? 'przy każdej rozsądnej cenie' : 'przy żadnej cenie — dochód jest za niski nawet bez kredytu';
    const hasPath = Object.keys(inputs.rateOverrides).length > 0;
    const rateLine = t.rateShift.value !== null
      ? (hasPath
        ? `stopy o <b>${pp(t.rateShift.value)}</b> względem Twojej ścieżki zmian stopy`
        : `oprocentowanie do <b>${pct(Math.max(0, t.maxTotalRate), 2)}</b> (dziś ${pct(rate, 2)})`)
      : t.rateShift.reason === 'always' ? 'oprocentowanie nawet o 30 pp wyższe' : 'przy żadnym oprocentowaniu — nawet kredyt 0% się nie spina';
    const ownLine = t.minOwn.value !== null
      ? (t.minOwn.value === 0 ? 'nawet bez wkładu własnego' : `wkład własny od <b>${zl(t.minOwn.value)}</b> (wpisany: ${zl(inputs.ownContribution)})`)
      : 'przy żadnym wkładzie — dochód nie pokrywa nawet kosztów kredytu';
    return `<div class="card"><h3>Kiedy to się spina (bufor ${num(s.target, 2)})</h3>` +
      '<p class="muted small">Każdy próg przy pozostałych parametrach bez zmian.</p>' +
      `<ul class="small"><li>${priceLine}</li><li>${rateLine}</li><li>${ownLine}</li></ul></div>`;
  }

  // ---------------------------------------------------------------- wykresy SVG

  function niceScale(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
    return { lo, hi, ticks };
  }

  function chartSvg({ n, bars = [], bands = [], lines = [], markers = [], xLabel }) {
    const W = 360, H = 190, L = 46, R = 8, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B;
    const vals = [0];
    for (let i = 0; i < n; i++) vals.push(bars.reduce((s, b) => s + Math.max(0, b.values[i] || 0), 0));
    lines.forEach((l) => l.values.forEach((v) => fin(v) && vals.push(v)));
    bands.forEach((b) => [...b.lo, ...b.hi].forEach((v) => fin(v) && vals.push(v)));
    const { lo, hi, ticks } = niceScale(Math.min(...vals), Math.max(...vals));
    const x = (i) => L + (i + 0.5) * pw / n;
    const y = (v) => T + (hi - v) / (hi - lo) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">`;
    ticks.forEach((t) => {
      s += `<line class="${t === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
        `<text class="tick" x="${L - 5}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${compact(t)}</text>`;
    });
    const bw = Math.max(1, pw / n * 0.7);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      bars.forEach((b) => {
        const v = Math.max(0, b.values[i] || 0);
        if (!v) return;
        s += `<rect class="${b.cls}" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(acc) - y(acc + v)).toFixed(1)}"/>`;
        acc += v;
      });
    }
    bands.forEach((b) => {
      const pts = b.lo.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1))
        .concat(b.hi.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).reverse());
      s += `<polygon class="band ${b.cls}" points="${pts.join(' ')}"/>`;
    });
    lines.forEach((l) => {
      const pts = l.values.map((v, i) => (fin(v) ? x(i).toFixed(1) + ',' + y(v).toFixed(1) : null)).filter(Boolean);
      s += `<polyline class="line ${l.cls}${l.dashed ? ' dashed' : ''}${l.thin ? ' thin' : ''}" points="${pts.join(' ')}"/>`;
      if (l.dots) l.values.forEach((v, i) => { if (fin(v)) s += `<circle class="${l.cls}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6"/>`; });
    });
    markers.forEach((m, k) => {
      const mx = x(m.i);
      const right = mx > W - 90;
      s += `<line class="marker ${m.cls}" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${T}" y2="${T + ph}"/>` +
        `<text class="marker-label ${m.cls}" x="${(mx + (right ? -4 : 4)).toFixed(1)}" y="${T + 10 + k * 12}" text-anchor="${right ? 'end' : 'start'}">${escapeHtml(m.label)}</text>`;
    });
    for (let i = 0; i < n; i++) {
      const lab = xLabel(i);
      if (lab !== null) s += `<text class="tick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${lab}</text>`;
    }
    return s + '</svg>';
  }

  const legend = (items) => '<div class="legend">' + items.map(([cls, label, type]) => `<span><i class="${type || ''} ${cls}"></i>${escapeHtml(label)}</span>`).join('') + '</div>';
  const yearStep = (years) => (years <= 12 ? 1 : years <= 30 ? 5 : 10);

  function flowChart(r) {
    const ys = r.years.filter((y) => y.inLoan);
    const target = r.summary.target;
    const step = yearStep(ys.length);
    return chartSvg({
      n: ys.length,
      bars: [
        { cls: 's-info', values: ys.map((y) => y.capital) },
        { cls: 's-warning', values: ys.map((y) => y.interest) },
        { cls: 's-muted', values: ys.map((y) => y.loanCosts) },
      ],
      lines: [
        { cls: 's-muted', dashed: true, values: ys.map((y) => y.debtService * target) },
        { cls: 's-accent', dots: true, values: ys.map((y) => y.income) },
      ],
      xLabel: (i) => ((i + 1) % step === 0 || i === 0 ? String(i + 1) : null),
    }) + legend([['s-info', 'kapitał', 'bar'], ['s-warning', 'odsetki', 'bar'], ['s-accent', 'dochód z ziemi'], ['s-muted', 'wymagany (z buforem)', 'dash']]) +
      '<p class="muted small">Oś pozioma: kolejne lata kredytu.</p>';
  }

  function cashChart(r) {
    const s = r.summary;
    const rows = r.rows.slice(0, s.horizonMonths + 1);
    const step = yearStep(s.horizonMonths / 12) * 12;
    const lines = [
      { cls: 's-info', values: rows.map((x) => x.cumCash) },
      { cls: 's-accent', values: rows.map((x) => x.equity) },
    ];
    if (inputs.landGrowthPct !== 0) lines.push({ cls: 's-accent', dashed: true, values: rows.map((x) => x.equity0) });
    const markers = [];
    if (s.paybackWealth) markers.push({ i: s.paybackWealth, cls: 's-accent', label: 'zwrot z ziemią' });
    if (s.paybackCash) markers.push({ i: s.paybackCash, cls: 's-info', label: 'zwrot gotówki' });
    return chartSvg({ n: rows.length, lines, markers, xLabel: (i) => (i % step === 0 ? String(i / 12) : null) }) +
      legend([['s-info', 'gotówka: wpływy − wydatki'], ['s-accent', 'majątek: ziemia − dług + gotówka']].concat(inputs.landGrowthPct !== 0 ? [['s-accent', 'majątek bez wzrostu ceny ziemi', 'dash']] : [])) +
      '<p class="muted small">Oś pozioma: lata od zakupu. Gotówka zaczyna się od minus wkładu i kosztów zakupu.</p>';
  }

  function mcIncomeChart(mc) {
    const ys = mc.years.slice(0, result.base.H / 12);
    const target = result.base.summary.target;
    const step = yearStep(ys.length);
    return chartSvg({
      n: ys.length,
      bands: [{ cls: 's-accent', lo: ys.map((y) => y.income.p10), hi: ys.map((y) => y.income.p90) }],
      lines: [
        ...mc.samples.map((sample) => ({ cls: 's-muted', thin: true, values: sample.slice(0, ys.length) })),
        { cls: 's-accent', values: ys.map((y) => y.income.p50) },
        { cls: 's-danger', values: ys.map((y) => (y.inLoan ? y.debtService : null)) },
        { cls: 's-muted', dashed: true, values: ys.map((y) => (y.inLoan ? y.debtService * target : null)) },
      ],
      xLabel: (i) => ((i + 1) % step === 0 || i === 0 ? String(i + 1) : null),
    }) + legend([['s-accent', '80% wariantów', 'bar band-key'], ['s-accent', 'mediana dochodu'], ['s-muted', 'przykładowe lata'], ['s-danger', 'raty + koszty kredytu'], ['s-muted', 'wymagany (z buforem)', 'dash']]) +
      '<p class="muted small">Oś pozioma: kolejne lata od zakupu. Gdy dochód spada pod czerwoną linię, brakuje na raty.</p>';
  }

  function mcCashChart(mc) {
    const pts = mc.cash;
    const step = yearStep(pts.length - 1);
    return chartSvg({
      n: pts.length,
      bands: [{ cls: 's-info', lo: pts.map((p) => p.p10), hi: pts.map((p) => p.p90) }],
      lines: [
        { cls: 's-info', values: pts.map((p) => p.p50) },
        { cls: 's-accent', values: mc.equity.map((p) => p.p50) },
        { cls: 's-accent', dashed: true, values: mc.equity.map((p) => p.p10) },
      ],
      xLabel: (i) => (i % step === 0 ? String(i) : null),
    }) + legend([['s-info', 'gotówka: 80% wariantów', 'bar band-key'], ['s-info', 'gotówka: mediana'], ['s-accent', 'majątek: mediana'], ['s-accent', 'majątek: co 10. wariant gorszy', 'dash']]) +
      '<p class="muted small">Oś pozioma: lata od zakupu. Gotówka = wszystkie wpływy minus wydatki od dnia zakupu.</p>';
  }

  const share = (x) => pct(x * 100, 0);
  const yearOfMonth = (m) => (m === 0 ? 'od razu' : Math.ceil(m / 12) + '. rok');

  function mcCard() {
    const mc = result.mc;
    if (!mc) {
      return '<div class="card"><h3>Zmienne lata</h3><p class="muted small">Symulacja wyłączona. Ustaw zmienność przychodu w parametrach → Dochód z kupionej ziemi → Zmienne lata.</p></div>';
    }
    const H = result.base.H / 12;
    const corrections = Object.keys(inputs.incomeYearPct).length;
    return `<div class="card chart"><h3>Zmienne lata: ${mc.runs} symulacji, przychód ±${num(mc.sd * 100, 0)}%</h3>` +
      `<p class="muted small">Każdy wariant losuje przychód na każdy rok osobno${corrections ? ' i nakłada Twoje korekty lat' : ''}. Raty są takie same jak w scenariuszu bazowym.</p>` +
      kv('Spina się', `${badge('ok')} ${share(mc.share.ok)} wariantów`) +
      kv('Na granicy', `${badge('warn')} ${share(mc.share.warn)}`) +
      kv('Nie spina się', `${badge('bad')} ${share(mc.share.bad)}`) +
      kv('Przynajmniej jeden rok bez pokrycia rat', share(mc.deficitShare)) +
      kv('Brakuje na raty łącznie', `mediana ${zl(mc.shortfall.p50)} · w co 10. wariancie ponad ${zl(mc.shortfall.p90)}`) +
      kv('Zysk vs lokata ' + afterYears(H), `<span class="${mc.delta.p50 >= 0 ? 'pos' : 'neg'}">${signedZl(mc.delta.p50)}</span> (od ${signedZl(mc.delta.p10)} do ${signedZl(mc.delta.p90)})`) +
      kv('Gotówka wraca w horyzoncie', share(mc.paybackCashShare) + (mc.paybackCash ? ' · mediana ' + yearOfMonth(mc.paybackCash.p50) : '')) +
      kv('Zwrot z wartością ziemi', mc.paybackWealth ? `mediana: ${yearOfMonth(mc.paybackWealth.p50)} · w co 10. wariancie: ${yearOfMonth(mc.paybackWealth.p90)} lub później` : 'nie w horyzoncie') +
      '<p class="muted small">Zakresy „od … do” obejmują 80% wariantów (10. i 90. percentyl).</p>' +
      `<h3>Dochód rok po roku</h3>${mcIncomeChart(mc)}<h3>Gotówka i majątek</h3>${mcCashChart(mc)}</div>`;
  }

  function rateChart() {
    const f = result.base.freq;
    const b = result.base.rows.filter((x) => x.isPayment);
    const st = result.stressRate.rows.filter((x) => x.isPayment);
    const step = yearStep(result.base.N / 12) * 12;
    return chartSvg({
      n: b.length,
      lines: [
        { cls: 's-danger', dashed: true, values: st.map((x) => x.payment / f) },
        { cls: 's-info', values: b.map((x) => x.payment / f) },
      ],
      xLabel: (i) => (b[i].m % step === 0 ? String(b[i].m / 12) : null),
    }) + legend([['s-info', 'rata bazowa'], ['s-danger', 'przy stresie stopy', 'dash']]) +
      `<p class="muted small">${f > 1 ? 'Rata przeliczona na miesiąc. ' : ''}Oś pozioma: lata od zakupu.</p>`;
  }

  // ---------------------------------------------------------------- harmonogram

  function renderSchedule() {
    $('sched-years').classList.toggle('active', scheduleMode === 'years');
    $('sched-months').classList.toggle('active', scheduleMode === 'months');
    const r = result.base;
    const extras = r.loans.length > 1;
    if (scheduleMode === 'years') {
      $('schedule-note').textContent = 'Rok liczony od miesiąca zakupu. Pokrycie = dochód / (raty + koszty kredytu).' +
        (extras ? ' Raty, kapitał, odsetki, koszty i saldo: wszystkie kredyty razem; oprocentowanie: kredyt na ziemię.' : '');
      const ys = r.years;
      const sum = (k) => ys.reduce((s, y) => s + y[k], 0);
      const rate = (y) => (y.rateMin === y.rateMax ? pct(y.rateMin, 2) : pct(y.rateMin, 2) + '–' + pct(y.rateMax, 2));
      $('schedule-table').innerHTML = '<table><thead><tr><th>Rok</th><th>Okres</th><th>Oproc.</th><th>Raty</th><th>Kapitał</th><th>Odsetki</th><th>Koszty</th><th>Saldo</th><th>Dochód</th><th>Pokrycie</th></tr></thead><tbody>' +
        ys.map((y) => `<tr class="${y.inLoan && y.dscr < 1 ? 'deficit' : ''}"><td>${y.year}</td><td>${shortMonth(y.from)} – ${shortMonth(y.to)}</td><td>${rate(y)}</td>` +
          `<td>${zl(y.payments)}</td><td>${zl(y.capital)}</td><td>${zl(y.interest)}</td><td>${zl(y.loanCosts)}</td><td>${zl(y.balance)}</td><td>${zl(y.income)}</td>` +
          `<td class="dscr">${y.debtService > 0 ? num(y.dscr, 2) : '—'}</td></tr>`).join('') +
        `</tbody><tfoot><tr><td>Razem</td><td></td><td></td><td>${zl(sum('payments'))}</td><td>${zl(sum('capital'))}</td><td>${zl(sum('interest'))}</td><td>${zl(sum('loanCosts'))}</td><td></td><td>${zl(sum('income'))}</td><td></td></tr></tfoot></table>`;
      return;
    }
    if (scheduleLoan >= r.loans.length) scheduleLoan = 0;
    const loan = r.loans[scheduleLoan];
    $('schedule-note').textContent = loan.fixed
      ? 'Ten kredyt ma stałe oprocentowanie.'
      : 'Wpisz inne oprocentowanie w racie, aby zmienić stopę referencyjną od tego okresu do kolejnej zmiany — dla wszystkich kredytów o zmiennym oprocentowaniu. Zmiany widać też w parametrach (Kredyt → Zaawansowane).';
    const picker = extras
      ? `<label class="field-label" for="sched-loan">Kredyt</label><select id="sched-loan" class="text-input">${r.loans.map((l, n) => `<option value="${n}"${n === scheduleLoan ? ' selected' : ''}>${escapeHtml(l.name || 'Kredyt ' + (n + 1))}</option>`).join('')}</select>`
      : '';
    const pays = loan.rows.filter((x) => x.isPayment);
    const sum = (k) => pays.reduce((s, x) => s + x[k], 0);
    $('schedule-table').innerHTML = picker + '<table><thead><tr><th>Nr</th><th>Data</th><th>Oproc. %</th><th>Rata</th><th>Kapitał</th><th>Odsetki</th><th>Saldo</th></tr></thead><tbody>' +
      pays.map((x, n) => {
        const key = Calc.monthKey(r.start + x.m - loan.freq);
        const over = key in inputs.rateOverrides;
        const rateCell = loan.fixed
          ? pct(x.rate, 2)
          : `<input class="rate-input${over ? ' overridden' : ''}" inputmode="decimal" data-key="${key}" data-margin="${loan.margin}" value="${inputFmt(2).format(x.rate)}" aria-label="Oprocentowanie raty ${n + 1}">`;
        return `<tr class="${x.inGrace ? 'grace' : ''}"><td>${n + 1}</td><td>${dateLabel(x.date)}${x.inGrace ? ' <span class="small">(karencja)</span>' : ''}</td>` +
          `<td>${rateCell}</td>` +
          `<td>${zl2(x.payment)}</td><td>${zl2(x.capital)}</td><td>${zl2(x.interest)}</td><td>${zl2(x.balance)}</td></tr>`;
      }).join('') +
      `</tbody><tfoot><tr><td>Razem</td><td></td><td></td><td>${zl2(sum('payment'))}</td><td>${zl2(sum('capital'))}</td><td>${zl2(sum('interest'))}</td><td></td></tr></tfoot></table>`;
  }

  function setScheduleMode(mode) { scheduleMode = mode; renderSchedule(); }

  function handleScheduleChange(e) {
    const el = e.target;
    if (el.id === 'sched-loan') { scheduleLoan = +el.value; renderSchedule(); return; }
    if (!el.matches('.rate-input')) return;
    const v = parsePlnNumber(el.value);
    const overrides = { ...inputs.rateOverrides };
    if (v === null) delete overrides[el.dataset.key];
    else if (Number.isNaN(v) || v < 0 || v > 40) { showToast('Oprocentowanie: liczba od 0 do 40%.'); renderSchedule(); return; }
    else overrides[el.dataset.key] = Math.round((v - +el.dataset.margin) * 10000) / 10000;
    inputs = { ...inputs, rateOverrides: overrides };
    rerenderOverrides();
    updateFormState();
    recalc(true);
    showToast('Zmiana stopy ' + fromMonth(el.dataset.key));
  }

  // ---------------------------------------------------------------- wrażliwość

  function renderSensitivity() {
    const cols = [
      ['Bazowy', result.base.summary, result.base.rows],
      [`Stopa ${pp(inputs.stressRatePp)}${inputs.stressRateFrom ? ' ' + fromMonth(inputs.stressRateFrom) : ''}`, result.stressRate.summary, result.stressRate.rows],
      [`Dochód −${num(inputs.stressIncomePct, 0)}%`, result.stressIncome.summary, result.stressIncome.rows],
    ];
    const row = (label, fn) => `<tr><td>${label}</td>${cols.map(([, s, rows]) => `<td>${fn(s, rows)}</td>`).join('')}</tr>`;
    const stressTable = '<div class="table-scroll"><table><thead><tr><th></th>' + cols.map(([l]) => `<th>${escapeHtml(l)}</th>`).join('') + '</tr></thead><tbody>' +
      row('Werdykt', (s) => `${badge(s.risk)} ${STATUS[s.risk].label}`) +
      row('Pierwsza rata', (s) => zl(s.firstInstallment)) +
      row('Najwyższa rata', (s) => zl(s.maxInstallment)) +
      row('Min. pokrycie', (s) => (fin(s.minDscr) ? num(s.minDscr, 2) : '—')) +
      row('Brakuje na raty', (s) => zl(s.shortfall)) +
      row('Najwięcej gotówki zaangażowanej', (s) => zl(s.peakCash)) +
      (inputs.cashAvailable > 0 ? row('Zostaje z Twojej gotówki', (s) => `<span class="${s.cashLeft >= 0 ? 'pos' : 'neg'}">${signedZl(s.cashLeft)}</span>`) : '') +
      row('Zysk vs lokata', (s) => `<span class="${s.delta >= 0 ? 'pos' : 'neg'}">${signedZl(s.delta)}</span>`) +
      row('Zwrot gotówkowy', (s) => paybackText(s.paybackCash, s)) +
      row('Zwrot z ziemią', (s) => paybackText(s.paybackWealth, s)) +
      '</tbody></table></div>';

    const target = result.base.summary.target;
    const rate = inputs.baseRate + inputs.margin;
    const cellCls = (d) => (d >= target ? 'cell-ok' : d >= 1 ? 'cell-warn' : 'cell-bad');
    const grid = '<div class="table-scroll"><table><thead><tr><th>Stopa \\ dochód</th>' +
      result.gridIncome.map((p) => `<th>${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%</th>`).join('') + '</tr></thead><tbody>' +
      result.grid.map((g) => `<tr><td>${g.pp === 0 ? 'obecna' : pp(g.pp)} (${pct(Math.max(0, rate + g.pp), 1)})</td>` +
        g.cells.map((c) => `<td class="${cellCls(c.dscr)}${g.pp === 0 && c.pct === 0 ? ' cell-current' : ''}">${fin(c.dscr) ? num(c.dscr, 2) : '—'}</td>`).join('') + '</tr>').join('') +
      '</tbody></table></div>';

    $('sensitivity').innerHTML =
      mcCard() +
      `<div class="card"><h3>Stres test</h3>${stressTable}<p class="muted small">Ustawienia stresu: parametry → Ocena → Stres test.</p></div>` +
      thresholdsCard() +
      `<div class="card"><h3>Pokrycie rat: stopa × dochód</h3>` +
      `<p class="muted small">Najgorszy rok: dochód / obsługa kredytu. Zielone ≥ ${num(target, 2)} (bufor), żółte 1–${num(target, 2)}, czerwone &lt; 1 (brakuje na raty). Obramowana komórka = Twoje założenia.</p>${grid}</div>` +
      `<div class="card chart"><h3>Rata w czasie</h3>${rateChart()}</div>`;
  }

  // ---------------------------------------------------------------- scenariusze

  // Podsumowanie bazowe ze statusem = werdykt łączny (bazowy + stresy + płynność), jak na ekranie Wynik.
  const quickSummary = (inp) => { const v = Calc.verdict(inp, todayIso()); return { ...v.base, status: v.status }; };

  function renderScenarios() {
    const list = Storage.getScenarios();
    [...compareIds].forEach((id) => { if (!list.some((s) => s.id === id)) compareIds.delete(id); });
    if (!list.length) {
      $('scenario-list').innerHTML = '<div class="empty">Brak zapisanych scenariuszy.<br>Zapisz bieżące parametry, żeby porównać warianty, np. 10 i 15 lat albo inną cenę za ha.</div>';
      $('compare').innerHTML = '';
      return;
    }
    $('scenario-list').innerHTML = '<p class="muted small">Zaznacz 2–3 scenariusze, żeby je porównać.</p>' + list.map((sc) => {
      const i = sc.inputs, s = quickSummary(i);
      return `<div class="card scenario${sc.id === currentId ? ' current' : ''}">` +
        `<input type="checkbox" data-compare="${sc.id}"${compareIds.has(sc.id) ? ' checked' : ''} aria-label="Porównaj">` +
        `<div><div class="scenario-name">${escapeHtml(sc.name)}</div>` +
        `<div class="scenario-meta">${inputFmt(2).format(i.areaHa)} ha × ${zl(i.pricePerHa)} · ${yearsLabel(i.loanYears)} · zapisany ${dateLabel(sc.updatedAt.slice(0, 10))}</div>` +
        `<div class="small">${badge(s.status)} ${STATUS[s.status].label} · rata ${zl(s.firstInstallment)} · wymagany ${zl(s.requiredIncome)}/rok · vs lokata <span class="${s.delta >= 0 ? 'pos' : 'neg'}">${signedZl(s.delta)}</span></div>` +
        (sc.notes ? `<div class="scenario-meta">${escapeHtml(sc.notes)}</div>` : '') + '</div>' +
        `<div class="scenario-actions"><button type="button" class="btn btn-small" data-load="${sc.id}">Wczytaj</button><button type="button" class="btn btn-small btn-danger" data-delete="${sc.id}">Usuń</button></div></div>`;
    }).join('');
    renderCompare(list);
  }

  function renderCompare(list) {
    const chosen = list.filter((s) => compareIds.has(s.id));
    if (chosen.length < 2) { $('compare').innerHTML = ''; return; }
    const data = chosen.map((sc) => ({ sc, i: sc.inputs, s: quickSummary(sc.inputs) }));
    const row = (label, fn) => `<tr><td>${label}</td>${data.map((d) => `<td>${fn(d)}</td>`).join('')}</tr>`;
    $('compare').innerHTML = '<div class="card"><h3>Porównanie</h3><div class="table-scroll"><table><thead><tr><th></th>' +
      data.map((d) => `<th>${escapeHtml(d.sc.name)}</th>`).join('') + '</tr></thead><tbody>' +
      row('Powierzchnia', (d) => inputFmt(2).format(d.i.areaHa) + ' ha') +
      row('Cena', (d) => zl(d.i.pricePerHa) + '/ha') +
      row('Wkład własny', (d) => zl(d.i.ownContribution)) +
      row('Okres', (d) => yearsLabel(d.i.loanYears)) +
      row('Raty', (d) => (d.i.installmentType === 'annuity' ? 'równe' : 'malejące') + ', ' + FREQ.find((x) => x[0] === d.i.frequency)[1]) +
      row('Oprocentowanie', (d) => pct(d.i.baseRate + d.i.margin, 2)) +
      row('Inne kredyty', (d) => (d.i.extraLoans.length ? d.i.extraLoans.length + ' · ' + zl(d.i.extraLoans.reduce((s, l) => s + l.amount, 0)) : '—')) +
      row('Dochód netto', (d) => zl(d.s.expectedPerHa) + '/ha') +
      row('Werdykt', (d) => `${badge(d.s.status)} ${STATUS[d.s.status].label}`) +
      row('Pierwsza rata', (d) => zl(d.s.firstInstallment)) +
      row('Wymagany dochód', (d) => zl(d.s.requiredIncome) + '/rok') +
      row('Min. pokrycie', (d) => (fin(d.s.minDscr) ? num(d.s.minDscr, 2) : '—')) +
      row('Koszt kredytu', (d) => zl(d.s.totalCost)) +
      row('Zwrot gotówkowy', (d) => paybackText(d.s.paybackCash, d.s)) +
      row('Zwrot z ziemią', (d) => paybackText(d.s.paybackWealth, d.s)) +
      row('Zysk vs lokata', (d) => `<span class="${d.s.delta >= 0 ? 'pos' : 'neg'}">${signedZl(d.s.delta)}</span>`) +
      '</tbody></table></div></div>';
  }

  function handleScenarioClick(e) {
    const t = e.target;
    if (t.dataset.compare) {
      if (t.checked && compareIds.size >= 3) { t.checked = false; showToast('Porównasz maksymalnie 3 scenariusze.'); return; }
      if (t.checked) compareIds.add(t.dataset.compare); else compareIds.delete(t.dataset.compare);
      renderCompare(Storage.getScenarios());
    } else if (t.dataset.load) {
      const sc = Storage.getScenario(t.dataset.load);
      if (!sc) return;
      inputs = sc.inputs;
      errors = {};
      currentId = sc.id;
      renderForm();
      recalc(true);
      switchView('result');
      showToast('Wczytano „' + sc.name + '”');
    } else if (t.dataset.delete) {
      const prev = Storage.deleteScenario(t.dataset.delete);
      if (!prev) return;
      compareIds.delete(prev.id);
      if (currentId === prev.id) currentId = null;
      renderScenarios();
      renderSummaryBar();
      showUndoToast('Usunięto „' + prev.name + '”', () => {
        Storage.restoreScenario(prev);
        renderScenarios();
      });
    }
  }

  function openSaveModal() {
    if (hasErrors()) { openParams(); showToast('Popraw zaznaczone pola przed zapisem.'); return; }
    const cur = currentId ? Storage.getScenario(currentId) : null;
    $('save-name').value = cur ? cur.name : `${inputFmt(2).format(inputs.areaHa)} ha × ${zl(inputs.pricePerHa)}, ${yearsLabel(inputs.loanYears)}`;
    $('save-notes').value = cur ? cur.notes || '' : '';
    $('btn-save-overwrite').hidden = !cur;
    if (cur) $('btn-save-overwrite').textContent = 'Nadpisz „' + cur.name + '”';
    openModal('modal-save');
    $('save-name').focus();
  }

  function saveScenario(asNew) {
    const rec = Storage.saveScenario({ id: asNew ? null : currentId, name: $('save-name').value, notes: $('save-notes').value, inputs });
    if (!rec) return;
    currentId = rec.id;
    closeModal('modal-save');
    renderAll();
    showToast('Zapisano „' + rec.name + '”');
  }

  // ---------------------------------------------------------------- nawigacja, modale, toasty

  function switchView(name) {
    view = name;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('fab-save').hidden = name !== 'result';
    renderAll();
    window.scrollTo(0, 0);
  }

  function handleNavClick(e) {
    const btn = e.target.closest('.nav-btn');
    if (btn) switchView(btn.dataset.view);
  }

  function handleVerdictClick(e) {
    const btn = e.target.closest('.next-step');
    if (!btn) return;
    if (btn.dataset.goto) switchView(btn.dataset.goto);
    else if (btn.dataset.action === 'save') openSaveModal();
    else if (btn.dataset.action === 'params') openParams();
  }

  function openParams() { $('params').classList.add('open'); }
  function closeParams() { $('params').classList.remove('open'); }

  function openModal(id) { $(id).classList.add('active'); }
  function closeModal(id) { $(id).classList.remove('active'); }
  function handleOverlayClick(e) { if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id); }
  function handleKeydown(e) {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal-overlay.active');
    if (open) closeModal(open.id); else closeParams();
  }

  function showToast(msg) {
    const t = $('toast');
    t.innerHTML = escapeHtml(msg);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function showUndoToast(msg, onUndo) {
    const t = $('toast');
    t.innerHTML = `<span>${escapeHtml(msg)}</span><button type="button">Cofnij</button>`;
    t.querySelector('button').addEventListener('click', () => {
      onUndo();
      t.classList.remove('show');
    }, { once: true });
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
  }

  // ---------------------------------------------------------------- ustawienia, pomoc

  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function openSettings() {
    $('theme-select').value = Storage.getTheme();
    $('import-message').textContent = '';
    openModal('modal-settings');
  }

  function handleThemeChange(e) {
    Storage.setTheme(e.target.value);
    applyTheme(e.target.value);
  }

  function exportJson() {
    const blob = new Blob([Storage.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kredyt-inwestycyjny-' + todayIso() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Wyeksportowano scenariusze');
  }

  function importJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const msg = $('import-message');
    const reader = new FileReader();
    reader.onload = () => {
      const res = Storage.importData(String(reader.result));
      msg.className = 'small ' + (res.ok ? 'pos' : 'neg');
      msg.textContent = res.ok ? `Zaimportowano ${res.count} ${plural(res.count, 'scenariusz', 'scenariusze', 'scenariuszy')}.` : res.error;
      e.target.value = '';
      if (res.ok) renderAll();
    };
    reader.onerror = () => { msg.className = 'small neg'; msg.textContent = 'Nie udało się odczytać pliku.'; };
    reader.readAsText(file);
  }

  function confirmClear() { openModal('modal-confirm'); }

  function clearData() {
    Storage.clearAll();
    applyTheme('auto');
    inputs = { ...Storage.blankInputs(), startMonth: nextMonth(todayIso()) };
    result = null;
    currentId = null;
    compareIds.clear();
    renderForm();
    readForm();
    updateFormState();
    recalc(true);
    closeModal('modal-confirm');
    closeModal('modal-settings');
    showToast('Wyczyszczono dane kalkulatora');
  }

  function updateMiniCalc() {
    const a = parsePlnNumber($('mini-amount').value), r = parsePlnNumber($('mini-rate').value), n = parsePlnNumber($('mini-n').value);
    const ok = [a, r, n].every((x) => fin(x)) && a >= 0 && r >= 0 && n >= 1 && Number.isInteger(n);
    $('mini-result').textContent = ok ? zl2(Calc.pmt(a, r, n)) : '—';
  }

  function openHelp() { updateMiniCalc(); openModal('modal-help'); }

  // ---------------------------------------------------------------- start

  function init() {
    Storage.setErrorHandler(showToast);
    inputs = Storage.getDraft();
    if (Calc.monthIndex(inputs.startMonth) === null) inputs.startMonth = nextMonth(todayIso());
    renderForm();
    readForm(); // puste pola → „Uzupełnij.”, wynik dopiero po wpisaniu wszystkich
    updateFormState();
    $('fab-save').hidden = false;
    recalc(true);
  }

  return {
    init, switchView, handleNavClick, handleVerdictClick,
    handleParamInput, handleParamChange, handleParamClick,
    openParams, closeParams, openModal, closeModal, handleOverlayClick, handleKeydown,
    setScheduleMode, handleScheduleChange, handleScenarioClick,
    openSaveModal, saveScenario, openSettings, handleThemeChange, exportJson, importJson,
    confirmClear, clearData, openHelp, updateMiniCalc, showToast,
  };
})();
window.UI = UI;
