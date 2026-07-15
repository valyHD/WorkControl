# Document Intelligence Core V1

## Scop

Acest increment muta analiza documentelor vehiculului din request-ul sincron al paginii intr-un job server-side, retry-safe. Rezultatul AI este o sugestie: nicio data de expirare si nicio categorie nu este aplicata vehiculului fara confirmarea explicita a unui utilizator autorizat.

Fluxul existent de GPS, trasee, simulare si jitter nu este modificat.

## Flux

1. UI incarca documentul in calea Storage existenta a vehiculului.
2. `createVehicleDocumentIngestionJob` valideaza utilizatorul, compania, vehiculul, calea, tipul si dimensiunea fisierului.
3. Serverul calculeaza SHA-256 si creeaza un job determinist, deduplicat in interiorul companiei.
4. `processDocumentIngestionJob` trimite documentul catre OpenAI si persista numai rezultatul structurat, increderea pe camp si metadatele operationale.
5. Pagina documentelor afiseaza sugestiile in starea `needs_review`.
6. Proprietarul vehiculului, managerul sau administratorul confirma ori respinge rezultatul.
7. Aplicarea ruleaza tranzactional, creeaza audit server-side si poate fi anulata daca valoarea nu a fost modificata ulterior.

## Contracte Firestore

### `documentIngestionJobs/{jobId}`

- `schemaVersion`: versiunea contractului jobului;
- `extractionVersion`: versiunea extractorului;
- `companyId`: proprietarul datelor;
- `entityType`: `vehicle` in V1;
- `sourceEntityId`, `sourceDocumentId`: referinta vehicul/document;
- `storagePath`, `fileName`, `contentType`, `sizeBytes`, `sha256`;
- `status`: `queued`, `processing`, `needs_review` sau `failed`;
- `attempts`, `errorCode`, `leaseOwner`, `leaseExpiresAt`;
- `result`: campuri structurate si confidence per camp;
- `createdAtServer`, `updatedAtServer`, `expiresAt`.

ID-ul este determinist pe `companyId + SHA-256 + extractionVersion + schemaVersion`. Continutul OCR brut si documentul base64 nu sunt stocate in Firestore.

### `documentReviewDecisions/{operationId}`

Decizia server-side (`applied`, `rejected`, `rolled_back`), actorul, compania si timestampul autoritativ.

### `documentApplyOperations/{operationId}`

Snapshot-ul strict necesar pentru rollback, campurile acceptate si starea operatiei. Rollback-ul refuza suprascrierea unei date schimbate ulterior.

### `documentIngestionRateLimits/{userHour}`

Contor server-side pentru maximum 30 de joburi/utilizator/ora. Documentele au `expiresAt`; activarea TTL pentru aceste colectii se face separat, dupa observarea productiei.

Toate cele patru colectii sunt server-owned. Regulile existente de fallback refuza accesul direct al clientului; UI foloseste exclusiv callable Functions.

## Validare si permisiuni

- maximum 18 MB;
- formate acceptate: imagini, PDF si text;
- date ISO validate calendaristic in UTC, fara rollover JavaScript;
- company scope verificat la fiecare callable;
- queue/retry/apply/reject/rollback: administrator global, admin, manager sau proprietarul vehiculului;
- citirea rezultatului: utilizator intern cu acces operational la vehicul;
- maximum 3 incercari per job;
- aplicarea necesita `confirm: true` si allowlist pentru `documentType`, `expiryDate`.

## Compatibilitate

- campurile noi din `VehicleDocumentItem` sunt optionale;
- documentele vechi continua sa fie citite;
- callable-ul legacy `analyzeVehicleDocument` ramane publicat temporar pentru clientii vechi, dar UI-ul nou nu il mai foloseste;
- daca jobul nu poate fi creat, documentul ramane salvat si poate fi gestionat manual.

## Retentie, cost si confidentialitate

- joburile au intentie de retentie de 90 de zile;
- rate-limit buckets au intentie de retentie de 48 de ore;
- OpenAI primeste documentul numai pentru extractia solicitata;
- nu se stocheaza transcript OCR brut si nu se logheaza documentul sau raspunsul complet;
- procesarea se face o singura data per hash si versiune in cadrul companiei.

## Rollout si rollback operational

Deploy minim:

1. cele sapte Functions noi;
2. Hosting cu UI-ul de review;
3. fara Rules, indexes, Storage Rules sau GPS.

Rollback:

1. Hosting poate reveni la bundle-ul anterior;
2. Functions noi pot ramane inactive fara sa afecteze clientul vechi;
3. o aplicare individuala se anuleaza din UI prin operatia server-side de rollback;
4. nu se sterg documente sau istoric pentru rollback.

## Ce urmeaza in V4

- motor comun de expirari si notificari pentru ITP, RCA, CASCO si rovinieta;
- review queue administrativa pentru toate documentele in asteptare;
- configurarea TTL dupa validarea retentiei;
- extinderea aceluiasi contract la scule, mentenanta si bonuri;
- eliminarea callable-ului legacy dupa perioada de compatibilitate.
