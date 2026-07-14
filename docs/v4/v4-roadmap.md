# WorkControl V4 Roadmap

## Principii de livrare

- Opt taskuri, fiecare pe branch și PR separat.
- Nicio activare production fără quality gate și review adversarial.
- Rules multi-company sunt gate pentru taskurile de documente, chiar dacă implementarea
  security este livrată separat de acest roadmap.
- Migrarea este expand -> backfill -> dual-read -> cutover -> cleanup.
- GPS are branch, canary și rollback separate; taskurile de documente nu ating cod GPS.
- Feature flags per companie și per document type.
- Măsurare înainte/după pentru reads, writes, Functions, Storage și AI.

## Task 1 - Firebase Write Amplification Foundation

**Branch recomandat:** `perf/firebase-write-amplification-foundation`

**Problema:** `syncVehicleOperationalView` domină Functions, iar câmpurile volatile produc
scrieri repetate. Presence-ul utilizatorilor produce un al doilea flux de proiecții.

**Impact:** reducerea imediată a costului Firestore/Functions și stabilizarea fundației
înainte de a adăuga joburi/documente.

**Module și fișiere:** `functions/index.js`, trigger-ele de operational views,
proiecțiile vehicle/user, serviciile de listă, metric scripts. Gateway-ul se atinge numai
dacă un task GPS separat și canary demonstrează necesitatea.

**Risc:** ridicat. Poate afecta freshness/lista GPS dacă este implementat fără separarea
clară stable/live.

**Skill-uri:** `workcontrol-firebase-feature`, `workcontrol-debug-bug`,
`workcontrol-quality-check`, `workcontrol-code-review`.

**Criterii de acceptare:**

- telemetry per writer și trigger;
- `vehicleOperationalViews` nu mai include istorice/structuri volatile mari;
- live projection minimală și compatibilă;
- `syncVehicleOperationalView` sub 120 invocări/oră în profilul actual;
- writes reduse minimum 70% față de baseline-ul 126/minut;
- presence separată/debounced;
- zero loop și rollback prin feature flag;
- `GPS_VISUAL_BEHAVIOR_EQUIVALENT` și `GPS_FUNCTIONAL_DIFF_ZERO`.

**Teste:** unit changed-fields, Functions emulator, rules, concurrency, visual GPS desktop/
mobile, route parity, simulation parity, 24h canary metrics.

**Dependențe:** reconcilierea schemei operational views; nu depinde de document core.

**Paralel:** poate rula în paralel cu designul UI documente, dar nu cu altă modificare GPS,
gateway sau operational views.

## Task 2 - Document Intelligence Core

**Branch recomandat:** `feat/document-intelligence-core`

**Problema:** fluxurile de vehicule și bonuri nu au un job universal, hash, field-level
confidence, review/rollback sau versiuni.

**Impact:** fundație sigură și reutilizabilă pentru toate documentele.

**Module și fișiere:** Functions noi modulare, `src/lib/document-intelligence`, tipuri,
serviciu jobs, Storage paths/rules, Firestore rules/indexes, emulator tests.

**Risc:** ridicat din cauza datelor sensibile și a scrierilor automate.

**Skill-uri:** `workcontrol-create-feature`, `workcontrol-firebase-feature`,
`workcontrol-code-review`, `workcontrol-quality-check`.

**Criterii de acceptare:**

- `documentIngestionJobs` și state machine;
- SHA-256/dedupe, lease, retry și TTL;
- Structured Output strict + field results;
- review implicit și apply/rollback server-side;
- usage/model/cost/version persistate;
- App Check readiness, company isolation, audit server-side;
- niciun câmp de business scris direct de worker-ul AI.

**Teste:** duplicate/concurrency, retry, MIME/size/path, cross-company, invalid output,
low confidence, apply/rollback conflict, Functions/rules/storage emulator.

**Dependențe:** rules production reconciliate și backfill companyId verificat; poate folosi
telemetry din Task 1.

**Paralel:** nu cu schimbări concurente în `functions/index.js`, rules sau Storage rules.
Poate rula cu UI mocks și catalog readonly.

## Task 3 - Vehicle Document Intelligence

**Branch recomandat:** `feat/vehicle-document-intelligence`

**Problema:** documentele sunt array pe vehicul, analiza este sincronă/secvențială, iar
ștergerea lasă Storage orphan.

**Impact:** talon, RCA, ITP, CASCO, rovinietă și service devin gestionabile, auditate și
ușor de extins.

**Module și fișiere:** vehicle types/service, document subcollection/adaptor, vehicle
details documents tab, Functions mapping, Storage cleanup, indexes/rules.

**Risc:** ridicat, fiindcă vehiculul este o entitate critică și documentele legacy trebuie
păstrate.

**Skill-uri:** `workcontrol-create-feature`, `workcontrol-firebase-feature`,
`workcontrol-ui-modernization`, `workcontrol-quality-check`.

**Criterii de acceptare:**

- subcollection documents + `documentSummary`;
- dual-read adaptor pentru array legacy;
- mapping exact pentru cele șase tipuri;
- date calendaristice valide;
- km/owner/driver/status nu se auto-aplică;
- cleanup idempotent Storage;
- review, replace, supersede și rollback;
- lista vehicule nu descarcă documente complete;
- zero import sau modificare în componentele GPS.

**Teste:** fiecare document type, duplicate, wrong vehicle, plate/VIN conflict, invalid
date, km regression, storage orphan, legacy read, E2E upload/review/apply.

**Dependențe:** Task 2 și gate-ul security.

**Paralel:** nu cu refactorizarea `vehiclesService.ts` sau vehicle detail. Poate rula în
paralel cu Task 4 după stabilirea contractelor event/schedule.

## Task 4 - Expiry Automation Engine

**Branch recomandat:** `feat/expiry-automation-engine`

**Problema:** reminders sunt dispersate, iar scanarea orară a vehiculelor nu scalează.

**Impact:** notificări corecte, fără full scans, pentru vehicule, lifturi, scule și facturi.

**Module și fișiere:** notification rules/services, Functions scheduler/dispatcher,
`notificationSchedules`, events/deliveries, rules/indexes, notification UX.

**Risc:** mediu-ridicat; risc de spam, duplicate și notificări cross-company.

**Skill-uri:** `workcontrol-firebase-feature`, `workcontrol-create-feature`,
`workcontrol-debug-bug`, `workcontrol-quality-check`.

**Criterii de acceptare:**

- query `nextRunAt <= now`, limitat și indexat;
- zero full scan vehicule/documente în schedule;
- lease + dedupe + rate limit;
- Europe/Bucharest/DST corect;
- destinatari company-scoped;
- no duplicate delivery 7 zile canary;
- migrare controlată de la reminders vechi.

**Teste:** thresholds, DST, concurență, rule disabled, changed expiry, cross-company,
disabled user, duplicate recipient, retry push, rate limits.

**Dependențe:** contractul Task 2; poate porni cu evenimentele actuale.

**Paralel:** poate rula în paralel cu Task 3 după înghețarea contractului
`document_expiry_*`; nu cu alte schimbări notification scheduler.

## Task 5 - Document Intelligence for Expenses, Tools and Maintenance

**Branch recomandat:** `feat/document-intelligence-business-modules`

**Problema:** expenses au un pipeline separat, iar sculele/lifturile nu au document model
comun.

**Impact:** un singur motor pentru bonuri/facturi, garanții și documente lift, cu cost și
review coerente.

**Module și fișiere:** expenses scan service/page, tools types/service/details,
maintenance client/lift service, Functions adapters, migrations și rules.

**Risc:** ridicat; include migrarea unui flow existent care funcționează.

**Skill-uri:** `workcontrol-create-feature`, `workcontrol-firebase-feature`,
`workcontrol-ui-modernization`, `workcontrol-code-review`.

**Criterii de acceptare:**

- jobul expense actual folosește core-ul fără regresie;
- retry/dedupe și review per field;
- tool document subcollection și mapping numai către câmpuri existente;
- lift documents și match serial/adresă cu clarificare;
- fără duplicarea expense când o factură service este legată și la vehicul;
- migrare/backward compatibility documentată.

**Teste:** bon/factură, garanție, certificat lift, entity ambiguity, duplicate cross-module,
legacy expense, upload failure/cleanup, E2E per modul.

**Dependențe:** Task 2; Task 3 pentru factură service cross-link; Task 4 pentru expirări.

**Paralel:** modulele expense/tool/maintenance pot fi PR-uri interne separate după contract
stabil, dar nu modifică simultan core worker/rules.

## Task 6 - Assistant Document Tools

**Branch recomandat:** `feat/assistant-document-tools`

**Problema:** Assistant V3 nu poate încă lista, încărca, revizui, aplica sau configura
expirări prin tool-uri controlate.

**Impact:** operare vocală rapidă fără DOM fallback și fără Firebase direct în UI.

**Module și fișiere:** assistant tool registry, adapters, contract/prompt, page actions,
server audit callables, command matrix și UI confirmation.

**Risc:** mediu-ridicat; o interpretare greșită ar putea modifica date.

**Skill-uri:** `workcontrol-create-feature`, `workcontrol-firebase-feature`,
`workcontrol-debug-bug`, `workcontrol-quality-check`.

**Criterii de acceptare:**

- tool-urile din `assistant-integration-plan.md` în registry unic;
- permission înainte de resolve;
- confirmare pentru apply/rollback/rules;
- form/file picker prin action declarat;
- clarificare la entitate ambiguă;
- audit server-side;
- zero arbitrary DOM fallback și zero Firebase direct în componentă;
- minimum 40 comenzi document-specific în matrice, pe lângă suita existentă.

**Teste:** command matrix, ambiguity, permission, confirmation, navigation no-fill,
idempotency, rollback, STT fallback și E2E admin/manager/employee.

**Dependențe:** Tasks 2-5 pentru API-uri stabile.

**Paralel:** partea de contract/mocks poate rula cu Task 5; integrarea reală nu înainte de
API freeze.

## Task 7 - Document Center UX

**Branch recomandat:** `feat/document-center-ux`

**Problema:** utilizatorul nu are o vedere unică pentru documente, review și expirări.

**Impact:** adoptare, claritate și mai puține documente omise.

**Module și fișiere:** navigation/action registry, document inbox, Vehicle Documents,
Expiry Center, responsive primitives, loading/error/empty/permission states.

**Risc:** mediu; principalul risc este încărcarea prea multor documente.

**Skill-uri:** `workcontrol-ui-modernization`, `workcontrol-create-feature`,
`workcontrol-quality-check`.

**Criterii de acceptare:**

- inbox global paginat și filtrat server-side;
- Vehicle Documents cu status, expirare, preview, review, replace și history;
- Expiry Center bazat pe summaries/schedules, nu full scans;
- mobile upload în maximum două acțiuni după alegerea entității;
- accesibilitate, touch targets, focus/dialog trap;
- state complete și fără overflow la 360/390/768/1366/1920;
- query budgets respectate.

**Teste:** component, accessibility, visual regression, upload/review/apply/replace,
filters/cursors, offline/retry presentation, role permissions.

**Dependențe:** Task 2 pentru API; poate folosi mocks înainte de Task 3/5.

**Paralel:** poate rula în paralel cu Tasks 3-5 dacă tipurile/API sunt generate și înghețate;
nu cu altă reorganizare a acelorași pagini.

## Task 8 - Observability, Rollout and Legacy Cutover

**Branch recomandat:** `feat/document-observability-rollout`

**Problema:** noile flow-uri nu pot fi activate în siguranță fără cost, quality, migration
și rollback observabile.

**Impact:** trecere controlată de la legacy la V4 și cost predictibil.

**Module și fișiere:** Control Panel metrics, Functions telemetry, migration scripts,
feature flags, docs/runbooks, cleanup jobs și dashboards.

**Risc:** mediu-ridicat; cleanup prematur poate pierde accesul la legacy.

**Skill-uri:** `workcontrol-firebase-feature`, `workcontrol-quality-check`,
`workcontrol-code-review`, `workcontrol-safe-deploy` numai după cerere explicită.

**Criterii de acceptare:**

- dashboard jobs/success/review/failure/dedupe/tokens/cost;
- cost per document type și companie fără PII;
- migration dry-run, backfill, reconciliation și rollback;
- canary o companie, apoi 10%/50%/100%;
- zero orphan Storage și zero duplicate expense;
- legacy array read oprit numai după reconciliere 100%;
- rules restrictive, indexes și App Check validate;
- runbook incident și SLO document processing.

**Teste:** migration fixtures, dual-read parity, failure injection, retry/dead-letter,
budget alarms, production-like emulator dataset, smoke per rol și cleanup rehearsal.

**Dependențe:** Tasks 1-7 și gate security închis.

**Paralel:** telemetry poate începe devreme; cutover/cleanup nu rulează în paralel cu alte
migrații sau deploy-uri de rules.

## Primele trei taskuri recomandate imediat

1. **Task 1 - Firebase Write Amplification Foundation.** Reduce costul actual înainte de
   a adăuga trafic nou.
2. **Task 2 - Document Intelligence Core**, imediat după reconcilierea rules P0.
3. **Task 4 - Expiry Automation Engine**, dezvoltat pe contractele Task 2, deoarece elimină
   full scans și oferă valoare operațională pentru toate modulele.

Task 3 poate porni în paralel cu Task 4 după stabilizarea core-ului. Taskurile 6 și 7 pot
folosi mocks, dar integrarea lor reală depinde de API-urile Tasks 2-5.

## Matrice completă de implementare și operare

Această matrice completează fiecare task cu schema, Functions, UI, securitate, cost,
deploy și rollback cerute.

| # | Firestore schema | Functions | UI | Security | Impact cost | Deploy order | Rollback |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | split operational/live views; presence view; metric counters | guards/projections/telemetry | fără schimbare vizuală; adaptoare transparente | aceleași roluri/company | foarte mare reducere writes/triggers | Functions compatibile -> backfill view -> Hosting read -> canary | feature flag la proiecția veche; nu șterge view vechi |
| 2 | `documentIngestionJobs`, apply operations, dedupe markers | create/process/review/apply/rollback | UI Lab + review shell minim | deny client writes, App Check, company | adaugă cost AI, evită duplicate | indexes/rules inactive -> Functions -> emulator -> flag admin | dezactivează flag; jobs rămân auditate, fără apply |
| 3 | vehicle document subcollection + summary | map/apply/delete cleanup | Vehicle Documents | owner/assigned/manager separat; tracker exclus | scade reads vehicule, adaugă jobs | dual-read -> backfill -> Hosting -> rules -> cutover | read legacy array; nu șterge Storage/array |
| 4 | schedules/events/deliveries | schedule builder/worker/dispatcher | preset editor + inbox actions | recipients company-only, rate limit | elimină full scans, writes predictibile | create schedules shadow -> compare -> enable canary -> stop old | disable worker flag și reactivează schedules legacy |
| 5 | tool/lift docs; expense job linkage | module adapters | wizards per modul | permissions per entity/document | dedupe AI și thumbnails reduc cost | module cu module, expense ultimul | adaptor legacy per modul; jobs neaplicate |
| 6 | numai logs/context IDs; fără document brut | tool callables existente/noi | confirmation/choices/debug admin | permission before resolve, audit server | evită AI pentru navigare, max 1 call complex | registry -> read tools -> write tools per rol | disable document tools flag; assistant navigation rămâne |
| 7 | saved view metadata opțional; fără duplicate business data | numai query endpoints necesare | inbox, expiry, vehicle docs, mobile | route/action guards și permission states | lazy/pagination respectă budgets | read-only UI -> review -> apply controls | feature flags pe suprafețe, rutele vechi rămân |
| 8 | metrics, migration markers, cleanup jobs | observability/reconciliation/cleanup | Control Panel V4 | admin-only, logs fără PII | detectează drift și permite cleanup | telemetry -> canary -> rollout -> cleanup separat | oprește cleanup, revine dual-read, restaurează din backup |

## Ordinea de deploy recomandată pentru fiecare etapă Firebase

1. Functions compatibile backward;
2. indexes;
3. migration dry-run și backfill;
4. Hosting dual-read;
5. Firestore/Storage Rules restrictive;
6. canary per companie;
7. rollout gradual;
8. cleanup legacy într-un deploy separat.

Niciunul dintre acești pași nu este executat de acest audit.
