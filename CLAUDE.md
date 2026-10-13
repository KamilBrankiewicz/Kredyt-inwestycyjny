# Kredyt na ziemię — zasady

Kalkulator opłacalności kredytu na zakup ziemi rolnej. Vanilla JS + CSS + HTML, bez kroku budowania,
GitHub Pages. Szczegóły: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), model: [docs/CALCULATIONS.md](docs/CALCULATIONS.md),
checklista: [docs/MAINTENANCE.md](docs/MAINTENANCE.md).

## Zasady nienaruszalne

1. **Bez builda i npm.** Pliki w repo = pliki w przeglądarce. Node tylko do `node test/calc.check.js`.
2. **Warstwy:** `app.js` tylko `addEventListener` → `UI.*`; `ui.js` render i walidacja, nie dotyka localStorage;
   `storage.js` jedyny właściciel localStorage; `calc.js` czyste funkcje — zero DOM, Storage, sieci i `new Date()`
   (`today` jako parametr), nie formatuje liczb.
3. **Wspólny origin z Licznikiem Kalorii:** każdy klucz localStorage z prefiksem `kredyt.`; nigdy `localStorage.clear()`;
   SW kasuje wyłącznie cache `kredyt-inwestycyjny-*`; SW rejestrowany ścieżką względną.
4. **Zapisujemy tylko parametry, nigdy wyniki.** Odczyt zawsze przez `{ ...DEFAULTS, ...saved }`; nowe pole dostaje
   w `DEFAULTS` wartość, która nie zmienia wyników starych scenariuszy. Nigdy wartości „na sztywno” w miejscu użycia.
5. **Nagrobki i `updatedAt`** przy każdym zapisie/usunięciu scenariusza. Import: parse → `migrate` → walidacja → merge.
6. **Każda zmiana `calc.js`** → `node test/calc.check.js` przechodzi; nowy wzór → nowy przypadek w checku
   i opis w CALCULATIONS.md.
7. **Bump `CACHE_NAME` w `sw.js` i „vN” w `index.html`** przy każdej zmianie JS/CSS/HTML. Nowy plik JS: `<script>`,
   `APP_SHELL`, drzewko w ARCHITECTURE.md.
8. `escapeHtml()` przy każdym tekście użytkownika w `innerHTML`.
9. UI po polsku, mobile-first, max 4 zakładki, kolor nigdy jedynym nośnikiem informacji.

Świadome ograniczenia (ARCHITECTURE.md) to decyzje użytkownika — nie „naprawiaj” ich z własnej inicjatywy.
