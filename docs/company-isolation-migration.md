# Migrare izolata pe firma

## Scop

Rules-urile restrictive din branch-ul `security/company-isolation-and-auth-v2` cer
`companyId` pe resursele operationale. Ele nu trebuie publicate peste date legacy
neverificate. Migrarea este intentionat separata in inventar, backfill si activarea
Rules.

## Principii de siguranta

- Scriptul ruleaza implicit numai `dry-run`.
- Nu ghiceste firma atunci cand referintele indica firme diferite.
- O firma implicita este folosita numai daca operatorul o transmite explicit prin
  `--default-company`.
- Scrierea cere simultan `--apply` si `--confirm-project <project-id>`.
- Inainte de backfill se creeaza un backup JSON pentru campurile modificate.
- Fisierele generate ajung in `migration-reports/`, director ignorat de Git.
- Nu sunt modificate punctele GPS, traseele, istoricul GPS, simulatorul, jitter-ul,
  cache-ul sau gateway-ul.

## Colectii inventariate

Scriptul inspecteaza utilizatori, proiecte, vehicule, scule, pontaje, concedii,
cheltuieli, notificari, reguli de notificare, audit, comenzi AI, mentenanta,
rapoarte si proiectrile operationale. Pentru rapoartele nested foloseste
`collectionGroup("rapoarte")`.

Subcolectiile GPS nu primesc `companyId`: accesul lor este derivat din documentul
parinte `vehicles/{vehicleId}`, astfel incat datele de traseu raman neschimbate.

## Etapa 1 - inventar dry-run

Autentifica Firebase CLI/ADC cu un cont autorizat, apoi ruleaza:

```powershell
npm run company-isolation:dry-run -- --project workcontrol-53b1d
```

Pentru o instalare legacy despre care se stie sigur ca apartine unei singure firme:

```powershell
node scripts/company-isolation-migration.mjs --mode dry-run --project workcontrol-53b1d --default-company <company-id>
```

Raportul trebuie verificat pentru:

- utilizatori fara `primaryCompanyId` si `companyIds`;
- referinte care indica doua firme;
- vehicule/scule fara proprietar sau detinator verificabil;
- proiecte, setari si sarbatori fara firma;
- clienti/lifturi/rapoarte fara legatura verificabila;
- notificari sau audituri vechi fara actor valid.

Orice intrare `conflict` sau `unresolved` trebuie corectata explicit. Nu folosi
o firma implicita peste documente multi-company.

## Etapa 2 - Functions compatibile

Publica mai intai numai Functions si indexurile compatibile:

- callables securizate pentru utilizatori, pontaje, vehicule si scule;
- audit si notificari server-side;
- `syncUserOperationalViews`;
- `syncVehicleOperationalView`.

Rules vechi raman active in aceasta etapa. Verifica logurile Functions inainte de
backfill.

## Etapa 3 - backfill

Backfill-ul este permis numai dupa ce raportul dry-run a fost aprobat:

```powershell
node scripts/company-isolation-migration.mjs --mode backfill --project workcontrol-53b1d --confirm-project workcontrol-53b1d --apply
```

Daca exista documente nerezolvate, scriptul se opreste. Optiunea
`--allow-unresolved` se foloseste numai dupa o decizie documentata; documentele
ramase fara firma nu vor fi accesibile dupa activarea Rules.

Backfill-ul:

- completeaza `companyId`;
- normalizeaza `companyIds`, `primaryCompanyId` si `accessStatus` pentru users;
- creeaza `userOperationalViews` per firma;
- creeaza `vehicleOperationalViews` fara tracker secrets, raw I/O sau configurari;
- nu activeaza utilizatori care erau dezactivati.

## Validare dupa backfill

Ruleaza din nou dry-run. Criteriul pentru activarea Rules este:

- zero conflicte;
- zero documente nerezolvate pentru modulele active;
- numarul de proiectrile user/vehicle corespunde resurselor accesibile;
- cont pending/disabled nu poate citi directoare interne;
- smoke test separat pentru global admin, admin firma, manager si angajat.

## Rollback

Fiecare backfill creeaza
`migration-reports/company-isolation-backup-<timestamp>.json`.

```powershell
node scripts/company-isolation-migration.mjs --mode rollback --project workcontrol-53b1d --confirm-project workcontrol-53b1d --apply --backup <backup.json>
```

Rollback-ul restaureaza campurile anterioare. Trigger-ele Functions regenereaza
proiectrile operationale din documentele restaurate. Daca Rules restrictive au fost
deja activate, publica temporar Rules anterioare inainte de rollback-ul datelor.

## Ordinea exacta de deploy

1. Functions compatibile si indexuri.
2. Inventar si backfill `companyId`, apoi dry-run de confirmare.
3. Hosting compatibil cu proiectrile operationale.
4. Firestore Rules restrictive.
5. Storage Rules restrictive.
6. Smoke tests per rol si firma.

Nu inversa pasii 2-4. Hosting-ul nou depinde de proiectrile generate, iar Rules noi
resping intentionat documentele legacy fara firma.
