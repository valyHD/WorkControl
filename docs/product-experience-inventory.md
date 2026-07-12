# WorkControl Product Experience Inventory

## Scop

Acest document inventariaza rutele si suprafetele principale ale aplicatiei inaintea
migrarii complete la Product Experience Foundation. Inventarul descrie responsabilitatea
paginii, accesul, dependentele principale si riscul de migrare. Rutele si logica de business
raman neschimbate.

## Reguli de fundatie

- Sursa unica pentru meniul lateral, comenzi de navigare si cautare: `src/config/navigation.ts`.
- Contractul pentru titlu, breadcrumbs, acces si stari: `src/config/pageExperience.ts`.
- Actiunile de navigare ale paletei si asistentului vocal folosesc acelasi catalog.
- Primitivele noi completeaza componentele existente; `EmptyState`, `KpiCard`, `FilterBar`,
  `ProductPageHeader` si serviciile de domeniu nu sunt duplicate.
- Rutele GPS si logica lor sunt inghetate functional in aceasta etapa.

## Inventar rute publice

| Ruta | Pagina | Scop | Stare curenta | Directie UX |
| --- | --- | --- | --- | --- |
| `/` | `PublicHomePage` | Intrare publica minima | Card simplu de autentificare | Pastreaza suprafata usoara; fara dependente interne |
| `/login` | `LoginPage` | Autentificare Firebase | Formular compact, erori locale | Stari explicite de procesare si eroare, focus initial |
| `/privacy-policy` | `PrivacyPolicyPage` | Informare legala | Continut static | Tipografie si latime de lectura |
| `/terms` | `TermsPage` | Termeni | Continut static | Tipografie si latime de lectura |

## Inventar aplicatie autentificata

| Ruta | Modul / pagina | Acces UI | Scop si date | Observatii / risc | Prioritate migrare |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `DashboardPage` | autentificat | KPI, pontaje, activitate user, notificari, proiecte | Multi-sursa; are stari si componente product existente | P1 |
| `/my-profile` | `MyProfilePage` | proprietar | Profil, firma, functie, departament, concedii, scule, masina, notificari | 1.054 linii; multe sectiuni si operatii | P1 |
| `/my-leave` | `LeavePlannerPage` | autentificat | Calendar, cereri, semnatura, aprobari dupa rol | 1.039 linii; date calendaristice si canvas | P1 |
| `/notification-rules` | `NotificationRulesPage` | admin / manager | Reguli push si programari | 391 linii; formular sensibil | P2 |
| `/users` | `UsersPage` | admin / manager | Lista, filtre, roluri, stergere | Product header deja folosit | P1 |
| `/users/new` | `UserFormPage` | admin / manager | Creare utilizator | Formular controlat, atribute assistant | P1 |
| `/users/:userId` | `UserActivityProfilePage` | admin / proprietar | Activitate, concedii, scule, masini, bonuri, pontaje | 911 linii; agregare costisitoare | P2 |
| `/users/:userId/edit` | `UserFormPage` | admin / manager | Editare rol, functie, departament, status | Confirmare si validare sensibila | P1 |
| `/tools` | `ToolsPage` | autentificat | Lista scule, cautare, status | Product header deja folosit | P1 |
| `/tools/new` | `ToolFormPage` | rol permis | Creare scula si poze | Formular cu upload | P2 |
| `/tools/scan` | `ToolScanPage` | autentificat | Citire QR | Suprafata mica, dependenta camera | P2 |
| `/tools/:toolId` | `ToolDetailsPage` | autentificat | Detalii, transfer, poze, istoric | 421 linii; actiuni sensibile | P2 |
| `/tools/:toolId/edit` | `ToolFormPage` | rol permis | Editare scula si detinator | Pastreaza serviciile existente | P2 |
| `/vehicles` | `VehiclesPage` | `vehicles:read` | Lista flota, filtre, documente, acces GPS | Product header; ordinea trebuie stabila | P1 |
| `/vehicles/gps-map` | `VehicleGpsMapsPage` | `vehicles:read` | Harta flotei, trasee live | **Inghet functional GPS**, 1.367 linii | Protejat |
| `/my-vehicle` | `MyVehiclePage` | `vehicles:read` | Redirect/control catre vehiculul atribuit | **Inghet functional GPS** | Protejat |
| `/vehicles/new` | `VehicleFormPage` | rol permis | Creare vehicul, sofer, kilometri, mentenanta | Validare kilometri critica | P1 |
| `/vehicles/:vehicleId` | `VehicleDetailsPage` | `vehicles:read` | Date, documente, sofer, tracker, istoric | 1.088 linii; contine suprafata GPS | P2, fara GPS |
| `/vehicles/:vehicleId/live` | `VehicleLiveDiagnosticsPage` | `vehicles:read` | AVL/OBD live si istoric anomalii | 1.008 linii; polling controlat | P2 |
| `/vehicles/:vehicleId/edit` | `VehicleFormPage` | rol permis | Editare vehicul si kilometri | Scriere sensibila; validare obligatorie | P1 |
| `/timesheets` | `TimesheetsPage` | `timesheets:read` | KPI, filtre, grafice, export, detalii echipa | Product header; multe vizualizari | P1 |
| `/my-timesheets` | `MyTimesheetsPage` | autentificat | Start/stop, proiect, timp live, istoric | Flow critic si actualizare live | P1 |
| `/projects` | `ProjectsPage` | `projects:read` | Lista si administrare proiecte | Product header; formulare inline | P1 |
| `/timesheets/:timesheetId` | `TimesheetDetailsPage` | permis | Detalii pontaj si locatie | Suprafata mica, dependenta harta | P2 |
| `/notifications` | `NotificationsPage` | autentificat | Ultimele notificari si marcare citite | Listener si retentie limitata | P1 |
| `/control-panel` | `ReportsPage` | admin | Health, costuri, backup si configurare | 797 linii; date administrative | P1 |
| `/control-panel/backup-preview` | `BackupPreviewPage` | admin | Previzualizare export | Continut tehnic, download | P2 |
| `/control-panel/ui-lab` | `UiLabPage` | admin | Catalog tokenuri, primitive si stari | Nou; fara date production | Foundation |
| `/maintenance` | `MaintenancePage` | `maintenance:read` | Dashboard, rapoarte, clienti, branding, istoric, verificari | 2.884 linii; cel mai mare modul de business | P1 |
| `/maintenance/manage` | `MaintenancePage` | `maintenance:read` | Compatibilitate ruta administrare | Alias pastrat | P2 |
| `/maintenance/parts` | `MaintenancePartOrdersPage` | `maintenance:read` | Comenzi piese | Alias pastrat | P2 |
| `/maintenance/orders` | `MaintenancePartOrdersPage` | `maintenance:read` | Comenzi piese | Ruta canonica in meniu | P1 |
| `/maintenance/:clientId` | `MaintenanceClientDetailsPage` | `maintenance:read` | Client, lifturi, rapoarte si documente | 806 linii; multe documente | P2 |
| `/expenses` | redirect | autentificat | Compatibilitate catre scanare | Redirect pastrat | - |
| `/expenses/scan` | `ExpenseScanPage` | autentificat | Upload, OCR, corectie, salvare | 1.004 linii; upload si AI | P1 |
| `/expenses/reports` | `ExpenseReportsPage` | permis | Agregari cheltuieli | 317 linii; filtre | P2 |
| `/expenses/invoices` | `ExpenseInvoicesPage` | permis | Lista documente si status | 734 linii; tabel dens | P2 |
| `/companies` | `CompaniesPage` | admin / manager | Firme si asociere utilizatori | 643 linii; operatii administrative | P2 |
| `/history` | `AuditLogPage` | admin / manager | Audit incarcat la cerere | 318 linii; evita citiri automate | P1 |
| `/reports` | redirect | autentificat | Compatibilitate catre Control Panel | Redirect pastrat | - |

## Componente si responsabilitati mari

| Fisier | Linii baseline | Observatie |
| --- | ---: | --- |
| `VoiceCommandAssistant.tsx` | peste 5.000 | Ramane lazy; catalogul de navigare este scos din componenta gradual |
| `MaintenancePage.tsx` | 2.884 | Necesita separare pe taburi in sprint separat, cu teste de contract |
| `VehicleGpsMapsPage.tsx` | 1.367 | Inghet functional in acest branch |
| `VehicleDetailsPage.tsx` | 1.088 | Migrare doar in afara trackerului |
| `MyProfilePage.tsx` | 1.054 | Candidat pentru sectiuni lazy si contracte de stare |
| `LeavePlannerPage.tsx` | 1.039 | Candidat pentru separare calendar/formular/lista |
| `ExpenseScanPage.tsx` | 1.004 | Candidat pentru wizard controlat |
| `VehicleLiveDiagnosticsPage.tsx` | 1.008 | Pastreaza frecventa si contractele live |

## CSS baseline si strategie

- Baseline `src/app/app.css`: 13.289 linii / aproximativ 300 KB.
- Primele 4.609 linii au fost mutate mecanic, in aceeasi ordine, in:
  `tokens.css`, `layout.css`, `buttons.css`, `forms.css`, `module-legacy.css`,
  `tables.css`, `form-support.css`, `feedback.css`, `navigation.css`,
  `responsive.css` si `legacy-foundation.css`.
- `reset.css` contine normalizarea minima, focusul si reduced motion.
- `experience.css` contine exclusiv primitivele Product Experience Foundation.
- Restul din `app.css` ramane strat legacy documentat; mutarea sa continua pe module,
  numai impreuna cu teste vizuale.

## Baseline performanta (build production)

- CSS principal: 238,11 KB minificat, 41,09 KB gzip.
- Firebase vendor: 602,72 KB, 177,24 KB gzip.
- QR reader: 369,04 KB, 108,14 KB gzip (incarcat pe ruta dedicata).
- React vendor: 178,68 KB, 56,48 KB gzip.
- Voice assistant: 150,49 KB, 39,49 KB gzip (lazy in `AppShell`).
- Leaflet: 166,11 KB, 49,04 KB gzip (lazy prin paginile GPS/harti).

Bugetul fundatiei: shell-ul si navigarea nu trebuie sa adauge mai mult de 15 KB gzip la
incarcarea initiala; modulele grele raman lazy, iar GPS/Leaflet nu se muta in bundle-ul
initial.

## Zona GPS protejata

Nu se modifica functional in acest branch:

- `VehicleLiveRouteCard.tsx`
- `VehicleGpsMapsPage.tsx`
- `MyVehiclePage.tsx`
- `GpsSimulatorPanel.tsx`
- `utils/vehicleGps.ts`
- gateway, jitter, trasee, pozitii, simulare, polling incremental, cache si batching

Validarea finala compara hash-urile acestor fisiere si screenshot-urile existente.
