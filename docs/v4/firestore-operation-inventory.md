# Firestore Operation Inventory

## 1. Metodologie și limitări

Inventarul combină:

- căutare statică în `src`, `functions` și gateway;
- grupare după serviciu și modul;
- inspectarea limitelor, listener-elor, timerelor și cleanup-ului;
- metrici read-only Cloud Monitoring pentru producție;
- rules/indexes locale și rules publicate.

Analiza statică a identificat 339 apeluri explicite, grupate în 247 operații logice.
Parserul nu poate deduce toate operațiile Firebase Admin ascunse în helperi și nici numărul
real de documente returnate; valorile sunt inventar de cod, nu factură.

| API / mecanism | Apeluri statice aproximative |
| --- | ---: |
| `getDocs` | 73 |
| `getDoc` | 44 |
| `onSnapshot` | 31 |
| `updateDoc` | 34 |
| `setDoc` | 15 |
| `addDoc` | 13 |
| `deleteDoc` | 14 |
| `runTransaction` | 24 |
| `writeBatch` | 5 |
| `collectionGroup` | 4 |
| `getCountFromServer` | 1 |
| `uploadBytes` / `getDownloadURL` | 11 / 11 |
| `deleteObject` | 4 |
| callable Functions | 31+ server handlers |
| document triggers | 4 |
| scheduled Functions | 5 |
| `setInterval` în frontend/gateway | 14 |

## 2. Distribuție pe module

| Modul | Apeluri Firebase explicite | Observații |
| --- | ---: | --- |
| Vehicles/GPS | 66 | Cel mai mare serviciu; CRUD, media, documente, AI, trasee și listeners. |
| Functions `index.js` | 60 | AI, notificări, billing, triggers și programe. |
| Maintenance | 32 | Clienți, branding, rapoarte și piese. |
| Tools | 28 | CRUD, transferuri, imagini și istoric. |
| Core frontend | 23 | Auth, shell, context, telemetry. |
| Users | 22 | Listă, profil, avatar și operational views. |
| Expenses | 17 | Upload, job AI, listă și ștergere. |
| Timesheets | 16 | Proiecte, start/stop și rapoarte. |
| Reports | 13 | Export și collection group. |
| Notifications | 13 | Reguli, inbox, dispatch. |
| Companies | 11 | Director, preferințe și operații admin. |
| Leave | 11 | Cereri, planner și PDF. |
| Dashboard | 9 | Query-uri limitate, cache și agregări. |
| Gateway | 7 | Snapshot, puncte, zi, diagnostic, comenzi. |

## 3. Vehicles și GPS

### Citiri

| Operație | Mecanism | Limită / frecvență | Risc |
| --- | --- | --- | --- |
| Listă vehicule manager/admin | `getDocs` / `onSnapshot` | până la 250 | Mediu; listener global. |
| Listă angajat | 3 query-uri pe asignări | până la 250/query | Dedupe local; până la 3 listeners. |
| Detaliu vehicul | `getDoc` / listener document | 1 | Bun pentru pagina de detaliu. |
| Evenimente vehicul | query subcolecție | fără limită | P1; trebuie paginare. |
| Diagnostic zilnic/istoric | listeners | interval/colecție | Necesită limită și retenție documentată. |
| Traseu selectat | range/chunks/cache | cache + incremental | Sensibil; nu se modifică în V4. |
| Ultima poziție | query limitat | 1 | Corect. |
| Tracker events/commands | query | limitat în serviciu | Operațional/admin. |

### Scrieri

| Operație | Destinație | Observație |
| --- | --- | --- |
| CRUD vehicul | `vehicles/{id}` | Update-urile declanșează proiecția operațională. |
| Mileage/driver/claim | callable/transaction | Fluxurile sensibile au variante server-side. |
| Imagini | Storage + array pe vehicul | Full + thumbnail; rescrie metadate. |
| Documente | Storage + array pe vehicul | Rescrie întreg array-ul; ștergerea nu șterge Storage. |
| AI document | callable `analyzeVehicleDocument` | Analiză sincronă per document, fără dedupe/version. |
| Puncte GPS | `positions`/chunks/day | Volum continuu, dominat de gateway. |
| Snapshot GPS | document vehicul | Frecvent în mișcare; trigger fan-out. |
| Operational view | `vehicleOperationalViews` | Trigger la fiecare schimbare relevantă. |

## 4. Timesheets și proiecte

| Operație | Tip | Limită / tranzacție | Observație |
| --- | --- | --- | --- |
| Proiecte | `getDocs` | limită configurabilă | Lista activă este limitată. |
| Start pontaj | callable + transaction | lock `activeTimesheets/{uid}` | Atomic și idempotent. |
| Stop pontaj | callable + transaction | owner + company | Calculează server-side durata. |
| Lista management | `getDocs` | 1.000 | Mare; necesită paginare. |
| `getTimesheetsList` | `getDocs` | fără limită | P1. |
| Istoric utilizator | query | limită parametrizată | Corect dacă toate ecranele trimit limită. |
| Ștergere/corecție | callable/direct service | audit necesar | Verificarea rules publicate este critică. |

## 5. Tools

| Operație | Tip | Limită | Observație |
| --- | --- | ---: | --- |
| Listă scule | one-shot | 500 | Mare pentru mobile; paginare recomandată. |
| Listă utilizatori | one-shot | fără limită | P1; folosește operational views limitate. |
| Lookup QR/cod | query exact | 1 | Eficient. |
| Evenimente | subcolecție | fără limită | P1. |
| Imagini | Storage full + thumb | per fișier | Cleanup există la ștergere. |
| Transfer/claim | transaction/callable | 1 entitate | Bine delimitat server-side în versiunea întărită. |

## 6. Maintenance

| Operație | Tip | Limită | Observație |
| --- | --- | ---: | --- |
| Clienți | one-shot/listener | 200 | Acceptabil acum; paginare la scalare. |
| Client by id | `getDoc` | 1 | Corect. |
| Istoric rapoarte/client | query | fără limită | P1. |
| Istoric global | listener | 100 | Acceptabil pentru recent. |
| Overview rapoarte | collection group | limitat | Necesită index și company filter. |
| Branding | listener | 50 | Poate deveni one-shot + cache. |
| Piese | listener | 200 | Înlocuiește cu active/recent split. |
| Upload branding | Storage | logo/stamp | Cleanup și validare MIME de verificat la fiecare update. |
| Rapoarte | Storage + Firestore | PDF + imagini | Retenție și permisiuni trebuie documentate. |

## 7. Expenses / bonuri

| Operație | Tip | Limită | Observație |
| --- | --- | ---: | --- |
| Documente | one-shot | 1.000 | Paginare/cursor recomandat. |
| Utilizatori opțiuni | one-shot | fără limită | P1. |
| Companii opțiuni | one-shot | fără limită | P1. |
| Proiecte active | one-shot | limitat | Corect. |
| Upload | Storage | max 15 MB în rules | UI validează MIME/size. |
| Job scan | `addDoc` + listener document | 180 sec timeout client | Listener se închide la final/timeout. |
| Procesare job | trigger | 1 per job | Fără hash/idempotency/retry versionat. |
| Salvare expense | write | 1 document | Metadate și analiză în același document. |
| Ștergere | Firestore + Storage | 1+1 | Cleanup implementat. |

## 8. Users, companies, leave, notifications și audit

### Users

- listă și listener: maximum 250;
- profil/avatar: document unic, Storage full + thumb;
- `userOperationalViews`: proiecție utilă, dar include prezență volatilă;
- pagina profil: listeners limitați pentru ultimele pontaje, notificări și concedii.

### Companies

- lista companiilor este nebounded;
- ștergerea firmei poate citi users și mai multe colecții asociate;
- directoarele administrative agregă unele liste fără limită;
- operațiile grele trebuie mutate în job server-side cu progres și dry-run.

### Leave

- cereri utilizator: listener fără limită în serviciul generic;
- planner: users 100, timesheets 180, leave 100, requests 100/30;
- PDF-ul este generat în client; metadatele cererii sunt în Firestore.

### Notifications

- inboxul utilizatorului păstrează/afișează ultimele 10;
- mark-all-read citește maximum 100;
- cleanup server-side citește loturi de 500;
- rules active: listener maximum 100 în UI;
- dispatch-ul legacy citește toți utilizatorii și toate regulile active.

### Audit

- pagina History citește până la 800, cu listener opțional;
- entity timeline citește ultimele 40;
- rules locale interzic scrierea client directă;
- rules publicate trebuie reconciliate înainte de a considera auditul sigur.

## 9. Functions, triggers și schedules

| Function | Tip | Fan-out / observație |
| --- | --- | --- |
| `syncVehicleOperationalView` | document trigger | 2.282 invocări/oră măsurate; cel mai mare consumator. |
| `syncUserOperationalViews` | document trigger | 124 invocări/oră; sensibil la presence. |
| `processExpenseScanJob` | create trigger | Un job per upload; scrie status și rezultat. |
| `sendPushOnNotificationCreated` | create trigger | Un push per notificare; gestionează tokenuri invalide. |
| `checkVehicleMaintenanceAlerts` | hourly | Full scan vehicule; trebuie scheduler indexat. |
| `checkTimesheetReminderAlerts` | every 5 min | Citește context/rules/users; trebuie query per companie. |
| `checkMaintenancePartOrderReminders` | every 5 min | Query `nextReminderAt`, limit 80; model bun. |
| billing refresh | every 3 h | Admin metrics/cache; acceptabil. |
| GPS archive | scheduled | Operație de infrastructură separată; nu se schimbă aici. |

## 10. Polling, cache și listeners

| Suprafață | Comportament | Verdict |
| --- | --- | --- |
| Dashboard | refresh 30 min, doar vizibil | Bun. |
| Billing panel | refresh 30 min | Bun; evită refresh sub-minut. |
| Fleet route | refresh 10 min, cache persistent/memory, hidden skip | Bun ca politică actuală; protejat. |
| My vehicle route | initial + incremental | Bun; protejat. |
| Notifications shell | listener unread limit 30 | Acceptabil; inboxul afișează 10. |
| Users online tick | timer local 15 sec | Fără query; bun. |
| My timesheet timer | timer local | Fără query; bun. |
| Expense scan job | listener document cu unsubscribe | Bun, dar adaugă recovery după timeout. |

## 11. Operații administrative intenționat costisitoare

Backup/export și cleanup din Control Panel fac full scans sau batches mari. Acestea nu
trebuie mascate ca query-uri obișnuite. Cerințe:

- admin-only;
- confirmare explicită;
- estimare de documente/cost înainte de execuție;
- job server-side cu progres;
- limită de concurență;
- audit și rezultat păstrat;
- niciodată polling automat al exportului complet.

## 12. Registru granular pe fișier și funcție

Tabelele de mai jos sunt registrul operațional auditabil. „Docs” este plafonul observat
sau estimarea pe apel; costul real este numărul de documente returnate/scrise plus index
entries și egress. Rolurile sunt verificate prin context/rules/callable; producția trebuie
reconciliată cu rules locale înainte ca aceste limite să fie considerate control de acces.

### `src/modules/vehicles/services/vehiclesService.ts`

| Funcție | Path principal | Tip | Frecvență/Docs | Cache/unsubscribe | Recomandare |
| --- | --- | --- | --- | --- | --- |
| `subscribeVehicleGpsVisibility` | `systemSettings` | listener | 1/sesiune admin | unsubscribe returnat | păstrează |
| `setVehicleGpsVisibilityBlocked` | `systemSettings` | write | manual, 1 | n/a | server-side/admin |
| `subscribeVehicleCommands` | commands vehicul | listener | tab activ, limitat | unsubscribe | doar tab activ |
| `getVehicleUsers` | user operational/users | read | <=250 | one-shot | prefix search la scalare |
| `getVehiclesList` | vehicle operational/vehicles | read | <=250 | one-shot | cursor 100 |
| `subscribeVehiclesList` | vehicle operational/vehicles | listener | 1 sau 3 query-uri, <=250 fiecare | unsubscribe agregat | stable projection |
| `getVehicleById` | `vehicles/{id}` | read | 1 | one-shot | păstrează |
| `getMyVehicleForUser` | `vehicles` | read | max 1 după query asignare | one-shot | păstrează |
| `subscribeVehicleById` | `vehicles/{id}` | listener | 1 | unsubscribe | numai detaliu activ |
| `subscribeVehicleDailyDiagnostics` | diagnostics/day | listener | 1 zi | unsubscribe | retenție + limită samples |
| `subscribeVehicleDiagnosticHistory` | diagnostics | listener | interval | unsubscribe | paginare |
| `isPlateNumberUsed` | `vehicles` | read | limit 1 | one-shot | păstrează |
| `createVehicle` | `vehicles` + audit/event | writes | manual, 2-3 | n/a | callable pentru câmpuri sensibile |
| `updateVehicle` | `vehicles` + event | writes | manual, 1-2 | n/a | allowlist + trigger guard |
| `addVehicleEvent` | vehicle events | write | per acțiune | n/a | server-side audit/event |
| `getVehicleEvents` | vehicle events | read | nelimitat | one-shot | limit 50 + cursor |
| `addVehicleComment` | vehicle events | write | manual | n/a | rate limit |
| `uploadVehicleImages` | Storage images/full/thumb | storage | 2 uploads/fișier | browser cache thumbnail | hash + orphan cleanup |
| `saveVehicleImages` | `vehicles/{id}` | write | 1/lot | n/a | subcollection/summary viitor |
| `uploadVehicleDocuments` | Storage documents | storage | 1/fișier | fără dedupe | job universal |
| `analyzeVehicleDocumentWithAi` | callable | function+download+AI | 1/document | fără cache | hash/version cache |
| `enrichVehicleDocumentsWithAi` | callable loop | N calls secvențiale | N documente | fără cache | ingestion jobs |
| `saveVehicleDocuments` | `vehicles/{id}` | write | rescrie array | n/a | subcollection |
| `removeVehicleDocument` | vehicle metadata | write | 1 | nu șterge Storage | cleanup idempotent |
| `restoreVehicleDocuments` | vehicle metadata | write | 1 | n/a | operation log |
| `set/remove/restoreVehicleCover/Image(s)` | vehicle + Storage | write/storage | manual | thumbnails | outbox cleanup |
| `change/accept/claimVehicle` | callable/transaction | function+writes | manual | n/a | păstrează server-side |
| `updateVehicleMileage` | callable | function+transaction | manual/assistant | n/a | monotonic + audit |
| `deleteVehicle` | vehicle și relații | delete | manual admin | n/a | job cu dry-run |
| `subscribeVehiclePositions` | positions | listener | tab GPS | unsubscribe | protejat, fără schimbări V4 |
| `getVehiclePositionsRange*` | positions/archive | reads/storage | după interval | memory/persistent cache | protejat |
| `getLatestVehiclePosition` | positions | read | limit 1 | one-shot | protejat |
| `getVehiclePositionsIncremental` | positions | read | numai după cursor | shared/cache | protejat |
| `poll/subscribeVehiclePositionsRange` | positions | polling/listener | vizibil/interval | cleanup returnat | protejat |
| `getVehicleTrackerEvents/Commands` | tracker events/commands | read | limitat | one-shot | admin/assigned only |
| `requestVehicleCommand` | callable/command | function+write | manual | n/a | idempotency/rate limit |

### `src/modules/timesheets/services/timesheetsService.ts`

| Funcție | Path | Tip | Docs | Recomandare |
| --- | --- | --- | ---: | --- |
| `getProjectsList` | projects | read | limit param | default <=100 |
| `getActiveProjectsList` | projects | read | limitat | cache per sesiune |
| `getProjectById` | projects/id | read | 1 | păstrează |
| user project preference get/save | users/id | read/write | 1 | merge allowlist |
| `create/update/deleteProject` | projects + audit | writes/function | 1-3 | server-side, company scope |
| `getActiveTimesheetForUser` | timesheets/active lock | read | <=1 | păstrează |
| `startTimesheet` | secure callable | transaction | 2-4 writes | idempotent lock |
| `stopTimesheet` | secure callable | transaction | 2-4 writes | idempotent |
| `getTimesheetsList` | timesheets | read | nelimitat | P1: interval+cursor |
| `getTimesheetsManagementList` | timesheets | read | <=1000 | cursor 100 |
| `getTimesheetsForUser` | timesheets | read | limit param | interval obligatoriu |
| `getLatestTimesheetProjectForUser` | timesheets | read | limit 1 | păstrează/cache |
| `getTimesheetById` | timesheets/id | read | 1 | păstrează |
| `deleteTimesheet` | timesheets | delete/function | 1+audit | manager/admin |

### `src/modules/tools/services/toolsService.ts`

| Funcție | Path | Tip | Docs | Recomandare |
| --- | --- | --- | ---: | --- |
| `getUsersList` | users | read | nelimitat | operational views + limit |
| `getToolsList` | tools | read | <=500 | cursor 100 |
| `getToolById` | tools/id | read | 1 | păstrează |
| `findToolByQrCode/InternalCode`, uniqueness | tools | read | limit 1 | păstrează/index |
| `create/update/deleteTool` | tools + events | writes | 1-3 | service/callable |
| `addToolEvent/Comment` | tool events | write | 1 | audit server-side |
| `getToolEvents` | tool events | read | nelimitat | limit 50 + cursor |
| `upload/save/removeToolImages` | Storage + tools | storage/write | 2 uploads/fișier | hash/orphan cleanup |
| `setToolCoverImage` | tools | write | 1 | summary field only |
| holder/claim functions | tools | transaction/callable | 1 entity + audit | păstrează server-side |
| owned/held queries | tools | reads | nelimitat | limit/cursor + indexes |

### Maintenance, expenses, users, companies și leave

| Fișier / funcție | Path | Tip | Docs/frecvență | Recomandare |
| --- | --- | --- | --- | --- |
| `maintenanceService.get/subscribeMaintenanceClients` | maintenanceClients | read/listener | <=200 | load per tab, cursor |
| `getMaintenanceClientById` | maintenanceClients/id | read | 1 | păstrează |
| `create/update/deleteMaintenanceClient` | maintenanceClients | writes | manual | callable + audit |
| `getMaintenanceReportHistory` | client/rapoarte | read | nelimitat | cursor 50 |
| `subscribeMaintenanceReportHistory` | reports | listener | <=100 | only history tab |
| `subscribeMaintenanceReportsOverview` | collectionGroup rapoarte | listener | limitat | one-shot/cache dacă nu e live |
| `subscribeMaintenanceCompanyBranding` | firmeMentenanta | listener | <=50 | one-shot/cache |
| `uploadMaintenanceBrandingAsset` | Storage | storage | manual | hash + delete old |
| `saveMaintenanceReportHistory` | Storage/rapoarte | writes | per raport | idempotency |
| `expensesService.getExpenseDocuments` | expenseDocuments | read | <=1000 | cursor 50 |
| `getExpenseUsers/Companies` | operational/users/companies | read | nelimitat în fallback | limit + prefix |
| `getExpenseProjects` | projects | read | active limit | cache |
| preferences get/save | users | read/write | 1 | merge allowlist |
| `uploadExpenseFile` | Storage expenses | storage | 1, <=15 MB | hash before AI |
| `analyzeExpenseUploadedFile` | callable | function+AI | 1 | cache/version |
| `uploadAndAnalyzeExpenseDocument` | Storage+job+listener | mixed | 1 job | idempotent universal job |
| `save/deleteExpenseDocument` | expenseDocuments+Storage | write/delete | 1+1 | cleanup/outbox |
| `usersService.getAllUsers/subscribeUsers` | users/views | read/listener | <=250 | cursor/prefix |
| `getUserById/getUserAvatar` | users/id | read | 1 | shared cache |
| `uploadUserAvatar` | Storage+users | storage/write | 2 uploads + 1 write | delete previous |
| `updateUserWorkDetails/Profile` | users | callable/write | 1+audit | allowlist |
| `companiesService.getCompaniesList` | companies | read | nelimitat | limit/cursor |
| `getCompanyDirectoryData` | multiple | reads | mai multe liste | lazy sections |
| `deleteCompanyEverywhere` | multiple | scans/deletes | manual admin | server job + dry-run |
| `leaveRequests.subscribe...` | leaveRequests | listener | nelimitat generic | interval/limit |
| `getLeaveRequestsForUser` | leaveRequests | read | <=200 default | cursor/calendar |
| save/approve/delete leave | leaveRequests | writes/function | manual | audit server-side |

### Dashboard, notificări, audit și Control Panel

| Fișier / funcție | Path | Tip | Frecvență/Docs | Recomandare |
| --- | --- | --- | --- | --- |
| `dashboardService.getDashboardData` | users/timesheets/vehicles/etc. | reads | query-uri limitate, cache 30 min | păstrează bugetul |
| `getNotificationRules/subscribe...` | notificationRules | read/listener | <=100 | company query |
| create/update/delete notification rule | notificationRules | writes | manual manager | callable + schedule rebuild |
| `notificationsService.dispatchNotificationEvent` | callable | function | per eveniment | allowlist/idempotency |
| prune notifications | notifications | reads/deletes | 10 păstrate, batch | păstrează |
| `auditLogService.getAuditLogs` | auditLogs | read | <=800 | implicit 0, cursor 50 |
| `getAuditLogsForEntity` | auditLogs | read | <=40 | păstrează |
| `subscribeAuditLogs` | auditLogs | listener | opțional | numai la cerere |
| billing service callables | system metrics/BigQuery cache | function/read | refresh manual/30 min | cache server-side |
| `exportBackupDataset` | toate colecțiile | full reads | manual admin | job cu estimare |
| `getCollectionCounters` | collection count | count | admin | cache |
| `cleanupHistory` | audit/history | read/delete batches | manual | max + dry-run |

### Firebase Functions publicate în cod

| Grup | Functions | Tip/frecvență | Recomandare |
| --- | --- | --- | --- |
| Auth/company | `adminCreateUser`, `setPrimaryCompany`, `listCompanyChoices`, `claimInitialCompany`, `assignUsersToCompany` | callable/manual | App Check, rate limit, audit |
| Timesheets | `startTimesheetSecure`, `stopTimesheetSecure` | callable/manual | tranzacțional/idempotent |
| Vehicles/tools | `request/acceptVehicleTransfer`, `setVehicleAssignments`, `claimVehicle`, `updateVehicleMileage`, `request/acceptToolTransfer`, `claimTool`, `requestVehicleCommand` | callable/manual | company/role + audit |
| Audit/notifications | `recordAuditEvent`, `dispatchNotificationEvent`, `recordAssistantTraceOutcome`, `sendPushOnNotificationCreated` | callable/trigger | allowlist, dedupe, retention |
| Assistant/AI | `interpretAssistantCommand`, `transcribeAssistantAudio`, `analyzeVehicleDocument`, `analyzeExpenseDocument`, `processExpenseScanJob` | callable/trigger | context minim, hash/version/cost |
| Schedules | `checkTimesheetReminderAlerts`, `checkVehicleMaintenanceAlerts`, `checkMaintenancePartOrderReminders` | 5m/hourly | scheduler indexat; elimină vehicle scan |
| Proiecții | `syncVehicleOperationalView`, `syncUserOperationalViews` | document trigger | changed-key guard/split live |
| GPS archive | `archiveOldVehiclePositionDays`, `archiveOldVehiclePositionDaysScheduled`, `getFleetGpsOverview` | callable/schedule | task GPS separat |
| Billing/health | `refreshBillingMetrics`, `refreshBillingMetricsNow`, `getBillingControlPanelData`, `getLiveFirebaseCostEstimate`, `saveBillingCostSettings`, `saveFirestoreCostControl`, `getWorkControlHealth` | scheduled/callable | admin, cache, no rapid polling |
