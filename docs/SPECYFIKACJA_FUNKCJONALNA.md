# Kalkulator opłacalności kredytu na zakup ziemi rolnej — specyfikacja funkcjonalna

Wersja 0.1 · 2026-10-13 · tylko funkcjonalności (technologia i architektura: osobny dokument)

---

## 1. Cel

Rolnik planuje kupić ziemię na kredyt ze zmienną stopą procentową. Aplikacja ma w kilka minut odpowiedzieć na trzy pytania:

1. **Ile będę płacić miesięcznie?** Teraz i wtedy, gdy stopy wzrosną.
2. **Ile ta ziemia musi zarabiać rocznie, żeby się spinało?** W zł/rok, w zł/ha i w tonach plonu z ha.
3. **Kiedy inwestycja się zwróci?** Licząc samą gotówkę oraz licząc razem z wartością ziemi.

Zasada nadrzędna to przejrzystość. Każdą liczbę wynikową da się rozwinąć i zobaczyć, z czego powstała.

---

## 2. Widok główny: trzy liczby na górze

| Kafel | Co pokazuje | Przykład |
|---|---|---|
| **Rata miesięczna** | pierwsza rata, najwyższa rata w scenariuszu, rata przy stresie +2 pp | 6 840 zł · max 7 910 zł · stres 8 450 zł |
| **Wymagany dochód** | roczny dochód z kupionej ziemi potrzebny na obsługę kredytu (z buforem) | 98 500 zł/rok · 4 925 zł/ha · 6,1 t/ha pszenicy |
| **Zwrot** | rok zwrotu gotówkowego i rok zwrotu majątkowego | gotówka: 14. rok · z wartością ziemi: 3. rok |

Kolor kafla: zielony = OK, żółty = na granicy (bufor < 20%), czerwony = nie spina się.

Pod kaflami są wykresy (F8), a niżej harmonogram (F3).

---

## 3. Funkcje

Priorytety: **MVP** = pierwsza wersja, **V2** = kolejna.

### F1. Dane zakupu ziemi — MVP

| Pole | Jednostka | Uwagi |
|---|---|---|
| Powierzchnia | ha | |
| Cena | zł/ha **lub** zł łącznie | przełącznik, drugie pole wylicza się samo |
| Koszty jednorazowe | zł | lista pozycji z nazwą i kwotą: notariusz, wpis do KW, operat szacunkowy, PCC itd. |
| Zwolnienie z PCC | tak/nie | przy „nie” proponuje 2% ceny jako pozycję; decyzję o zwolnieniu podejmuje użytkownik |
| Wkład własny | zł lub % ceny | |

**Wynik:** kwota kredytu = cena − wkład własny (+ prowizja, jeśli jest kredytowana).

### F2. Parametry kredytu — MVP

| Pole | Uwagi |
|---|---|
| Okres | lata (1–30) |
| Rodzaj rat | równe (annuitetowe) / malejące |
| Stopa referencyjna | %, wpisywana ręcznie (WIBOR 3M/6M, POLSTR/WIRON); aplikacja nie pobiera notowań |
| Marża banku | pp |
| Dopłata do oprocentowania | **V2.** pp lub % odsetek; dla kredytów preferencyjnych (np. ARiMR); oprocentowanie płacone przez klienta nigdy nie spada poniżej 0 |
| Prowizja | % kwoty; płatna z góry lub doliczona do kredytu |
| Karencja | miesiące; typ: *tylko odsetki* albo *odsetki doliczane do salda* |
| Koszty cykliczne | zł/rok, np. ubezpieczenie nieruchomości |

### F3. Harmonogram spłat — MVP

Tabela miesiąc po miesiącu z kolumnami: nr raty, data, stopa, rata, część kapitałowa, część odsetkowa, saldo po racie. Na dole są sumy: zapłacone odsetki, całkowity koszt kredytu (odsetki + prowizja + koszty), suma wpłat.

Przełącznik między widokiem miesięcznym a rocznym. Widok roczny jest wejściem do F5 i F6.

### F4. Scenariusze stopy procentowej — MVP

Stopa jest zmienna, więc użytkownik określa, jak może się zmieniać:

- **Stała:** obecna stopa przez cały okres (punkt odniesienia).
- **Ścieżka roczna:** stopa referencyjna wpisana dla każdego roku; puste lata przejmują wartość z poprzedniego.
- **Stres test:** +1 / +2 / +3 pp od wskazanego miesiąca. Wyliczany zawsze i pokazywany obok scenariusza bazowego.

Gdy stopa się zmienia, rata równa jest przeliczana od salda, które zostało, na pozostałą liczbę miesięcy. W ratach malejących zmieniają się tylko odsetki.

**Próg bólu:** stopa, przy której wymagany dochód (F5) przekracza dochód zakładany (F6).

### F5. Wymagany dochód roczny — MVP (sedno aplikacji)

Odpowiada na pytanie, ile ziemia musi zarabiać, żeby kredyt się spłacał.

- **Obsługa długu w roku** = suma rat w danym roku + koszty cykliczne kredytu.
- **Wymagany dochód netto z ziemi** = obsługa długu × współczynnik bezpieczeństwa (domyślnie 1,2, edytowalny; banki zwykle patrzą na 1,2–1,3).
- Wynik jest pokazywany jako zł/rok, zł/ha, zł/miesiąc oraz jako **plon progowy**: ile t/ha danej uprawy trzeba zebrać przy podanej cenie.

`plon progowy [t/ha] = (wymagany dochód/ha + koszty uprawy/ha − dopłaty/ha) / cena [zł/t]`

Wynik jest liczony dla każdego roku osobno, bo raty się zmieniają. Na kaflu stoi najgorszy rok, a w szczegółach cała lista.

„Dochód netto z ziemi” oznacza tu przychód minus koszty uprawy minus podatek rolny, przed spłatą kredytu.

### F6. Dochód z kupionej ziemi — MVP

Dwa sposoby podania, do wyboru:

1. **Prosto:** dochód netto w zł/ha/rok, wpisany jedną liczbą.
2. **Z rozbiciem:** uprawa, plon (t/ha), cena (zł/t), koszty bezpośrednie (zł/ha), dopłaty bezpośrednie (zł/ha), podatek rolny (zł/ha). Dochód wylicza się z tych pól.

Do tego dwa pola:
- wzrost dochodu, %/rok (domyślnie 0);
- **czynsz dzierżawny rynkowy** (zł/ha), jako punkt odniesienia: tyle dałoby się zarobić, wydzierżawiając tę ziemię.

### F7. Opłacalność i zwrot — MVP

Przepływ gotówki w roku *t*:
- rok 0: −(wkład własny + koszty jednorazowe + prowizja płatna z góry);
- rok *t*: dochód z ziemi − obsługa długu.

| Wskaźnik | Definicja | Po co |
|---|---|---|
| **Zwrot gotówkowy** | pierwszy rok, w którym skumulowana gotówka ≥ 0 | kiedy wrócą wyłożone pieniądze |
| **Zwrot majątkowy** | pierwszy rok, w którym wartość ziemi − saldo kredytu + skumulowana gotówka ≥ 0 | uwzględnia, że ziemia zostaje i zwykle drożeje |
| **Bilans na koniec kredytu** | wartość ziemi + skumulowana gotówka | ile inwestycja dała po spłacie |
| **NPV** | przepływy zdyskontowane stopą alternatywną + wartość ziemi na końcu | czy to lepsze niż trzymanie pieniędzy np. w obligacjach |
| **IRR** | stopa, przy której NPV = 0 | roczna „stopa zwrotu” z inwestycji |
| **Lata deficytowe** | lata, w których dochód < obsługa długu, i łączna kwota braku | ile trzeba dołożyć z reszty gospodarstwa |

Parametry: wzrost wartości ziemi (%/rok, domyślnie 0, czyli wariant ostrożny) i stopa alternatywna do NPV (%).

Wynik zwrotu jest zawsze pokazywany w dwóch wersjach: **bez wzrostu wartości ziemi** i **z nim**. Tak nie da się pomylić zarabiania na uprawie z zarabianiem na drożejącej ziemi.

Gdy zwrot nie następuje w horyzoncie analizy, aplikacja wyświetla „nie zwraca się w N lat” zamiast pustego pola.

### F8. Wykresy — MVP

1. Rata miesięczna w czasie: scenariusz bazowy i stres test na jednym wykresie.
2. Struktura raty: kapitał i odsetki, wykres skumulowany.
3. Skumulowana gotówka i bilans majątkowy w czasie, z zaznaczonymi punktami zwrotu.
4. Dochód z ziemi a obsługa długu rok po roku; luka zaznaczona na czerwono.

### F9. Progi opłacalności — MVP

Wartości graniczne liczone przy pozostałych parametrach bez zmian:

- **maksymalna cena za ha**, przy której wymagany dochód = zakładany dochód;
- **maksymalna stopa** (próg bólu z F4);
- **minimalny dochód/ha** i **minimalny plon**;
- **minimalny wkład własny** przy zadanym dochodzie.

Podane jedną linijką, np.: „Opłaca się do 68 000 zł/ha albo do stopy 9,4%”.

### F10. Analiza wrażliwości — V2

Tabela dwuwymiarowa: zmiana stopy (−1…+4 pp) × dochód/ha (−30%…+30%). W komórce stoi współczynnik pokrycia obsługi długu (dochód / obsługa długu) w kolorach zielony/żółty/czerwony.

### F11. Porównanie scenariuszy — V2

Do 3 wariantów obok siebie, np. 10 vs 15 lat, raty równe vs malejące, 20 vs 30 ha. Tabela różnic i wspólne wykresy.

### F12. Kupno vs dzierżawa — V2

Porównanie dwóch dróg: kupić na kredyt albo dzierżawić tę samą ziemię i trzymać wkład własny na lokacie lub w obligacjach. Wynik: majątek po N latach w obu wariantach.

### F13. Obciążenie całego gospodarstwa — v4 (jedno pole: nadwyżka gospodarstwa na raty)

Wejście: obecny dochód gospodarstwa, obecne raty innych kredytów, koszty utrzymania rodziny.
Wynik: jaka część dochodu idzie na raty po zakupie i czy gospodarstwo pokryje lata deficytowe z F7.

### F14. Zły rok — V2

Spadek dochodu o X% w wybranym roku lub latach (susza, niskie ceny). Pokazuje, czy wystarczy rezerwa i jak przesuwa się zwrot.

### F16. Zmienne lata — v2 (zrealizowane)

- **Dochód rok po roku:** korekta przychodu w % dla wybranych lat (susza, nieurodzaj, dobry rok).
- **Symulacja:** 500 wariantów z losowym przychodem w każdym roku (zmienność ±% jako parametr). Wynik: w ilu procentach
  wariantów zakup się spina, ile brakuje na raty w złych wariantach, rozrzut zysku i zwrotu, wykres pasma dochodu na tle rat.

### F15. Zapis i eksport — MVP (zapis), V2 (PDF)

- Zapis i wczytanie analizy (plik lokalny).
- Eksport harmonogramu do CSV.
- V2: raport PDF do rozmowy z bankiem albo doradcą: dane wejściowe, 3 kafle, wykresy, harmonogram roczny.

---

## 4. Reguły obliczeń

- Stopa miesięczna `r = (referencyjna + marża − dopłata) / 12`.
- Rata równa: `R = S · r / (1 − (1 + r)^−n)`, gdzie `S` to saldo, a `n` pozostałe miesiące. Przeliczana przy każdej zmianie stopy oraz po karencji.
- Przy `r = 0`: `R = S / n`.
- Rata malejąca: kapitał `= S₀ / n` (stały), odsetki `= saldo · r`.
- Karencja *tylko odsetki*: rata = saldo · r, saldo się nie zmienia. Karencja *kapitalizowana*: rata = 0, saldo += saldo · r.
- Kwoty zaokrąglane do groszy przy prezentacji; ostatnia rata domyka saldo do 0.
- Lata analizy liczone od miesiąca pierwszej raty.

**Walidacja:** powierzchnia > 0, cena > 0, wkład 0 ≤ wkład < cena, okres 1–30 lat, karencja < okres, stopy ≥ 0. Błąd pokazywany przy polu, a nie jako ogólny komunikat.

---

## 5. Czego aplikacja świadomie nie robi (na razie)

- Nie pobiera stóp procentowych, cen ziemi ani cen płodów z internetu; wszystko jest wpisywane ręcznie.
- Nie liczy RRSO; całkowity koszt kredytu wystarcza do porównań.
- Nie liczy podatku dochodowego (działalność rolnicza zwykle jest objęta podatkiem rolnym); podatek rolny jest kosztem w F6.
- Nie ocenia zdolności kredytowej tak jak bank. F13 jest orientacyjne.
- Nie doradza; pokazuje skutki założeń użytkownika.

---

## 6. Decyzje (2026-10-13)

1. Użytkownik: sam rolnik. Bez listy klientów; wystarczą zapisane warianty.
2. Dopłaty do oprocentowania (ARiMR): poza v1, przeniesione do V2.
3. Jedna uprawa na całej kupionej ziemi (albo dochód podany kwotą).
4. Zakup obejmuje tylko ziemię, bez budynków, maszyn i kredytu obrotowego.
5. Dochód z ziemi wpływa raz w roku, w wybranym miesiącu (domyślnie sierpień). Współczynnik pokrycia obsługi długu liczony rocznie.
6. Częstotliwość rat już w v1: miesięczne, kwartalne, półroczne, roczne. Kafel „Rata miesięczna” przy innej częstotliwości pokazuje ratę i jej miesięczny ekwiwalent.
7. Repo lokalne (git init + commity), push i Pages robi użytkownik.

---

## 7. Dopasowanie do SPEC budowy (SPEC-KALKULATOR-KREDYTU-INWESTYCYJNEGO.md)

| SPEC budowy | Tutaj |
|---|---|
| `taxMode` (najem, PIT/CIT, Belka) | jeden tryb `none`: podatek rolny jako koszt w zł/ha (F6); Belka tylko w scenariuszu alternatywy |
| Scen. 1 inwestycja z kredytem | zakup ziemi na kredyt |
| Scen. 2 wkład na stopie alternatywnej | bez zmian (lokata/obligacje) |
| Scen. 3 inwestycja bez kredytu | pominięty w v1; zastąpi go F12 (kupno vs dzierżawa) w V2 |
| Scen. 4–5 stress stopy i przychodu | bez zmian (F4, F14 przesunięte do v1 jako stress przychodu) |
| Werdykt: zysk netto na horyzoncie | karta werdyktu = „spina się / nie spina” (dochód vs wymagany dochód, F5) z przyczyną + trzy kafle (§2) + zysk netto i delta vs alternatywa |
| `monthlyRevenue`, `vacancyPct`, `exitValue` | dochód roczny z ha (F6) w miesiącu żniw; wartość końcowa = cena × (1 + wzrost)^lata (F7) |
| Raty tylko miesięczne | + kwartalne, półroczne, roczne (decyzja 6) |
