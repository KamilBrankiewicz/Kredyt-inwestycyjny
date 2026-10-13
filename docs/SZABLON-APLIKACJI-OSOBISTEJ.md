# Szablon aplikacji osobistej (single-user PWA)

> Uniwersalna specyfikacja budowy aplikacji do własnego użytku, wypracowana na projekcie
> „Licznik Kalorii". Skopiuj ten plik do nowego repozytorium jako punkt wyjścia i wykreśl
> sekcje, które nie dotyczą danego projektu. Wzorce opisane niżej nie są teorią — każdy
> z nich został zweryfikowany w działającej, codziennie używanej aplikacji.

---

## 1. Filozofia — pięć decyzji, z których wynika cała reszta

1. **Jeden użytkownik.** Nie budujesz produktu — budujesz narzędzie dla siebie (ew. + partner).
   To zdejmuje 90% złożoności: brak kont wielu użytkowników, ról, RODO, paginacji, i18n,
   skalowania. Każdą decyzję projektową wolno podjąć „bo tak mi wygodnie".
2. **Zero kosztów.** Brak serwera, abonamentu, domeny. Hosting: GitHub Pages. Usługi
   zewnętrzne wyłącznie w darmowych tierach, z kluczami należącymi do użytkownika.
3. **Zero kroku budowania.** Pliki w repo = pliki w przeglądarce. Brak bundlera, npm,
   frameworka, transpilacji. Vanilla JS + CSS + HTML. Deployment to `git push`.
4. **Offline-first, localStorage jako źródło prawdy.** Aplikacja działa w 100% bez sieci
   i bez konta. Chmura (jeśli w ogóle jest) to kanał synchronizacji i kopia zapasowa,
   nigdy baza główna.
5. **Interfejs w jednym języku, mobile-first.** Stringi UI inline w kodzie, po polsku.
   Głównym urządzeniem jest telefon; desktop to bonus.

Konsekwencja tych decyzji: **prostota jest funkcją, nie kompromisem.** Każda propozycja
„dodajmy framework / testy E2E / CI / realtime" musi udowodnić, że jej koszt utrzymania
zwraca się przy skali jednego użytkownika. Zwykle nie zwraca.

---

## 2. Struktura repozytorium

```
/
├── index.html          # cały SPA: markup wszystkich widoków i modali
├── manifest.json       # metadane PWA
├── sw.js               # service worker: cache offline + logika aktualizacji
├── css/
│   └── style.css       # style, zmienne CSS, dark/light
├── js/
│   ├── app.js          # WYŁĄCZNIE podpięcie zdarzeń DOM → wywołania UI.*
│   ├── ui.js           # renderowanie widoków, modale, walidacja formularzy
│   ├── storage.js      # jedyny właściciel localStorage: CRUD, merge, eksport/import
│   ├── <domena>.js     # opcjonalne moduły domenowe (np. recipes.js)
│   └── <usługa>.js     # po jednym module na integrację zewnętrzną
├── icons/
│   └── icon.svg        # jedna ikona SVG na wszystkie rozmiary
├── docs/
│   ├── ARCHITECTURE.md # jak działa i dlaczego tak
│   ├── MAINTENANCE.md  # checklista wdrożeniowa (obowiązkowa)
│   └── CHANGELOG.md    # historia funkcji: data, co, dlaczego, pliki
├── CLAUDE.md           # instrukcja dla AI: zasady nienaruszalne, skrót architektury
├── PLAN.md             # backlog + sekcja „Stan realizacji"
└── .claude/launch.json # konfiguracja lokalnego serwera podglądu (npx serve .)
```

### 2.1 Twardy podział odpowiedzialności warstw

```
index.html  →  app.js  →  ui.js  →  storage.js  →  localStorage
                            ↓
                    moduły integracji  →  sieć
```

| Warstwa | Wolno | Nie wolno |
|---|---|---|
| `app.js` | `addEventListener` na elementy statyczne; każdy handler = 1 linia delegująca do `UI.*` | jakakolwiek logika |
| `ui.js` | renderowanie (`render*`), modale (`open*Modal`/`close*Modal`), walidacja (`save*FromForm`), integracje (`handle*`) | dotykać `localStorage` bezpośrednio |
| `storage.js` | CRUD, agregaty, `merge*`, eksport/import JSON | dotykać DOM |
| moduły integracji | hermetyzują jedną usługę, zwracają czyste dane albo rzucają błąd z rozpoznawalnym kodem | renderować UI, zapisywać dane |

Elementy generowane dynamicznie dostają handlery w `ui.js` w miejscu tworzenia — nie w `app.js`.

**Dlaczego to działa:** przy braku testów automatycznych jedynym zabezpieczeniem jest
przewidywalność. Gdy wiadomo, że logika renderowania jest *zawsze* w `ui.js`, a dostęp do
danych *zawsze* w `storage.js`, każda zmiana (także pisana przez AI) ląduje we właściwym
miejscu i jest łatwa do zrewidowania.

### 2.2 Konwencja modułów JS

Bez modułów ES i bez bundlera — każdy plik to IIFE eksponujące jeden obiekt na `window`:

```javascript
const Storage = (() => {
  // prywatne funkcje i stałe
  function load(key) { /* ... */ }

  return {           // publiczne API
    addEntry,
    getEntries,
    // ...
  };
})();
window.Storage = Storage;
```

Kolejność `<script>` w `index.html` odzwierciedla zależności (storage przed ui, ui przed app).
Dynamiczny `import()` jest dozwolony tylko do ładowania SDK z CDN (patrz sekcja 6).

---

## 3. Dane — zasady nienaruszalne

To sekcja najważniejsza: złamanie tych reguł **psuje dane użytkownika**, a dane osobistej
aplikacji to często miesiące ręcznie wprowadzonej historii bez kopii u nikogo innego.

### 3.1 Kształt rekordu

Każdy rekord przeznaczony do synchronizacji ma minimum:

```javascript
{
  id: crypto.randomUUID(),          // stabilny identyfikator
  updatedAt: new Date().toISOString(), // ustawiany PRZY KAŻDYM zapisie
  // ...pola domenowe
}
```

`updatedAt` jako ISO 8601 porównuje się zwykłym porównaniem stringów — bez parsowania dat.
Rekord bez `updatedAt` przegrywa każdy konflikt.

### 3.2 Nagrobki (tombstones) przy usuwaniu

Usunięcie NIE kasuje rekordu — zapisuje `{ id, deleted: true, updatedAt }`.

**Dlaczego:** bez nagrobka urządzenie A usuwa wpis, urządzenie B nadal go ma, merge widzi
„A nie ma, B ma" i wpis zmartwychwstaje. Nagrobek z nowszym `updatedAt` wygrywa z żywym
rekordem i usunięcie się propaguje. Nagrobków nigdy nie czyścisz — koszt przy skali jednego
użytkownika jest znikomy, a czyszczenie otwiera z powrotem drzwi zmartwychwstaniom.

Renderowanie i agregaty zawsze filtrują `.filter((e) => !e.deleted)`.

### 3.3 Wsteczna zgodność modelu danych

W localStorage użytkownika leżą wpisy sprzed miesięcy. Nowe pole = wartość domyślna
**przy odczycie**, nigdy migracja niszcząca:

```javascript
Number(entry.fiber) || 0                         // nowe pole liczbowe
const settings = { ...DEFAULT_SETTINGS, ...saved }; // nowe pole ustawień
```

Wzorzec `{ ...DEFAULTS, ...saved }` sprawia, że dopisanie pola do `DEFAULT_SETTINGS`
automatycznie działa dla istniejących danych. Nigdy nie zakładaj, że pole istnieje.

### 3.4 Eksport / import JSON

Obowiązkowy od pierwszej wersji — to jedyna kopia zapasowa niezależna od chmury i ostatnia
deska ratunku przy migracji. Import w dwóch trybach: **scal** (przez `merge*`, bezpieczny
domyślny) i **zastąp** (świadoma decyzja). Eksport obejmuje *wszystkie* kolekcje — nowa
kolekcja bez obsługi w eksporcie to dziura w kopii zapasowej.

### 3.5 Klucze localStorage

- dane dzienne partycjonowane po dacie: `entries_YYYY-MM-DD` (push jednego dnia nie
  przepisuje historii),
- małe kolekcje globalne jako pojedyncze klucze: `settings`, `weights`, `favoriteProducts`,
- klucze API i configi usług **należą do użytkownika i zostają w localStorage** — wpisywane
  w Ustawieniach, nigdy commitowane, nigdy logowane do konsoli.

---

## 4. Synchronizacja między urządzeniami (opcjonalna)

Jedyna sensowna opcja przy zerowym budżecie: **Firebase (Firestore + Auth Google)**,
darmowy tier, SDK ładowane dynamicznym `import()` z gstatic (wersja w stałej
`FIREBASE_SDK_VERSION`), config wklejany przez użytkownika w Ustawieniach.

### 4.1 Zasada naczelna: lokalnie najpierw, chmura w tle

```javascript
Storage.addEntry(date, entry);   // 1. lokalnie, synchronicznie
renderDiary();                   // 2. UI od razu odświeżone
pushDayToCloud(date);            // 3. w tle; błąd tylko loguje/toastuje
```

Nie odwracaj kolejności i nie czekaj `await` na chmurę przed renderem. Nieudany push nie
może zablokować UI ani utracić danych lokalnych.

### 4.2 Sync na żądanie, nie realtime

Uruchamiany przy logowaniu i po zapisie. Jeden użytkownik rzadko ma dwa urządzenia otwarte
naraz — realtime listener to złożoność bez zysku.

Algorytm: **pull → merge → zapis lokalny → push**. Merge łączy po `id` (lub kluczu daty),
przy konflikcie wygrywa wyższy `updatedAt`:

```javascript
function mergeLists(a, b) {
  const byId = new Map();
  [...a, ...b].forEach((e) => {
    const prev = byId.get(e.id);
    if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) byId.set(e.id, e);
  });
  return [...byId.values()];
}
```

### 4.3 Komplet dla nowej synchronizowanej kolekcji

Dodając kolekcję, potrzebujesz **wszystkich pięciu** elementów — brak któregokolwiek
objawia się dopiero po tygodniach jako utrata lub duplikacja danych:

1. nagrobki przy usuwaniu,
2. `merge*` w `storage.js`,
3. `push*` / `pull*` w module synca,
4. wywołanie w głównej funkcji `syncWithCloud`,
5. obsługa w eksporcie/imporcie JSON.

### 4.4 Struktura Firestore

```
users/{uid}/days/{YYYY-MM-DD}  → dane partycjonowane po dniu
users/{uid}/meta/{nazwa}       → małe kolekcje globalne jako pojedyncze dokumenty
```

Wyjątek od reguł (jednorazowe skrzynki odbiorcze między niezależnymi kontami, jak
`sharedRecipes`) opisuj jawnie w ARCHITECTURE.md wraz z regułami bezpieczeństwa Firestore —
repo nie zawiera pliku `.rules`, reguły wpisuje się ręcznie w konsoli Firebase.

---

## 5. PWA: manifest, service worker, aktualizacje

### 5.1 Manifest — warunek instalowalności

`manifest.json` w katalogu głównym, podpięty `<link rel="manifest" href="manifest.json">`:

```json
{
  "name": "Pełna nazwa aplikacji",
  "short_name": "Nazwa pod ikoną",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#12121f",
  "theme_color": "#12121f",
  "icons": [
    { "src": "icons/icon.svg", "sizes": "192x192 512x512", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

`display: standalone` = po instalacji apka otwiera się bez paska adresu. Jedno SVG
z `purpose: "any maskable"` obsługuje wszystkie rozmiary; dla iOS dodatkowo w `<head>`:
`<link rel="apple-touch-icon" href="icons/icon.svg">`.

### 5.2 Service worker — dwie strategie, sprawdzone w praktyce

```javascript
const CACHE_NAME = 'nazwa-apki-v1';   // ← bump przy KAŻDEJ zmianie JS/CSS/HTML
const APP_SHELL = ['./', './index.html', './css/style.css', './js/app.js', /* KAŻDY plik JS */];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Nawigacja: network-first — nowy index.html dociera natychmiast
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Zasoby: stale-while-revalidate — z cache od razu, odświeżenie w tle
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
```

Rejestracja na końcu `app.js`:

```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW:', err));
}
```

### 5.3 Mechanizm aktualizacji — najczęstsza pułapka całego szablonu

Konsekwencja strategii z 5.2: po deployu użytkownik dostaje **nowy HTML ze starym JS**
przy pierwszym otwarciu, a spójną kombinację dopiero przy drugim. Objaw zapomnianego bumpa:
„przycisk nic nie robi", w konsoli `UI.cośNowego is not a function`.

Dwie żelazne zasady:

1. **Bump `CACHE_NAME` przy każdej zmianie JS/CSS/HTML** (`v1` → `v2` …). To jedyny sygnał
   dla przeglądarki, że jest coś nowego; `activate` kasuje wtedy stare cache.
2. **Widoczny znacznik wersji w UI**: ten sam numer `vN` jako *zwykły statyczny tekst*
   w `index.html` (np. obok nagłówka Ustawień), bumpowany razem z `CACHE_NAME`. To jedyny
   sposób sprawdzenia na telefonie, czy przeglądarka faktycznie wczytała nową wersję.
   Celowo statyczny tekst, nie odczyt z service workera: tylko `index.html` jest serwowany
   network-first, więc tylko on gwarantuje, że numer odpowiada temu, co realnie jest na
   ekranie.

3. **Nowy plik JS trafia w trzy miejsca naraz:** `<script>` w `index.html`, `APP_SHELL`
   w `sw.js`, drzewko w ARCHITECTURE.md. Pominięcie `APP_SHELL` = działa online, wybucha offline.

---

## 6. Integracje zewnętrzne

Wzorzec: **jeden moduł JS na jedną usługę**. Moduł hermetyzuje całą komunikację, zwraca
czyste dane domenowe albo rzuca błąd z rozpoznawalnym kodem. UI decyduje, co pokazać.

Zasady obowiązujące każdą integrację:

- **Każda może zawieść** (brak sieci, brak klucza, brak wsparcia przeglądarki, zmiana API).
  Każda ścieżka błędu ma czytelny polski komunikat w UI — nigdy cichy `catch {}`.
- **Brak klucza to nie błąd, to stan** — komunikat kieruje do Ustawień, nie crashuje.
- **Odpowiedzi AI parsowane defensywnie.** Model proszony o czysty JSON i tak zwróci czasem
  ` ```json …``` ` albo prozę — parser musi to znieść i zdegradować się do komunikatu.
- **Fallback na ścieżkę ręczną.** Skan nie rozpoznał / API nie zna produktu / przeglądarka
  nie wspiera — użytkownik zawsze może wpisać dane ręcznie. Automatyzacja przyspiesza
  wpis, nigdy go nie warunkuje.
- **SDK z CDN przez dynamiczny `import()`**, wersja przypięta w stałej (np.
  `FIREBASE_SDK_VERSION`) — jedno miejsce do podbicia przy aktualizacji.

Sprawdzone darmowe klocki (stan: 2026):

| Potrzeba | Rozwiązanie | Uwagi |
|---|---|---|
| AI: OCR, wizja, transkrypcja, parsowanie NL | Gemini API (`gemini-flash-latest`) | darmowy tier, klucz użytkownika w localStorage |
| Baza produktów spożywczych | Open Food Facts | publiczne, bez klucza; „nie znaleziono" to normalny scenariusz |
| Sync + logowanie | Firebase (Firestore + Auth Google) | darmowy tier; domena Pages musi być autoryzowana w konsoli |
| Głos | Web Speech API / MediaRecorder + Gemini | Web Speech tylko Chrome/Android; na Androidzie potrafi duplikować frazy — pewniejsze jest nagranie audio + transkrypcja Gemini |
| Kody kreskowe | natywny `BarcodeDetector` | brak wsparcia → ręczne wpisanie kodu |

---

## 7. Wygląd i UX — wypracowane standardy

### 7.1 Fundament CSS

- **Mobile-first**: projektuj na ~375 px; kontener `#app { max-width: 480px; margin: 0 auto }`
  robi z tego samego layoutu wersję desktopową. Zero media queries na layout.
- **Wszystkie kolory i promienie przez zmienne CSS** na `:root` — to warunek działania
  motywów i spójności:

```css
:root {
  --bg: #12121f;            /* tło aplikacji */
  --bg-elevated: #1c1c30;   /* nawigacja, modale */
  --bg-card: #242440;       /* karty */
  --text: #f2f2f7;
  --text-muted: #9a9ab0;
  --accent: #34d399;        /* JEDEN kolor akcentu na aplikację */
  --accent-soft: rgba(52,211,153,0.15);
  --danger: #f87171;
  --warning: #fbbf24;
  --border: #33334d;
  --radius: 18px;
  color-scheme: dark;
}
```

- **Font systemowy** (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …`) — zero
  webfontów do pobierania, natywny wygląd na każdej platformie.
- `viewport-fit=cover` w meta viewport (notche), `box-sizing: border-box` globalnie.

### 7.2 Dark / light — trójstanowy motyw

Domyślnie ciemny; jasny przez `prefers-color-scheme` z możliwością ręcznego nadpisania
(`auto` / `dark` / `light` w Ustawieniach, zapisywane w localStorage):

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) { /* jasne wartości zmiennych */ }
}
:root[data-theme="light"] { /* te same jasne wartości */ }
```

Kluczowy detal — **inline skrypt w `<head>` przed CSS**, żeby uniknąć błysku złego motywu:

```html
<script>
  (function () {
    var theme = localStorage.getItem('themePreference');
    if (theme && theme !== 'auto') document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
```

### 7.3 Szkielet nawigacji SPA

- Widoki jako sekcje `<section id="view-x" class="view">`; przełączanie klasą `.active`
  (`display: none` ↔ `block`). Zero routera — jednemu użytkownikowi deep-linki niepotrzebne.
- **Dolny pasek nawigacji** (3–4 przyciski z ikoną i etykietą) — kciuk, nie kursor.
  `#app` dostaje `padding-bottom`, żeby treść nie chowała się pod paskiem.
- **FAB** (floating action button) dla akcji głównej — „dodaj wpis" ma być osiągalne
  jednym dotknięciem z głównego widoku. Uwaga na kolizje FAB z innymi pływającymi
  elementami (przewidź to w layoucie).
- **Modale jako overlay** (`<div class="modal-overlay">` + karta), otwierane klasą
  `.active`; klik w tło zamyka. Formularze dodawania/edycji zawsze w modalach, nie
  w osobnych widokach.

### 7.4 Mikrointerakcje, które robią różnicę

- **Toast** na każdą operację zapisu/błędu: jeden element `#toast`, pokazywany klasą,
  auto-ukrycie po ~2,2 s.
- **Toast z Cofnij** przy usuwaniu — zamiast modala „czy na pewno?". Usuwanie jest
  natychmiastowe (nagrobek!), a toast przez kilka sekund oferuje przywrócenie. Szybciej
  i bezpieczniej niż potwierdzenia.
- **Daty po ludzku**: „Dziś" / „Wczoraj" / „Jutro" zamiast `2026-08-02`; dalej `DD.MM.RRRR`.
- **`inputmode="decimal"` / `inputmode="numeric"`** na polach liczbowych — właściwa
  klawiatura na telefonie.
- **Skróty z historii**: podpowiadanie najczęstszych/ostatnich wpisów przy dodawaniu —
  w aplikacji używanej codziennie 80% wpisów to powtórki.
- **`escapeHtml()` przy każdym wstawianiu danych użytkownika do `innerHTML`** — jedyna
  reguła bezpieczeństwa frontu, której nie wolno pominąć nawet w aplikacji dla siebie.

---

## 8. Testowanie — ręczne, ale systemowe

Świadoma decyzja: **brak testów automatycznych i CI.** Przy jednym użytkowniku i braku
kroku budowania koszt utrzymania testów przewyższa ich wartość. Ale „brak testów
automatycznych" ≠ „brak testowania" — zabezpieczeniem jest **obowiązkowa checklista
w `docs/MAINTENANCE.md`**, wykonywana przy każdej zmianie. Struktura checklisty:

**A. Przed kodem:** przeczytaj zasady (CLAUDE.md), sprawdź backlog i changelog (czy nie
było już robione/próbowane), ustal czy zmiana dotyka modelu danych, `git status`.

**B. Podczas pisania:** reguły warstw, wartości domyślne dla nowych pól, nagrobki,
`updatedAt`, `try/catch` z komunikatem na każdym wywołaniu sieciowym, nowy plik JS
w trzech miejscach.

**C. Przed uznaniem za zrobione:**
- C1: bump `CACHE_NAME` + znacznik `vN` w HTML — zawsze;
- C2: test w przeglądarce na lokalnym serwerze (`npx serve .`): konsola bez błędów,
  ścieżka szczęśliwa, **trwałość** (dodaj wpis → F5 → wpis jest), **regresja rdzenia**
  (stały zestaw 4–6 operacji podstawowych: dodaj / edytuj / usuń / przełącz widoki —
  wykonywany zawsze, niezależnie od zakresu zmiany), widok mobilny ~375 px, oba motywy
  jeśli zmiana dotykała CSS;
- C3: testy zależne od zakresu — dla zmian w danych: otwarcie ze **starymi** danymi
  (nie czyść localStorage!) + eksport/import; dla synca: test zmartwychwstania
  (usuń → sync → przeładuj → wpis NIE wrócił); dla integracji: ścieżki błędów;
  dla SW: DevTools → Offline → aplikacja startuje;
- C4: dokumentacja (CHANGELOG zawsze; ARCHITECTURE/CLAUDE.md tylko gdy zmieniły się
  zasady lub model);
- C5: przegląd `git diff` — brak `console.log`, zakomentowanego kodu, **kluczy API**.

**D. Po wdrożeniu:** publiczny URL na telefonie, wymuszony reload, zainstalowana PWA
załadowała nową wersję, dane sprzed aktualizacji na miejscu.

Do tego **tabela diagnostyczna** typowych awarii (objaw → przyczyna → gdzie sprawdzić) —
w tym szablonie architektury awarie są powtarzalne, więc tabela z 6–8 wierszy pokrywa
niemal wszystko:

| Objaw | Przyczyna |
|---|---|
| Przycisk nic nie robi, `X is not a function` | niezbumpowany `CACHE_NAME` |
| Działa online, wybucha offline | plik poza `APP_SHELL` |
| Usunięty rekord wraca po syncu | brak nagrobka lub `merge*` |
| Duplikaty po syncu | brak/złe `id` lub `updatedAt` |
| Stare wpisy renderują `NaN` | nowe pole bez wartości domyślnej |
| Login Google nie działa na Pages | domena nieautoryzowana w konsoli Firebase |

**Rytm utrzymaniowy (co kilka miesięcy):** wersje SDK z CDN, nazwy modeli AI, zużycie
darmowych tierów, ręczny eksport JSON jako backup niezależny od chmury.

---

## 9. Dokumentacja jako system operacyjny projektu

Ten szablon zakłada rozwój wspomagany przez AI (Claude Code itp.). Dokumentacja nie jest
opisem po fakcie — jest **mechanizmem kontroli**, który sprawia, że każda sesja (ludzka
czy AI) zaczyna z pełnym kontekstem. Cztery pliki, każdy z inną rolą i innym progiem wpisu:

| Plik | Rola | Kiedy aktualizować |
|---|---|---|
| `CLAUDE.md` | zasady nienaruszalne + skrót stacku; czytany jako pierwszy w każdej sesji | tylko gdy powstała nowa zasada, której złamanie psuje dane/aplikację |
| `docs/ARCHITECTURE.md` | *jak działa i dlaczego tak*: warstwy, model danych, sync, sekcja „świadome ograniczenia" | zmiana modelu danych, nowy moduł/integracja, zmiana strategii |
| `docs/MAINTENANCE.md` | *co robić przy wdrożeniu*: checklista + diagnostyka | gdy checklistę trzeba rozszerzyć o nową klasę zmian |
| `docs/CHANGELOG.md` | *co się zmieniło*: data, co, dlaczego, dotknięte pliki | każda zmiana |
| `PLAN.md` | backlog + „Stan realizacji" | każda zakończona/odłożona pozycja |

Zasady pisania:
- **Sekcja „świadome ograniczenia"** w ARCHITECTURE.md jest obowiązkowa: lista rzeczy,
  których celowo NIE ma (realtime, i18n, testy, paginacja) z adnotacją „to decyzje, nie
  braki — nie zmieniaj z własnej inicjatywy". Bez niej każda sesja AI będzie proponować
  „naprawienie" tych samych nie-problemów.
- CHANGELOG odpowiada też na pytanie „czy to już było próbowane" — zapisuj podejścia
  porzucone i dlaczego (np. „Web Speech API duplikował frazy na Androidzie → zastąpione
  nagraniem + transkrypcją").
- Dokumenty linkują się nawzajem z jasnym podziałem: *jak działa* / *co robić* / *co było*.

---

## 10. Hosting i deployment — GitHub Pages

- Repo **publiczne** (Free plan nie daje Pages z prywatnego repo). Dla aplikacji osobistej
  to akceptowalne — dane i tak są tylko w localStorage/własnym Firebase, nigdy w repo.
- HTTPS automatyczne — twardy wymóg PWA (SW i instalacja nie działają po HTTP;
  `localhost` jest zwolniony na czas developmentu).
- Deployment = `git push`. Zero CI/CD. Pages przebudowuje się w ~1 minutę.

Bootstrap nowego projektu od zera (sprawdzona sekwencja, gh CLI już zalogowany):

```
git init -b main
git config user.name "KamilBrankiewicz"
git config user.email "KamilBrankiewicz@users.noreply.github.com"   # lokalnie, nie --global
git add -- <pliki jawnie po nazwie, nie -A>
git commit -m "Initial commit"
gh repo create <nazwa> --public --source=. --remote=origin --push
gh api repos/KamilBrankiewicz/<nazwa>/pages -X POST -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
```

Uwagi:
- Enable Pages działa od razu z CLI (`gh api … /pages`), bez wchodzenia w Settings.
- Status „building" przez ~1 min zanim URL zacznie odpowiadać.
- `.claude/launch.json` (lokalny serwer: `npx serve .`) commituj do repo — ułatwia
  development w kolejnych sesjach.
- Jeśli używasz Firebase Auth: dodaj domenę `<user>.github.io` do autoryzowanych
  w konsoli Firebase → Authentication → Settings.

---

## 11. Checklista startowa nowego projektu

Dzień 1 — szkielet (wszystko poniżej to ~2–3 h pracy, potem już tylko domena):

- [ ] Struktura katalogów z sekcji 2; `index.html` z meta viewport, theme-color,
      manifestem, ikonami, inline skryptem motywu.
- [ ] `css/style.css`: zmienne `:root` (dark) + wariant light, kontener `#app`,
      dolna nawigacja, klasa `.view`/`.active`, modal-overlay, toast.
- [ ] `js/storage.js` (IIFE → `window.Storage`): CRUD pierwszej kolekcji z `id`,
      `updatedAt`, nagrobkami; `DEFAULT_SETTINGS`; eksport/import JSON.
- [ ] `js/ui.js` (IIFE → `window.UI`): `switchView`, `renderX`, `showToast`,
      `showUndoToast`, `escapeHtml`, pierwszy modal.
- [ ] `js/app.js`: DOMContentLoaded, delegacje, rejestracja SW.
- [ ] `sw.js`: `CACHE_NAME = 'nazwa-v1'`, `APP_SHELL`, strategie z sekcji 5.2.
- [ ] `manifest.json` + `icons/icon.svg`.
- [ ] Znacznik „v1" w UI (Ustawienia).
- [ ] `CLAUDE.md` (zasady z sekcji 3 + podział warstw), `docs/ARCHITECTURE.md`,
      `docs/MAINTENANCE.md` (skopiowana checklista z sekcji 8), pusty CHANGELOG, PLAN.md.
- [ ] `.claude/launch.json` z `npx serve .`.
- [ ] Bootstrap repo + Pages (sekcja 10).
- [ ] Test DevTools: Application → Manifest i Service Worker bez błędów, przycisk
      „Install" dostępny; Network → Offline → aplikacja startuje.
- [ ] Test na telefonie: instalacja PWA, dodanie rekordu, reload, rekord przetrwał.

Sync (Firebase) dodawaj **później**, gdy aplikacja już działa lokalnie — architektura
z sekcji 3 (id/updatedAt/nagrobki od pierwszego dnia) gwarantuje, że dołożenie synca
nie wymaga migracji danych.

---

## 12. Kiedy odstąpić od szablonu

Szablon jest zoptymalizowany pod: dane wpisywane codziennie, małe (tysiące rekordów),
jeden użytkownik, telefon. Sygnały, że dana część przestaje pasować:

- **Dane > ~2–4 MB lub pliki binarne (zdjęcia)** → localStorage się kończy; IndexedDB
  (bez zmiany reszty architektury — `storage.js` dalej jest jedynym właścicielem).
- **Wielu piszących użytkowników naraz** → merge po `updatedAt` przestaje wystarczać;
  to już nie jest aplikacja osobista i szablon świadomie tego nie obsługuje.
- **Ciężkie obliczenia / wykresy** → nadal bez bundlera: pojedyncza biblioteka jako
  jeden plik vendored do repo (nie CDN w runtime — łamie offline) i dopisana do `APP_SHELL`.
- **Aplikacja czysto obliczeniowa bez danych** (kalkulator) → sekcje 3–4 (dane, sync)
  wypadają w całości; zostaje PWA + wygląd + deployment.
- **Potrzeba prywatności repo** → GitHub Free nie da Pages z prywatnego repo; opcje:
  Cloudflare Pages (darmowe, prywatne repo) — jedyny punkt szablonu, gdzie warto
  rozważyć innego hostera.

---

## 13. Propozycje rozwoju szablonu (do rozważenia w kolejnych projektach)

Rzeczy, których w Liczniku Kalorii nie ma, a które są tanie i zgodne z filozofią:

1. **Smoke-test w konsoli**: funkcja `Storage.selfTest()` uruchamiana ręcznie z konsoli
   (dodaj → odczytaj → usuń → sprawdź nagrobek → merge dwóch list). Nie CI, ale
   30 sekund weryfikacji rdzenia danych po większej zmianie w storage.
2. **Automatyczne przypomnienie o bumpie**: skoro numer wersji żyje w dwóch miejscach
   (`sw.js` i `index.html`), grep porównujący oba w checklistcie C1 — jedna linijka,
   eliminuje najczęstszy błąd wdrożeniowy.
3. **Eksport JSON przypominany cyklicznie**: mały znacznik w UI „ostatni eksport: X dni
   temu" po przekroczeniu np. 30 dni — backup niezależny od chmury robi się sam z siebie
   rzadko.
4. **Sekcja „Stan wdrożenia" na końcu tego pliku** w każdym nowym projekcie: URL repo,
   URL live, branch, data włączenia Pages — 5 linijek, które oszczędzają szukanie
   w następnej sesji.
