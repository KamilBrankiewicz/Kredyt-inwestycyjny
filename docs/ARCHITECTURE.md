# Architektura

Kalkulator kredytu na zakup ziemi rolnej. PWA dla jednego użytkownika, vanilla JS bez kroku budowania,
hosting na GitHub Pages. Budowa według [SZABLON-APLIKACJI-OSOBISTEJ.md](SZABLON-APLIKACJI-OSOBISTEJ.md)
i [SPEC-KALKULATOR-KREDYTU-INWESTYCYJNEGO.md](SPEC-KALKULATOR-KREDYTU-INWESTYCYJNEGO.md); funkcje według
[SPECYFIKACJA_FUNKCJONALNA.md](SPECYFIKACJA_FUNKCJONALNA.md); model finansowy w [CALCULATIONS.md](CALCULATIONS.md).

## Pliki

```
/
├── index.html            # cały SPA: widoki + modale, inline skrypt motywu (kredyt.theme)
├── manifest.json         # start_url i scope względne
├── sw.js                 # CACHE_NAME = 'kredyt-inwestycyjny-vN', kasuje tylko własne cache
├── css/style.css         # zmienne CSS, ciemny/jasny, mobile-first + breakpoint 900 px
├── js/
│   ├── storage.js        # jedyny właściciel localStorage, DEFAULTS, scenariusze, eksport/import
│   ├── calc.js           # silnik: czyste funkcje, calculate(inputs, today)
│   ├── ui.js             # formularz (schemat SECTIONS), walidacja, render, wykresy SVG
│   └── app.js            # tylko addEventListener → UI.*, handler błędów, rejestracja SW
├── test/calc.check.js    # node test/calc.check.js (poza APP_SHELL)
├── icons/icon.svg
└── docs/
```

## Warstwy

```
index.html → app.js → ui.js → calc.js          (liczy; zero DOM, zero Storage)
                        ↓
                    storage.js → localStorage  (tylko parametry)
```

- `calc.js` nie woła `new Date()`; „dziś” przychodzi parametrem i służy tylko do domyślnego miesiąca zakupu.
- `storage.js` i `calc.js` eksportują się też przez `module.exports`, żeby check w Node używał prawdziwych `DEFAULTS`.
- Formularz powstaje ze schematu `SECTIONS` w `ui.js`: pole = klucz, etykieta, jednostka, zakres, warunek widoczności, podpowiedź. Nowe pole: wpis w `DEFAULTS` + wpis w `SECTIONS`.
- Zdarzenia formularza, harmonogramu i listy scenariuszy są delegowane z kontenerów statycznych w `app.js`.

## Dane (localStorage, prefiks `kredyt.`)

| Klucz | Zawartość | Eksport |
|---|---|---|
| `kredyt.scenarios` | `Scenario[]` z nagrobkami (`{ id, deleted: true, updatedAt }`) | tak |
| `kredyt.draft` | bieżące parametry, zapis przy każdej zmianie; brak szkicu → `blankInputs()` (pola `BLANK_START` = `null`, użytkownik je wpisuje) | nie |
| `kredyt.theme` | `auto` / `dark` / `light` | nie |

`Scenario = { id, name, notes, inputs, createdAt, updatedAt }`. `inputs` zawsze czytane przez
`withDefaults` (`{ ...DEFAULTS, ...saved }`; każdy element `inputs.extraLoans` uzupełniany z `EXTRA_LOAN_DEFAULTS`). Eksport `{ version: 1, scenarios }`; import: `JSON.parse`
→ `migrate` → `validateImport` (typy pól zgodne z `DEFAULTS`) → `mergeListBy` (scal).

## Wspólny origin z Licznikiem Kalorii

`kamilbrankiewicz.github.io/*` to jeden origin: wspólny localStorage i Cache Storage.
Prefiks `kredyt.` na każdym kluczu, „Wyczyść dane” usuwa tylko własne klucze, SW kasuje tylko cache
`kredyt-inwestycyjny-*`, SW rejestrowany ścieżką względną. Licznik wymaga osobnej poprawki swojego SW
(kasuje *każdy* obcy cache) — patrz SPEC §5.3.

## Świadome ograniczenia

To decyzje, nie braki — nie zmieniaj z własnej inicjatywy:

- brak automatycznego pobierania WIBOR/WIRON, cen ziemi i płodów,
- brak podatku dochodowego, dopłat do oprocentowania (ARiMR — V2), nadpłat, transz, kredytów walutowych,
- dochód z kupionej ziemi jako przychód i zysk z ha (bez rozbicia na uprawy, plon i koszty); zakup obejmuje tylko ziemię,
- inflacja tylko przez parametry „wzrost %/rok”,
- brak synca w v1, brak wywołań sieciowych; jedyny automatyczny check to `test/calc.check.js`,
- wykresy bez biblioteki (inline SVG),
- brak blokady edycji „przeszłych” miesięcy — to symulator, nie śledzenie realnego kredytu.
