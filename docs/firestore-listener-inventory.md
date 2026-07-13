# Firestore listener and query inventory

Data auditului: 13 iulie 2026
Branch: `perf/firestore-emergency-cost-reduction-v2`

## Baseline production

Cloud Billing arata cost contabil acumulat, cu intarziere. Cloud Monitoring arata usage-ul
operational recent. Aceste surse nu trebuie confundate.

| Fereastra | Reads | Reads/min | Writes | Writes/min | Listener-e medii | Egress estimat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 minute | 87 | 17,40 | 431 | 86,20 | 10,00 | 0,32 MiB |
| 15 minute | 3.167 | 211,13 | 1.802 | 120,13 | 15,62 | 11,69 MiB |
| 60 minute | 30.051 | 500,85 | 5.997 | 99,95 | 16,64 | 110,93 MiB |

Masurare: `2026-07-13T03:25:42Z`. Captura Control Panel anterioara arata 41.414 reads
in fereastra mobila de 60 minute. Scaderea puternica din ultimele 5 minute confirma ca
fereastra de billing contine trafic mai vechi, dar varful de 15/60 minute a fost real.
Egress-ul din tabel este estimat la 3,78 KiB/read; Cloud Monitoring nu expune un metric
Firestore direct pentru Internet Data Transfer Out.

Cloud Monitoring nu include URL-ul paginii sau numele colectiei in `read_ops_count`.
Separarea frontend/gateway/Functions se bazeaza pe instrumentarea aplicatiei si pe fluxurile
de scriere documentate, nu pe o atribuire inventata.

## Top consumatori identificati

1. `VehicleGpsMapsPage`: cate un full route si un sync incremental pentru fiecare card.
2. `ControlPanelService.getCollectionCounters`: full scan pentru fiecare colectie de backup.
3. `DashboardService`: inventare globale si pontaje reincarcate la revenirea in tab.
4. `VehicleLiveRouteCard`: traseul unui singur vehicul, justificat numai cat pagina este activa.
5. `LeavePlannerPage`: utilizatori + pontaje + cereri si recrearea listenerului de utilizatori.
6. `MyProfilePage`: patru listener-e personale cu limite mai mari decat UI-ul afisa.
7. `MaintenanceWorkspace`: clienti, branding si raport overview pe taburile active.
8. `NotificationsPage` + badge global: doua listener-e intentionate, ambele limitate.
9. `AppShell`: user profile, unread badge si maximum 20 audit events la autentificare.
10. Pagini administrative/backup: citiri explicite si costisitoare, numai la actiunea adminului.

## Inventar listener-e runtime

| Listener/query | Pagina | Colectie | Documente maxime | Frecventa | Unsubscribe | Cost estimat / observatie |
| --- | --- | --- | ---: | --- | --- | --- |
| Fleet overview callable | Toate GPS-urile | `vehicles` (projection) | 11 curent, max 250 | 60 sec, numai visible | poller stop | 660 reads/ora la 11 masini |
| Fleet compact routes | Toate GPS-urile | `positionDays/.../points` | 50 / vehicul | intrare, refresh, 30 min visible | controller stop | maximum 550 reads initial la 11 masini |
| Selected vehicle | Toate GPS-urile, fallback | `vehicles/{id}` | 1 | live, numai selectie | da | activ daca traseele compacte sunt oprite |
| Selected route | Toate GPS-urile, fallback | `positionDays/.../points` | 2.000 hard | 60 sec incremental | controller stop | maximum un controller |
| Vehicle list legacy | Toate GPS-urile, rollback | `vehicles` | 250 | live | da | activ numai daca flag-ul este oprit |
| Vehicle detail | Masina | `vehicles/{id}` | 1 | live | da | justificat cat ruta este montata |
| Vehicle diagnostics | Detalii live | `diagnosticDays` | 1 + istoric limitat | live | da | numai pagina dedicata |
| Auth profile | global | `users/{uid}` | 1 | live | da | necesar permisiuni/profil |
| Unread badge | global | `notifications` | 30 | live | da | query user + unread |
| Notifications inbox | Notificari | `notifications` | 10 | live | da | pagina montata |
| Leave users | Concedii | `users` | 100 manager / 1 angajat | live | da | dependency stabilizata |
| Leave calendar | Concedii | `timesheets`, `leaveRequests` | 180 + 100 | live | da | numai user selectat |
| Leave requests | Concedii | `leaveRequests` | 100 manager / 30 personal | live | da | scope dupa rol |
| Profile vehicles | Profilul meu | `vehicles` | 20 | live | da | filtrare client legacy |
| Profile timesheets | Profilul meu | `timesheets` | 20 | live | da | user scoped |
| Profile notifications | Profilul meu | `notifications` | 10 | live | da | user scoped |
| Profile leave | Profilul meu | `leaveRequests` | 20 | live | da | user scoped |
| Maintenance clients | Mentenanta | `maintenanceClients` | 200 | live pe tab | da | limitat |
| Maintenance branding | Mentenanta | `maintenanceCompanies` | 50 | live pe tab | da | limitat |
| Maintenance reports | Mentenanta | collection group `rapoarte` | 100 implicit | live pe tab | da | limitat |
| Part orders | Piese | `maintenancePartOrders` | 200 | live pe pagina | da | limitat |
| Notification rules | Reguli | `notificationRules` | 100 | live pe pagina/pontaj | da | limita adaugata |
| Audit entity timeline | Timeline | `auditLogs` | 40 | one-shot | n/a | indexat entity + createdAt |
| Audit history | Istoric | `auditLogs` | 200 | la click | n/a | nu se incarca la intrare globala |

React Router demonteaza elementul de ruta la navigare. Efectele inspectate returneaza cleanup;
problema de recreare din Concedii a fost eliminata. Listener-ele globale ramase sunt profilul
autentificat si badge-ul unread.

## Schimbari aplicate

- Flota foloseste un callable cu field projection; `gpsSimHistory` nu este transferat.
- Toate traseele compacte sunt incarcate la intrare, la refresh si apoi la 30 minute.
- Fiecare traseu compact pastreaza maximum 50 puncte, iar markerul live ramane separat.
- Controller-ele sunt esalonate si nu citesc cat pagina este ascunsa.
- Modul cu un singur traseu selectat ramane disponibil prin feature flag pentru rollback.
- Interval implicit: ultimele 2 ore; optiuni pana la 24 ore; hard cap 2.000 puncte.
- Tab ascuns: pollerul de overview si controllerul de traseu nu citesc.
- Control Panel foloseste agregari `count()` in locul descarcarii colectiilor.
- Billing near-live se actualizeaza automat la 15-30 minute, cu cache server-side de 15 minute.
- Dashboard foloseste limite mici, cache 30 minute si nu mai face refresh la fiecare revenire.
- Listener-ele secundare au limite explicite si scope dupa rol/user.
- Telemetria de query este in memorie; nu scrie cate un document Firestore per request.

## Gateway si writes

Fluxul gateway ramane neschimbat in acest branch:

`packet -> vehicle snapshot -> relevant history point -> buffered diagnostics/usage`.

Nu au fost modificate parserul FMC130, payloadurile, snapshotul live, jitterul, simularea,
istoricul sau comenzile block/unblock. Writes-urile observate (aproximativ 86-120/min) provin
in principal din snapshot/history si batching-ul diagnostic deja publicat. Reducerea lor in
continuare necesita un task separat pentru relevanta punctelor, deoarece frecventa live in
miscare nu poate fi redusa fara aprobare.

## Comanda de masurare

```powershell
powershell -ExecutionPolicy Bypass -File scripts/measure-firestore-usage.ps1
```

Scriptul foloseste tokenul temporar al contului `gcloud` si nu salveaza credentiale.
