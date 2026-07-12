# Product Experience Foundation Report

## Arhitectura livrata

```text
src/config/navigation.ts
  -> AppShell desktop/mobile
  -> GlobalCommandPalette
  -> assistantActionCatalog
  -> assistantNavigation

src/config/pageExperience.ts
  -> titlu si breadcrumbs AppShell
  -> contract de acces si stari pentru pagini

src/components/experience
  -> layout, tabs, toolbar, grids, formulare, overlays, stari si conectivitate
```

Navigarea vizuala si navigarea vocala folosesc aceleasi id-uri, aliasuri, cuvinte cheie,
rute si restrictii de rol. Rutele React Router si serviciile de business nu au fost
schimbate.

## Componente noi

- `PageLayout`, `PageHeader`, `PageBreadcrumbs`, `PageTabs`, `PageToolbar`
- `KpiGrid`, `ContentGrid`, `SidePanel`, `ResponsiveDataView`
- `FormSection`, `FormWizard`, `StickyActionBar`
- `DetailsDrawer`, `MobileActionSheet`
- `Skeleton`, `InlineError`, `OfflineState`, `StaleState`, `PermissionState`
- `ConnectivityBanner`
- `UiLabPage`, disponibil doar administratorilor la `/control-panel/ui-lab`

Componentele existente `EmptyState`, `KpiCard`, `ProductPageHeader` si serviciile de
domeniu sunt reutilizate, nu duplicate.

## AppShell si navigare

- un singur registru pentru desktop, mobil, breadcrumbs, cautare si voce;
- filtrare vizuala dupa rol si permisiune;
- sectiune administrativa compacta;
- notificari pastrate in meniu;
- meniu desktop colapsabil, cu preferinta persistenta;
- meniu mobil cu ordine controlata prin `mobilePriority`;
- skip-link, focus trap, Escape si restaurarea focusului;
- breadcrumbs configurabile inclusiv pentru rute dinamice;
- prefetch-ul existent ramane activ.

## Command palette

- `Ctrl/Cmd+K`, navigare cu sageti, Enter si Escape;
- pagini si workflow-uri din acelasi catalog ca asistentul vocal;
- cautare controlata pentru masini, scule, utilizatori, proiecte si mentenanta;
- debounce 250 ms, rezultate remote limitate la 8, cache-ul serviciului pastrat;
- ultimele 6 comenzi in `localStorage`, filtrate din nou dupa rol la afisare;
- focus trap si restaurarea focusului la inchidere.

## CSS

Baseline `app.css`: 13.289 linii, aproximativ 300 KB sursa.

Rezultat `app.css`: 8.680 linii, aproximativ 190 KB sursa. Reducere: **34,7%**.

CSS mutat, in aceeasi ordine de cascade:

- `tokens.css`
- `layout.css`
- `buttons.css`
- `forms.css`
- `module-legacy.css`
- `tables.css`
- `form-support.css`
- `feedback.css`
- `navigation.css`
- `responsive.css`
- `legacy-foundation.css`

Verificarea mecanica a confirmat `CSS_LEGACY_SEQUENCE_IDENTICAL`. Noile reguli sunt
izolate in `reset.css` si `experience.css`.

## Pagini migrate la primitive

1. Dashboard
2. Dashboard Pontaje
3. Pontajul meu
4. Proiecte
5. Masini
6. Scule
7. Utilizatori
8. Control Panel

Migrarea schimba numai wrapperul si headerul; state-ul, serviciile si operatiile Firebase
raman neschimbate.

## Bundle inainte / dupa

| Zona | Inainte gzip | Dupa gzip | Observatie |
| --- | ---: | ---: | --- |
| CSS principal | 41,09 KB | 42,96 KB | +1,87 KB pentru primitive si a11y |
| Shell initial JS | 66,37 KB | 73,52 KB agregat | +7,15 KB, sub bugetul de 15 KB |
| Voice assistant | 39,49 KB | 39,36 KB | ramane lazy |
| Fleet GPS page | 7,33 KB | 7,32 KB | neschimbat practic |
| Leaflet vendor | 49,04 KB | 49,04 KB | neschimbat si lazy |
| Firebase vendor | 177,24 KB | 177,24 KB | neschimbat |

Bugetele automate ruleaza cu `npm run check:bundle` si limiteaza CSS-ul aplicatiei,
shell-ul initial, asistentul, pagina GPS si vendorul Firebase.

## Verificari si teste

- contract registru navigare si permisiuni;
- rezolvare rute dinamice pentru `PageExperienceDefinition`;
- catalog comun pentru comenzi vocale si palette;
- breadcrumbs, tabs, drawer Escape/focus si stari accesibile;
- command palette Ctrl+K, navigare, filtrare admin si focus restore;
- no-overflow la 360x800, 390x844, 768x1024, 1366x768 si 1920x1080;
- axe pe login si UI Lab;
- snapshot login mobil/desktop, UI Lab si pagina GPS;
- flow-ul critic Emulator Suite ramane activ.

## GPS functional freeze

Hash-urile fisierelor protejate sunt identice cu baza branch-ului, iar `git diff` este gol
pentru toate cele cinci fisiere. Gateway-ul, jitter-ul, traseele, pozitiile, simularea,
polling-ul incremental, cache-ul si batching-ul nu au fost modificate.

Status: `GPS_FUNCTIONAL_DIFF_ZERO`.

## Riscuri ramase

- `app.css` pastreaza 8.680 linii legacy; mutarea continua trebuie facuta pe module si
  validata vizual pentru a evita schimbarea cascade-ului.
- `VoiceCommandAssistant.tsx` si `MaintenancePage.tsx` raman foarte mari; separarea lor
  necesita taskuri dedicate si teste de contract.
- cautarea globala foloseste listele serviciilor existente si cache; pentru flote foarte
  mari va fi nevoie de indexuri si cautare server-side, fara a schimba API-ul UI.
- Firebase ramane cel mai mare vendor chunk, dar este separat si in limitele bugetului.
- warning-urile ESLint istorice React Compiler raman warnings; acest branch nu le ascunde
  si nu modifica fisierele GPS pentru a le elimina.

## Sprint recomandat

1. Migreaza formularele User, Vehicle, Tool si Leave la `FormSection` si
   `StickyActionBar`, cu validari si teste vizuale.
2. Separa `MaintenancePage` pe taburi lazy, pastrand contractele serviciilor si PDF.
3. Extrage sectiunile din `MyProfilePage` si incarca datele doar cand sunt deschise.
4. Continua modularizarea CSS pentru leave, expenses, maintenance si vehicle details.
5. Adauga query-uri de cautare server-side limitate pentru volume mari.
6. Introdu route-level permission guards dupa alinierea cu Firebase Rules.
7. Extinde snapshot-urile autentificate pentru Dashboard, Pontaje si formulare.
8. Masoara Web Vitals production si seteaza praguri CI dupa doua saptamani de date.
