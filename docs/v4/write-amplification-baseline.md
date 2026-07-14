# Firebase write amplification - baseline și contract runtime

## Baseline production

Fereastra curată din auditul V4, înainte de migrarea `companyId`, este referința de
comparație. Măsurarea imediat următoare backfill-ului este păstrată separat deoarece
include 8.043 de update-uri de migrare și nu reprezintă traficul normal.

| Metrică | Baseline curat / 60 min | Fereastră post-backfill / 60 min |
| --- | ---: | ---: |
| Firestore reads | 2.574 | 59.645 |
| Firestore writes | 7.585 | 16.422 |
| Functions requests | 2.497 | 2.561 |
| `syncVehicleOperationalView` | 2.282 | contaminat |
| `syncUserOperationalViews` | 124 | contaminat |

Măsurarea post-backfill a fost făcută la `2026-07-14T05:02:51Z`. Pentru ferestrele
comparative după deploy se folosește `scripts/measure-firestore-usage.ps1`, care raportează
5/15/30/60 minute și requesturile Cloud Run grupate pe Function.

Măsurarea read-only de la `2026-07-14T05:24:00Z` confirmă amplificarea activă înainte de
remediere:

| Fereastră | Reads | Writes | Functions | `syncVehicleOperationalView` | `syncUserOperationalViews` |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 15 min | 415 | 1.886 | 599 | 536 | 55 |
| 30 min | 1.616 | 4.655 | 1.409 | 1.219 | 137 |
| 60 min | 57.160 | 17.016 | 2.651 | 2.380 | 199 |

Fereastra de 60 minute continuă să includă operațiile migrației. Ferestrele de 15 și 30
minute sunt indicatorii operaționali utili: aproximativ 126-155 writes/minut și
2.144-2.438 invocări/oră proiectate pentru triggerul de vehicul.

Cloud Monitoring nu oferă direct path-ul documentului, no-op ratio sau retry-ul logic al
triggerului. Acestea sunt măsurate prin teste și prin logul agregat, sampled, al gateway-ului;
nu se creează câte un document metric pentru fiecare operație.

## Cauza amplificării

Un pachet GPS acceptat putea produce:

1. punct în `positionDays/{day}/points`;
2. update repetat pe documentul `positionDays/{day}`;
3. update pe rădăcina `vehicles/{vehicleId}` pentru snapshot, tracker, kilometri și usage;
4. invocarea `syncVehicleOperationalView`;
5. write în `vehicleOperationalViews`;
6. write în `vehicleTrackerAdmin`.

Presence-ul la 30 secunde și evenimentele focus/visibility porneau separat
`syncUserOperationalViews` și rescriau toate proiecțiile companiei.

## Contract runtime GPS

Document: `vehicles/{vehicleId}/positions/_runtime`.

- `schemaVersion: 1`;
- `vehicleId`;
- `gpsSnapshot` și `liveDiagnostics` cu același payload folosit anterior de UI;
- `tracker` minimal;
- `gpsDataUsage` agregat;
- `mileageBaseKm` și `pendingCurrentKm` pentru consolidare retry-safe;
- `updatedAt`, `updatedAtServer`, `lastRootFlushAt`.

Punctele, `positionDays`, simularea și istoricul nu se mută. Adapterul frontend alege
snapshotul cu timestampul cel mai nou și revine automat la rădăcina legacy dacă documentul
runtime lipsește sau este mai vechi. Rădăcina este consolidată la 5-30 minute, implicit 10,
printr-o tranzacție; kilometrii pending sunt aplicați exact o dată.

## Rollout și rollback

Configurație server-side: `systemPrivateSettings/gpsCostOptimization.runtimeLive`.

```text
enabled: false
trackerImeis: []
dualWriteRoot: true
rootFlushSeconds: 600
dayMetadataRefreshSeconds: 600
```

Activarea cere `enabled=true` și tracker explicit în `trackerImeis`. Prima etapă păstrează
`dualWriteRoot=true` pentru comparația vizuală. După canary, `dualWriteRoot=false` oprește
snapshotul frecvent din rădăcină. Niciun IMEI nu este hardcodat. Rollback-ul este
`enabled=false`; următorul pachet revine la snapshotul legacy, iar frontendul continuă să
aleagă valoarea cea mai nouă.

## Bugete

| Indicator | Baseline | Buget inițial |
| --- | ---: | ---: |
| `syncVehicleOperationalView` / oră | 2.282 | sub 120 |
| Writes proiecție vehicul / oră | până la 2.282 | reducere minim 80% |
| `syncUserOperationalViews` / oră | 124 | sub 30 |
| Presence / sesiune / oră | peste 120 în furtună UI | sub 20 |
| Root vehicle writes / tracker / oră | până la 3.600 | maximum 6 implicit |
| GPS visual diff | n/a | zero |

Rules restrictive P0 nu sunt active în production: au fost retrase după ce au blocat
flow-uri legitime. Faza de cost nu publică Rules și nu este o confirmare că izolarea între
companii este aplicată în production.
