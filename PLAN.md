# Plan

## Stan realizacji

| Etap | Stan |
|---|---|
| 1. Szkielet (PWA, prefiksy, SW z filtrem cache, motyw, 4 zakładki, „v1”) | gotowe lokalnie; Pages — po pushu |
| 2. Silnik: kredyt + check | gotowe |
| 3. Wynik (formularz, DEFAULTS, szkic, werdykt, kafle, karty) | gotowe |
| 4. Harmonogram (roczny / raty, edycja stopy) | gotowe |
| 5. Wrażliwość (stres, progi, siatka, wykres) | gotowe |
| 6. Scenariusze (zapis, porównanie, nagrobki, eksport/import) | gotowe |
| 7. Jak to liczymy? + CALCULATIONS.md | gotowe |
| 8. Sync Firebase | opcjonalny, nie zaczęty |

## Backlog (V2, ze specyfikacji funkcjonalnej)

- Dopłaty do oprocentowania (kredyty preferencyjne ARiMR).
- F12 kupno vs dzierżawa (majątek po N latach w obu wariantach).
- ~~F13 obciążenie całego gospodarstwa~~ — v3: inne raty, v4: nadwyżka gospodarstwa (po kosztach utrzymania) w pokryciu.
- ~~F14 zły rok w wybranych latach~~ — v2: korekty lat + symulacja zmiennych lat.
- Symulacja: serie złych lat (korelacja rok do roku), losowanie stóp procentowych.
- F15 raport PDF do rozmowy z bankiem.
- Dopasowanie kolorów (paleta tymczasowo z Licznika).
- Poprawka SW w repo Licznika: kasować tylko własne cache (SPEC §5.3).

## Stan wdrożenia

- Repo: lokalne (`main`), push i Pages — użytkownik.
- URL live: `https://kamilbrankiewicz.github.io/kredyt-ziemia/` (po włączeniu Pages).
