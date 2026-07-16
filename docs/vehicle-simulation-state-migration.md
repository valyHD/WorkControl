# Migrare stare simulare GPS

## Scop

Campurile mari `gpsSim` si `gpsSimHistory` sunt mutate din `vehicles/{vehicleId}` in
`vehicles/{vehicleId}/positions/_simulation`. Contractul `VehicleItem` ramane neschimbat:
serviciul de vehicule combina documentul principal, `_runtime` si `_simulation` inainte ca
datele sa ajunga la componentele hartii.

## Contract Firestore

Documentul `_simulation` contine:

- `schemaVersion: 1`;
- `vehicleId: string`;
- `gpsSim: map | null`;
- `gpsSimHistory: array`, maximum 250 trasee;
- `updatedAt: number`;
- `migratedAtServer`, numai la migrare.

Citirea foloseste temporar campurile legacy daca documentul copil nu exista. Scrierile noi
folosesc exclusiv documentul copil, iar modificarile de kilometraj raman atomice cu starea
simularii.

## Ordine rollout

1. Deploy Functions cu `vehicleOperationalView` v3 si Firestore Rules compatibile.
2. Ruleaza `dry-run`.
3. Ruleaza `copy`; comanda creeaza un backup JSON in afara repository-ului.
4. Ruleaza `verify`; nu continua daca exista diferente.
5. Deploy Hosting cu adaptorul nou.
6. Verifica masina personala si harta flotei pe desktop si mobil.
7. Ruleaza `cleanup-root` folosind backupul creat la pasul 3.
8. Reconstruieste proiectiile operationale pentru eliminarea copiilor vechi.

## Comenzi

```powershell
node scripts/migrate-vehicle-simulation-state.mjs --project workcontrol-53b1d --mode dry-run
node scripts/migrate-vehicle-simulation-state.mjs --project workcontrol-53b1d --mode copy --confirm-project workcontrol-53b1d
node scripts/migrate-vehicle-simulation-state.mjs --project workcontrol-53b1d --mode verify
node scripts/migrate-vehicle-simulation-state.mjs --project workcontrol-53b1d --mode cleanup-root --confirm-project workcontrol-53b1d --backup-file <backup.json>
```

## Rollback

```powershell
node scripts/migrate-vehicle-simulation-state.mjs --project workcontrol-53b1d --mode rollback --confirm-project workcontrol-53b1d --backup-file <backup.json>
```

Rollback-ul restaureaza campurile root si starea anterioara a documentului copil. Scriptul
refuza cleanup-ul daca starea root sau copil s-a schimbat dupa backup.
