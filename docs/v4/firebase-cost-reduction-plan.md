# Firebase Cost Reduction Plan

## 1. Baseline măsurat

Baseline-ul read-only din producție, pe o fereastră de 60 minute:

- 2.574 citiri, adică 42,9/minut;
- 7.585 scrieri, adică 126,42/minut;
- 2.497 requesturi Functions, adică 41,62/minut;
- aproximativ 9,50 MiB egress estimat;
- aproximativ 3,2 listeners și 2,08 conexiuni active medii.

Extrapolarea este doar orientativă:

| Resursă | Ritm/zi dacă ora este reprezentativă | Cotă gratuită relevantă |
| --- | ---: | ---: |
| Citiri | ~61.776 | 50.000/zi |
| Scrieri | ~182.045 | 20.000/zi |
| Functions requests | ~59.928 | 2 milioane/lună total |
| Egress | ~228 MiB/zi, ~6,8 GiB/lună | 10 GiB/lună Firestore |

La tarifele exemplificative Firestore de aproximativ 0,06 USD/100k reads și
0,18 USD/100k writes, operațiile plătite peste cota zilnică ar fi în jur de 0,30 USD/zi,
majoritar writes. Prețul real depinde de regiune, SKU, free tier, egress și curs; Cloud
Billing Export rămâne sursa financiară de adevăr.

Surse oficiale:

- <https://firebase.google.com/docs/firestore/pricing>
- <https://firebase.google.com/pricing>

## 2. Obiective

| Indicator | Baseline | Țintă 30 zile |
| --- | ---: | ---: |
| Writes/minut | 126,4 | sub 20 în repaus, sub 45 cu flotă activă |
| `syncVehicleOperationalView`/oră | 2.282 | sub 120 |
| `syncUserOperationalViews`/oră | 124 | sub 30 |
| Reads/minut | 42,9 | sub 25 medie, fără pierdere UX |
| Full scans programate | 1+ | 0 |
| Liste fără limită în UI | 7+ | 0 |
| GPS visual diff | n/a | zero |

## 3. Faza 0 - Observabilitate înainte de schimbare

1. Metrici per writer: gateway snapshot, point, day parent, diagnostic, operational view,
   user presence, notification, audit.
2. Câmpuri: `source`, `operation`, `companyIdHash`, `documentsWritten`, `bytesEstimate`,
   `durationMs`, fără date personale sau coordonate.
3. Dashboards pentru 5/15/60 minute și comparație deploy marker.
4. Alertă la write rate, trigger loop, error rate și egress.
5. Feature flags și rollback pentru orice schimbare GPS-cost.

## 4. Faza 1 - Reducerea amplificării de scrieri

### 4.1 Vehicule

Separă proiecțiile:

- `vehicleOperationalViews/{vehicleId}`: date stabile de listă, asignări, status,
  document alerts sumarizate, fără puncte și istorice;
- `vehicleLiveViews/{vehicleId}`: poziție/speed/ignition/updatedAt minimal;
- tracker/admin: colecție admin-only, fără expunere în listă.

Trigger-ul nu trebuie să compare/scrie structuri mari (`gpsSimHistory`, `documents`,
`rawIo`) la fiecare pachet. Variante sigure:

1. gateway-ul actualizează direct documentul live minimal la interval controlat; sau
2. trigger-ul verifică `changedKeys` și iese imediat pentru câmpurile nerelevante; sau
3. Eventarc/PubSub agregă latest state, cu idempotency.

Orice variantă este canary și trebuie să păstreze exact traseul și poziția vizuală.

### 4.2 Users/presence

- mută `isOnline`, `lastSeenAt`, `lastActiveAt` într-un `userPresenceViews` mic;
- debounce 60-120 secunde și write numai la schimbare de stare;
- profilul operațional se rescrie doar pentru nume, rol, departament, companie, avatar;
- TTL pentru presence vechi, fără schedule full scan.

## 5. Faza 2 - Query budgets și paginare

Bugetele sunt limite de proiectare per sesiune vizibilă, nu promisiuni de facturare.

Estimările „actual” sunt plafoane deduse din limitele codului pentru o încărcare rece. Un
query poate returna mai puține documente; telemetry trebuie să înlocuiască estimarea după
instrumentare.

| Pagină | Initial actual estimat | Țintă | Reads/oră actual estimat | Țintă | Listeners țintă | Docs/query | Storage/Functions țintă |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Dashboard | 40-90 | <=75 | 0-90 | <=25 | 0-1 | <=50 | 0 MB, 0-1 callable cache |
| Toate GPS-urile | <=250 + trasee | <=50 + cache traseu | dependent de flotă | refresh 10 min | <=1 list | <=50 vehicule | traseu din cache; 0 callable implicit |
| Mașina mea | vehicul + zi traseu | aceeași încărcare | full/incremental variabil | numai incremental | 1-2 | puncte după cursor | archive lazy; 0 AI |
| Pontaje manager | până la 1.000 | <=120 | până la 1.000/refresh | <=120 | 0-1 active | 100 | export numai manual |
| Pontajul meu | 20-50 | <=35 | 0-50 | <=20 | 1 active | <=30 | 2 callables start/stop manual |
| Proiecte | toate/limită variabilă | <=60 | variabil | <=15 | 0 | <=60 | 0 MB, CRUD manual |
| Scule | <=500 + users nelimitat | <=100 | 0-500 | <=30 | 0 | 100 | thumbnails lazy |
| Concedii planner | până la 410 din 4 query-uri | <=100 | listener deltas | <=60 | <=2 | <=100 | PDF local, callables doar acțiuni |
| Mentenanță | 200 clienți + 50 branding + tab data | <=100/tab | listener deltas | <=50 | <=1/tab | <=100 | PDF/imagini lazy |
| Companii | listă nelimitată + directoare | <=100/secțiune | 0 | <=20 | 0 | <=100 | export/delete numai job manual |
| Profil | ~50 din 3 listeners | <=35 | deltas | <=20 | <=3 mici | <=20 | avatar thumb, <=2 uploads manual |
| Notificări | 10-30 | 10 | deltas | <=20 | 1 | 10-30 | push event-driven |
| Control Panel | count/full backup la cerere | <=50 normal | refresh metrics | <=20 | 0 | <=20 | <=2 callables/30 min |
| Asistent | 0 Firestore pentru navigare | 0 | per comandă | <=10 reads/comandă complexă | 0 | <=5 rezultate | 0 AI la navigare; max 1 interpretare |
| Bonuri/OCR | până la 1.000 listă | <=50 | 1 job listener | <=20 + job | 1 temporar | 50 | max 15 MB și 1 AI/job |
| Istoric | până la 800 | 0 implicit/50 la cerere | listener opțional | 0 implicit | 0 | 50 | 0 MB |

| Pagină | Initial reads | Reads/oră vizibilă | Listeners | Reguli |
| --- | ---: | ---: | ---: | --- |
| Dashboard | <=75 | <=25 | 0-1 | agregări/cache 30 min |
| Pontaje manager | <=120 | <=120 | 0-1 doar active | cursor 100/page |
| Pontajul meu | <=35 | <=20 | 1 activ | timer local |
| Proiecte | <=60 | <=15 | 0 | search local pe pagina curentă |
| Users | <=100 | <=50 | 0-1 | operational views + cursor |
| Vehicles list | <=100 | <=60 | 0-1 | proiecție stabilă |
| Vehicle detail fără GPS | <=30 | <=30 | 1 document | subliste lazy |
| Toate GPS-urile | <=50 vehicule + route cache | refresh la 10 min | max 1 list | nicio schimbare V4 |
| Mașina mea GPS | route initial + incremental | numai puncte noi | controlat | nicio schimbare V4 |
| Tools | <=100 | <=30 | 0 | cursor 100/page |
| Maintenance | <=100 | <=50 | 0-1/tab | încărcare pe tab |
| Leave | <=100 | <=60 | max 2 | interval lunar |
| Expenses | <=100 | <=20 | 1 job temporar | cursor 50/page |
| Notifications | 10 | <=20 | 1 limitat | retenție 10/user |
| History | 50 | 0 până la „Afișează” | 0 implicit | cursor |
| Control Panel | <=50 | <=20 | 0 | callable cache, admin-only |

Remedieri concrete:

- `getTimesheetsList`: interval obligatoriu + limit + cursor;
- vehicle/tool events: 50/page;
- maintenance report history: 50/page;
- expense documents: 50/page;
- companies/users option lists: operational projections și căutare prefix limitată;
- leave requests: interval calendaristic și limită;
- audit: fără listener implicit, numai după acțiunea utilizatorului.

## 6. Faza 3 - Schedules fără full scans

Model propus:

```text
notificationSchedules/{scheduleId}
  companyId
  sourceType
  sourceId
  ruleType
  nextRunAt
  status
  dedupeKey
  lastEvaluatedAt
  version
```

Scheduler-ul citește numai `status == active AND nextRunAt <= now`, ordonat, limitat 100.
După procesare, actualizează `nextRunAt` sau închide schedule-ul. Astfel dispar:

- scanarea orară a tuturor vehiculelor;
- recalcularea zilnică a tuturor documentelor;
- notificările duplicate generate de mai multe instanțe.

### Implementare WorkControl

- regulile recurente de pontaj sunt proiectate in `notificationSchedules` de triggerul
  `syncNotificationRuleSchedules`;
- workerul `checkTimesheetReminderAlerts` citeste numai programarile scadente, ordonate
  dupa `nextRunAt`, cu limita 40 si lease tranzactional;
- utilizatorii, pontajele si concediile sunt citite numai pentru compania unei programari
  scadente; nu mai exista scanari globale la fiecare 5 minute;
- markerii existenti `timesheetReminderMarkers` raman sursa de idempotency;
- programarile vechi cu peste 15 minute intarziere sunt avansate fara notificari expirate;
- workerii de remindere ruleaza intre 05:00 si 21:59, `Europe/Bucharest`. Noaptea nu
  produc invocari Scheduler/PubSub, reads sau notificari; aplicatia si GPS raman
  disponibile la cerere.

Migrare compatibila:

```text
npm run timesheet-schedules:dry-run -- --project workcontrol-53b1d
node scripts/backfill-timesheet-reminder-schedules.mjs --mode apply --project workcontrol-53b1d --confirm-project workcontrol-53b1d
```

Rollback: redeploy workerul anterior si sterge numai documentele cu
`workerType=timesheet_reminders_v1`. Regulile, notificarile si pontajele nu sunt mutate.
Aceasta faza nu modifica ingestia, istoricul, simularea sau randarea GPS.

## 7. Faza 4 - Documente și media

- metadatele documentelor devin subcolecții, nu array mare pe entitate;
- listarea entităților citește doar `documentSummary` cu `count` și `nextExpiryAt`;
- thumbnail/previews separate de original;
- SHA-256 pentru dedupe înainte de AI;
- rezultat AI cache-uit după `hash + extractorVersion + schemaVersion`;
- cleanup Storage prin outbox/job idempotent;
- lifecycle/retention pentru originale și joburi, conform politicii firmei;
- PDF/image limits aliniate între UI, Storage Rules și Functions (astăzi 20 MB vs 18 MB
  pentru vehicule).

### Implementare 2026-07-16

- `vehicles.documents` rămâne compatibil pentru UI-ul existent, dar fiecare salvare, ștergere,
  restaurare și decizie AI scrie și `documentSummary`.
- Functions scrie metadate compacte în `vehicles/{vehicleId}/documents/{documentId}` cu write
  server-side only; clientul poate citi subcolecția doar dacă are acces la vehicul.
- `vehicleOperationalViews` expune `documentSummary`, astfel listele viitoare pot evita citirea
  array-ului mare de documente.
- limita documentelor vehicul este aliniată la 18 MB în UI, Storage Rules și Functions.
- uploadul de documente vehicul acceptă doar PDF, JPG, PNG și WEBP.
- uploadul offline de bonuri este aliniat cu limita online de 15 MB.
- scanarea bonurilor cache-uiește rezultatul AI după `companyId + sha256 + scanMode +
  extractionVersion + schemaVersion`; duplicatele refolosesc analiza fără apel OpenAI nou.

Rămase pentru increment separat:

- backfill `documentSummary` și subcolecții compacte pentru toate documentele istorice;
- migrarea listelor mari să citească doar `documentSummary`, după backfill verificat;
- cleanup Storage prin outbox/job idempotent pentru documentele șterse;
- lifecycle/retention configurabil pentru originale, cache și joburi vechi.

## 8. Cost AI document intelligence

Modelul curent implicit este `gpt-4.1-mini`. La tarifele oficiale consultate:

- input: 0,40 USD / 1M tokeni;
- cached input: 0,10 USD / 1M tokeni;
- output: 1,60 USD / 1M tokeni.

Estimare ilustrativă per document:

| Profil | Input | Output | Cost model aproximativ |
| --- | ---: | ---: | ---: |
| imagine simplă | 2k tokeni | 300 | ~0,0013 USD |
| document mediu | 8k | 600 | ~0,0042 USD |
| PDF dens/multipagină | 15k | 1k | ~0,0076 USD |

Imaginile/PDF-urile sunt tarifate în tokeni; costul real trebuie salvat din `usage` per job.
Nu se poate declara un cost fix per pagină fără măsurare. Sursa oficială:
<https://developers.openai.com/api/docs/pricing>.

### Costuri auxiliare per document

| Componentă | Operații tipice | Estimare/strategie |
| --- | --- | --- |
| Storage original | 1 upload + stocare MB-lună + download la procesare | variabil pe regiune; comprimă și limitează pagini/rezoluție |
| Thumbnail | 1 download/sursă + 1 upload + stocare mică | generează o dată și cache immutable |
| Firestore | 3-8 writes status/result/apply + 1-5 reads | mult sub 0,001 USD/document la rate standard, fără duplicate |
| Functions | 1-3 invocări/job | 2M invocări/lună free tier, apoi aproximativ 0,40 USD/M, compute separat |
| Notifications | 1 event + N deliveries + push | FCM nu taxează mesajul standard; Firestore/Functions rămân costul |
| Email | numai dacă este activat | depinde de provider, separat de Firebase |

Buget orientativ complet pentru un document mediu: 0,002-0,02 USD, excluzând retenția
pe termen lung și emailul. Limita superioară acoperă PDF-uri mai grele, retry și model
escalation. Orice depășire trebuie vizibilă în Control Panel, nu ascunsă într-o medie.

## 9. Ordine de livrare și rollback

1. baseline/telemetry;
2. proiecții stabile și `changedKeys` guard;
3. canary un vehicul, fără schimbare vizuală;
4. rollout progresiv 10%/50%/100%;
5. paginare și query budgets;
6. scheduler indexat;
7. document subcollections și adaptoare legacy;
8. activare AI în review mode.

Rollback-ul trebuie să poată reveni la writer-ul anterior fără migrare inversă imediată.
Dual-read este permis temporar; dual-write trebuie limitat și măsurat pentru a nu dubla
costul.

## 10. Verificări de acceptare

- 24 ore de metrici înainte și după;
- writes/minut și trigger invocations reduse conform țintei;
- fără full scans în schedules;
- toate listele au limit/cursor;
- costul Cloud Billing și estimarea din Control Panel sunt reconciliate zilnic;
- regression screenshots și teste GPS trec;
- `GPS_FUNCTIONAL_DIFF_ZERO` confirmat.
