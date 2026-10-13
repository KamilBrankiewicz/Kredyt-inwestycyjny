# Specyfikacja: Kalkulator opłacalności kredytu inwestycyjnego

> Samodzielna aplikacja (własne repo, własny adres na GitHub Pages) zbudowana **w stylu
> Licznika Kalorii**. Specyfikacja łączy dwa źródła:
>
> - **Licznik Kalorii** — *jak budujemy*: stack, warstwy, dane, PWA, proces. Szczegóły
>   w [SZABLON-APLIKACJI-OSOBISTEJ.md](SZABLON-APLIKACJI-OSOBISTEJ.md) (dalej „§N szablonu”).
>   Skopiuj go do nowego repo razem z tym plikiem.
> - **Specyfikacja z Celovio (moduł hipoteczny)** — *co i jak liczymy*: konwencje
>   finansowe, scenariusze w jednej pętli, zasady projektowe UI i lekcje z błędów
>   (oznaczone ⚠).
>
> Stan na: 2026-10-13 (Licznik Kalorii v65).

---

## 0. Co skąd wzięto — i co odrzucono

| Obszar | Decyzja | Źródło | Dlaczego |
|---|---|---|---|
| Stack | vanilla JS + CSS + HTML, IIFE na `window`, **bez kroku budowania** | Licznik | aplikacja „w stylu Licznika”; deployment = `git push` |
| React, TypeScript, Vite, Tailwind, recharts, lucide, vite-plugin-pwa | **odrzucone** | Celovio | wymagają npm i builda; jeden kalkulator ich nie potrzebuje |
| ErrorBoundary | → globalny `error`/`unhandledrejection` z toastem | Celovio → wersja vanilla | ten sam efekt bez Reacta |
| Silnik jako czysta funkcja w osobnym pliku, „dziś” jako parametr | **przyjęte** | Celovio | ⚠ w hipotece silnik siedział w `useMemo` w 3000-linijkowym pliku i nie dało się go sprawdzić |
| Sprawdzenie silnika uruchamiane z Node (`node:assert`) | **przyjęte** | Celovio | jedyny automatyczny check w projekcie; błąd w liczbach jest cichy |
| `tsc --noEmit` | odrzucone | Celovio | wymaga npm; jego rolę przejmuje check silnika |
| Konwencja odsetek Actual/365, rata przeliczana co miesiąc, „lepkie” nadpisania stopy | **przyjęte** | Celovio | zgodność z harmonogramami banków, obsługa zmian WIBOR |
| Scenariusze liczone równolegle w jednej pętli | **przyjęte** | Celovio | porównanie wariantów bez dodatkowych przebiegów |
| Wspólny horyzont, podatek nigdy ujemny | **przyjęte** | Celovio | ⚠ dwa realne błędy z hipoteki |
| Zasady projektowe UI (werdykt z przyczyną, max 4 zakładki, spokojne ostrzeżenia…) | **przyjęte** | Celovio | profil użytkownika |
| Wygląd: zmienne CSS, ciemny/jasny, mobile-first, dolny pasek | **przyjęte** | Licznik | „w stylu Licznika” |
| Zapis: kolekcja scenariuszy z `id`/`updatedAt`/nagrobkami | **przyjęte** | Licznik | gotowe pod sync bez migracji |
| Pole `version` + `migrate()`, walidacja importu przed zapisem | **przyjęte** | Celovio | ⚠ import bez walidacji, „na sztywno” wpisana marża |
| Usuwanie z toastem „Cofnij” | **przyjęte** | Licznik | szybsze niż modal; modal tylko dla „Wyczyść wszystko” |
| PIN / autoblokada | odrzucone | Celovio | tylko parametry symulacji; ⚠ jeśli kiedyś: hash przez `crypto.subtle` |
| Blokada edycji „przeszłych” miesięcy | odrzucone na start | Celovio | to kalkulator, nie śledzenie realnego kredytu (§1, D3) |
| Firebase sync, Gemini | **opcjonalne, późne etapy** | Licznik | v1 nie wykonuje żadnych wywołań sieciowych |

---

## 1. Cel aplikacji

Odpowiedzieć na jedno pytanie: **czy inwestycja finansowana kredytem zarabia więcej, niż
kosztuje kredyt — i przy jakich warunkach przestaje?**

Wynik to:
1. jeden werdykt liczbowy: zysk/strata netto po podatkach na wspólnym horyzoncie,
2. z przyczyną: *„Inwestycja przegrywa, bo stopa zwrotu 6,0% < koszt kredytu po podatku 6,8%”*,
3. porównanie z wariantami bez kredytu,
4. progi rentowności: przy jakim WIBOR i przy jakiej stopie zwrotu wynik spada do zera.

---

## 2. Decyzje do potwierdzenia przed startem

| # | Pytanie | Przyjęte domyślnie |
|---|---|---|
| D1 | Typ inwestycji | Jeden silnik dla trzech typów; różnią się tylko trybem podatku (§6.3): **a)** firmowa (maszyna, lokal), **b)** nieruchomość na wynajem, **c)** inwestowanie lewarowane (ETF/obligacje). |
| D2 | Sync między urządzeniami | Nie w v1. Eksport/import JSON. Firebase jako etap opcjonalny; model danych jest na to gotowy od dnia 1. |
| D3 | Śledzenie realnego, spłacanego kredytu (historia, import harmonogramu z banku) | Nie. Kalkulator symulacji. Nadpisania stopy służą scenariuszom „co jeśli”. |
| D4 | Transze wypłaty kredytu | Nie w v1. Karencja tak. |
| D5 | Stopy WIBOR/WIRON | Wpisywane ręcznie, z datą notowania. Brak darmowego API bez klucza. |
| D6 | Waluta | Tylko PLN. |
| D7 | Adres | `kamilbrankiewicz.github.io/<repo>`. **Wspólny origin z Licznikiem**, więc obowiązuje §5. |

---

## 3. Zasady

### 3.1 Budowa (z Licznika, §1 szablonu)

1. **Jeden użytkownik**: bez kont, ról, paginacji, i18n.
2. **Zero kosztów**: GitHub Pages, w v1 żadnych usług zewnętrznych.
3. **Zero kroku budowania**: pliki w repo = pliki w przeglądarce. Brak `package.json`.
   Node służy wyłącznie do uruchomienia checka silnika (§10.1).
4. **Offline-first, localStorage jako źródło prawdy.**
5. **Wyłącznie po polsku, mobile-first.**
6. **Wyniki są pochodne, nigdy zapisywane.** Zapisujemy tylko parametry; harmonogram
   i wskaźniki liczymy przy każdym odczycie. Poprawka wzoru naprawia wszystkie zapisane
   scenariusze naraz.

### 3.2 Projektowe (z Celovio, filtr dla każdej funkcji)

1. **Dane i przyczyny zamiast motywacji.** Werdykt = liczba + delta + „dlaczego”. Żadnych
   haseł, odznak, konfetti.
2. **Jeden wniosek i jeden następny krok na górze** ekranu wyników; karty pomocnicze niżej,
   nie 10 kart równej wagi.
3. **Mało równoległych elementów.** Max 4 zakładki w dolnym pasku. Rzadko używane parametry
   (prowizje, karencja, nadpisania stóp, stress) w zwijanych sekcjach „Zaawansowane”.
4. **Ustrukturyzowane pola zamiast pustych.** Liczby, listy wyboru, daty. Jedyny tekst
   swobodny to nazwa i notatka scenariusza.
5. **Porównania tylko z własnymi wariantami**, nigdy z „innymi użytkownikami”.
6. **Spokojne ostrzeżenia.** Np. DSCR < 1,2 jako rzeczowa informacja w kolorze `--warning`.
7. **Konsolidacja ponad mnożenie.** Nowa funkcja najpierw próbuje wejść w istniejący widok.
   Nieużywana funkcja jest usuwana, nie ukrywana.
8. **Przejrzystość obliczeń.** Każdą liczbę z ekranu wyników da się odtworzyć ze wzorów
   w widoku „Jak to liczymy?” i w `docs/CALCULATIONS.md`.
9. **Każde pole ma sensowną wartość domyślną.** Pierwsze uruchomienie od razu pokazuje wynik.

---

## 4. Struktura repozytorium i warstwy

```
/
├── index.html            # cały SPA: widoki + modale
├── manifest.json         # start_url i scope względne ("./")
├── sw.js                 # CACHE_NAME = 'kredyt-inwestycyjny-v1'
├── css/style.css         # zmienne CSS, ciemny/jasny (paleta Licznika)
├── js/
│   ├── app.js            # WYŁĄCZNIE addEventListener → UI.*; globalny handler błędów; rejestracja SW
│   ├── ui.js             # renderowanie, formularz, walidacja, formatowanie, wykres SVG
│   ├── storage.js        # jedyny właściciel localStorage (klucze z prefiksem, §5)
│   └── calc.js           # silnik: czysta funkcja calculate(inputs, today) → wynik
├── test/calc.check.js    # node test/calc.check.js — asserty silnika (poza APP_SHELL)
├── icons/icon.svg
├── docs/
│   ├── ARCHITECTURE.md   # jak działa i dlaczego (z sekcją „Świadome ograniczenia”)
│   ├── CALCULATIONS.md   # model finansowy: konwencje, scenariusze, kolejność kroków, uproszczenia
│   ├── MAINTENANCE.md    # checklista (z Licznika, zmiany w §10.2)
│   ├── CHANGELOG.md
│   └── SZABLON-…, SPEC-… (ten plik)
├── CLAUDE.md, PLAN.md
└── .claude/launch.json   # npx serve .
```

```
index.html → app.js → ui.js → calc.js          (liczy; zero DOM, zero Storage)
                        ↓
                    storage.js → localStorage  (zapisuje tylko parametry)
```

### 4.1 Reguły `calc.js`

- Wystawia `calculate(inputs, today)` i pomocnicze `pmt`, `irr`, `npv`, `solve` (bisekcja).
- **Zero efektów ubocznych.** Nie dotyka DOM, `Storage`, sieci. Nie woła `new Date()`:
  „dziś” przychodzi jako parametr `today` (`YYYY-MM-DD`), więc wyniki są deterministyczne.
- Nie formatuje liczb do wyświetlania; to robi `ui.js`.
- Ten sam plik działa w przeglądarce i w Node, bez builda:

```javascript
const Calc = (() => {
  // ...
  return { calculate, pmt, irr, npv, solve };
})();
if (typeof module === 'object') module.exports = Calc; // Node: test/calc.check.js
```

- Kolejność `<script>`: `storage.js`, `calc.js`, `ui.js`, `app.js`.
- Nowy plik JS trafia w trzy miejsca naraz: `<script>`, `APP_SHELL`, drzewko w ARCHITECTURE.md.
- `ui.js` dzielimy dopiero, gdy przekroczy ~1500 linii albo dwa widoki zaczną współdzielić
  komponenty.

---

## 5. ⚠ Wspólny origin z Licznikiem Kalorii — zasady obowiązkowe

Wszystkie repozytoria na `kamilbrankiewicz.github.io/*` dzielą **jeden origin**, a więc
jeden localStorage, jeden Cache Storage i jedno IndexedDB. Dwie aplikacje Kamila będą
widziały nawzajem swoje dane.

1. **Każdy klucz localStorage z prefiksem** `kredyt.` (`kredyt.scenarios`,
   `kredyt.settings`, `kredyt.draft`, `kredyt.theme`). Licznik używa kluczy bez prefiksu
   (`settings`, `themePreference`), więc bez prefiksu nowa aplikacja nadpisze mu ustawienia.
   Prefiks żyje w jednej stałej w `storage.js`; dotyczy to też inline skryptu motywu w `<head>`.
2. **Nigdy `localStorage.clear()`.** „Wyczyść dane” usuwa tylko klucze z prefiksem.
3. **Service worker czyści wyłącznie własne cache:**
   ```javascript
   names.filter((n) => n.startsWith('kredyt-inwestycyjny-') && n !== CACHE_NAME)
   ```
   Kod SW z §5.2 szablonu i obecny `sw.js` Licznika kasują *każdy* cache o innej nazwie,
   czyli przy aktualizacji jedna aplikacja zabija offline drugiej. **Licznik wymaga tej
   samej poprawki**: osobna zmiana w jego repo, z bumpem wersji.
4. SW rejestrowany ścieżką względną (`register('sw.js')`). Jego scope to wtedy `/<repo>/`
   i nie przechwytuje żądań Licznika.
5. Manifest z `start_url: "./index.html"` i `scope: "./"`. Każda aplikacja instaluje się
   jako osobna PWA.
6. (Etap Firebase) Jeśli obie aplikacje użyją tego samego projektu Firebase, współdzielą
   sesję logowania. To jest akceptowalne, ale dane w Firestore muszą mieć osobne drzewo
   (`users/{uid}/kredyt/...`) i osobne reguły.

---

## 6. Silnik obliczeń

### 6.1 Konwencje finansowe (z modułu hipotecznego Celovio)

| Konwencja | Reguła |
|---|---|
| Stopa | zmienna = WIBOR/WIRON + marża; stała jako opcja. Stopy w % rocznych (7.5 = 7,5%) |
| Odsetki | **Actual/365** od salda na początek okresu: `saldo × stopa/100 × dni_okresu/365` |
| Rata równa | `PMT = saldo × r / (1 − (1+r)^(−n))`, `r = stopa/100/12`; przy `r = 0` → `saldo / n`. **Przeliczana co miesiąc** od bieżącego salda i pozostałej liczby rat. Kapitał = PMT − odsetki(Actual/365) |
| Rata malejąca | kapitał stały `kwota / n`, odsetki Actual/365. Typowa dla kredytów firmowych |
| Karencja | przez `graceMonths` płacone same odsetki, potem spłata na `n − graceMonths` |
| Dzień płatności | clamp do 1–28 |
| Nadpisania stopy | „lepkie”: `rateOverrides['YYYY-MM']` obowiązuje od tego miesiąca do następnego nadpisania |
| Ostatnia rata | koryguje resztę, by saldo zeszło dokładnie do 0 |
| Zaokrąglanie | obliczenia na pełnej precyzji `Number`; zaokrąglenie tylko przy wyświetlaniu |
| Podatek | **nigdy ujemny**: od straty wynosi 0 (⚠ błąd „ujemnego podatku” w hipotece) |
| Horyzont | **wspólny dla wszystkich scenariuszy**, jawny parametr, pokazany przy werdykcie (⚠ inwestycja „procentowała” dłużej niż kredyt i zawyżała wynik) |
| Koniec horyzontu | wartość końcowa inwestycji minus koszty wyjścia minus **saldo kredytu do spłaty** |

### 6.2 Kolejność kroków w miesiącu (spisana też w `CALCULATIONS.md`)

1. daty okresu (od poprzedniego do bieżącego dnia płatności) i liczba dni,
2. stopa obowiązująca (bazowa → nadpisanie lepkie → stress),
3. odsetki Actual/365,
4. rata (PMT od bieżącego salda albo kapitał stały; w karencji same odsetki),
5. kapitał, nowe saldo,
6. przepływy inwestycji (przychód × (1 − pustostan) − koszty; indeksacja co 12 mies.;
   zero przez `startDelayMonths`),
7. podatek wg trybu (§6.3),
8. zapis wiersza dla każdego scenariusza.

### 6.3 Tryby podatku (`taxMode`, stawka wpisywana przez użytkownika)

| Tryb | Typ inwestycji (D1) | Podstawa | Odsetki kosztem? |
|---|---|---|---|
| `none` | — | — | — |
| `revenue` | b) ryczałt od najmu | przychód | nie |
| `income` | a) PIT liniowy / CIT | przychód − koszty − odsetki − amortyzacja | tak (tarcza podatkowa) |
| `capital_gain` | c) Belka | zysk przy wyjściu, raz na końcu horyzontu | nie |

`ponytail:` jedna efektywna stawka bez progów, składki zdrowotnej, VAT i rozliczania strat
z lat poprzednich. Precyzyjny PIT/CIT jest świadomie poza zakresem; ten sufit trafia do
„Znanych uproszczeń”.

### 6.4 Scenariusze liczone w jednej pętli

Każdy scenariusz ma własne saldo i sumy, a pętla po miesiącach jest jedna.

| # | Scenariusz | Po co |
|---|---|---|
| 1 | Inwestycja z kredytem (główny) | wynik netto, harmonogram, wykres |
| 2 | Bez inwestycji: wkład własny na stopie alternatywnej (z Belką) | koszt alternatywny, punkt odniesienia werdyktu |
| 3 | Inwestycja bez kredytu (tylko za wkład, proporcjonalnie mniejsza skala) | efekt dźwigni |
| 4 | Stress stopy: od daty X stopa + Y p.p. | maks. rata, wynik przy wyższym WIBOR |
| 5 | Stress przepływów: przychód − Z% | odporność na spadek przychodu |

Wynik silnika: `{ rows: MonthRow[], summary: Summary, chart: ChartPoint[], warnings: string[] }`.

### 6.5 Wyniki (`summary`)

- **Zysk netto na horyzoncie** (scen. 1) i **delta vs scen. 2**, czyli werdykt.
- **Przyczyna werdyktu**: porównanie stopy zwrotu inwestycji z kosztem kredytu po podatku.
- **IRR** kapitału własnego (rocznie: `(1 + irr_m)^12 − 1`) i **NPV** przy stopie dyskontowej
  = stopa alternatywna.
- **ROE z dźwignią vs bez** (scen. 1 vs 3).
- **Rzeczywisty koszt kredytu**: odsetki + prowizja + koszty stałe − tarcza podatkowa
  (jeśli `income`). Do tego **RRSO** do porównywania ofert banków; to ta sama funkcja `irr`
  na przepływach kredytu, więc kosztuje jedną linijkę.
- **DSCR** (przepływ operacyjny / rata): minimum i liczba miesięcy z DSCR < 1.
- **Okres zwrotu wkładu**: pierwszy miesiąc ze skumulowanym przepływem ≥ 0, albo
  „nie zwraca się w horyzoncie”.
- **Progi rentowności** (bisekcja na całym silniku): maks. stopa bazowa kredytu oraz min.
  stopa zwrotu inwestycji, przy których wynik = 0.

**Pierwiastki** (IRR, RRSO, progi) liczymy bisekcją na przedziale, sprawdzając zmianę znaku na
krańcach. Brak zmiany znaku → `null` i komunikat „nie da się wyznaczyć”, nigdy `NaN`.
Kierunek zawężania zależy od znaku pierwszego przepływu, dlatego zawsze sprawdzamy go
przypadkiem w checku. Bez Newtona, bez bibliotek.

---

## 7. Parametry wejściowe (domyślne w jednym obiekcie `DEFAULTS` w `storage.js`)

| Grupa | Pola | Sekcja |
|---|---|---|
| Kredyt | `amount`, `startMonth` (YYYY-MM), `months`, `rateType` (`variable`/`fixed`), `baseRate`, `baseRateDate`, `margin`, `installmentType` (`annuity`/`decreasing`), `paymentDay` | główna |
| Kredyt: zaawansowane | `feePct`, `feeFixed`, `feeFinanced`, `graceMonths`, `insuranceMonthly`, `rateOverrides` | zwijana |
| Inwestycja | `investmentCost`, `ownContribution`, `monthlyRevenue`, `monthlyCosts`, `horizonMonths` (domyślnie = `months`), `exitValue` | główna |
| Inwestycja: zaawansowane | `vacancyPct`, `revenueGrowthPct`, `costGrowthPct`, `startDelayMonths`, `exitCostsPct`, `depreciationMonthly` | zwijana |
| Podatek i alternatywa | `taxMode`, `taxRate`, `alternativeRate` | główna |
| Stress | `stressRateFrom` (YYYY-MM), `stressRatePp`, `stressRevenuePct` | zwijana |

Walidacja (w `ui.js`, komunikat pod polem, wyniki pokazują ostatni poprawny stan wyszarzony):
kwoty ≥ 0, `months` 1–420, `paymentDay` clamp 1–28. Gdy `amount + ownContribution <
investmentCost` → ostrzeżenie, nie blokada.

---

## 8. Dane

### 8.1 localStorage (wszystko z prefiksem `kredyt.`, §5)

| Klucz | Zawartość | Eksport / sync |
|---|---|---|
| `kredyt.scenarios` | `Scenario[]` z nagrobkami | tak / tak |
| `kredyt.settings` | domyślne założenia (`taxMode`, `taxRate`, `alternativeRate`, stress) + `updatedAt` | tak / tak |
| `kredyt.draft` | bieżący stan formularza, autozapis przy każdej zmianie | nie / nie |
| `kredyt.theme` | `auto`/`dark`/`light` | nie / nie |

```javascript
Scenario = {
  id: string,            // crypto.randomUUID()
  name: string,
  notes?: string,
  inputs: { ...pola z §7 },   // tylko parametry, nigdy wyniki
  createdAt: string,     // ISO 8601
  updatedAt: string      // ISO 8601, przy KAŻDYM zapisie
}
// nagrobek: { id, deleted: true, updatedAt }
```

### 8.2 Zasady nienaruszalne (Licznik + lekcje Celovio)

1. **Nagrobki** przy usuwaniu scenariusza, od v1 (sync później bez migracji).
2. **`updatedAt` przy każdym zapisie**; merge przez `mergeListBy` z Licznika.
3. **Wsteczna zgodność przez jeden `DEFAULTS`:** `const inputs = { ...DEFAULTS, ...saved.inputs }`
   przy każdym odczycie i imporcie. ⚠ Brakujące pole nigdy nie dostaje wartości „na sztywno”
   w miejscu użycia (błąd z marżą 1,74% w hipotece). Domyślna wartość nowego pola musi
   zachowywać dotychczasowy wynik (np. nowy koszt = 0).
4. **Odczyt odporny na śmieci:** `JSON.parse` w `try`, uszkodzony klucz → `DEFAULTS` + toast.
   Aplikacja startuje z pustego i z uszkodzonego storage.
5. **Zapis w `try`:** `QuotaExceededError` → toast „Brak miejsca w pamięci przeglądarki”
   (wzorzec `storage.js` Licznika).
6. **Eksport JSON** (`kredyt-inwestycyjny-RRRR-MM-DD.json`, Blob + `URL.createObjectURL`)
   z polem `version: 1`. **Import:** `<input type="file">` + `FileReader`, `JSON.parse`
   (nigdy wykonywany), potem `migrate(data)`, potem **walidacja typów kluczowych pól**.
   Błąd walidacji → komunikat inline w Ustawieniach, stan nietknięty. Sukces → `mergeListBy`
   (tryb „scal”). Nigdy `alert()`.
7. Zmiana kształtu niezgodna wstecz → `version: 2` + krok w `migrate()`. Migracja
   nie niszczy danych źródłowych.

---

## 9. Interfejs

### 9.1 Wygląd (Licznik)

Zmienne CSS na `:root`, ciemny domyślnie, jasny przez `prefers-color-scheme` + ręczny
przełącznik, inline skrypt motywu w `<head>` (czyta `kredyt.theme`), font systemowy,
`#app { max-width: 480px }` na telefonie. Semantyka kolorów: zysk `--accent` (zielony),
strata `--danger`, ostrzeżenie `--warning`. **Kolor nigdy nie jest jedynym nośnikiem
informacji**: zawsze znak +/− albo etykieta.

Odstępstwo od Licznika: jeden breakpoint `@media (min-width: 900px)`, gdzie parametry
siedzą w lewej kolumnie, a wyniki w prawej. Kalkulator będzie częściej otwierany na laptopie
niż dziennik posiłków.

### 9.2 Nawigacja: max 4 zakładki w dolnym pasku

| Zakładka | Zawartość |
|---|---|
| **Wynik** | Na górze karta werdyktu: zysk/strata netto, delta vs alternatywa, przyczyna, horyzont, **jeden następny krok** (np. „Sprawdź próg WIBOR w Wrażliwości”). Pod nią pasek skrótu parametrów („300 000 zł · 10 lat · 7,1% · najem 2 800 zł”); tap otwiera arkusz parametrów z sekcjami i przyciętym werdyktem przyklejonym u góry, przeliczanym na żywo. Niżej karty pomocnicze (IRR/NPV, ROE z/bez dźwigni, koszt kredytu + RRSO, DSCR, zwrot wkładu) i wykres SVG. |
| **Harmonogram** | Tabela miesięcy (domyślnie zwinięta do lat), przewijana poziomo **w swoim kontenerze**. Edycja inline stopy w wierszu tworzy nadpisanie lepkie. |
| **Wrażliwość** | Scenariusze 4–5 (stress), progi rentowności, siatka wynik vs (stopa kredytu × stopa zwrotu) z zaznaczeniem linii zera. |
| **Scenariusze** | Zapisane scenariusze: nazwa, data, wynik netto. Tap wczytuje scenariusz do kalkulatora. Zaznaczenie 2–3 → tabela porównawcza. Usuwanie z toastem „Cofnij”. |

W nagłówku dwie ikony zamiast kolejnych zakładek: **„?” → Jak to liczymy?** (wzory, kolejność
kroków, mały kalkulator testowy raty, stopka *„Symulacja edukacyjna, nie stanowi
rekomendacji inwestycyjnej”*) i **⚙ → Ustawienia** (domyślne założenia, motyw,
eksport/import, „Wyczyść dane” z modalem potwierdzenia, znacznik **„vN”** bumpowany razem
z `CACHE_NAME`).

Akcja główna (FAB na Wyniku): **Zapisz scenariusz**.

### 9.3 Liczby i język

- Pola liczbowe: `<input type="text" inputmode="decimal">` + jeden parser
  `parsePlnNumber` w `ui.js` (spacje, `zł`, przecinek → `Number`). Nie `type="number"`,
  bo ten typ w polskiej lokalizacji różnie znosi przecinek i spacje tysięcy. Miesiące
  `<input type="month">`, daty `<input type="date">`.
- Kwoty na kartach: `Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN',
  maximumFractionDigits: 0 })`; w harmonogramie 2 miejsca. Jedna instancja formattera
  na format.
- `plural(n, 'rok', 'lata', 'lat')` + `formatMonths(n)` → „1 rok”, „2 lata”, „5 lat i 3 miesiące”.
- Daty po ludzku tam, gdzie to ma sens („od marca 2027”).
- `escapeHtml()` przy nazwie i notatce scenariusza w `innerHTML`.

### 9.4 Interakcje i błędy

- Przeliczenie przy każdym `input` (bez przycisku „Oblicz”).
- Toast przy zapisie i błędzie. Usunięcie scenariusza: natychmiast + „Cofnij”.
  „Wyczyść dane”: modal potwierdzenia (nie `confirm()`).
- Globalny handler w `app.js` (zamiennik ErrorBoundary):
  `window.addEventListener('error' | 'unhandledrejection', …)` → toast *„Coś poszło nie tak.
  Twoje dane są bezpieczne w przeglądarce.”* + `console.error`. Licznik ma już
  `unhandledrejection` dla pełnej pamięci; tu rozszerzamy go o ogólny przypadek.

### 9.5 Wykres

Inline SVG generowany w `ui.js`: saldo kredytu i skumulowany przepływ właściciela (scen. 1
vs 2), z wyróżnioną linią zera i działający w obu motywach. Bez biblioteki. Gdyby kiedyś
potrzebna była interaktywność, dokładamy jedną bibliotekę vendored jako plik w repo
i w `APP_SHELL` (§12 szablonu), nigdy CDN w runtime.

---

## 10. Weryfikacja

### 10.1 `test/calc.check.js` (jedyny check automatyczny)

Uruchamiany `node test/calc.check.js`. Wystarczy Node, bez npm. Używa `node:assert`
z tolerancją. Wartości policzone niezależnie:

| Przypadek | Oczekiwane |
|---|---|
| PMT: 100 000 zł, 6%, 120 mies. | **1 110,21 zł** |
| PMT: 500 000 zł, 6%, 300 mies. | **3 221,51 zł** |
| Odsetki Actual/365: 100 000 zł, 6%, 31 dni | **509,59 zł** |
| Harmonogram (oba typy rat, z karencją) | suma kapitału = kwota kredytu (±0,01), saldo końcowe = 0 |
| Stopa 0% | rata = saldo / n, brak `NaN`/`Infinity` |
| `irr([-100, 110])` | **10%** |
| Przepływy bez zmiany znaku | `irr` → `null`, bez wyjątku |
| RRSO: 100 000 zł, rata 1 110,205 × 120, bez prowizji | **6,17%** |
| j.w., prowizja 2% gotówką (wypłata netto 98 000 zł) | **6,64%** |
| Strata w roku | podatek = 0 |
| `horizonMonths` < `months` | saldo kredytu na koniec horyzontu odjęte od wyniku |
| Ten sam `inputs` + `today` dwa razy | identyczny wynik (determinizm) |

Każda zmiana w `calc.js` → check przechodzi. Nowy wzór → nowy przypadek.

### 10.2 `docs/MAINTENANCE.md`: kopia z Licznika ze zmianami

- **C1 (zawsze):** bump `CACHE_NAME` + „vN” w HTML. Dodatkowo `node test/calc.check.js`,
  jeśli ruszano `calc.js`.
- **C2 regresja rdzenia (zawsze):** pierwszy start na pustym storage pokazuje wynik;
  zmiana parametru przelicza wynik; F5 nie gubi szkicu; zapis scenariusza → F5 → jest;
  usunięcie + „Cofnij”; porównanie 2 scenariuszy; przełączenie 4 zakładek; widok 375 px
  i ≥ 900 px; oba motywy.
- **C3, zmiana `calc.js`:** jeden przypadek ręcznie porównany z publicznym kalkulatorem
  raty banku.
- **C3, zmiana modelu danych:** start ze scenariuszami sprzed zmiany daje wyniki
  **identyczne** jak przed zmianą; eksport → import; import uszkodzonego pliku daje
  komunikat i stan nietknięty.
- **C3, wspólny origin:** po zmianach w storage/SW otwórz Licznik na tym samym originie.
  Jego ustawienia są nietknięte, a offline obu aplikacji działa.
- **Diagnostyka (wiersze dodatkowe):**

| Objaw | Przyczyna |
|---|---|
| `NaN`/`Infinity` w wynikach | pole spoza `DEFAULTS`, nieprzekonwertowany przecinek, `r = 0` bez gałęzi |
| Saldo końcowe ≠ 0,00 | brak korekty ostatniej raty |
| IRR/RRSO absurdalne | odwrócony kierunek bisekcji |
| Stary scenariusz liczy się inaczej po aktualizacji | domyślna wartość nowego pola nie jest neutralna |
| Licznik stracił ustawienia / motyw | klucz bez prefiksu `kredyt.` |
| Jedna z aplikacji nie startuje offline po aktualizacji drugiej | SW kasuje cudze cache (§5.3) |

---

## 11. Dokumentacja (system z Licznika + `CALCULATIONS.md` z Celovio)

| Plik | Rola |
|---|---|
| `CLAUDE.md` | zasady nienaruszalne: §3.1, §5, §8.2, reguły `calc.js` (§4.1), bump wersji |
| `docs/ARCHITECTURE.md` | warstwy, dane, SW, **„Świadome ograniczenia”** (lista niżej) |
| `docs/CALCULATIONS.md` | konwencje (§6.1), kolejność kroków (§6.2), tryby podatku, tabela scenariuszy, wzory, „Znane uproszczenia” z datą, mapa funkcji `calc.js`. Cel: obliczenia da się zmieniać bez czytania całego kodu |
| `docs/MAINTENANCE.md` | checklista (§10.2) |
| `docs/CHANGELOG.md`, `PLAN.md` | jak w Liczniku |

Świadome ograniczenia (start):
- brak automatycznego pobierania WIBOR/WIRON i stawek podatkowych,
- podatek jako jedna efektywna stawka, bez VAT, składki zdrowotnej i progów,
- brak transz, nadpłat, kredytów walutowych, śledzenia realnej spłaty,
- inflacja tylko przez parametry „wzrost %/rok”,
- brak synca w v1; jedyny automatyczny check to `test/calc.check.js`,
- brak wywołań sieciowych w v1.

Jeśli któreś ma się zmienić, to decyzja użytkownika, nie zmiana z własnej inicjatywy.

---

## 12. Etapy (do `PLAN.md`)

Każdy etap kończy się wdrożoną wersją przetestowaną w przeglądarce.

| Etap | Zakres | Gotowe, gdy |
|---|---|---|
| 1. Szkielet | §11 szablonu + §5 (prefiksy, SW z filtrem cache), motyw, 4 zakładki, „v1”, Pages | apka instaluje się obok Licznika, oba działają offline, Licznik nietknięty |
| 2. Silnik: kredyt | `pmt`, harmonogram Actual/365, raty równe/malejące, karencja, prowizja, nadpisania, RRSO, check | wiersze kredytowe §10.1 przechodzą |
| 3. Wynik | formularz + `DEFAULTS` + `draft`, przepływy, podatek, scen. 1–3, werdykt z przyczyną, karty | pierwszy start pokazuje sensowny wynik; jeden przypadek zgodny z arkuszem |
| 4. Harmonogram | tabela, zwijanie do lat, edycja stopy inline | suma kapitału = kwota |
| 5. Wrażliwość | scen. 4–5, progi (bisekcja), siatka, wykres SVG | poprawne w obu motywach na 375 px i 900 px |
| 6. Scenariusze | zapis, lista, porównanie, nagrobki + „Cofnij”, eksport/import z walidacją i `migrate` | eksport → „Wyczyść dane” → import przywraca wszystko; zły plik → komunikat |
| 7. Jak to liczymy? | widok wzorów + kalkulator testowy, `CALCULATIONS.md` kompletne | każda liczba z Wyniku odtwarzalna ze wzorów |
| 8. (opcj.) Sync | Firebase wg §4 szablonu + `users/{uid}/kredyt/...` (§5.6) | test zmartwychwstania, drugi sync bez zapisów |
