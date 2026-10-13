# Model obliczeń

Cel: obliczenia da się zmieniać bez czytania całego kodu. Każda liczba z ekranu Wynik wynika z tego pliku.
Kod: [`js/calc.js`](../js/calc.js), sprawdzenie: `node test/calc.check.js`.

## Konwencje

| Konwencja | Reguła |
|---|---|
| Oprocentowanie | stopa referencyjna (WIBOR/WIRON) + marża; nigdy poniżej 0. Stopy w % rocznie (7.5 = 7,5%) |
| Odsetki | **Actual/365**: `saldo × oprocentowanie/100 × dni/365`, naliczane miesiąc po miesiącu od dnia płatności do dnia płatności |
| Częstotliwość rat | co 1, 3, 6 albo 12 miesięcy; rata płatna w miesiącu `m`, gdy `m % częstotliwość = 0`. Odsetki między ratami się sumują |
| Rata równa | `R = S × r / (1 − (1+r)^−n)`, `r = oprocentowanie/100 × częstotliwość/12`, `n` = pozostałe raty, `S` = bieżące saldo. **Przeliczana przy każdej racie.** Kapitał = R − odsetki (Actual/365), w granicach [0, saldo]. Przy `r = 0`: `R = S / n` |
| Rata malejąca | kapitał = saldo / pozostałe raty (stały), do tego odsetki |
| Karencja | raty w miesiącach `m ≤ karencja`: *same odsetki* albo *kapitalizacja* (rata 0, odsetki doliczane do salda). Potem spłata kapitału na pozostałe raty. Karencja przycinana do `okres − częstotliwość` |
| Dzień płatności | 1–28 |
| Zmiany stopy | „lepkie”: `rateOverrides['YYYY-MM'] = stopa referencyjna` obowiązuje od okresu odsetkowego zaczynającego się w tym miesiącu do następnej zmiany. Edycja w harmonogramie zapisuje zmianę od początku okresu odsetkowego tej raty |
| Ostatnia rata | spłaca całe saldo |
| Zaokrąglanie | tylko przy wyświetlaniu |
| Podatek | brak podatku dochodowego; podatek rolny to koszt w dochodzie z ha. Belka (19%) tylko w stopie alternatywnej |
| Horyzont | wspólny dla wszystkich wskaźników; domyślnie = okres kredytu. Na końcu horyzontu odejmujemy saldo kredytu do spłaty |

## Oś czasu

- `m = 0` — miesiąc zakupu i uruchomienia kredytu (`startMonth`). Wypływ gotówki: wkład + koszty zakupu (+ prowizja, jeśli nie jest kredytowana).
- `m = 1 … max(okres, horyzont)` — kolejne miesiące.
- Rok analizy `y` = miesiące `(12(y−1), 12y]` od zakupu. Każdy taki rok zawiera dokładnie jeden miesiąc żniw.

## Kolejność kroków w miesiącu (`simulate`)

1. Okres odsetkowy od dnia płatności w miesiącu `m−1` do dnia płatności w `m`, liczba dni.
2. Stopa obowiązująca w okresie: bazowa → zmiana lepka → stres (`+pp` od wskazanego miesiąca) → + marża, min. 0.
3. Odsetki Actual/365 doliczone do odsetek narosłych.
4. Jeśli to miesiąc raty: karencja albo spłata (rata równa / malejąca / ostatnia), odsetki narosłe zerowane.
5. Koszty kredytu: `koszty roczne / 12` co miesiąc, dopóki trwa kredyt.
6. Dochód: w miesiącu żniw `(przychód z ha × korekta roku + część stała z ha) × ha × (1 + wzrost)^k × mnożnik stresu`, `k` = numer żniw od 0.
7. Przepływ = dochód − rata − koszty kredytu; skumulowana gotówka; wartość ziemi `cena × (1 + wzrost ceny)^(m/12)`.
8. Majątek = ziemia − saldo − odsetki narosłe + skumulowana gotówka (też w wariancie bez wzrostu ceny ziemi).

## Dochód z ha

- tryb „z plonu”: `plon × cena − koszty bezpośrednie + dopłaty − podatek rolny`,
- tryb „kwotą”: wpisany dochód netto.

Część zmienna (przychód) = `plon × cena` w trybie „z plonu”, cały dochód netto w trybie „kwotą”; część stała = reszta
(`− koszty + dopłaty − podatek rolny`). **Korekta roku** `incomeYearPct['RRRR']` (w %) mnoży część zmienną żniw
w danym roku kalendarzowym: `max(0, 1 + korekta/100)`. Susza −50% obniża przychód o połowę, a koszty zostają.

## Wskaźniki (`summarize`)

| Wskaźnik | Definicja |
|---|---|
| Obsługa kredytu w roku | suma rat + koszty kredytu w roku analizy |
| Pokrycie (DSCR) | dochód w roku / obsługa kredytu w roku (tylko lata kredytu z obsługą > 0) |
| Werdykt | `ok`: min. pokrycie ≥ bufor; `warn`: 1 ≤ min. pokrycie < bufor; `bad`: < 1 |
| Wymagany dochód | najwyższa roczna obsługa kredytu × bufor; też na ha i na miesiąc |
| Plon progowy | `(wymagany dochód/ha + koszty − dopłaty + podatek rolny) / cena` (tryb „z plonu”) |
| Brakuje na raty | suma `obsługa − dochód` w latach, gdy dochód < obsługa |
| Zwrot gotówkowy | pierwszy miesiąc `m ≥ 1` w horyzoncie ze skumulowaną gotówką ≥ 0 |
| Zwrot z wartością ziemi | pierwszy miesiąc w horyzoncie z majątkiem ≥ 0; również bez wzrostu ceny ziemi |
| Bilans | majątek na koniec horyzontu (bez odsetek od gotówki) |
| NPV | przepływy miesięczne (`m = 0 … H`, w `H` dodane ziemia − dług) dyskontowane miesięcznym odpowiednikiem stopy alternatywnej po Belce |
| Zysk vs lokata | `NPV × (1 + r_m)^H`: różnica majątku po H względem trzymania każdej dołożonej złotówki (wkład, koszty, braki na raty) na stopie alternatywnej, z nadwyżkami odkładanymi tak samo |
| IRR | stopa miesięczna z NPV = 0, rocznie `(1 + irr)^12 − 1` |
| RRSO | IRR przepływów kredytu: `+ (cena − wkład)` w `m = 0`, potem `− (rata + koszty kredytu)`; rocznie jak IRR |
| Koszt kredytu | odsetki (suma rat − kwota kredytu, więc z odsetkami skapitalizowanymi) + prowizja + koszty kredytu |

## Scenariusze (`calculate`)

| Scenariusz | Opcje symulacji |
|---|---|
| Bazowy | — |
| Stres stopy | `ratePp = stressRatePp`, `rateFrom = stressRateFrom` (puste = od początku) |
| Stres dochodu | `incomeFactor = 1 − stressIncomePct/100` |

Każdy scenariusz to osobne wywołanie `simulate` (czysta funkcja). Szablon zakładał jedną wspólną pętlę; osobne przebiegi są prostsze i przy ~20 ms na całe `calculate` wystarczają.

## Symulacja zmiennych lat (`monteCarlo`)

- 500 wariantów, stałe ziarno (PRNG mulberry32), więc wynik jest deterministyczny.
- W każdym wariancie i każdym roku: część zmienna dochodu (już z korektą roku) × `max(0, 1 + σ·z)`, `z ~ N(0, 1)`
  (Box–Muller), lata niezależne. `σ = incomeVolatilityPct / 100`; `σ = 0` → brak symulacji (`mc = null`).
- Harmonogram kredytu nie zależy od dochodu, więc wariant = scenariusz bazowy + różnica dochodu `Δ_k` w żniwach `k`:
  gotówka i majątek przesuwają się o `Σ Δ` od miesiąca żniw, zysk vs lokata o `Σ Δ_k × (1 + r_m)^(H − m_k)`.
  Check porównuje tę metodę z pełną symulacją.
- Wyniki: udział wariantów ok / na granicy / nie spina się (min. pokrycie jak w werdykcie), udział z co najmniej
  jednym rokiem bez pokrycia, brak na raty, zysk vs lokata, zwroty — jako 10., 50. i 90. percentyl (interpolacja liniowa);
  percentyle dochodu w każdym roku oraz gotówki i majątku na koniec każdego roku; 5 przykładowych ścieżek dochodu.

## Progi (`thresholds`) i siatka (`grid`)

Kryterium: min. pokrycie = bufor. Bisekcja (`solve`) na całym silniku, do tolerancji:

| Próg | Zmienna | Przedział | Tolerancja |
|---|---|---|---|
| Stopa | równoległe przesunięcie od początku kredytu | od 0% we wszystkich miesiącach (z uwzględnieniem zmian stopy) do +30 pp | 0,001 pp |
| Cena za ha | `pricePerHa` | od `wkład/ha + 1` do 10× ceny | 1 zł |
| Wkład własny | `ownContribution` | od 0 do 99,9% ceny | 1 zł |

Brak zmiany znaku na krańcach → `value: null`, `reason: 'always'` (spina się w całym przedziale) albo `'never'`. Nigdy `NaN`.

Siatka: min. pokrycie dla przesunięć stopy −1…+4 pp × zmian dochodu −30…+30%. Pokrycie jest liniowe względem mnożnika dochodu, więc wystarcza jedna symulacja na wiersz.

## Znane uproszczenia (2026-10-13)

- Dochód netto wpływa w całości raz w roku; nie modelujemy kosztów ponoszonych w trakcie sezonu ani kredytu obrotowego.
- Stres dochodu obniża dochód netto (nie przychód); korekty lat i zmienność w symulacji dotyczą przychodu.
- W symulacji lata są od siebie niezależne (brak serii złych lat), rozkład normalny ucięty na zerze przychodu; raty bez losowania stóp.
- Gotówka (nadwyżki i braki) nie jest oprocentowana w bilansie; uwzględniają ją NPV i „Zysk vs lokata”.
- Jedna efektywna stopa alternatywna z Belką naliczaną rocznie.
- Prowizja liczona od kwoty kredytu bez prowizji.
- Brak dopłat do oprocentowania (ARiMR), nadpłat, transz, kredytów walutowych, podatku dochodowego.

## Mapa funkcji `calc.js`

| Funkcja | Rola |
|---|---|
| `pmt`, `interest`, `npv`, `irr`, `solve`, `annualize` | narzędzia finansowe |
| `monthIndex`, `monthKey` | miesiąc ↔ indeks `rok × 12 + (miesiąc − 1)` |
| `purchase` | cena, PCC, koszty zakupu, prowizja, kwota kredytu, gotówka na start |
| `incomePerHa` | dochód netto z ha |
| `simulate` | pętla miesięczna → `rows`, `years` |
| `summarize` | wskaźniki scenariusza |
| `thresholds`, `grid` | progi i siatka wrażliwości |
| `monteCarlo` | symulacja zmiennych lat |
| `calculate` | wszystko naraz dla UI |
