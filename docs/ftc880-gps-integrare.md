# Integrare GPS FTC880 în WorkControl (hartă live + istoric + comenzi)

Acest ghid îți dă **fișierele necesare** și **pașii clari** pentru a integra un tracker GPS FTC880 cu aplicația voastră (React + Firebase), astfel încât să aveți:

- hartă live (mișcare în timp real)
- istoric traseu + rapoarte (zilnic/lunar)
- comenzi remote (ex: pornire/opriere motor)
- notificări (pornit/oprit motor, geofence, depășire viteză)
- asignare mașină → user

---

## 1) Arhitectură recomandată

> Nu conecta direct frontend-ul la API-ul dispozitivului/GPS provider.
> Pune un backend intermediar pentru securitate, audit și normalizare date.

### Flux date

1. **FTC880** trimite poziții + telemetrie către provider/endpoint (TCP/HTTP/MQTT, în funcție de configurare).
2. **Webhook/Ingestion service** primește evenimentele brute.
3. **Normalizer service** convertește payload-urile în model unitar (`GpsPosition`, `VehicleTelemetry`, `IgnitionEvent`).
4. Scrii datele în Firestore/BigQuery:
   - `vehicles/{vehicleId}/positions`
   - `vehicles/{vehicleId}/events`
   - `trip_summaries` (zi/lună)
5. Frontend-ul ascultă live `latest_position` + interoghează istoric pentru intervale.
6. Comenzile remote (`engine_stop`, `engine_resume`) pleacă doar din backend, cu RBAC.

---

## 2) Fișiere noi recomandate în proiect

Mai jos sunt fișierele pe care le recomand să le creați (frontend + backend + reguli + job-uri):

```txt
src/types/gps.ts
src/modules/gps/services/gpsService.ts
src/modules/gps/services/liveTrackingService.ts
src/modules/gps/services/tripReportsService.ts
src/modules/gps/pages/LiveMapPage.tsx
src/modules/gps/pages/TripHistoryPage.tsx
src/modules/gps/pages/TripReportsPage.tsx
src/modules/gps/components/VehicleLiveMap.tsx
src/modules/gps/components/TripTimeline.tsx
src/modules/gps/components/TripReportFilters.tsx
src/modules/vehicles/components/VehicleEngineControlCard.tsx
src/modules/vehicles/components/VehicleAssignmentCard.tsx
src/lib/maps/mapProvider.ts
src/lib/maps/mapMarkers.ts
src/lib/maps/mapPolylines.ts

functions/src/gps/ftc880Webhook.ts
functions/src/gps/ftc880CommandProxy.ts
functions/src/gps/gpsNormalizer.ts
functions/src/gps/tripAggregator.ts
functions/src/gps/geofenceEvaluator.ts
functions/src/gps/notificationDispatcher.ts
functions/src/shared/rbac.ts
functions/src/shared/auditLog.ts

firestore.rules
firestore.indexes.json
.env.example
```

Dacă folosiți alt backend (Node/Nest/FastAPI), păstrați aceeași separare logică.

---

## 3) Modele de date (minim necesar)

### `src/types/gps.ts`

```ts
export interface GpsPosition {
  id: string;
  vehicleId: string;
  trackerId: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading?: number;
  altitude?: number;
  accuracyMeters?: number;
  gpsTimestamp: number;   // timestamp primit de la dispozitiv
  serverTimestamp: number; // timestamp la ingestie
  ignitionOn?: boolean;
  engineBlocked?: boolean;
  odometerKm?: number;
}

export interface TripSummary {
  id: string; // de ex: vehicleId_YYYY-MM-DD
  vehicleId: string;
  date: string; // YYYY-MM-DD
  startTs: number;
  endTs: number;
  distanceKm: number;
  durationSec: number;
  idleSec: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  fuelEstimateLiters?: number;
}

export interface VehicleAssignment {
  vehicleId: string;
  userId: string;
  assignedAt: number;
  unassignedAt?: number;
  active: boolean;
}

export type RemoteCommandType = "engine_stop" | "engine_resume";

export interface RemoteCommand {
  id: string;
  vehicleId: string;
  requestedBy: string;
  type: RemoteCommandType;
  status: "queued" | "sent" | "ack" | "failed";
  requestedAt: number;
  completedAt?: number;
  providerMessage?: string;
}
```

---

## 4) Colecții Firestore recomandate

```txt
vehicles/{vehicleId}
vehicles/{vehicleId}/positions/{positionId}
vehicles/{vehicleId}/events/{eventId}
vehicles/{vehicleId}/commands/{commandId}
vehicles/{vehicleId}/assignments/{assignmentId}

trip_summaries/{vehicleId_YYYY-MM-DD}
trip_summaries_monthly/{vehicleId_YYYY-MM}
notification_rules/{ruleId}
```

### Indecși utili

- `positions`: `(vehicleId, gpsTimestamp desc)`
- `events`: `(vehicleId, createdAt desc, type)`
- `trip_summaries`: `(vehicleId, date desc)`

---

## 5) API/Backend endpoints (contract minim)

### Ingestion + live

- `POST /api/gps/ftc880/webhook` – primește payload brut de la provider.
- `GET /api/gps/vehicles/:vehicleId/latest` – poziția curentă.
- `GET /api/gps/vehicles/:vehicleId/history?from=&to=` – puncte traseu.

### Rapoarte

- `GET /api/gps/vehicles/:vehicleId/reports/daily?month=YYYY-MM`
- `GET /api/gps/vehicles/:vehicleId/reports/monthly?year=YYYY`

### Comenzi remote

- `POST /api/gps/vehicles/:vehicleId/commands/engine-stop`
- `POST /api/gps/vehicles/:vehicleId/commands/engine-resume`

### Asignare mașină

- `POST /api/vehicles/:vehicleId/assign/:userId`
- `POST /api/vehicles/:vehicleId/unassign/:userId`

---

## 6) Pași de implementare (ordinea recomandată)

### Pas 1 — Documentația FTC880 + provider

- obține formatul exact de payload (IMEI, coordonate, ignition, status motor)
- obține mecanismul de comenzi remote + ack
- whitelist IP și secret webhook

### Pas 2 — Ingestion sigur

- implementează `ftc880Webhook.ts`
- validează semnătura/HMAC/token
- deduplicate (ex: `trackerId + gpsTimestamp`)
- normalizează în `GpsPosition`

### Pas 3 — Persistență + latest snapshot

- salvează punctele în `positions`
- actualizează `vehicles/{vehicleId}.latestPosition`
- scrie evenimente (`ignition_on`, `ignition_off`, `engine_blocked`)

### Pas 4 — Hartă live

- pagină `LiveMapPage.tsx`
- subscriberi în timp real la `latestPosition`
- update marker + centrare opțională
- afișare status: contact, viteză, ultima actualizare

### Pas 5 — Istoric traseu

- filtre interval (`from/to`)
- query puncte ordonate după timp
- polyline pe hartă
- timeline cu opriri/idle

### Pas 6 — Rapoarte zilnice/lunare

- job zilnic `tripAggregator.ts` (cron)
- calcule: distanță, timp mers, idle, viteză medie/max
- UI `TripReportsPage.tsx` cu export CSV/PDF

### Pas 7 — Comenzi motor (pornit/oprit)

- UI în `VehicleEngineControlCard.tsx`
- backend proxy `ftc880CommandProxy.ts`
- log audit obligatoriu + roluri (`admin/fleet_manager`)
- confirmare cu 2 pași pentru `engine_stop`

### Pas 8 — Notificări

- reguli în `notification_rules`
- motor de reguli `notificationDispatcher.ts`
- canale: in-app, email, push
- evenimente minime: contact pornit/oprit, ieșire geofence, offline > X minute

### Pas 9 — Asignare vehicul-user

- `VehicleAssignmentCard.tsx`
- istoric asignări cu interval activ
- folosește asignarea în rapoarte (cine conducea la ora X)

### Pas 10 — Hardening + observabilitate

- rate limit webhook
- retry + dead-letter pentru comenzi
- dashboard erori ingestie/comenzi
- alerte când tracker nu mai transmite

---

## 7) Reguli de securitate (obligatoriu)

1. **Niciodată** token-ul provider în frontend.
2. Comenzile engine stop/resume doar cu RBAC + audit log.
3. PII minim în payload-urile afișate.
4. Reguli Firestore pe rol + ownership flotă.
5. Confirmare explicită pentru acțiuni critice (engine stop).

---

## 8) Config necesar în `.env.example`

```env
# maps
VITE_MAP_PROVIDER=mapbox
VITE_MAPBOX_TOKEN=

# gps backend
VITE_GPS_API_BASE_URL=https://<backend-url>

# backend secrets (doar server)
FTC880_WEBHOOK_SECRET=
FTC880_API_BASE_URL=
FTC880_API_KEY=
FTC880_API_SECRET=
```

---

## 9) MVP realist (2-3 sprinturi)

### Sprint 1
- ingestion + latest position + live map pe un vehicul

### Sprint 2
- istoric traseu + rapoarte zilnice + asignare user

### Sprint 3
- comenzi engine stop/resume + notificări + geofence

---

## 10) Criterii de acceptanță

- markerul live se actualizează în < 5 secunde de la noua poziție
- traseul istoric pe 24h se încarcă sub 2 secunde (pentru ~5k puncte)
- raport zilnic include: km, durată, idle, max speed
- comanda `engine_stop` are status clar: queued/sent/ack/failed
- toate acțiunile critice sunt auditate (cine, când, ce vehicul)

---

## 11) Ce îți mai trebuie de la vendorul FTC880

Ca să finalizăm integrarea, cere explicit:

1. protocol + exemple payload live
2. metoda de autentificare webhook
3. API comenzi remote + exemple request/response
4. coduri de status/eroare pentru ack comenzi
5. limitări de rată + SLA disponibilitate

Cu aceste informații pot să-ți dau și un **contract API final** + implementare concretă endpoint cu endpoint.
