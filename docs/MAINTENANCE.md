# Checklista zmian

## A. Przed kodem
- Przeczytaj [CLAUDE.md](../CLAUDE.md), [PLAN.md](../PLAN.md) i [CHANGELOG.md](CHANGELOG.md) (czy to już było próbowane).
- Czy zmiana dotyka modelu danych (`DEFAULTS`, kształt scenariusza)? Czy dotyka `calc.js`?
- `git status`.

## B. Podczas pisania
- Reguły warstw (ARCHITECTURE.md). `calc.js` bez DOM, Storage i `new Date()`.
- Nowe pole: wartość w `DEFAULTS` neutralna dla starych scenariuszy (np. koszt 0), wpis w `SECTIONS` w `ui.js`.
- Klucze localStorage tylko przez `storage.js` (prefiks `kredyt.`).
- Nowy plik JS: `<script>` w `index.html`, `APP_SHELL` w `sw.js`, drzewko w ARCHITECTURE.md.
- `escapeHtml()` przy nazwie i notatce scenariusza.

## C. Przed uznaniem za zrobione
- **C1 (zawsze):** bump `CACHE_NAME` w `sw.js` + znacznik „vN” w `index.html` (Ustawienia). Sprawdzenie zgodności:
  `grep -o "kredyt-inwestycyjny-v[0-9]*" sw.js; grep -o 'class="version">v[0-9]*' index.html`.
  Jeśli ruszano `calc.js`: `node test/calc.check.js`.
- **C2 regresja rdzenia (zawsze):** pierwszy start na pustym storage pokazuje wynik; zmiana parametru przelicza wynik;
  F5 nie gubi szkicu; zapis scenariusza → F5 → jest; usunięcie + „Cofnij”; porównanie 2 scenariuszy;
  przełączenie 4 zakładek; widok 375 px i ≥ 900 px; oba motywy; konsola bez błędów.
- **C3, zmiana `calc.js`:** jeden przypadek ręcznie porównany z publicznym kalkulatorem raty banku. Nowy wzór → nowy przypadek w checku.
- **C3, zmiana modelu danych:** start ze scenariuszami sprzed zmiany daje identyczne wyniki; eksport → import;
  import uszkodzonego pliku daje komunikat i stan nietknięty.
- **C3, wspólny origin:** po zmianach w storage/SW otwórz Licznik na tym samym originie — jego ustawienia
  nietknięte, offline obu aplikacji działa.
- **C3, SW:** DevTools → Offline → aplikacja startuje.
- **C4:** CHANGELOG zawsze; ARCHITECTURE/CALCULATIONS/CLAUDE.md gdy zmieniły się zasady lub model.
- **C5:** `git diff` — brak `console.log`, zakomentowanego kodu, kluczy.

## D. Po wdrożeniu
Publiczny URL na telefonie, wymuszony reload, zainstalowana PWA pokazuje nowe „vN”, scenariusze na miejscu.

## Diagnostyka

| Objaw | Przyczyna |
|---|---|
| Przycisk nic nie robi, `X is not a function` | niezbumpowany `CACHE_NAME` |
| Działa online, wybucha offline | plik poza `APP_SHELL` |
| `NaN`/`Infinity` w wynikach | pole spoza `DEFAULTS`, nieprzekonwertowany przecinek, `r = 0` bez gałęzi |
| Saldo końcowe ≠ 0,00 | brak domknięcia ostatniej raty |
| IRR/RRSO/progi absurdalne | przedział bisekcji bez zmiany znaku albo zła tolerancja |
| Stary scenariusz liczy się inaczej po aktualizacji | domyślna wartość nowego pola nie jest neutralna |
| Licznik stracił ustawienia / motyw | klucz bez prefiksu `kredyt.` |
| Jedna z aplikacji nie startuje offline po aktualizacji drugiej | SW kasuje cudze cache |
| Lokalnie widać starą wersję mimo zmian | SW serwuje z cache: DevTools → Application → Unregister albo drugi reload |
