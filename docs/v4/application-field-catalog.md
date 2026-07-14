# Application Field Catalog

## 1. Regula catalogului

`Existent` înseamnă câmp prezent în tipurile/serviciile actuale. `Propus` înseamnă câmp
necesar pentru V4, dar care nu poate fi scris încă fără schimbare de schemă, migrare,
rules și adaptor. Document intelligence nu are voie să inventeze sau să aplice un câmp
`Propus` într-o entitate existentă.

## 2. Vehicle

În `VehicleItem`, toate câmpurile fără `?` sunt obligatorii la nivel TypeScript, inclusiv
valorile string goale folosite legacy. Opționale sunt `companyId`, theme keys, pending
driver metadata, `updatedAt` și toate obiectele GPS/diagnostic. Într-o migrare V4,
`companyId` trebuie să devină obligatoriu în documentele noi fără a rupe citirea legacy.

### Identitate și administrare - existente

| Câmp | Tip | Sursă acceptată | Auto-apply |
| --- | --- | --- | --- |
| `companyId` | string optional | context companie | niciodată din document |
| `plateNumber` | string | formular/talon | review obligatoriu |
| `brand` | string | formular/talon | review |
| `model` | string | formular/talon | review |
| `year` | string | formular/talon | review |
| `vin` | string | formular/talon | review, match unic |
| `fuelType` | string | formular/talon | review |
| `status` | enum | acțiune administrativă | niciodată din OCR |
| `currentKm` | number | formular/OBD/service confirmat | niciodată automat din OCR |
| `initialRecordedKm` | number | formular inițial | niciodată automat |

### Asignări - existente și protejate

`ownerUserId`, `ownerUserName`, `ownerThemeKey`, `currentDriverUserId`,
`currentDriverUserName`, `currentDriverThemeKey`, `pendingDriverUserId`,
`pendingDriverUserName`, `pendingDriverThemeKey`, `pendingDriverRequestedAt`.

Aceste câmpuri nu se extrag din documente și se modifică numai prin acțiuni controlate.

### Service și expirări - existente

| Câmp | Tip | Document compatibil | Politică |
| --- | --- | --- | --- |
| `maintenanceNotes` | string | factură/service report | sugestie, fără auto-append |
| `serviceStrategy` | `interval`/`absolute` | configurare | manual |
| `serviceIntervalKm` | number | policy/service plan | review admin |
| `nextServiceKm` | number | invoice/service report | review strict |
| `nextItpDate` | date string | ITP | auto numai cu policy + confidence mare |
| `nextRcaDate` | date string | RCA | auto numai cu policy + confidence mare |
| `nextCascoDate` | date string | CASCO | auto numai cu policy + confidence mare |
| `nextRovinietaDate` | date string | rovinietă | auto numai cu policy + confidence mare |
| `nextOilServiceKm` | number | service invoice | review strict |

### Media/documente - existente

- `coverImageUrl`, `coverThumbUrl`, `images[]`, `documents[]`;
- fiecare document are `id`, `name`, `url`, `path`, `contentType`, `sizeBytes`,
  `extension`, `category`, `expiryDate`, `createdAt`;
- `aiAnalysis` are `documentType`, `expiryDate`, `issueDate`, `policyNumber`,
  `providerName`, `vehiclePlateNumber`, `confidence`, `notes`, `analyzedAt`.

### GPS/diagnostic - existente, excluse din document intelligence

`gpsSnapshot`, `liveDiagnostics`, `gpsDataUsage`, `tracker`, `gpsSim`, `gpsSimHistory`.
Acestea nu se citesc sau modifică prin document ingestion.

### Câmpuri vehicul propuse, inexistente azi

`firstRegistrationDate`, `registrationCertificateNumber`, `engineCapacityCc`, `powerKw`,
`color`, `maximumAuthorizedMassKg`, `seats`, `engineCode`, `ownerLegalName`,
`serviceHistorySummary`. Ele necesită schemă separată sau extinderea controlată a
`VehicleItem`.

## 3. VehicleDocument propus V4

Colecție propusă: `vehicles/{vehicleId}/documents/{documentId}`.

| Câmp | Status |
| --- | --- |
| metadatele actuale `VehicleDocumentItem` | migrate/adapt |
| `companyId`, `vehicleId`, `ownerUserId` | propus obligatoriu |
| `sha256`, `dedupeKey` | propus |
| `documentType`, `documentSubtype` | extinde categoria actuală |
| `issueDate`, `validFrom`, `validUntil` | propus normalizat |
| `policyNumber`, `providerName` | există numai în `aiAnalysis`; promovează după review |
| `status`, `reviewStatus`, `appliedAt` | propus |
| `extractionVersion`, `schemaVersion`, `model` | propus |
| `fieldResults[]` cu confidence/provenance | propus |
| `supersedesDocumentId`, `supersededByDocumentId` | propus |

## 4. Tool

În `ToolItem`, `companyId`, theme keys și pending holder metadata sunt opționale; celelalte
câmpuri enumerate sunt obligatorii TypeScript. `updatedAt` este obligatoriu. String gol nu
trebuie confundat cu valoare verificată.

### Existente

| Grup | Câmpuri |
| --- | --- |
| Identitate | `companyId`, `name`, `internalCode`, `qrCodeValue`, `status` |
| Owner/holder | `ownerUserId/Name/Theme`, `currentHolder*`, `pendingHolder*`, `pendingHolderRequestedAt` |
| Locație | `locationType`, `locationLabel` |
| Descriere | `description` |
| Garanție | `warrantyText`, `warrantyUntil` |
| Media | `coverImageUrl`, `coverThumbUrl`, `imageUrls`, `images[]` |
| Timestamps | `createdAt`, `updatedAt` |

### Propuse, inexistente azi

`manufacturer`, `model`, `serialNumber`, `purchaseDate`, `purchasePrice`, `supplierName`,
`invoiceNumber`, `warrantyProvider`, `documents` subcollection, `serviceHistory`,
`calibrationDueDate`.

Un certificat de garanție poate actualiza direct numai `warrantyUntil` și, opțional,
`warrantyText`; restul valorilor rămân draft până la extinderea modelului.

## 5. MaintenanceClient, adrese și lifturi

`companyId`, `liftExpiryDates` și `liftRevisionTypes` sunt opționale; restul câmpurilor
clientului sunt obligatorii TypeScript, dar multe sunt compatibilitate legacy. În
`LiftUnit`, numai `revisionType` este opțional. Document intelligence trebuie să scrie în
structura nested numai printr-un adapter care identifică exact address ID și lift ID.

### Client - existent

`companyId`, `name`, `email`, `emails`, `address` legacy, `liftNumber` legacy,
`liftNumbers` legacy, `liftExpiryDates` legacy, `liftRevisionTypes` legacy, `expiryDate`
legacy, `maintenanceCompany`, `contactPerson`, `contactPhone`, `createdAt`, `updatedAt`,
`addresses[]`.

### ClientAddress - existent

`id`, `label`, `city`, `street`, `postalCode`, `contactPerson`, `contactPhone`, `lifts[]`.

### LiftUnit - existent

| Câmp | Tip | Document compatibil |
| --- | --- | --- |
| `id` | string | intern |
| `label` | string | formular/document review |
| `serialNumber` | string | certificat/raport |
| `revisionType` | R1/R2/string | raport revizie |
| `manufacturer` | string | certificat/fișă |
| `installYear` | string | certificat/fișă |
| `maintenanceCompany` | string | contract/raport |
| `maintenanceEmail` | string | contract |
| `inspectionExpiryDate` | date string | proces verbal/revizie |
| `notes` | string | review manual |

### Propuse

`liftDocuments` subcollection, `inspectionIssueDate`, `inspectionCertificateNumber`,
`contractStartDate`, `contractEndDate`, `nextMaintenanceDate`, `assetTag`, `locationId`,
`documentSummary`. Fiindcă liftul este nested azi, orice migrare la document separat trebuie
să păstreze adaptorul pentru `addresses[].lifts`.

## 6. Maintenance reports și parts

### Report history - existent

`companyId`, `clientId`, `clientName`, `reportType`, `address`, `lift`,
`technicianName`, `comments`, `pdfUrl`, `pdfPath`, `images[]`, `fileName`, `createdAt`,
`dateText`, `timeText`.

### Branding - existent

`companyId`, `companyName`, `companyKey`, `logoUrl`, `stampUrl`, `logoPath`, `stampPath`,
`createdAt`, `updatedAt`.

### Part order - existent

Status, priority, client/lift, requester/recipient, interval reminders, supplier/contact,
email states, quote/offer amounts, lines, totals, notes și timestamps, conform
`MaintenancePartOrder`.

Document intelligence nu trebuie să modifice starea unei comenzi de piese pe baza unei
facturi fără confirmare și reconciliere explicită.

## 7. ExpenseDocument

`companyId` este opțional în tipul legacy; restul câmpurilor `ExpenseDocumentItem` sunt
obligatorii. Pentru documentele noi, company trebuie derivată server-side și tratată ca
obligatorie. Nu există câmp `vehicleId` în expense astăzi; asocierea unei facturi service
cu vehiculul este o extindere propusă, nu un mapping existent.

### Analiză existentă

| Grup | Câmpuri |
| --- | --- |
| Tip | `documentKind` |
| Furnizor | `supplierName`, `supplierTaxId` |
| Cumpărător | `buyerCompanyName`, `buyerTaxId` |
| Document | `documentNumber`, `documentDate`, `dueDate`, `currency` |
| Sume | `subtotalAmount`, `vatAmount`, `totalAmount` |
| Clasificare | `paymentMethod`, `expenseCategory` |
| Sugestii | `projectHint`, `userHint`, `companyHint` |
| Linii | `lineItems[] {name, quantity, unitPrice, total}` |
| Calitate | `confidence`, `notes` |

### Metadate existente

`companyId`, `fileName`, `fileUrl`, `filePath`, `contentType`, `sizeBytes`, `extension`,
`uploadedByUserId/Name`, `assignedUserId/Name`, `projectId/Code/Name`, `companyName`,
`reimbursable`, `yearMonth`, `createdAt`, `updatedAt`.

### Propuse

`sha256`, `jobId`, `reviewStatus`, `fieldResults`, `model`, `usage`, `costEstimate`,
`extractionVersion`, `schemaVersion`, `duplicateOfDocumentId`, `approvedByUserId`,
`approvedAt`, `sourceDocumentId`, `rollbackPatch`.

## 8. NotificationRule

### Existente

- module: tools, vehicles, timesheets, leave, users, projects, notifications,
  maintenance, expenses, web, server, system, backup, general;
- eventType: evenimentele enumerate în `NotificationRuleEventType`;
- target: `entityId`, `entityLabel`;
- program: `scheduleTime`, `stopTime`, `weekdays`, delay/repeat/active minutes;
- presentation: `name`, `enabled`, `soundEnabled`;
- recipients: direct user, owner, admins, managers, specific users;
- `companyId`, `createdAt`, `updatedAt`.

### Propuse pentru expirări

`notificationSchedules` trebuie să conțină `sourceType`, `sourceId`, `documentId`,
`dateField`, `nextRunAt`, `timezone`, `thresholdDays`, `dedupeKey`, `lastSentAt`, `status`,
`version`. Regula definește politica; schedule-ul reprezintă următoarea execuție concretă.

## 9. Politica de mapare AI

1. Extrage numai în `fieldResults`.
2. Rezolvă câmpul în catalog.
3. Dacă statusul este `existent`, validează tipul și permisiunea.
4. Dacă statusul este `propus`, afișează informația, dar nu scrie entitatea.
5. Pentru identificatori, owner, role, company, status, GPS și assignments: niciodată
   auto-apply.
6. Pentru expirări: auto-apply numai dacă policy, confidence per câmp, entitate unică și
   data calendaristică sunt valide.
7. Orice apply păstrează before/after și poate fi anulat prin acțiune server-side.
