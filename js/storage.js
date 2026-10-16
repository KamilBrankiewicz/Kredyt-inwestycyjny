// Jedyny właściciel localStorage. Zapisuje tylko parametry, nigdy wyniki.
// Wspólny origin z Licznikiem Kalorii: każdy klucz z prefiksem, nigdy localStorage.clear().
const Storage = (() => {
  const PREFIX = 'kredyt.';
  const KEYS = { scenarios: 'scenarios', draft: 'draft', theme: 'theme' };
  const VERSION = 1;

  // Domyślne parametry. Nowe pole = wartość neutralna dla starych scenariuszy (np. koszt 0).
  const DEFAULTS = {
    // Ziemia
    areaHa: 20,
    pricePerHa: 60000,
    ownContribution: 300000,
    pccExempt: false,
    notaryCosts: 9000,
    valuationCosts: 1500,
    otherCosts: 0,
    // Kredyt
    startMonth: '',            // YYYY-MM, miesiąc uruchomienia (zakupu); puste = następny miesiąc
    loanYears: 15,
    frequency: 1,              // miesiące między ratami: 1, 3, 6, 12
    installmentType: 'annuity', // 'annuity' | 'decreasing'
    baseRate: 4.5,             // stopa referencyjna, % rocznie
    baseRateDate: '',          // data notowania, tylko informacyjnie
    margin: 2.5,
    paymentDay: 10,
    feePct: 1,
    feeFinanced: false,
    graceMonths: 0,
    graceType: 'interest',     // 'interest' | 'capitalize'
    yearlyLoanCosts: 0,        // ubezpieczenie itp., zł/rok
    rateOverrides: {},         // { 'YYYY-MM': stopa referencyjna } — lepkie
    extraLoans: [],            // inne kredyty i zobowiązania, pola: EXTRA_LOAN_DEFAULTS
    farmIncome: 0,             // nadwyżka z obecnego gospodarstwa na raty, zł/rok; tylko do pokrycia (F13)
    cashAvailable: 0,          // gotówka na wkład, koszty i rezerwę, zł; 0 = bez sprawdzania płynności
    // Dochód z ziemi
    revenuePerHa: 6750,        // przychód z ha (sprzedaż plonu) — zmienna część dochodu, od niej odchylenia
    profitPerHa: 3700,         // zysk z ha po kosztach, z dopłatami, po podatku rolnym, przed ratą
    incomeMonth: 8,
    incomeGrowthPct: 0,
    rentPerHa: 1500,
    incomeYearPct: {},         // { 'RRRR': korekta przychodu w % } dla żniw w danym roku kalendarzowym
    incomeVolatilityPct: 20,   // odchylenie standardowe przychodu w symulacji zmiennych lat
    // Ocena
    horizonYears: 0,           // 0 = okres kredytu
    landGrowthPct: 0,
    alternativeRate: 5,
    dscrTarget: 1.2,
    // Stress
    stressRateFrom: '',        // YYYY-MM; puste = od początku
    stressRatePp: 2,
    stressIncomePct: 20,
  };

  // Dodatkowy kredyt (element extraLoans). Startuje razem z kredytem na ziemię.
  const EXTRA_LOAN_DEFAULTS = {
    name: 'Kredyt 2',
    purpose: 'own',            // 'own' — współfinansuje zakup | 'existing' — istniejące zobowiązanie
    amount: 100000,            // kwota albo saldo do spłaty
    months: 120,               // okres albo pozostały okres
    frequency: 1,
    installmentType: 'annuity',
    rateType: 'variable',      // 'variable' — stopa referencyjna kredytu na ziemię + marża | 'fixed'
    margin: 2.5,
    fixedRate: 2,
    feePct: 0,                 // tylko 'own'; płatna z wypłaty
    graceMonths: 0,
    graceType: 'interest',
    paymentDay: 10,
    yearlyCosts: 0,
  };

  let onError = (msg) => console.error(msg);

  function setErrorHandler(fn) { onError = fn; }

  function read(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(PREFIX + key); } catch (e) { return fallback; }
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) {
      onError('Uszkodzone dane (' + key + ') — przywrócono domyślne.');
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      onError(e && e.name === 'QuotaExceededError'
        ? 'Brak miejsca w pamięci przeglądarki.'
        : 'Nie udało się zapisać danych.');
      return false;
    }
  }

  // Do v7 dochód podawano z plonu, ceny i kosztów albo jedną kwotą. Przeliczamy na przychód i zysk z ha —
  // to ten sam model (zmienny przychód + stała reszta), więc stare scenariusze liczą się tak samo.
  const LEGACY_INCOME = { incomeMode: 'detailed', netIncomePerHa: 2500, cropName: '', yieldT: 7.5, pricePerT: 900, directCostsPerHa: 3800, subsidiesPerHa: 1000, landTaxPerHa: 250 };
  function migrateIncome(src) {
    if (!Object.keys(LEGACY_INCOME).some((k) => k in src)) return src;
    const o = { ...LEGACY_INCOME, ...src };
    const out = { ...src };
    Object.keys(LEGACY_INCOME).forEach((k) => delete out[k]);
    if (src.revenuePerHa !== undefined) return out;
    const nums = (...ks) => (ks.some((k) => o[k] == null) ? null : ks.map((k) => +o[k]));
    if (o.incomeMode === 'simple') {
      out.revenuePerHa = out.profitPerHa = o.netIncomePerHa == null ? null : +o.netIncomePerHa;
    } else {
      const r = nums('yieldT', 'pricePerT');
      const c = nums('directCostsPerHa', 'subsidiesPerHa', 'landTaxPerHa');
      out.revenuePerHa = r && r[0] * r[1];
      out.profitPerHa = r && c ? r[0] * r[1] - c[0] + c[1] - c[2] : null;
    }
    return out;
  }

  function withDefaults(inputs) {
    const src = migrateIncome(inputs && typeof inputs === 'object' ? inputs : {});
    return {
      ...DEFAULTS, ...src,
      rateOverrides: { ...(src.rateOverrides || {}) },
      incomeYearPct: { ...(src.incomeYearPct || {}) },
      extraLoans: Array.isArray(src.extraLoans) ? src.extraLoans.map((l) => ({ ...EXTRA_LOAN_DEFAULTS, ...l })) : [],
    };
  }

  // ---- szkic formularza ----
  // Nowy formularz (pierwsze uruchomienie, wyczyszczenie danych): dane użytkownika puste (null) — ma je wpisać.
  // Stopa referencyjna i założenia oceny zostają z DEFAULTS. DEFAULTS bez zmian, więc stare scenariusze liczą się tak samo.
  const BLANK_START = ['areaHa', 'pricePerHa', 'ownContribution', 'notaryCosts', 'valuationCosts', 'otherCosts',
    'loanYears', 'margin', 'feePct', 'graceMonths', 'yearlyLoanCosts', 'farmIncome', 'revenuePerHa', 'profitPerHa',
    'incomeGrowthPct', 'rentPerHa'];
  function blankInputs() { return withDefaults(Object.fromEntries(BLANK_START.map((k) => [k, null]))); }
  function getDraft() {
    const d = read(KEYS.draft, null);
    return d && typeof d === 'object' ? withDefaults(d) : blankInputs();
  }
  function saveDraft(inputs) { return write(KEYS.draft, inputs); }

  // ---- scenariusze (z nagrobkami) ----
  function getAllScenarios() {
    const list = read(KEYS.scenarios, []);
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string') : [];
  }

  function getScenarios() {
    return getAllScenarios()
      .filter((s) => !s.deleted)
      .map((s) => ({ ...s, inputs: withDefaults(s.inputs) }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getScenario(id) { return getScenarios().find((s) => s.id === id) || null; }

  function upsert(record) {
    const list = getAllScenarios().filter((s) => s.id !== record.id);
    list.push(record);
    return write(KEYS.scenarios, list);
  }

  function saveScenario({ id, name, notes, inputs }) {
    const now = new Date().toISOString();
    const prev = id ? getAllScenarios().find((s) => s.id === id && !s.deleted) : null;
    const record = {
      id: prev ? prev.id : crypto.randomUUID(),
      name: String(name || '').trim() || 'Scenariusz',
      notes: String(notes || '').trim(),
      // Puste pola ukryte w formularzu (np. plon przy dochodzie kwotą) dostają DEFAULTS — scenariusz bez null.
      inputs: withDefaults(Object.fromEntries(Object.entries(inputs).filter(([, v]) => v !== null))),
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now,
    };
    return upsert(record) ? record : null;
  }

  // Usuwa (nagrobek) i zwraca poprzedni rekord do „Cofnij”.
  function deleteScenario(id) {
    const prev = getAllScenarios().find((s) => s.id === id && !s.deleted);
    if (!prev) return null;
    upsert({ id, deleted: true, updatedAt: new Date().toISOString() });
    return prev;
  }

  function restoreScenario(record) {
    return upsert({ ...record, updatedAt: new Date().toISOString() });
  }

  // ---- merge (wzorzec Licznika): wyższy updatedAt wygrywa, nagrobki też ----
  function mergeListBy(a, b, key = 'id') {
    const byKey = new Map();
    [...a, ...b].forEach((e) => {
      const prev = byKey.get(e[key]);
      if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) byKey.set(e[key], e);
    });
    return [...byKey.values()];
  }

  // ---- eksport / import ----
  function exportData() {
    return JSON.stringify({ version: VERSION, exportedAt: new Date().toISOString(), scenarios: getAllScenarios() }, null, 2);
  }

  function migrate(data) {
    // v1 to obecny kształt; brak pola version traktujemy jak v1.
    return { ...data, version: VERSION };
  }

  // Zwraca komunikat błędu albo null.
  function validateImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'To nie jest plik eksportu kalkulatora.';
    if (typeof data.version === 'number' && data.version > VERSION) return 'Plik pochodzi z nowszej wersji aplikacji.';
    if (!Array.isArray(data.scenarios)) return 'Brak listy scenariuszy w pliku.';
    for (const s of data.scenarios) {
      if (!s || typeof s.id !== 'string' || typeof s.updatedAt !== 'string') return 'Scenariusz bez id lub daty zapisu.';
      if (s.deleted) continue;
      if (typeof s.name !== 'string' || !s.inputs || typeof s.inputs !== 'object') return 'Scenariusz „' + (s.name || s.id) + '” jest niekompletny.';
      for (const [k, v] of Object.entries(s.inputs)) {
        if (k in DEFAULTS && typeof v !== typeof DEFAULTS[k]) return 'Pole „' + k + '” w scenariuszu „' + s.name + '” ma zły typ.';
      }
      const extra = s.inputs.extraLoans;
      if (extra !== undefined && !Array.isArray(extra)) return 'Pole „extraLoans” w scenariuszu „' + s.name + '” ma zły typ.';
      for (const l of extra || []) {
        if (!l || typeof l !== 'object') return 'Kredyt w scenariuszu „' + s.name + '” jest niekompletny.';
        for (const [k, v] of Object.entries(l)) {
          if (k in EXTRA_LOAN_DEFAULTS && typeof v !== typeof EXTRA_LOAN_DEFAULTS[k]) return 'Pole „' + k + '” kredytu w scenariuszu „' + s.name + '” ma zły typ.';
        }
      }
    }
    return null;
  }

  function importData(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'Plik nie jest poprawnym JSON.' }; }
    data = data && typeof data === 'object' && !Array.isArray(data) ? migrate(data) : data;
    const error = validateImport(data);
    if (error) return { ok: false, error };
    const merged = mergeListBy(getAllScenarios(), data.scenarios);
    if (!write(KEYS.scenarios, merged)) return { ok: false, error: 'Nie udało się zapisać danych.' };
    return { ok: true, count: data.scenarios.filter((s) => !s.deleted).length };
  }

  // Usuwa wyłącznie własne klucze (wspólny origin z Licznikiem).
  function clearAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch (e) { onError('Nie udało się wyczyścić danych.'); }
  }

  // ---- motyw ----
  function getTheme() { const t = read(KEYS.theme, 'auto'); return ['auto', 'dark', 'light'].includes(t) ? t : 'auto'; }
  function setTheme(t) { return write(KEYS.theme, t); }

  return {
    DEFAULTS, EXTRA_LOAN_DEFAULTS, BLANK_START, withDefaults, blankInputs, setErrorHandler,
    getDraft, saveDraft,
    getScenarios, getScenario, saveScenario, deleteScenario, restoreScenario,
    mergeListBy, exportData, importData, validateImport, migrate, clearAll,
    getTheme, setTheme,
  };
})();
if (typeof window === 'object') window.Storage = Storage;
if (typeof module === 'object') module.exports = Storage; // Node: test/calc.check.js
