# Changelog

## v4 — 2026-10-16

- **Nadwyżka z obecnego gospodarstwa (F13):** pole w sekcji „Obecne gospodarstwo i inne kredyty”, zł/rok.
  Wchodzi tylko do pokrycia rat: werdykt, wymagany dochód (teraz z kupionej ziemi), brakuje na raty, progi, siatka,
  symulacja. Gotówka, majątek, zysk vs lokata i zwrot bez zmian.
- Siatka wrażliwości liczy min. pokrycie z lat zamiast mnożyć je liniowo (przy `farmIncome = 0` ten sam wynik).
- Nowe pole `farmIncome: 0` — neutralne dla starych scenariuszy.
- Check: 63 sprawdzenia.

## v3 — 2026-10-16

- **Wiele kredytów i zobowiązań:** sekcja „Inne kredyty i zobowiązania” w parametrach. Każdy kredyt ma własne
  parametry (kwota, okres w miesiącach, częstotliwość, rodzaj rat, oprocentowanie zmienne z marżą albo stałe,
  prowizja, karencja, dzień płatności, koszty) i własny harmonogram. Rodzaj: *na zakup* (wypłata zmniejsza gotówkę
  na start, wchodzi do wszystkich wyników) albo *istniejące zobowiązanie* (tylko do pokrycia rat).
- Jeden wynik: raty wszystkich kredytów sumują się w obsłudze długu, pokryciu, werdykcie, wymaganym dochodzie,
  progach, siatce i symulacji. Karta „Wszystkie kredyty” z kosztem i RRSO każdego; harmonogram rat z wyborem kredytu.
- Nowe pole `extraLoans: []` — neutralne dla starych scenariuszy (wynik bez zmian, sprawdzone bit w bit względem v2).
- Check: 62 sprawdzenia.

## v2 — 2026-10-13

- **Dochód rok po roku:** korekta przychodu w % dla żniw w danym roku kalendarzowym (np. susza −40%). Wchodzi do
  wszystkich wyników, harmonogramu i wykresów. Parametry → Dochód z kupionej ziemi → Zmienne lata.
- **Symulacja zmiennych lat:** 500 wariantów z losowym przychodem (±σ, domyślnie 20%). Karta na górze Wrażliwości:
  udziały spina się / na granicy / nie spina się, braki na raty, rozrzut zysku i zwrotu, wykres pasma dochodu
  (80% wariantów, mediana, przykładowe lata) na tle rat oraz pasmo gotówki i majątku. Jedna linia w werdykcie.
- Wykresy: obsługa pasm i cienkich linii.
- Nowe pola `incomeYearPct: {}` i `incomeVolatilityPct: 20` — neutralne dla starych scenariuszy (symulacja nie zmienia wyniku bazowego).
- Podgląd lokalny: `.claude/launch.json` z `autoPort`.
- Check: 53 sprawdzenia.

## v1 — 2026-10-13

Pierwsza wersja: etapy 1–7 z [SPEC](SPEC-KALKULATOR-KREDYTU-INWESTYCYJNEGO.md) §12 (bez synca).

- Silnik (`calc.js`): Actual/365, raty równe/malejące, raty co 1/3/6/12 miesięcy, karencja (odsetki albo kapitalizacja),
  prowizja, koszty roczne, lepkie zmiany stopy, stres stopy i dochodu, pokrycie rat rocznie, wymagany dochód
  i plon progowy, zwrot gotówkowy i z wartością ziemi, NPV/IRR, zysk vs lokata, RRSO, progi (cena, stopa, wkład), siatka.
- Check `test/calc.check.js` (49 sprawdzeń).
- UI: Wynik (werdykt z przyczyną i następnym krokiem, 3 kafle, progi, 2 wykresy, karty), Harmonogram
  (roczny / raty, edycja stopy w racie), Wrażliwość (stres test, progi, siatka, wykres raty), Scenariusze
  (zapis, nadpisanie, porównanie do 3, usuwanie z „Cofnij”), „Jak to liczymy?” z kalkulatorem raty, Ustawienia
  (motyw, eksport/import JSON, wyczyść dane).
- PWA: manifest, SW kasujący tylko własne cache, prefiks `kredyt.` w localStorage.

Decyzje i podejścia porzucone:
- „Zysk vs lokata” liczony najpierw jako `bilans − wkład × ((1+r)^H − 1)` — zawyżał wynik, bo pomijał pieniądze
  dokładane do rat w kolejnych latach. Zastąpione przez NPV przeniesione na koniec horyzontu.
- Próg stopy pokazywany jako stopa referencyjna wychodził ujemny — pokazujemy oprocentowanie (stopa + marża),
  a przy ścieżce zmian stopy przesunięcie w pp.
- Bisekcja ze stałą liczbą 60 iteracji: 86 ms na przeliczenie. Stop na tolerancji: ~20 ms.
- Scenariusze w osobnych przebiegach `simulate` zamiast jednej wspólnej pętli (prościej, wystarczająco szybko).
