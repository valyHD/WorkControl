# Optimizare cost Firestore - 22.07.2026

## Punct de restaurare

- Branch: `backup/inainte-optimizare-consum-22-07`
- Tag: `backup-inainte-optimizare-consum-22-07`
- Commit: `6c19a1fd359392d5e9bf171b545cfe46a1ed5d8a`

Acest punct preceda toate schimbarile descrise aici.

## Cauza masurata

Pentru 21.07.2026, costul a fost dominat de transferul Firestore, nu de pretul citirilor:

- aproximativ 6,60 GB egress Firestore;
- 158.344 citiri;
- 92.992 scrieri;
- documentele zilnice de diagnostic erau rescrise cu liste in crestere;
- istoricul simularii era rescris integral intr-un singur document;
- pagina flotei putea reincarca trasee complete pentru harti aflate in afara ecranului.

## Cele sase schimbari

1. **Simulari schema 2**
   - `_simulation` pastreaza traseul activ si metadatele istoricului.
   - traseele finalizate sunt documente individuale in `simulationRoutes`.
   - punctele, kilometrii, opririle si vitezele nu sunt simplificate.
2. **Flota la cerere**
   - harta se hidrateaza cand cardul ajunge aproape de viewport;
   - refresh incremental la 10 minute cat pagina este vizibila;
   - refresh manual forteaza sincronizarea imediata;
   - traseele lungi sunt pastrate local, fara truncarea geometriei.
3. **Listener-e suspendate**
   - listener-ele GPS vizate sunt inchise cand tabul este ascuns si repornite o singura data la revenire;
   - ultima stare vizibila ramane in UI.
4. **Diagnostic gateway compact**
   - flush implicit la 300 secunde;
   - o mostra la 10 minute;
   - evenimente deduplicate in ferestre de 15 minute;
   - documentul zilnic contine doar sumar si preview mic;
   - istoricul detaliat este impartit in documente mici.
5. **Retentie fara pierderea traseelor**
   - mostre diagnostic: 14 zile prin TTL;
   - evenimente neobisnuite: 90 zile prin TTL;
   - traseele reale raman in mecanismul existent de arhivare Storage dupa 30 zile;
   - `positionDays` si `simulationRoutes` nu primesc TTL.
6. **Masurare locala explicita**
   - Control Panel afiseaza documente, bytes estimati, cache hits, query-uri si bytes evitati;
   - metricile sunt locale sesiunii si nu inlocuiesc Billing Export.

## Migrare sigura

Toate comenzile pornesc in `dry-run`. Modurile de scriere cer Project ID-ul confirmat.

```powershell
node scripts/migrate-vehicle-simulation-routes-v2.mjs --mode dry-run --project workcontrol-53b1d
node scripts/migrate-vehicle-diagnostics-v2.mjs --mode dry-run --project workcontrol-53b1d
```

Aplicarea creeaza mai intai backup JSON in `../workcontrol-migration-backups`:

```powershell
node scripts/migrate-vehicle-simulation-routes-v2.mjs --mode apply --project workcontrol-53b1d --confirm-project workcontrol-53b1d
node scripts/migrate-vehicle-diagnostics-v2.mjs --mode apply --project workcontrol-53b1d --confirm-project workcontrol-53b1d
```

Verificare:

```powershell
node scripts/migrate-vehicle-simulation-routes-v2.mjs --mode verify --project workcontrol-53b1d
node scripts/migrate-vehicle-diagnostics-v2.mjs --mode verify --project workcontrol-53b1d
```

Rollback-ul necesita calea backupului raportata de comanda `apply`. El refuza sa suprascrie date care au primit actualizari dupa migrare.

## Ordine de publicare

1. verificari locale si emulator;
2. Firestore Rules compatibile cu ambele scheme;
3. Hosting si Function de Control Panel;
4. migrare simulare si verificare;
5. migrare diagnostic si verificare;
6. activare TTL diagnostic;
7. backup gateway si `.env` pe server;
8. publicare gateway, verificare sintaxa, restart PM2 si monitorizare;
9. smoke test traseu real, simulare, opriri, viteza si kilometri.

## Rollback

- Hosting/Functions/Rules: redeploy din tagul de backup.
- Date: scripturile de migrare cu `--mode rollback --backup-file <cale>`.
- Gateway: restaurarea fisierului si `.env` timestamped, apoi restart PM2.

Nu se sterg trasee reale sau trasee de simulare in cadrul acestei optimizari.
