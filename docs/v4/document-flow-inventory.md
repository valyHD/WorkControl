# Document Flow Inventory

## 1. Scop

Acest document descrie fluxurile de fișiere existente, de la selecția din browser până la
Storage, Firestore, procesare AI, afișare și ștergere. Nu presupune că un câmp sau un tip de
document există dacă nu este prezent în cod.

## 2. Matricea fluxurilor existente

| Domeniu | Fișier | Storage path | Firestore | Procesare | Cleanup |
| --- | --- | --- | --- | --- | --- |
| Avatar utilizator | imagine | path utilizator din service | `users/{uid}` URL full/thumb | compresie client | vechiul asset trebuie verificat la înlocuire |
| Vehicul - imagini | JPEG generat | `vehicles/{vehicleId}/images/*` și thumb | array `images` pe vehicul | resize/compresie client | ștergere obiecte implementată pentru imagini |
| Vehicul - documente | image/PDF/business docs | `vehicles/{vehicleId}/documents/{category}/*` | array `documents` pe vehicul | callable AI sincron | eliminarea metadata nu șterge Storage |
| Scule - imagini | JPEG full/thumb | `tools/{toolId}/images/*` | array `images` pe sculă | resize/compresie client | ștergere full/thumb implementată |
| Bonuri/facturi | JPEG/PNG/WEBP/PDF | `expenses/{userId}/*` | `expenseScanJobs`, apoi `expenseDocuments` | trigger AI asincron sau callable | expense delete șterge Storage |
| Branding mentenanță | logo/ștampilă | path branding | `firmeMentenanta` | fără AI | cleanup la înlocuire trebuie validat |
| Rapoarte mentenanță | PDF + imagini | maintenance reports paths | `rapoarte`/history | generare PDF/email | retenție explicită lipsește |
| Concediu | PDF client-side | download/local flow | `leaveRequests` | fără AI | nu este document ingestion |

### Tipurile de business cerute versus suport actual

| Tip | Suport actual |
| --- | --- |
| Talon / carte identitate vehicul | nu are categorie dedicată; ajunge `other` și schema AI actuală este insuficientă |
| RCA | categorie și expirare existente |
| CASCO | categorie și expirare existente |
| Rovinietă | categorie și expirare existente |
| ITP | categorie și expirare existente |
| Factură service | categorie `service`; fără linii/service history structurat |
| Bon/factură expense | suport AI bogat în modul Expenses |
| Garanție/document sculă | nu există document model, numai imagini și câmpuri garanție |
| Contract/document lift | nu există ingestion; rapoartele PDF sunt doar istoric |
| Leasing | există categoria `leasing_rate`, nu contract intelligence |

### Componente și servicii exacte

| Flux | UI | Service |
| --- | --- | --- |
| Avatar | `src/modules/users/pages/MyProfilePage.tsx` | `usersService.uploadUserAvatar` |
| Vehicul imagini | `VehicleFormPage`, `VehicleImageUploader` | `vehiclesService.uploadVehicleImages/saveVehicleImages` |
| Vehicul documente | `VehicleFormPage`, `VehicleDocumentUploader`, `VehicleDocumentsPanel` | `uploadVehicleDocuments`, `enrichVehicleDocumentsWithAi`, `saveVehicleDocuments` |
| Bon scan | `ExpenseScanPage` | `uploadExpenseFile`, `uploadAndAnalyzeExpenseDocument` |
| Facturi/istoric | `ExpenseInvoicesPage` | `uploadExpenseFile`, `saveExpenseDocument`, `deleteExpenseDocument` |
| Scule imagini | `ToolFormPage`, `ToolImageUploader` | `uploadToolImages`, `saveToolImages` |
| Branding/rapoarte | `MaintenanceWorkspace` | `uploadMaintenanceBrandingAsset`, `saveMaintenanceReportHistory` |

Există o inconsecvență P1 în UI-ul vehiculului: `VehicleDocumentUploader` afirmă că acceptă
„orice tip de fișier” și inputul nu are `accept`, dar Storage Rules acceptă doar PDF și
imagini JPEG/PNG/WEBP. Fișiere Word/Excel vor fi selectabile și apoi respinse la upload.
UI-ul și service-ul trebuie aliniate la aceeași allowlist și limită înainte de orice
extindere.

## 3. Vehicule - imagini

### Flux actual

1. UI selectează imagini.
2. Service-ul convertește/normalizează în JPEG.
3. Încarcă full și thumbnail în Storage.
4. Obține URL-urile.
5. Salvează metadatele în array-ul `images` din `vehicles/{vehicleId}`.
6. Poate seta cover image separat.

### Puncte bune

- thumbnail separat;
- metadate suficiente pentru afișare și ștergere;
- serviciu dedicat;
- Storage Rules au limită de dimensiune.

### Riscuri

- rescrierea array-ului vehiculului declanșează proiecția operațională;
- nu există job/outbox pentru cleanup în cazul în care uploadul reușește și write-ul
  Firestore eșuează;
- nu există hash pentru dedupe.

## 4. Vehicule - documente

### Flux actual

1. Fișierul este încărcat la
   `vehicles/{vehicleId}/documents/{category}/{timestamp_name}`.
2. Se creează `VehicleDocumentItem` în memorie.
3. `enrichVehicleDocumentsWithAi` analizează secvențial fiecare document nou prin
   `analyzeVehicleDocument`.
4. Rezultatul este atașat în `aiAnalysis`.
5. Dacă există date recunoscute, serviciul poate actualiza `nextItpDate`, `nextRcaDate`,
   `nextCascoDate` sau `nextRovinietaDate`.
6. Array-ul complet `documents` este salvat pe vehicul.

### Validări existente

- Storage Rules: limită 20 MB și MIME-uri de document business;
- Function: limită practică 18 MB;
- storage path trebuie să înceapă cu `vehicles/`;
- actorul este verificat față de companie/asignare în callable;
- OpenAI răspunde cu JSON Schema strict.

`VehicleDocumentUploader` nu validează explicit dimensiunea sau MIME-ul. Pentru imagini,
`VehicleImageUploader` validează tipuri JPEG/PNG/WEBP/HEIC/HEIF și o limită configurată,
apoi service-ul normalizează la JPEG; documentele nu au aceeași protecție client-side.

### Defecte și inconsistențe

- limită 20 MB în Storage, dar 18 MB în Function;
- UI/service nu are o validare client unică și explicită pentru size/MIME înainte de upload;
- `isDateString` verifică numai forma `YYYY-MM-DD`, nu data calendaristică;
- `confidence` este global, nu per câmp;
- nu există review draft, motiv de acceptare, `acceptedBy` sau rollback;
- nu există SHA-256, `schemaVersion`, `extractorVersion`, token usage sau cost per job;
- același fișier poate fi analizat repetat;
- analizarea mai multor fișiere este secvențială;
- ștergerea documentului elimină metadata, dar nu șterge obiectul Storage;
- array-ul de documente mărește fiecare read al vehiculului și fiecare update.

## 5. Bonuri și facturi

### Flux asincron actual

1. UI validează fișierul și îl încarcă în `expenses/{userId}/...`.
2. Creează `expenseScanJobs/{jobId}` cu `status: queued`.
3. Clientul ascultă documentul jobului, cu timeout de 180 secunde.
4. `processExpenseScanJob` trece jobul în `processing`.
5. Function descarcă fișierul, apelează OpenAI cu JSON Schema strict și normalizează
   rezultatul.
6. Creează `expenseDocuments/{expenseDocumentId}`.
7. Jobul devine `completed` sau `failed`.
8. Listener-ul client se închide la succes, eroare sau timeout.

### Flux sincron alternativ

`analyzeExpenseDocument` permite analiză callable directă, inclusiv mod `fast`/`full`.
Existența ambelor căi trebuie justificată și unificată în arhitectura V4; altfel aceleași
documente pot avea comportamente diferite.

### Puncte bune

- limite și MIME-uri clare în UI/Storage;
- job asincron și progres;
- rezultat structurat bogat;
- ștergerea expense șterge și Storage;
- listener document unic, cu unsubscribe.

Inputurile `ExpenseScanPage`/`ExpenseInvoicesPage` afișează și extensii `.txt/.doc/.docx`,
dar `uploadExpenseFile` acceptă efectiv numai PDF/JPEG/PNG/WEBP, maximum 15 MB. Aceasta este
o a doua inconsecvență UI/service care trebuie corectată; offline queue are limită 12 MB,
deci un fișier de 13-15 MB poate funcționa online și eșua offline.

### Riscuri

- `onDocumentCreated` nu are cheie idempotentă explicită;
- nu există hash/dedupe;
- nu există retry policy controlat, dead-letter sau reluare din UI;
- `failed` poate conține mesaje interne prea detaliate dacă nu sunt normalizate;
- nu există TTL pentru joburile vechi;
- nu se păstrează usage/cost/model/extractor version;
- analiza este salvată direct ca document final, fără review per câmp.

## 6. Scule

Există imagini full/thumb, dar nu există model de documente pentru:

- factură de achiziție;
- certificat de garanție;
- proces verbal de predare;
- fișă service;
- manual/certificat.

Câmpurile existente relevante sunt `warrantyText` și `warrantyUntil`. Orice document
intelligence pentru scule necesită o subcolecție nouă și migrare, nu poate presupune că
`ToolItem` are deja `documents`, serie sau dată de achiziție.

## 7. Mentenanță și lifturi

### Fluxuri existente

- clienții și lifturile sunt structuri nested în `MaintenanceClient.addresses`;
- rapoartele PDF și imaginile sunt păstrate în istoric;
- branding-ul firmei are logo și ștampilă;
- piesele/comenzile sunt documente separate;
- nu există un inbox universal de documente pentru lift.

### Câmpuri extractabile deja persistabile

- `LiftUnit.serialNumber`;
- `manufacturer`;
- `installYear`;
- `revisionType`;
- `inspectionExpiryDate`;
- `maintenanceCompany` și `maintenanceEmail`;
- client/adresă/contact, numai dacă utilizatorul confirmă entitatea corectă.

### Riscuri

- lifturile nested obligă rescrierea clientului pentru o singură modificare;
- istoric rapoarte/client fără paginare;
- identificarea liftului după serial poate fi ambiguă dacă datele legacy sunt incomplete;
- PDF-urile nu au hash, clasificare, fields review sau provenance.

Storage Rules limitează branding-ul la imagini de 8 MB și rapoartele la documente/imagine
de 25 MB. Service-ul nu face aceeași validare înainte de upload. Un raport încarcă PDF-ul,
apoi imaginile secvențial și abia după aceea creează documentul Firestore; un eșec la mijloc
poate lăsa fișiere orphan.

## 8. Lifecycle și stări lipsă

Arhitectura comună trebuie să distingă:

```text
selected -> uploading -> uploaded -> queued -> extracting -> needs_review
         -> approved -> applied -> archived
         -> failed -> retrying / rejected
```

Un fișier nu trebuie considerat document de business doar pentru că uploadul a reușit.
Aplicarea câmpurilor trebuie să fie o operație separată, auditată și reversibilă.

## 9. Politică propusă de retenție

| Artefact | Retenție propusă | Observație |
| --- | --- | --- |
| Original document | conform politicii firmei/legii | Nu se șterge automat fără aprobare. |
| Preview/thumbnail | cât timp există originalul | Regenerabil. |
| Job complet | 90 zile | Păstrează audit minimal după TTL. |
| Job eșuat | 30 zile | Fără payload sensibil în error. |
| Răspuns brut model | 7-30 zile, restricționat | Preferabil nu se păstrează dacă nu este necesar. |
| Extracted fields aprobate | durata documentului | Cu provenance și versiune. |
| Dedupe hash | durata originalului | Hash, nu conținut. |

## 10. Controale obligatorii înainte de extindere

- reconciliere Firestore Rules producție;
- App Check pentru Functions de upload/analyze;
- size/MIME validate identic în client, Storage Rules și Function;
- fișiere cu nume random, fără PII în path;
- antivirus/malware scanning sau quarantine pentru tipuri active;
- hash server-side;
- audit server-side;
- download numai prin reguli sau URL semnat cu durată limitată;
- delete idempotent pentru metadata + Storage;
- test cross-company pentru fiecare document type.
