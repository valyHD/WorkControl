/**
 * GPS Simulator Service
 *
 * Strategie:
 *  - Starea activa ramane in positions/_simulation, separat de GPS-ul fizic.
 *  - Traseele finalizate sunt documente individuale in simulationRoutes.
 *  - Pozitia afisata este calculata din timp: continua si daca pagina este inchisa.
 *  - Nu atingem positionDays si nu rescriem gpsSnapshot-ul trackerului fizic.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase/firebase';
import { applyVehicleMileageAdjustment } from '../utils/vehicleMileage';

export interface RoutePoint {
  lat: number;
  lng: number;
  speedKmh: number;
  angle: number;
  distanceFromStartKm: number;
}

export interface SimulationConfig {
  vehicleId: string;
  vehiclePlate: string;
  destinationQuery?: string;
  destinationDisplay?: string;
  startOdometerKm: number;
  route: RoutePoint[];
  totalDurationMs: number;
  totalDistanceKm: number;
}

export interface SimulationProgress {
  currentPointIndex: number;
  totalPoints: number;
  currentLat: number;
  currentLng: number;
  currentSpeedKmh: number;
  elapsedMs: number;
  remainingMs: number;
  distanceCoveredKm: number;
}

export interface PersistedGpsSimulation {
  id?: string;
  active?: boolean;
  status?: 'running' | 'paused' | 'done';
  points?: Array<{
    lat: number;
    lng: number;
    speedKmh: number;
    angle: number;
    odometerKm: number;
    ts: number;
    ignitionOn: boolean;
  }>;
  startedAt?: number;
  resumedAt?: number;
  pausedAt?: number | null;
  elapsedBeforePauseMs?: number;
  totalDurationMs?: number;
  totalDistanceKm?: number;
  destinationQuery?: string;
  destinationDisplay?: string;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
}

export interface GpsRouteStateSnapshot {
  gpsSim?: PersistedGpsSimulation | null;
  gpsSimHistory?: PersistedGpsSimulation[];
  currentKm?: number;
}

const SIMULATION_STATE_SCHEMA_VERSION = 2;
const SIMULATION_HISTORY_LIMIT = 250;
// A route document can be large. Small batches stay safely below Firestore's
// 10 MiB request limit even when several dense routes are restored or edited.
const SIMULATION_BATCH_CHUNK_SIZE = 8;

function simulationStateRef(vehicleId: string) {
  return doc(db, 'vehicles', vehicleId, 'positions', '_simulation');
}

function simulationRoutesCollection(vehicleId: string) {
  return collection(db, 'vehicles', vehicleId, 'simulationRoutes');
}

function simulationRouteRef(vehicleId: string, simulationId: string) {
  return doc(db, 'vehicles', vehicleId, 'simulationRoutes', simulationId);
}

function getSimulationId(simulation: PersistedGpsSimulation, index: number) {
  return simulation.id || `sim-${simulation.startedAt || index}`;
}

function withoutSimulationPoints(
  simulation: PersistedGpsSimulation,
  index: number
): PersistedGpsSimulation {
  const { points: _points, ...metadata } = simulation;
  return {
    ...metadata,
    id: getSimulationId(simulation, index),
    active: false,
    status: 'done',
  };
}

function normalizeHistoryMetadata(history: PersistedGpsSimulation[]) {
  return [...(history ?? [])]
    .sort((left, right) => (left.startedAt || 0) - (right.startedAt || 0))
    .slice(-SIMULATION_HISTORY_LIMIT)
    .map((simulation, index) => withoutSimulationPoints(simulation, index));
}

function buildSimulationRoutePayload(
  vehicleId: string,
  simulation: PersistedGpsSimulation,
  index: number,
  updatedAt: number
) {
  const id = getSimulationId(simulation, index);
  return {
    schemaVersion: SIMULATION_STATE_SCHEMA_VERSION,
    vehicleId,
    routeId: id,
    ...simulation,
    id,
    active: false,
    status: 'done' as const,
    updatedAt,
  };
}

function buildSimulationStatePayload(
  vehicleId: string,
  gpsSim: PersistedGpsSimulation | null,
  gpsSimHistory: PersistedGpsSimulation[],
  updatedAt: number
) {
  return {
    schemaVersion: SIMULATION_STATE_SCHEMA_VERSION,
    vehicleId,
    gpsSim,
    gpsSimHistory: normalizeHistoryMetadata(gpsSimHistory),
    historyCount: Math.min(gpsSimHistory.length, SIMULATION_HISTORY_LIMIT),
    updatedAt,
  };
}

async function commitSimulationOperationsInChunks(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>
) {
  for (let offset = 0; offset < operations.length; offset += SIMULATION_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    operations
      .slice(offset, offset + SIMULATION_BATCH_CHUNK_SIZE)
      .forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function ensureSimulationHistoryV2(vehicleId: string): Promise<void> {
  const stateRef = simulationStateRef(vehicleId);
  const stateSnap = await getDoc(stateRef);
  if (!stateSnap.exists()) return;

  const state = stateSnap.data() as Record<string, unknown>;
  const history = Array.isArray(state.gpsSimHistory)
    ? state.gpsSimHistory as PersistedGpsSimulation[]
    : [];
  const hasEmbeddedRoutes = history.some((route) => Array.isArray(route.points) && route.points.length > 0);
  if (Number(state.schemaVersion || 1) >= SIMULATION_STATE_SCHEMA_VERSION && !hasEmbeddedRoutes) {
    return;
  }

  const migratedAt = Date.now();
  await commitSimulationOperationsInChunks(
    history.map((simulation, index) => {
      return (batch: ReturnType<typeof writeBatch>) => {
        batch.set(
          simulationRouteRef(vehicleId, getSimulationId(simulation, index)),
          buildSimulationRoutePayload(vehicleId, simulation, index, migratedAt),
          { merge: true }
        );
      };
    })
  );

  await runTransaction(db, async (transaction) => {
    const currentSnap = await transaction.get(stateRef);
    if (!currentSnap.exists()) return;
    const current = currentSnap.data() as Record<string, unknown>;
    const currentHistory = Array.isArray(current.gpsSimHistory)
      ? current.gpsSimHistory as PersistedGpsSimulation[]
      : [];
    transaction.set(
      stateRef,
      buildSimulationStatePayload(
        vehicleId,
        current.gpsSim && typeof current.gpsSim === 'object'
          ? current.gpsSim as PersistedGpsSimulation
          : null,
        currentHistory,
        migratedAt
      ),
      { merge: true }
    );
  });
}

async function updateSimulationStatus(
  vehicleId: string,
  update: (current: PersistedGpsSimulation) => PersistedGpsSimulation
) {
  await ensureSimulationHistoryV2(vehicleId);
  const simulationRef = simulationStateRef(vehicleId);
  const vehicleRef = doc(db, 'vehicles', vehicleId);
  await runTransaction(db, async (transaction) => {
    const simulationSnap = await transaction.get(simulationRef);
    const vehicleSnap = simulationSnap.exists() ? null : await transaction.get(vehicleRef);
    const storedState: Record<string, unknown> = simulationSnap.exists()
      ? simulationSnap.data()
      : vehicleSnap?.exists()
        ? vehicleSnap.data()
        : {};
    const current = storedState.gpsSim && typeof storedState.gpsSim === 'object'
      ? storedState.gpsSim as PersistedGpsSimulation
      : null;
    if (!current) throw new Error('Traseul activ nu mai este disponibil. Reincarca pagina.');
    const now = Date.now();
    const history = Array.isArray(storedState.gpsSimHistory)
      ? storedState.gpsSimHistory as PersistedGpsSimulation[]
      : [];
    transaction.set(simulationRef, buildSimulationStatePayload(
      vehicleId,
      update(current),
      history,
      now
    ));
  });
}

function clampElapsed(ms: number, totalMs: number) {
  return Math.min(Math.max(0, ms), Math.max(0, totalMs));
}

function getSimulationTotalDurationMs(simulation?: PersistedGpsSimulation | null) {
  if (!simulation) return 0;
  return (
    simulation.totalDurationMs ||
    Math.max(
      0,
      (simulation.points?.[simulation.points.length - 1]?.ts || 0) - (simulation.startedAt || 0)
    )
  );
}

function getSimulationElapsedMs(simulation?: PersistedGpsSimulation | null, now = Date.now()) {
  if (!simulation) return 0;

  const totalDurationMs = getSimulationTotalDurationMs(simulation);
  const baseElapsed = simulation.elapsedBeforePauseMs || 0;
  if (simulation.status === 'paused') {
    return clampElapsed(baseElapsed, totalDurationMs || baseElapsed);
  }

  const resumedAt = simulation.resumedAt || simulation.startedAt || now;
  return clampElapsed(
    baseElapsed + Math.max(0, now - resumedAt),
    totalDurationMs || Number.MAX_SAFE_INTEGER
  );
}

function trimSimulationPointsToElapsed(
  simulation: PersistedGpsSimulation,
  now: number
) {
  const points = simulation.points ?? [];
  if (!points.length) return [];

  const startedAt = simulation.startedAt || points[0]?.ts || now;
  const totalDurationMs = getSimulationTotalDurationMs(simulation);
  const elapsedMs = getSimulationElapsedMs(simulation, now);
  if (totalDurationMs > 0 && elapsedMs >= totalDurationMs) return points;

  const cutoffTs = startedAt + elapsedMs;
  const trimmed = points.filter((point) => (point.ts || 0) <= cutoffTs);
  return trimmed.length ? trimmed : [points[0]!];
}

function getSimulationDistanceFromPoints(
  points: PersistedGpsSimulation["points"],
  fallbackDistanceKm: number,
  ratio: number
) {
  const first = points?.[0];
  const last = points?.[points.length - 1];
  if (
    first &&
    last &&
    Number.isFinite(first.odometerKm) &&
    Number.isFinite(last.odometerKm) &&
    last.odometerKm >= first.odometerKm
  ) {
    return Number((last.odometerKm - first.odometerKm).toFixed(2));
  }

  return Number((Math.max(0, fallbackDistanceKm || 0) * ratio).toFixed(2));
}

function toSafeKm(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function getVehicleKmBase(data: Record<string, any>) {
  const initialKm = toSafeKm(data.initialRecordedKm);
  const currentKm = toSafeKm(data.currentKm);
  const snapshotKm = toSafeKm(
    applyVehicleMileageAdjustment(data.gpsSnapshot?.odometerKm, data.mileageAdjustmentKm)
  );
  const trustedSnapshotKm = initialKm > 0 && snapshotKm < initialKm ? 0 : snapshotKm;
  const trustedCurrentKm = initialKm > 0 && currentKm < initialKm ? 0 : currentKm;

  return Math.max(initialKm, trustedCurrentKm, trustedSnapshotKm);
}

function addDistanceToVehicleKm(data: Record<string, any>, distanceKm: unknown) {
  const safeDistanceKm =
    typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0
      ? distanceKm
      : 0;
  return Number((getVehicleKmBase(data) + safeDistanceKm).toFixed(2));
}

function buildHistoryEntry(currentSimulation?: PersistedGpsSimulation | null) {
  const now = Date.now();
  const points = currentSimulation
    ? trimSimulationPointsToElapsed(currentSimulation, now)
    : [];
  if (!points.length) return null;
  const totalDurationMs = getSimulationTotalDurationMs(currentSimulation);
  const elapsedMs = getSimulationElapsedMs(currentSimulation, now);
  const durationMs = totalDurationMs > 0 ? Math.min(elapsedMs, totalDurationMs) : 0;
  const ratio = totalDurationMs > 0 ? Math.min(1, Math.max(0, durationMs / totalDurationMs)) : 1;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return {
    id: `sim-${currentSimulation?.startedAt || now}`,
    stoppedAt: now,
    startedAt: currentSimulation?.startedAt || now,
    totalDistanceKm: getSimulationDistanceFromPoints(
      points,
      currentSimulation?.totalDistanceKm || 0,
      ratio
    ),
    totalDurationMs: durationMs,
    destinationQuery: currentSimulation?.destinationQuery || '',
    destinationDisplay: currentSimulation?.destinationDisplay || '',
    startLat: currentSimulation?.startLat ?? firstPoint?.lat,
    startLng: currentSimulation?.startLng ?? firstPoint?.lng,
    endLat: lastPoint?.lat,
    endLng: lastPoint?.lng,
    points,
  };
}

function mergeSimulationHistory(
  history: PersistedGpsSimulation[],
  entry: PersistedGpsSimulation | null
) {
  const merged = new Map<string, PersistedGpsSimulation>();

  for (const simulation of history ?? []) {
    const id = getSimulationId(simulation, merged.size);
    merged.set(id, { ...simulation, id });
  }

  if (entry) {
    const id = getSimulationId(entry, merged.size);
    merged.set(id, { ...entry, id });
  }

  return [...merged.values()]
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .slice(-SIMULATION_HISTORY_LIMIT);
}

function normalizeHistoryOdometers(realBaseKm: number, history: PersistedGpsSimulation[]) {
  let cursorKm = Math.max(0, realBaseKm || 0);

  const normalizedHistory = [...(history ?? [])]
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .map((entry) => {
      const points = entry.points ?? [];
      const distanceKm = Math.max(0, Number(entry.totalDistanceKm) || 0);
      const rewrittenPoints = points.map((point, index) => {
        const progress = points.length <= 1 ? 0 : index / (points.length - 1);
        return {
          ...point,
          odometerKm: Number((cursorKm + distanceKm * progress).toFixed(2)),
        };
      });

      cursorKm = Number((cursorKm + distanceKm).toFixed(2));
      return {
        ...entry,
        totalDistanceKm: Number(distanceKm.toFixed(2)),
        points: rewrittenPoints,
      };
    });

  return {
    history: normalizedHistory,
    currentKm: Number(cursorKm.toFixed(2)),
  };
}

function rewriteSimulationDistance(
  simulation: PersistedGpsSimulation,
  newDistanceKm: number
): PersistedGpsSimulation {
  const points = simulation.points ?? [];
  const firstKm = points[0]?.odometerKm ?? 0;
  const safeDistanceKm = Math.max(0, Number(newDistanceKm) || 0);
  const rewrittenPoints = points.map((point, index) => {
    const progress = points.length <= 1 ? 0 : index / (points.length - 1);
    return {
      ...point,
      odometerKm: Number((firstKm + safeDistanceKm * progress).toFixed(2)),
    };
  });

  return {
    ...simulation,
    totalDistanceKm: Number(safeDistanceKm.toFixed(2)),
    points: rewrittenPoints,
  };
}

const MIN_SIM_SPEED_KMH = 10;
const MAX_SIM_SPEED_KMH = 63;
const DISPLAY_SPEED_SLOT_MS = 20_000;
const MAX_SIM_POINT_STEP_KM = 0.05;
const MAX_SIM_ROUTE_POINTS = 900;

function clampSimulationSpeedKmh(value: number) {
  if (!Number.isFinite(value)) return MIN_SIM_SPEED_KMH;
  return Math.min(MAX_SIM_SPEED_KMH, Math.max(MIN_SIM_SPEED_KMH, Math.round(value)));
}

function buildUrbanSpeedKmh(progress: number, totalDurationMs: number) {
  const slot = Math.max(0, Math.floor((progress * Math.max(1, totalDurationMs)) / DISPLAY_SPEED_SLOT_MS));
  const minDisplaySpeed = 16;
  const maxDisplaySpeed = 62;
  const speedRange = maxDisplaySpeed - minDisplaySpeed + 1;
  const variedSpeed = minDisplaySpeed + ((slot * 17 + 43) % speedRange);

  return clampSimulationSpeedKmh(variedSpeed);
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(from: [number, number], to: [number, number]) {
  const earthRadiusKm = 6371;
  const dLat = toRad(to[0] - from[0]);
  const dLng = toRad(to[1] - from[1]);
  const fromLat = toRad(from[0]);
  const toLat = toRad(to[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function densifyCoordinates(coordinates: Array<[number, number]>): Array<[number, number]> {
  if (coordinates.length <= 1) return coordinates;

  const result: Array<[number, number]> = [coordinates[0]!];

  for (let index = 1; index < coordinates.length; index += 1) {
    const prev = result[result.length - 1]!;
    const next = coordinates[index]!;
    const segmentKm = haversineKm(prev, next);
    const extraPoints = Math.max(0, Math.ceil(segmentKm / MAX_SIM_POINT_STEP_KM) - 1);

    for (let step = 1; step <= extraPoints; step += 1) {
      const progress = step / (extraPoints + 1);
      result.push([
        prev[0] + (next[0] - prev[0]) * progress,
        prev[1] + (next[1] - prev[1]) * progress,
      ]);
    }

    result.push(next);
  }

  if (result.length <= MAX_SIM_ROUTE_POINTS) return result;

  const sampled: Array<[number, number]> = [result[0]!];
  const step = (result.length - 2) / (MAX_SIM_ROUTE_POINTS - 2);
  for (let index = 1; index < MAX_SIM_ROUTE_POINTS - 1; index += 1) {
    sampled.push(result[Math.round(index * step)]!);
  }
  sampled.push(result[result.length - 1]!);
  return sampled;
}

export async function fetchRouteFromOSRM(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<{ coordinates: Array<[number, number]>; distanceKm: number; durationSec: number } | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json() as {
      routes?: Array<{ geometry: { coordinates: Array<[number, number]> }; distance: number; duration: number }>;
    };
    if (!data.routes?.length) return null;
    const r = data.routes[0]!;
    return {
      coordinates: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
      distanceKm: r.distance / 1000,
      durationSec: r.duration,
    };
  } catch (err) {
    console.error('[gps-route][OSRM]', err);
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<{
  lat: number; lng: number; displayName: string;
} | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ro`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ro' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data.length) return null;
    return { lat: parseFloat(data[0]!.lat), lng: parseFloat(data[0]!.lon), displayName: data[0]!.display_name };
  } catch (err) {
    console.error('[gps-route][geocode]', err);
    return null;
  }
}

export function buildSimulationConfig(
  vehicleId: string,
  vehiclePlate: string,
  coordinates: Array<[number, number]>,
  distanceKm: number,
  durationSec: number,
  startOdometerKm: number,
  customDurationMs?: number,
  destinationQuery = '',
  destinationDisplay = '',
): SimulationConfig {
  const routeCoordinates = densifyCoordinates(coordinates);
  const totalDurationMs = customDurationMs ?? durationSec * 1000;
  const segmentDistancesKm = routeCoordinates.map((coord, index) =>
    index === 0 ? 0 : haversineKm(routeCoordinates[index - 1]!, coord)
  );
  const totalCoordinateDistanceKm = segmentDistancesKm.reduce((total, value) => total + value, 0);

  let distanceCursorKm = 0;
  const route: RoutePoint[] = routeCoordinates.map((coord, i) => {
    distanceCursorKm += segmentDistancesKm[i] ?? 0;
    const progress = totalCoordinateDistanceKm > 0
       ? distanceCursorKm / totalCoordinateDistanceKm
      : routeCoordinates.length <= 1 ? 0 : i / (routeCoordinates.length - 1);

    let angle = 0;
    if (i < routeCoordinates.length - 1) {
      const next = routeCoordinates[i + 1]!;
      angle = Math.round((Math.atan2(next[1] - coord[1], next[0] - coord[0]) * 180) / Math.PI + 360) % 360;
    }

    const speedKmh = buildUrbanSpeedKmh(progress, totalDurationMs);

    return { lat: coord[0], lng: coord[1], speedKmh, angle, distanceFromStartKm: distanceKm * progress };
  });

  return {
    vehicleId,
    vehiclePlate,
    destinationQuery,
    destinationDisplay,
    startOdometerKm,
    route,
    totalDurationMs,
    totalDistanceKm: distanceKm,
  };
}

/**
 * Scrie tot traseul de test pe documentul dedicat positions/_simulation.
 * - Permis numai administratorului global prin Firestore Rules
 * - Vazut instant prin adaptorul de simulare al serviciului de vehicule
 * - Ramane dupa oprire (active=false) ca dovada in istoric
 */
export async function startGpsSimOnFirestore(
  config: SimulationConfig,
): Promise<PersistedGpsSimulation> {
  await ensureSimulationHistoryV2(config.vehicleId);
  const startedAt = Date.now();
  const points = config.route.map((p, index) => {
    const progress = config.route.length <= 1 ? 0 : index / (config.route.length - 1);
    return {
      lat: p.lat,
      lng: p.lng,
      speedKmh: p.speedKmh,
      angle: p.angle,
      odometerKm: Number((config.startOdometerKm + p.distanceFromStartKm).toFixed(2)),
      ts: Math.round(startedAt + progress * config.totalDurationMs),
      ignitionOn: true,
    };
  });
  // Marcam ultimul punct: motor oprit
  if (points.length > 0) {
    points[points.length - 1]!.speedKmh = 0;
    points[points.length - 1]!.ignitionOn = false;
  }

  const nextGpsSim: PersistedGpsSimulation = {
    active: true,
    status: 'running',
    startedAt,
    resumedAt: startedAt,
    pausedAt: null,
    elapsedBeforePauseMs: 0,
    totalDurationMs: config.totalDurationMs,
    totalDistanceKm: config.totalDistanceKm,
    destinationQuery: config.destinationQuery || '',
    destinationDisplay: config.destinationDisplay || '',
    startLat: points[0]?.lat,
    startLng: points[0]?.lng,
    endLat: points[points.length - 1]?.lat,
    endLng: points[points.length - 1]?.lng,
    points,
  };

  const vehicleRef = doc(db, 'vehicles', config.vehicleId);
  const simulationRef = simulationStateRef(config.vehicleId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(vehicleRef);
    const simulationSnap = await transaction.get(simulationRef);
    const data = snap.exists() ? snap.data() as Record<string, any> : {};
    const storedState = simulationSnap.exists()
      ? simulationSnap.data() as Record<string, any>
      : data;
    const existingHistory = Array.isArray(storedState.gpsSimHistory)
       ? storedState.gpsSimHistory as PersistedGpsSimulation[]
      : [];
    const activeSimulation =
      storedState.gpsSim && typeof storedState.gpsSim === 'object'
         ? storedState.gpsSim as PersistedGpsSimulation
        : null;
    const previousHistoryEntry = buildHistoryEntry(activeSimulation);
    const traveledKm = previousHistoryEntry?.totalDistanceKm || 0;
    if (previousHistoryEntry) {
      transaction.set(
        simulationRouteRef(
          config.vehicleId,
          getSimulationId(previousHistoryEntry, existingHistory.length)
        ),
        buildSimulationRoutePayload(
          config.vehicleId,
          previousHistoryEntry,
          existingHistory.length,
          startedAt
        ),
        { merge: true }
      );
    }
    transaction.set(simulationRef, buildSimulationStatePayload(
      config.vehicleId,
      nextGpsSim,
      mergeSimulationHistory(existingHistory, previousHistoryEntry),
      startedAt
    ));
    if (traveledKm > 0) {
      transaction.update(vehicleRef, {
        currentKm: addDistanceToVehicleKm(data, traveledKm),
        updatedAt: startedAt,
      });
    }
  });

  return nextGpsSim;
}

export async function pauseGpsSimOnFirestore(
  vehicleId: string,
  totalDurationMs: number,
  resumedAt: number,
  elapsedBeforePauseMs: number,
): Promise<void> {
  const now = Date.now();
  const elapsed = clampElapsed(elapsedBeforePauseMs + Math.max(0, now - resumedAt), totalDurationMs);
  await updateSimulationStatus(vehicleId, (current) => ({
    ...current,
    status: 'paused',
    pausedAt: now,
    elapsedBeforePauseMs: elapsed,
  }));
}

export async function resumeGpsSimOnFirestore(vehicleId: string): Promise<void> {
  const now = Date.now();
  await updateSimulationStatus(vehicleId, (current) => ({
    ...current,
    status: 'running',
    resumedAt: now,
    pausedAt: null,
  }));
}

export async function stopGpsSimOnFirestore(
  vehicleId: string,
): Promise<void> {
  await ensureSimulationHistoryV2(vehicleId);
  const now = Date.now();
  const vehicleRef = doc(db, 'vehicles', vehicleId);
  const simulationRef = simulationStateRef(vehicleId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(vehicleRef);
    const simulationSnap = await transaction.get(simulationRef);
    const data = snap.exists() ? snap.data() as Record<string, any> : {};
    const storedState = simulationSnap.exists()
      ? simulationSnap.data() as Record<string, any>
      : data;
    const existingHistory = Array.isArray(storedState.gpsSimHistory)
       ? storedState.gpsSimHistory as PersistedGpsSimulation[]
      : [];
    const activeSimulation =
      storedState.gpsSim && typeof storedState.gpsSim === 'object'
         ? storedState.gpsSim as PersistedGpsSimulation
        : null;
    const historyEntry = buildHistoryEntry(activeSimulation);
    const traveledKm = historyEntry?.totalDistanceKm || 0;
    if (historyEntry) {
      transaction.set(
        simulationRouteRef(vehicleId, getSimulationId(historyEntry, existingHistory.length)),
        buildSimulationRoutePayload(vehicleId, historyEntry, existingHistory.length, now),
        { merge: true }
      );
    }
    transaction.set(simulationRef, buildSimulationStatePayload(
      vehicleId,
      null,
      mergeSimulationHistory(existingHistory, historyEntry),
      now
    ));
    if (traveledKm > 0) {
      transaction.update(vehicleRef, {
        currentKm: addDistanceToVehicleKm(data, traveledKm),
        updatedAt: now,
      });
    }
  });
}

export async function clearGpsSimHistoryOnFirestore(
  vehicleId: string,
  realBaseKm = 0
): Promise<void> {
  const now = Date.now();
  const routesSnap = await getDocs(query(
    simulationRoutesCollection(vehicleId),
    orderBy('startedAt', 'asc'),
    limit(SIMULATION_HISTORY_LIMIT)
  ));
  const batch = writeBatch(db);
  routesSnap.docs.forEach((routeDoc) => batch.delete(routeDoc.ref));
  batch.set(
    simulationStateRef(vehicleId),
    buildSimulationStatePayload(vehicleId, null, [], now)
  );
  batch.update(doc(db, 'vehicles', vehicleId), {
    currentKm: Number((realBaseKm || 0).toFixed(2)),
    updatedAt: now,
  });
  await batch.commit();
}

export async function deleteGpsSimHistoryEntryOnFirestore(
  vehicleId: string,
  history: PersistedGpsSimulation[],
  simulationId: string,
  realBaseKm = 0
): Promise<void> {
  const nextHistory = (history ?? []).filter(
    (simulation, index) => getSimulationId(simulation, index) !== simulationId
  );
  const normalized = normalizeHistoryOdometers(realBaseKm, nextHistory);
  const now = Date.now();
  await commitSimulationOperationsInChunks([
    (batch) => batch.delete(simulationRouteRef(vehicleId, simulationId)),
    ...normalized.history.map((simulation, index) => (batch: ReturnType<typeof writeBatch>) => {
      batch.set(
        simulationRouteRef(vehicleId, getSimulationId(simulation, index)),
        buildSimulationRoutePayload(vehicleId, simulation, index, now),
        { merge: true }
      );
    }),
  ]);
  const stateBatch = writeBatch(db);
  stateBatch.set(
    simulationStateRef(vehicleId),
    {
      schemaVersion: SIMULATION_STATE_SCHEMA_VERSION,
      vehicleId,
      gpsSimHistory: normalizeHistoryMetadata(normalized.history),
      historyCount: normalized.history.length,
      updatedAt: now,
    },
    { merge: true }
  );
  stateBatch.update(doc(db, 'vehicles', vehicleId), {
    currentKm: normalized.currentKm,
    updatedAt: now,
  });
  await stateBatch.commit();
}

export async function updateGpsSimHistoryDistanceOnFirestore(
  vehicleId: string,
  history: PersistedGpsSimulation[],
  simulationId: string,
  newDistanceKm: number,
  realBaseKm = 0
): Promise<void> {
  const nextHistory = (history ?? []).map((simulation, index) =>
    getSimulationId(simulation, index) === simulationId
       ? rewriteSimulationDistance(simulation, newDistanceKm)
      : simulation
  );
  const normalized = normalizeHistoryOdometers(realBaseKm, nextHistory);
  const now = Date.now();
  await commitSimulationOperationsInChunks(
    normalized.history.map((simulation, index) => (batch) => {
      batch.set(
        simulationRouteRef(vehicleId, getSimulationId(simulation, index)),
        buildSimulationRoutePayload(vehicleId, simulation, index, now),
        { merge: true }
      );
    })
  );
  const stateBatch = writeBatch(db);
  stateBatch.set(
    simulationStateRef(vehicleId),
    {
      schemaVersion: SIMULATION_STATE_SCHEMA_VERSION,
      vehicleId,
      gpsSimHistory: normalizeHistoryMetadata(normalized.history),
      historyCount: normalized.history.length,
      updatedAt: now,
    },
    { merge: true }
  );
  stateBatch.update(doc(db, 'vehicles', vehicleId), {
    currentKm: normalized.currentKm,
    updatedAt: now,
  });
  await stateBatch.commit();
}

export async function restoreGpsRouteStateOnFirestore(
  vehicleId: string,
  snapshot: GpsRouteStateSnapshot
): Promise<void> {
  const now = Date.now();
  const routesSnap = await getDocs(query(
    simulationRoutesCollection(vehicleId),
    orderBy('startedAt', 'asc'),
    limit(SIMULATION_HISTORY_LIMIT)
  ));
  await commitSimulationOperationsInChunks(
    routesSnap.docs.map((routeDoc) => (batch) => batch.delete(routeDoc.ref))
  );
  await commitSimulationOperationsInChunks(
    (snapshot.gpsSimHistory ?? []).map((simulation, index) => (batch) => {
      batch.set(
        simulationRouteRef(vehicleId, getSimulationId(simulation, index)),
        buildSimulationRoutePayload(vehicleId, simulation, index, now),
        { merge: true }
      );
    })
  );

  const stateBatch = writeBatch(db);
  stateBatch.set(
    simulationStateRef(vehicleId),
    buildSimulationStatePayload(
      vehicleId,
      snapshot.gpsSim ?? null,
      snapshot.gpsSimHistory ?? [],
      now
    )
  );
  stateBatch.update(doc(db, 'vehicles', vehicleId), {
    currentKm: Number((snapshot.currentKm || 0).toFixed(2)),
    updatedAt: now,
  });
  await stateBatch.commit();
}
