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
    // Dochód z ziemi
    incomeMode: 'detailed',    // 'simple' | 'detailed'
    netIncomePerHa: 2500,
    cropName: 'pszenica',
    yieldT: 7.5,
    pricePerT: 900,
    directCostsPerHa: 3800,
    subsidiesPerHa: 1000,
    landTaxPerHa: 250,
    incomeMonth: 8,
    incomeGrowthPct: 0,
    rentPerHa: 1500,
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

  function withDefaults(inputs) {
    const src = inputs && typeof inputs === 'object' ? inputs : {};
    return { ...DEFAULTS, ...src, rateOverrides: { ...(src.rateOverrides || {}) } };
  }

  // ---- szkic formularza ----
  function getDraft() { return withDefaults(read(KEYS.draft, {})); }
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
      inputs: withDefaults(inputs),
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
    DEFAULTS, withDefaults, setErrorHandler,
    getDraft, saveDraft,
    getScenarios, getScenario, saveScenario, deleteScenario, restoreScenario,
    mergeListBy, exportData, importData, validateImport, migrate, clearAll,
    getTheme, setTheme,
  };
})();
if (typeof window === 'object') window.Storage = Storage;
if (typeof module === 'object') module.exports = Storage; // Node: test/calc.check.js
