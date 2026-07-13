# Firebase cost controls

Data: 12 iulie 2026
Branch: `perf/firestore-gps-read-optimization`
Proiect: `workcontrol-53b1d`

## Baseline confirmat

Perioada 5-11 iulie:

- cost total: 13,50 USD;
- Firestore egress: 6,88 USD / 67,22 GiB;
- Firestore reads: 6,19 USD / 19.103.161 citiri;
- Firestore writes: 0,44 USD / 581.245 scrieri;
- reads + egress: aproximativ 97% din cost.

Pagina `VehicleGpsMapsPage` reincarca traseul complet al fiecarei masini la 10 secunde.
La aproximativ 65.393 puncte, o scanare completa a flotei transfera aproximativ 241 MiB.
Cele 19,1 milioane de reads corespund cu aproximativ 292 scanari complete.

## Flow anterior

```text
mount card vehicul
  -> getVehiclePositionsForSelectedDay(toate punctele zilei)
  -> setInterval 10 secunde
  -> getVehiclePositionsForSelectedDay(toate punctele zilei)
  -> cererea urmatoare putea porni independent
  -> acelasi traseu era transferat din nou
```

Markerul live provine din listenerul documentului vehiculului. Simularea si segmentele
salvate provin tot din documentul vehiculului; nu necesita recitirea istoricului real.

## Flow nou

```text
mount card vehicul
  -> cache sesiune valid?
       da: afiseaza cache + query incremental
       nu: o singura incarcare completa
  -> salveaza lastTimestamp
  -> la 10 secunde: positionDays points [lastTimestamp - 12 sec, acum]
  -> dedupe dupa id/timestamp/coordonate
  -> merge ordonat in state
  -> marker si polyline folosesc aceleasi functii de randare existente
```

Garantii:

- maximum un request activ per utilizator + vehicul + sursa;
- requesturile identice din Strict Mode impart acelasi Promise;
- rezultatele vechi sunt ignorate prin generatie;
- cache numai in memorie, maximum 30 intrari / 180.000 puncte;
- cheia cache include utilizator, vehicul, sursa si interval;
- cache-ul utilizatorului este invalidat la logout;
- pagina ascunsa opreste timerul;
- revenirea vizibila cere numai gap-ul;
- `Actualizeaza` este incremental;
- `Reincarca complet` este disponibil numai adminului pentru diagnostic.

## Test de performanta

Scenariu automat:

- 10 vehicule;
- 6.500 puncte per vehicul;
- 30 cicluri de refresh;
- 65.000 puncte initiale.

Rezultat asteptat:

- vechi: `10 * 6.500 * 31 = 2.015.000` documente returnate;
- nou: `10 * 6.500 + 300 = 65.300` documente in scenariul cu un punct nou/ciclu;
- reducere: peste 96%;
- 10 full-route requests, apoi numai incremental;
- concurenta maxima per vehicul: 1;
- zero puncte duplicate;
- pagina hidden: zero requesturi Firestore.

## Gateway diagnostic si usage batching

Feature flag privat: `systemPrivateSettings/gpsCostOptimization`.

```json
{
  "enabled": false,
  "canaryTrackerImeis": [],
  "diagnosticFlushSeconds": 45
}
```

Comportament:

- flag oprit sau IMEI absent: codul vechi;
- canary: pozitiile, snapshotul live, kilometrajul si comenzile raman neschimbate;
- numai `diagnosticDays` si `gpsDataUsage` sunt bufferizate;
- flush configurabil, limitat la 30-60 secunde;
- flush la 500 records, disconnect si SIGINT/SIGTERM;
- retry-ul reintroduce batch-ul in buffer;
- log agregat `[GPS COST METRICS]` per flush, nu per pachet.

Configuratia nu contine IMEI hardcodat. Lista canary se administreaza server-side.
Fisierul gateway este separat de Firebase Hosting/Functions si trebuie instalat pe
serverul TCP, urmat de restart controlat PM2/systemd. Pana atunci flag-ul nu are efect.

## Billing Export

Stare verificata:

- Standard Usage Cost: enabled;
- dataset: `firebase_billing_export`;
- locatie: `EU`;
- Detailed Usage Cost: disabled;
- tabelul Standard: in curs de creare/backfill la momentul implementarii;
- FOCUS era deja activ si nu a fost modificat.

Runtime service account are:

- `roles/bigquery.jobUser` pe proiect;
- `READER` numai pe datasetul `firebase_billing_export`.

## Query billing

Query-ul:

- descopera automat tabelul `gcp_billing_export_v1_*`;
- selecteaza explicit day, currency, service, SKU, cost, credits, net cost si usage;
- filtreaza `usage_start_time` prin parametrii `@startTime` si `@endTime`;
- grupeaza in `Europe/Bucharest`;
- limiteaza jobul la maximum 1 GiB procesat;
- nu foloseste `SELECT *`;
- foloseste costul net dupa credits.

Conversia EUR foloseste cursul BCE server-side, cache zilnic in
`systemMetrics/exchangeRates`. Daca BCE nu raspunde, se foloseste ultimul curs valid.
Daca nu exista curs valid, refresh-ul esueaza controlat si pastreaza ultimul cache.

## Functions

- `refreshBillingMetrics`: scheduled la 3 ore;
- `refreshBillingMetricsNow`: callable numai admin;
- datasetul nu este interogat la deschiderea Control Panel;
- lipsa tabelului produce `freshnessStatus = awaiting_export`, nu cost zero inventat;
- rezultatele sunt idempotente prin `set(..., merge)` pe chei stabile.

Documente:

- `systemMetrics/billing` - cache curent;
- `systemMetrics/exchangeRates` - cache curs;
- `systemMetricDaily/{YYYY-MM-DD}` - cost zilnic mic;
- `systemCostSettings/billing` - buget si praguri.

Colectiile de billing si configuratia canary nu au reguli client si sunt implicit
inaccesibile din browser. Callable Functions verifica rolul admin inainte sa citeasca
sau sa salveze. Clientul nu are acces la BigQuery si nu vede billing account ID sau IMEI.

## Control Panel

Sectiunea `Consum si costuri` este randata numai pentru rolul `admin` si afiseaza:

- cost azi, 7 zile, luna, proiectie;
- reads/writes azi si 7 zile;
- egress si Functions invocations;
- estimare GPS vs rest;
- cost zilnic 30 zile;
- reads/writes 14 zile;
- breakdown serviciu si SKU;
- buget si praguri;
- freshness si conversie BCE;
- status canary;
- metrici agregate ale sincronizarii pentru sesiunea curenta.

Valorile indisponibile sunt `null` in backend si `Indisponibil` in UI.

### Estimare aproape live

Callable-ul admin-only `getLiveFirebaseCostEstimate` citeste din Cloud Monitoring
operatiunile Firestore `read_ops_count`, `write_ops_count` si `delete_ops_count`.
Panoul se actualizeaza la 60 secunde doar cat pagina este vizibila si afiseaza:

- EUR/minut, ca medie a ultimelor 5 minute raportate;
- proiectia EUR/ora la ritmul curent;
- costul estimat al operatiunilor din ultimele 60 minute;
- citiri si scrieri pe minut;
- egress estimat pe minut la media observata de 3,78 KiB per citire;
- momentul ultimei metrici disponibile.

Cloud Monitoring esantioneaza la 60 secunde si poate publica datele cu pana la 240
secunde intarziere. Estimarea foloseste tarifele Standard pentru `europe-west1` si
cursul BCE. Egress-ul foloseste tariful brut de 0,12 USD/GiB si media observata in
baseline-ul 5-11 iulie; nu include storage, Cloud Functions, quota gratuita sau
discounturi. Costul contabil final ramane cel din Cloud Billing Export.

## Canary production

1. Pastreaza `enabled: false` pana cand noul gateway este instalat.
2. Configureaza un singur IMEI sigur in `canaryTrackerImeis`.
3. Instaleaza fisierul gateway si restarteaza procesul controlat.
4. Verifica `[TRACKER OK]` si `[GPS COST METRICS]`.
5. Seteaza `enabled: true`.
6. Testeaza o sesiune completa: mers real, oprire, simulare, hidden/visible si refresh.
7. Compara snapshot/history/diagnostic writes si latenta.
8. Extinde lista numai dupa cel putin o sesiune fara diferente.

## Deploy minim

Ordine:

1. Functions: `refreshBillingMetrics`, `refreshBillingMetricsNow`,
   `getBillingControlPanelData`, `saveBillingCostSettings`;
2. Hosting pentru sincronizarea incrementala si Control Panel;
3. gateway separat, un singur canary.

Nu se deployeaza Firestore Rules, Storage Rules sau indexes. Colectiile noi raman
protejate prin default deny si sunt accesate numai de Admin SDK in Functions.

## Rollback

- Frontend: redeploy versiunea Hosting anterioara;
- Functions: redeploy commitul anterior pentru cele doua functii;
- gateway: seteaza imediat `enabled: false`, apoi revino la fisierul anterior;
- datele billing pot ramane, fiind izolate si read-only pentru client;
- nu se sterg si nu se migreaza puncte GPS.

## Confirmari

- `GPS_VISUAL_BEHAVIOR_EQUIVALENT`
- `FULL_ROUTE_POLLING_REMOVED`
- `INCREMENTAL_SYNC_ACTIVE`
- `HIDDEN_PAGE_FETCH_DISABLED`
- `BILLING_DATA_ADMIN_ONLY`

## Roadmap

`NEXT: reluare remediere P0 securitate - registration, company isolation, GPS metadata access, notification spam.`

## Emergency cost reduction V2 - 13 iulie 2026

Flag privat: `systemPrivateSettings/firestoreCostControl`. Daca documentul lipseste,
backend-ul foloseste implicit modul de urgenta, astfel incat un deploy nou nu poate reveni
accidental la full-route fleet scans.

Comportamentul V2:

- `getFleetGpsOverview` intoarce maximum 250 proiectii slabe din `vehicles`;
- proiectia exclude `gpsSimHistory`, documente, imagini, diagnostic si alte campuri mari;
- snapshoturile flotei sunt cerute la 60 secunde numai cu pagina vizibila;
- un singur vehicul selectat poate avea document complet si controller de traseu;
- traseul implicit acopera ultimele doua ore, maximum 24 ore si maximum 2.000 puncte;
- `ControlPanelService.getCollectionCounters` foloseste agregari `count()`;
- Dashboard-ul foloseste limite reduse, cache 30 minute si refresh protejat de stale time;
- estimatorul Cloud Monitoring este cache-uit 15 minute si include listener-e snapshot,
  conexiuni active si requesturi Cloud Run/Functions;
- telemetria per query este numai in memoria browserului si nu produce writes Firestore.

Rollback:

1. in Control Panel dezactiveaza `Mod economie Firestore`;
2. sau seteaza `emergencyMode=false` si `fleetRoutesOnDemandOnly=false` prin callable-ul
   admin-only `saveFirestoreCostControl`;
3. pentru rollback complet Hosting, foloseste branch-ul
   `backup/all-gps-before-emergency-v2-20260713-0615`.

Inventarul complet si baseline-ul se afla in `docs/firestore-listener-inventory.md`.
