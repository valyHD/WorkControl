# WorkControl V4 - Expiry Automation Engine V1

## Scop

Motorul V1 înlocuiește scanarea orară completă a colecției `vehicles` cu schedule-uri
materializate și un worker limitat. Acoperă:

- ITP;
- RCA;
- CASCO;
- rovinietă;
- apropierea reviziei generale și a reviziei de ulei la 500 km.

Nu modifică documentele GPS, traseele, simularea, jitter-ul, gateway-ul sau payload-urile
FMC130.

## Contract Firestore

### `notificationSchedules/{scheduleId}`

Document server-only, cu ID determinist per vehicul și tip de alertă.

| Câmp | Tip | Descriere |
| --- | --- | --- |
| `schemaVersion` | number | Versiunea contractului, momentan `1` |
| `workerType` | string | `vehicle_alerts_v1`; izolează workerul de schedule-urile altor module |
| `scheduleKind` | string | `vehicle_document_expiry` sau `vehicle_service_mileage` |
| `sourceCollection` | string | `vehicles` |
| `sourceId` / `entityId` | string | ID vehicul |
| `companyId` | string | Firma destinatarilor |
| `directUserId` / `ownerUserId` | string | Destinatari operaționali |
| `targetKey` | string | `itp`, `rca`, `casco`, `rovinieta`, `service`, `oil` |
| `expiryDate` | string | Dată calendaristică `YYYY-MM-DD`, numai pentru documente |
| `targetKm` | number | Prag kilometraj, numai pentru service |
| `status` | string | `scheduled`, `completed` sau `invalid` |
| `nextMilestone` | string | `30`, `14`, `7`, `1`, `0`, `expired` sau `within_500_km` |
| `nextRunAt` | number/null | Timestamp folosit de query-ul workerului |
| `sourceRevision` | string | Hash al datelor relevante din vehicul |
| `leaseOwner` / `leaseUntil` | string/number | Lease concurent de două minute |
| `failureCount` | number | Număr limitat de retry-uri observate |

Clientul nu poate citi sau scrie această colecție. Schedule-urile sunt sincronizate de
`syncVehicleOperationalView`, numai când se schimbă o dată, un prag, compania sau
destinatarul. Update-urile GPS fără schimbarea pragului nu resetează schedule-ul.

### `notificationDeliveries/{deliveryId}`

Marker server-only creat în aceeași tranzacție cu notificările destinatarilor. ID-ul este
determinist din companie, entitate, tip, dată/prag și milestone. Retry-urile concurente
găsesc markerul și nu mai creează notificări duplicate. Markerul are TTL de 180 zile.

## Calendar și notificări

- timezone: `Europe/Bucharest`;
- calculele sunt pe zile calendaristice UTC, nu pe diferențe de milisecunde locale;
- ora de execuție pentru milestone-urile viitoare este 08:00 local;
- praguri documente: 30, 14, 7, 1, 0 zile și o alertă `expired`;
- dacă un worker a fost oprit, la revenire trimite pragul util curent, nu toate pragurile
  ratate în rafală;
- event type-urile existente `vehicle_document_*_due_soon` sunt păstrate pentru
  compatibilitate cu regulile de notificare deja configurate.

## Cost și limite

Workerul `checkVehicleMaintenanceAlerts` rulează la 15 minute și execută:

```text
workerType == vehicle_alerts_v1
status == scheduled
nextRunAt <= now
orderBy nextRunAt asc
limit 40
```

Nu mai există `db.collection("vehicles").get()` în funcția programată. Contextul de
notificare este încărcat o singură dată per companie și rundă, din proiecțiile
`userOperationalViews`, cu limite de 250 utilizatori și 100 reguli. O livrare este limitată
la 100 destinatari.

## Migrare

Migrarea este separată de worker și este dry-run implicit:

```powershell
npm run expiry-schedules:dry-run -- --project workcontrol-53b1d
```

Aplicarea necesită confirmarea explicită a Project ID-ului:

```powershell
node scripts/backfill-vehicle-alert-schedules.mjs `
  --mode apply `
  --project workcontrol-53b1d `
  --confirm-project workcontrol-53b1d
```

Scriptul este paginat, compară `sourceRevision` și scrie numai schedule-urile lipsă sau
schimbate. Nu modifică documentele `vehicles`.

## Ordine de rollout

1. deploy indexul `notificationSchedules(status, nextRunAt)` și TTL-ul deliveries;
2. deploy Firestore Rules server-only;
3. deploy Functions compatibile;
4. rulează migrarea dry-run și verifică totalurile;
5. rulează backfill apply;
6. verifică în shadow schedule-urile și notificările pentru o companie canary;
7. urmărește minimum șapte zile duplicatele, erorile și latența;
8. elimină markerii legacy numai într-un task separat.

## Rollback

- funcția programată poate reveni la versiunea precedentă fără modificarea vehiculelor;
- `notificationSchedules` și `notificationDeliveries` pot rămâne inactive, fiind
  server-only;
- nu se șterg date la rollback;
- schedule-urile materializate se pot reconstrui din `vehicles` prin scriptul dry-run/apply.

## Verificări obligatorii înainte de deploy

- Functions unit tests;
- Rules emulator tests pentru refuzul scrierilor client;
- build frontend;
- verificare indexuri;
- dry-run pe proiectul țintă;
- smoke notificări pe canary;
- confirmare `GPS_FUNCTIONAL_DIFF_ZERO` din diff și testele GPS existente.
