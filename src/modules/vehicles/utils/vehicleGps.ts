import type {
  VehicleGeoEvent,
  VehicleGeoEventType,
  VehiclePositionItem,
  VehicleStopItem,
} from "../../../types/vehicle";

const DEFAULT_STOP_SPEED_KMH = 4;
const DEFAULT_STOP_MIN_MS = 4 * 60 * 1000;
const DEFAULT_OVERSPEED_COOLDOWN_MS = 5 * 60 * 1000;

const MAX_REASONABLE_GAP_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_ROUTE_DURATION_GAP_MS = 15 * 60 * 1000; // durata contorizata doar pe GPS continuu
const MAX_REASONABLE_POINT_JUMP_KM = 20; // evita salturi GPS false
const MAX_REASONABLE_ODOMETER_STEP_KM = 20; // evita odometru corupt
const MIN_MOVING_SPEED_KMH = 10;
const MIN_GEO_MOVEMENT_STEP_KM = 0.05; // ~50m: elimina drift GPS la stationare
const IDLE_JITTER_MOVEMENT_STEP_KM = 0.08; // ~80m: ascunde puncte false cand masina sta
const IDLE_JITTER_CLUSTER_KM = 0.2; // ~200m: colapseaza deriva GPS cand vehiculul sta pe loc
const IDLE_JITTER_MAX_GAP_MS = 15 * 60 * 1000;
const RENDER_JITTER_IDLE_SPEED_KMH = 10;
const RENDER_JITTER_CLUSTER_KM = 0.35;
const RENDER_JITTER_TRAIL_CLUSTER_KM = 0.55;
const RENDER_JITTER_MOVEMENT_STEP_KM = 0.1;
const RENDER_MIN_DRAWABLE_DISTANCE_KM = 0.12;
const RENDER_JITTER_MAX_GAP_MS = 20 * 60 * 1000;
const TIMELINE_STATE_BREAK_MS = 5 * 60 * 1000;
const START_TO_MOVE_MAX_MS = 10 * 60 * 1000;
const IGNITION_OFF_AFTER_IDLE_MS = 10 * 60 * 1000;
const MIN_IMPLIED_MOVEMENT_SPEED_KMH = 5;
const MAX_PLAUSIBLE_ROUTE_SPEED_KMH = 220;

export type DateRangePreset = "today" | "last24h" | "last3d" | "last7d" | "custom";
export type VehicleDistanceBucketType = "day" | "week" | "month";

export interface VehicleDistanceBucket {
  id: string;
  label: string;
  startTs: number;
  endTs: number;
  distanceKm: number;
}

function buildDerivedIgnitionStates(positions: VehiclePositionItem[]): boolean[] {
  if (!positions.length) return [];

  const states: boolean[] = [];
  let ignitionOn = false;
  let lastMovingAt: number | null = null;

  for (let index = 0; index < positions.length; index += 1) {
    const point = positions[index];
    const timestamp = point.gpsTimestamp;
    if (point.ignitionOn === false) {
      ignitionOn = false;
      lastMovingAt = null;
    } else if (point.ignitionOn === true) {
      ignitionOn = true;
      if (isPointMoving(point, positions, index)) {
        lastMovingAt = timestamp;
      }
    } else if (isPointMoving(point, positions, index)) {
      ignitionOn = true;
      lastMovingAt = timestamp;
    } else if (
      ignitionOn &&
      lastMovingAt !== null &&
      timestamp - lastMovingAt >= IGNITION_OFF_AFTER_IDLE_MS
    ) {
      ignitionOn = false;
    }

    states.push(ignitionOn);
  }

  return states;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && value > 946684800000 && value < 4102444800000; // 2000 -> 2100
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function toSafeSpeed(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  if (value < 0) return 0;
  if (value > 400) return 400;
  return value;
}

function toSafeOdometer(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  if (value < 0) return undefined;
  if (value > 10_000_000) return undefined;
  return value;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function getPresetRange(preset: DateRangePreset): { from: number; to: number } {
  const now = Date.now();

  if (preset === "last24h") {
    return { from: now - 24 * 60 * 60 * 1000, to: now };
  }

  if (preset === "last7d") {
    return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
  }

  if (preset === "last3d") {
    return { from: now - 3 * 24 * 60 * 60 * 1000, to: now };
  }

  if (preset === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: now };
  }

  return { from: now - 24 * 60 * 60 * 1000, to: now };
}

export function toDateTimeLocalValue(ts: number): string {
  if (!isValidTimestamp(ts)) return "";

  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return isValidTimestamp(parsed) ? parsed : null;
}

export function sanitizePositions(positions: VehiclePositionItem[]): VehiclePositionItem[] {
  if (!Array.isArray(positions) || positions.length === 0) return [];

  const cleaned: VehiclePositionItem[] = positions
    .filter((item) => item && isValidLatLng(item.lat, item.lng))
    .filter((item) => isValidTimestamp(item.gpsTimestamp))
    .map((item) => ({
      ...item,
      speedKmh: toSafeSpeed(item.speedKmh),
      odometerKm: toSafeOdometer(item.odometerKm),
      satellites: isFiniteNumber(item.satellites) && item.satellites >= 0 ? item.satellites : 0,
      altitude: isFiniteNumber(item.altitude) ? item.altitude : 0,
      angle: isFiniteNumber(item.angle) ? item.angle : 0,
      ignitionOn: typeof item.ignitionOn === "boolean" ? item.ignitionOn : undefined,
    }))
    .sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);

  const deduped: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of cleaned) {
    const key = `${item.gpsTimestamp}_${item.lat}_${item.lng}_${item.speedKmh ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const filtered: VehiclePositionItem[] = [];

  for (const point of deduped) {
    const prev = filtered[filtered.length - 1];

    if (!prev) {
      filtered.push(point);
      continue;
    }

    const deltaMs = point.gpsTimestamp - prev.gpsTimestamp;
    if (deltaMs <= 0) continue;
    if (deltaMs > MAX_REASONABLE_GAP_MS) {
      filtered.push(point);
      continue;
    }

    const geoStepKm = haversineKm(prev.lat, prev.lng, point.lat, point.lng);
    if (geoStepKm > MAX_REASONABLE_POINT_JUMP_KM) continue;

    const prevOdo = toSafeOdometer(prev.odometerKm);
    const nextOdo = toSafeOdometer(point.odometerKm);
    const odometerStepKm =
      prevOdo !== undefined && nextOdo !== undefined ? nextOdo - prevOdo : undefined;

    if (odometerStepKm !== undefined && odometerStepKm > MAX_REASONABLE_ODOMETER_STEP_KM) {
      continue;
    }

    filtered.push(point);
  }

  return filtered;
}

export function samplePositions(
  positions: VehiclePositionItem[],
  maxPoints = 800
): VehiclePositionItem[] {
  if (!Array.isArray(positions) || positions.length <= maxPoints) return positions ?? [];
  if (maxPoints <= 2) return positions.slice(0, Math.max(1, maxPoints));

  const sampled: VehiclePositionItem[] = [];
  const lastIndex = positions.length - 1;

  sampled.push(positions[0]);

  const step = (positions.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i += 1) {
    const index = Math.min(lastIndex - 1, Math.max(1, Math.round(i * step)));
    sampled.push(positions[index]);
  }

  sampled.push(positions[lastIndex]);

  const unique: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of sampled) {
    const key = item.id || `${item.gpsTimestamp}_${item.lat}_${item.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique.sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);
}

export function getMaximumPositionSpeedKmh(
  ...positionSources: VehiclePositionItem[][]
): number {
  let maximumSpeedKmh = 0;

  for (const source of positionSources) {
    for (const position of source) {
      const speedKmh = Number(position.speedKmh);
      if (Number.isFinite(speedKmh) && speedKmh > maximumSpeedKmh) {
        maximumSpeedKmh = speedKmh;
      }
    }
  }

  return maximumSpeedKmh;
}

export function filterStationaryGpsJitter(
  positions: VehiclePositionItem[]
): VehiclePositionItem[] {
  const clean = sanitizePositions(positions);
  if (clean.length <= 1) return clean;

  const filtered: VehiclePositionItem[] = [];
  let idleAnchor: VehiclePositionItem | null = null;

  for (const point of clean) {
    const previous = filtered[filtered.length - 1];

    if (!previous) {
      filtered.push(point);
      if (point.ignitionOn === false || toSafeSpeed(point.speedKmh) <= DEFAULT_STOP_SPEED_KMH) {
        idleAnchor = point;
      }
      continue;
    }

    const deltaMs = point.gpsTimestamp - previous.gpsTimestamp;
    if (deltaMs <= 0) continue;

    const movedKm = haversineKm(previous.lat, previous.lng, point.lat, point.lng);
    const odometerStepKm =
      previous.odometerKm !== undefined && point.odometerKm !== undefined
         ? point.odometerKm - previous.odometerKm
        : undefined;
    const hasClearOdometerMovement =
      odometerStepKm !== undefined && odometerStepKm > IDLE_JITTER_MOVEMENT_STEP_KM;
    const speed = toSafeSpeed(point.speedKmh);
    const previousSpeed = toSafeSpeed(previous.speedKmh);
    const pointLooksIdle = point.ignitionOn === false || speed <= DEFAULT_STOP_SPEED_KMH;
    const previousLooksIdle = previous.ignitionOn === false || previousSpeed <= DEFAULT_STOP_SPEED_KMH;
    const anchorMovedKm = idleAnchor
       ? haversineKm(idleAnchor.lat, idleAnchor.lng, point.lat, point.lng)
      : movedKm;

    if (
      pointLooksIdle &&
      previousLooksIdle &&
      !hasClearOdometerMovement &&
      deltaMs <= IDLE_JITTER_MAX_GAP_MS &&
      anchorMovedKm < IDLE_JITTER_CLUSTER_KM
    ) {
      filtered[filtered.length - 1] = {
        ...previous,
        id: point.id || previous.id,
        gpsTimestamp: point.gpsTimestamp,
        serverTimestamp: point.serverTimestamp,
        speedKmh: 0,
        ignitionOn: false,
      };
      continue;
    }

    if (
      !hasClearOdometerMovement &&
      deltaMs <= IDLE_JITTER_MAX_GAP_MS &&
      movedKm < IDLE_JITTER_MOVEMENT_STEP_KM
    ) {
      continue;
    }

    filtered.push(point);
    idleAnchor = pointLooksIdle ? point : null;
  }

  return filtered;
}

export function filterRouteRenderJitter(
  positions: VehiclePositionItem[]
): VehiclePositionItem[] {
  const clean = filterStationaryGpsJitter(positions);
  if (clean.length <= 1) return clean;

  const filtered: VehiclePositionItem[] = [];
  let idleAnchor: VehiclePositionItem | null = null;

  const looksIdleForRender = (point: VehiclePositionItem) =>
    point.ignitionOn === false || toSafeSpeed(point.speedKmh) <= RENDER_JITTER_IDLE_SPEED_KMH;

  for (const point of clean) {
    const previous = filtered[filtered.length - 1];

    if (!previous) {
      filtered.push(point);
      idleAnchor = looksIdleForRender(point) ? point : null;
      continue;
    }

    const deltaMs = point.gpsTimestamp - previous.gpsTimestamp;
    if (deltaMs <= 0) continue;

    const movedKm = haversineKm(previous.lat, previous.lng, point.lat, point.lng);
    const odometerStepKm =
      previous.odometerKm !== undefined && point.odometerKm !== undefined
        ? point.odometerKm - previous.odometerKm
        : undefined;
    const hasClearOdometerMovement =
      odometerStepKm !== undefined && odometerStepKm > RENDER_JITTER_MOVEMENT_STEP_KM;
    const pointLooksIdle = looksIdleForRender(point);
    const previousLooksIdle = looksIdleForRender(previous);
    const anchorMovedKm = idleAnchor
      ? haversineKm(idleAnchor.lat, idleAnchor.lng, point.lat, point.lng)
      : movedKm;

    if (
      pointLooksIdle &&
      previousLooksIdle &&
      !hasClearOdometerMovement &&
      deltaMs <= RENDER_JITTER_MAX_GAP_MS &&
      anchorMovedKm <= RENDER_JITTER_CLUSTER_KM
    ) {
      filtered[filtered.length - 1] = {
        ...previous,
        id: point.id || previous.id,
        gpsTimestamp: point.gpsTimestamp,
        serverTimestamp: point.serverTimestamp,
        speedKmh: 0,
        ignitionOn: false,
      };
      continue;
    }

    if (
      !hasClearOdometerMovement &&
      deltaMs <= RENDER_JITTER_MAX_GAP_MS &&
      movedKm < RENDER_JITTER_MOVEMENT_STEP_KM &&
      (pointLooksIdle || previousLooksIdle)
    ) {
      continue;
    }

    filtered.push(point);
    idleAnchor = pointLooksIdle ? point : null;
  }

  const lastPoint = filtered[filtered.length - 1];
  if (!lastPoint || filtered.length <= 1) return filtered;

  let totalDistanceKm = 0;
  for (let index = 1; index < filtered.length; index += 1) {
    const previous = filtered[index - 1];
    const current = filtered[index];
    if (!previous || !current) continue;
    totalDistanceKm += haversineKm(previous.lat, previous.lng, current.lat, current.lng);
  }

  if (totalDistanceKm <= RENDER_MIN_DRAWABLE_DISTANCE_KM) {
    const stablePoint = filtered[0] ?? lastPoint;
    return [
      {
        ...stablePoint,
        id: lastPoint.id || stablePoint.id,
        gpsTimestamp: lastPoint.gpsTimestamp,
        serverTimestamp: lastPoint.serverTimestamp,
        speedKmh: 0,
        ignitionOn: false,
      },
    ];
  }

  if (!looksIdleForRender(lastPoint)) return filtered;

  let tailStartIndex = filtered.length - 1;
  for (let index = filtered.length - 2; index >= 0; index -= 1) {
    const point = filtered[index];
    if (!point) break;

    const gapMs = lastPoint.gpsTimestamp - point.gpsTimestamp;
    if (gapMs < 0 || gapMs > RENDER_JITTER_MAX_GAP_MS) break;

    const distanceToLastKm = haversineKm(point.lat, point.lng, lastPoint.lat, lastPoint.lng);
    const odometerDeltaKm =
      point.odometerKm !== undefined && lastPoint.odometerKm !== undefined
        ? lastPoint.odometerKm - point.odometerKm
        : 0;
    const hasClearTailOdometerMovement = odometerDeltaKm > RENDER_JITTER_MOVEMENT_STEP_KM;
    if (distanceToLastKm > RENDER_JITTER_TRAIL_CLUSTER_KM || hasClearTailOdometerMovement) {
      break;
    }

    tailStartIndex = index;
  }

  if (tailStartIndex < filtered.length - 1) {
    const stableTailPoint = filtered[tailStartIndex] ?? lastPoint;
    return [
      ...filtered.slice(0, tailStartIndex),
      {
        ...stableTailPoint,
        id: lastPoint.id || stableTailPoint.id,
        gpsTimestamp: lastPoint.gpsTimestamp,
        serverTimestamp: lastPoint.serverTimestamp,
        speedKmh: 0,
        ignitionOn: false,
      },
    ];
  }

  return filtered;
}

export function detectStops(
  positions: VehiclePositionItem[],
  options?: { minStopMs?: number; speedThresholdKmh?: number }
): VehicleStopItem[] {
  const minStopMs = Math.max(60_000, options?.minStopMs ?? DEFAULT_STOP_MIN_MS);
  const speedThresholdKmh = Math.max(0, options?.speedThresholdKmh ?? DEFAULT_STOP_SPEED_KMH);

  if (!positions.length) return [];

  const stops: VehicleStopItem[] = [];
  let run: VehiclePositionItem[] = [];

  const flush = () => {
    if (!run.length) return;

    const start = run[0];
    const end = run[run.length - 1];
    const durationMs = Math.max(0, end.gpsTimestamp - start.gpsTimestamp);

    if (durationMs >= minStopMs) {
      const avgLat = run.reduce((sum, point) => sum + point.lat, 0) / run.length;
      const avgLng = run.reduce((sum, point) => sum + point.lng, 0) / run.length;

      stops.push({
        id: `stop-${start.id}-${end.id}-${start.gpsTimestamp}`,
        start,
        end,
        durationMs,
        lat: avgLat,
        lng: avgLng,
      });
    }

    run = [];
  };

  for (let index = 0; index < positions.length; index += 1) {
    const point = positions[index];
    const prev = index > 0 ? positions[index - 1] : null;

    if (prev && point.gpsTimestamp < prev.gpsTimestamp) {
      flush();
      continue;
    }

    if (prev && point.gpsTimestamp - prev.gpsTimestamp > MAX_REASONABLE_GAP_MS) {
      flush();
    }

    const speed = toSafeSpeed(point.speedKmh);
    if (speed <= speedThresholdKmh) {
      run.push(point);
    } else {
      flush();
    }
  }

  flush();
  return stops;
}

export function detectOverspeed(
  positions: VehiclePositionItem[],
  thresholdKmh: number,
  cooldownMs = DEFAULT_OVERSPEED_COOLDOWN_MS
): VehiclePositionItem[] {
  const safeThreshold = Math.max(1, Math.min(400, thresholdKmh || 0));
  const safeCooldownMs = Math.max(0, cooldownMs);

  if (!positions.length) return [];

  const markers: VehiclePositionItem[] = [];
  let lastMarkerAt = 0;

  for (const point of positions) {
    const speed = toSafeSpeed(point.speedKmh);
    if (speed < safeThreshold) continue;

    if (!lastMarkerAt || point.gpsTimestamp - lastMarkerAt >= safeCooldownMs) {
      markers.push(point);
      lastMarkerAt = point.gpsTimestamp;
    }
  }

  return markers;
}

export function buildTimelineEvents(
  positions: VehiclePositionItem[],
  stops: VehicleStopItem[],
  overspeedPoints: VehiclePositionItem[]
): VehicleGeoEvent[] {
  const events: VehicleGeoEvent[] = [];

  const add = (
    type: VehicleGeoEventType,
    timestamp: number,
    label: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!isValidTimestamp(timestamp)) return;

    events.push({
      id: `${type}-${timestamp}-${events.length}`,
      type,
      timestamp,
      label,
      metadata,
    });
  };

  const ignitionStates = buildDerivedIgnitionStates(positions);
  const stopBreaks = stops
    .map((stop) => stop.end.gpsTimestamp)
    .filter((timestamp) => isValidTimestamp(timestamp))
    .sort((a, b) => a - b);

  let wasMoving = false;

  for (let index = 0; index < positions.length; index += 1) {
    const point = positions[index];
    const previousPoint = index > 0 ? positions[index - 1] : null;
    const hasLargeGap =
      previousPoint !== null &&
      point.gpsTimestamp - previousPoint.gpsTimestamp > TIMELINE_STATE_BREAK_MS;
    const hasStopBreak =
      previousPoint !== null &&
      stopBreaks.some(
        (timestamp) =>
          timestamp >= previousPoint.gpsTimestamp &&
          timestamp <= point.gpsTimestamp
      );
    const hasStateBreak = hasLargeGap || hasStopBreak;
    const currentIgnition = ignitionStates[index] ?? false;
    const previousIgnition = hasStateBreak
      ? false
      : index > 0
        ? ignitionStates[index - 1] ?? false
        : false;

    if (hasStateBreak) {
      wasMoving = false;
    }

    if (currentIgnition && !previousIgnition) {
      add("ignition_on", point.gpsTimestamp, "Contact pornit", {
        speedKmh: point.speedKmh,
      });
    }

    if (!currentIgnition && previousIgnition) {
      add("ignition_off", point.gpsTimestamp, "Contact oprit", {
        speedKmh: point.speedKmh,
      });
    }

    const isMoving =
      currentIgnition &&
      (toSafeSpeed(point.speedKmh) > MIN_MOVING_SPEED_KMH ||
        isPointMoving(point, positions, index));
    if (isMoving && !wasMoving) {
      add("moving", point.gpsTimestamp, "Vehicul in miscare", {
        speedKmh: point.speedKmh,
      });
    }
    wasMoving = isMoving;
  }

  for (const stop of stops) {
    const hasNearbyContactOff = events.some(
      (event) =>
        event.type === "ignition_off" &&
        Math.abs(event.timestamp - stop.start.gpsTimestamp) <= 60_000
    );
    if (!hasNearbyContactOff) {
      add("ignition_off", stop.start.gpsTimestamp, "Contact oprit", {
        speedKmh: stop.start.speedKmh,
      });
    }

    add("stop", stop.start.gpsTimestamp, "Oprire", {
      durationMs: stop.durationMs,
      lat: stop.lat,
      lng: stop.lng,
    });
  }

  for (const point of overspeedPoints) {
    add("overspeed", point.gpsTimestamp, "Depasire viteza", {
      speedKmh: point.speedKmh,
      lat: point.lat,
      lng: point.lng,
    });
  }

  const unique = new Map<string, VehicleGeoEvent>();
  for (const event of events) {
    const key = `${event.type}_${event.timestamp}_${JSON.stringify(event.metadata ?? {})}`;
    if (!unique.has(key)) unique.set(key, event);
  }

  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function formatDuration(ms: number): string {
  if (!isFiniteNumber(ms) || ms <= 0) return "0 min";

  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getSegmentDeltaMs(prev: VehiclePositionItem, next: VehiclePositionItem): number {
  return next.gpsTimestamp - prev.gpsTimestamp;
}

function getSegmentImpliedSpeedKmh(distanceKm: number, deltaMs: number): number {
  if (!isFiniteNumber(distanceKm) || !isFiniteNumber(deltaMs) || deltaMs <= 0) return 0;
  return distanceKm / (deltaMs / 3_600_000);
}

function getPlausibleGeoMovementKm(
  prev: VehiclePositionItem | undefined,
  next: VehiclePositionItem | undefined
): number {
  if (!prev || !next) return 0;

  const deltaMs = getSegmentDeltaMs(prev, next);
  if (deltaMs <= 0 || deltaMs > MAX_ROUTE_DURATION_GAP_MS) return 0;

  const geoDelta = haversineKm(prev.lat, prev.lng, next.lat, next.lng);
  if (geoDelta < MIN_GEO_MOVEMENT_STEP_KM) return 0;
  if (geoDelta >= MAX_REASONABLE_POINT_JUMP_KM) return 0;

  const impliedSpeed = getSegmentImpliedSpeedKmh(geoDelta, deltaMs);
  if (impliedSpeed > MAX_PLAUSIBLE_ROUTE_SPEED_KMH) return 0;
  if (impliedSpeed < MIN_IMPLIED_MOVEMENT_SPEED_KMH && geoDelta < IDLE_JITTER_MOVEMENT_STEP_KM) {
    return 0;
  }

  return geoDelta;
}

function isPointMoving(
  point: VehiclePositionItem,
  positions?: VehiclePositionItem[],
  index?: number
): boolean {
  if (point.ignitionOn === false) return false;
  if (toSafeSpeed(point.speedKmh) >= MIN_MOVING_SPEED_KMH) return true;
  if (!positions || index === undefined) return false;

  return (
    getPlausibleGeoMovementKm(positions[index - 1], point) > 0 ||
    getPlausibleGeoMovementKm(point, positions[index + 1]) > 0
  );
}

export function calculateRouteDistanceKm(positions: VehiclePositionItem[]): number {
  if (!Array.isArray(positions) || positions.length <= 1) return 0;

  const ignitionStates = buildDerivedIgnitionStates(positions);
  let total = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const prev = positions[index - 1];
    const next = positions[index];

    if (!prev || !next) continue;

    const timeDeltaMs = getSegmentDeltaMs(prev, next);
    if (timeDeltaMs <= 0) continue;
    if (timeDeltaMs > MAX_ROUTE_DURATION_GAP_MS) continue;

    const segmentDistanceKm = getTrackableSegmentDistanceKm(prev, next);
    if (segmentDistanceKm <= 0) continue;
    if (
      !ignitionStates[index - 1] &&
      !ignitionStates[index] &&
      getPlausibleGeoMovementKm(prev, next) <= 0
    ) {
      continue;
    }

    total += segmentDistanceKm;
  }

  return Number(total.toFixed(2));
}

function getTrackableSegmentDistanceKm(
  prev: VehiclePositionItem,
  next: VehiclePositionItem
): number {
  if (prev.ignitionOn === false && next.ignitionOn === false) return 0;

  const prevOdo = toSafeOdometer(prev.odometerKm);
  const nextOdo = toSafeOdometer(next.odometerKm);
  const odometerDelta =
    prevOdo !== undefined && nextOdo !== undefined ? nextOdo - prevOdo : undefined;

  if (
    odometerDelta !== undefined &&
    odometerDelta > 0 &&
    odometerDelta < MAX_REASONABLE_ODOMETER_STEP_KM
  ) {
    return odometerDelta;
  }

  const geoDelta = getPlausibleGeoMovementKm(prev, next);
  const prevSpeed = toSafeSpeed(prev.speedKmh);
  const nextSpeed = toSafeSpeed(next.speedKmh);
  const movingBySpeed = prevSpeed >= MIN_MOVING_SPEED_KMH || nextSpeed >= MIN_MOVING_SPEED_KMH;

  if (geoDelta <= 0) return 0;
  if (!movingBySpeed && getPlausibleGeoMovementKm(prev, next) <= 0) return 0;

  return geoDelta;
}

export function calculateRouteDurationMs(positions: VehiclePositionItem[]): number {
  if (!Array.isArray(positions) || positions.length <= 1) return 0;

  const ignitionStates = buildDerivedIgnitionStates(positions);
  let totalMs = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const prev = positions[index - 1];
    const next = positions[index];

    if (!prev || !next) continue;

    const deltaMs = getSegmentDeltaMs(prev, next);
    if (deltaMs <= 0) continue;
    if (deltaMs > MAX_ROUTE_DURATION_GAP_MS) continue;
    if (getTrackableSegmentDistanceKm(prev, next) <= 0) continue;
    if (
      !ignitionStates[index - 1] &&
      !ignitionStates[index] &&
      getPlausibleGeoMovementKm(prev, next) <= 0
    ) {
      continue;
    }

    totalMs += deltaMs;
  }

  return totalMs;
}

function getMetricSegmentDistanceKm(
  prev: VehiclePositionItem,
  next: VehiclePositionItem
): number {
  const deltaMs = getSegmentDeltaMs(prev, next);
  if (deltaMs <= 0 || deltaMs > MAX_ROUTE_DURATION_GAP_MS) return 0;

  const prevOdo = toSafeOdometer(prev.odometerKm);
  const nextOdo = toSafeOdometer(next.odometerKm);
  const odometerDelta =
    prevOdo !== undefined && nextOdo !== undefined ? nextOdo - prevOdo : undefined;

  if (
    odometerDelta !== undefined &&
    odometerDelta > 0 &&
    odometerDelta < MAX_REASONABLE_ODOMETER_STEP_KM
  ) {
    return odometerDelta;
  }

  return getPlausibleGeoMovementKm(prev, next);
}

export function calculateRouteMetricDistanceKm(
  positions: VehiclePositionItem[]
): number {
  const clean = sanitizePositions(positions);
  if (clean.length <= 1) return 0;

  let total = 0;
  for (let index = 1; index < clean.length; index += 1) {
    total += getMetricSegmentDistanceKm(clean[index - 1], clean[index]);
  }

  return Number(total.toFixed(2));
}

export function calculateRouteMetricDurationMs(
  positions: VehiclePositionItem[]
): number {
  const clean = sanitizePositions(positions);
  if (clean.length <= 1) return 0;

  let totalMs = 0;
  for (let index = 1; index < clean.length; index += 1) {
    const prev = clean[index - 1];
    const next = clean[index];
    if (getMetricSegmentDistanceKm(prev, next) <= 0) continue;
    totalMs += getSegmentDeltaMs(prev, next);
  }

  return totalMs;
}

export function filterTrackableRoutePositions(
  positions: VehiclePositionItem[]
): VehiclePositionItem[] {
  const clean = sanitizePositions(positions);
  if (!clean.length) return [];

  const ignitionStates = buildDerivedIgnitionStates(clean);

  const result: VehiclePositionItem[] = [];
  let segmentStartIndex = -1;
  let segment: VehiclePositionItem[] = [];

  const flushSegment = () => {
    if (!segment.length) return;

    const start = segment[0];
    const startTs = start.gpsTimestamp;

    let firstMovingIndex = -1;
    for (let index = 0; index < segment.length; index += 1) {
      const point = segment[index];
      const elapsed = point.gpsTimestamp - startTs;
      if (elapsed > START_TO_MOVE_MAX_MS) break;
      if (toSafeSpeed(point.speedKmh) > MIN_MOVING_SPEED_KMH || isPointMoving(point, segment, index)) {
        firstMovingIndex = index;
        break;
      }
    }

    if (firstMovingIndex < 0) {
      segmentStartIndex = -1;
      segment = [];
      return;
    }

    const startedSlice = segment.slice(firstMovingIndex);
    const startedSliceStart = segmentStartIndex + firstMovingIndex;
    const engineOnSlice = startedSlice.filter(
      (_point, index) => ignitionStates[startedSliceStart + index]
    );
    if (!engineOnSlice.length) {
      segmentStartIndex = -1;
      segment = [];
      return;
    }

    result.push(...engineOnSlice);
    segmentStartIndex = -1;
    segment = [];
  };

  for (let index = 0; index < clean.length; index += 1) {
    const point = clean[index];

    if (ignitionStates[index]) {
      if (segmentStartIndex < 0) segmentStartIndex = index;
      segment.push(point);
      continue;
    }

    flushSegment();
  }

  flushSegment();

  return sanitizePositions(result);
}

export function buildRouteMetricSegments(
  positions: VehiclePositionItem[]
): VehiclePositionItem[][] {
  const clean = filterStationaryGpsJitter(positions);
  if (clean.length <= 1) return [];

  const strictRoute = filterTrackableRoutePositions(clean);
  const strictDistanceKm = calculateRouteDistanceKm(strictRoute);
  const recoveredSegments: VehiclePositionItem[][] = [];
  let current: VehiclePositionItem[] = [];
  let currentDistanceKm = 0;

  const flush = () => {
    // Two connected movements over at least 200 m are strong evidence of a real trip,
    // even when a tracker incorrectly reports ignition off and zero speed.
    if (current.length >= 3 && currentDistanceKm >= 0.2) {
      recoveredSegments.push(current);
    }
    current = [];
    currentDistanceKm = 0;
  };

  for (let index = 1; index < clean.length; index += 1) {
    const prev = clean[index - 1];
    const next = clean[index];
    const segmentDistanceKm = getMetricSegmentDistanceKm(prev, next);

    if (segmentDistanceKm <= 0) {
      flush();
      continue;
    }

    if (!current.length) current.push(prev);
    current.push(next);
    currentDistanceKm += segmentDistanceKm;
  }

  flush();

  const recoveredDistanceKm = recoveredSegments.reduce(
    (total, segment) => total + calculateRouteMetricDistanceKm(segment),
    0
  );

  if (
    recoveredDistanceKm > 0 &&
    (strictDistanceKm <= 0 || recoveredDistanceKm >= strictDistanceKm + 0.3)
  ) {
    return recoveredSegments;
  }

  return strictRoute.length > 1 ? [strictRoute] : [];
}

function getWeekStart(date: Date): Date {
  const copy = new Date(date.getTime());
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function buildDistanceHistory(
  positions: VehiclePositionItem[],
  type: VehicleDistanceBucketType
): VehicleDistanceBucket[] {
  if (!Array.isArray(positions) || positions.length <= 1) return [];

  const clean = sanitizePositions(positions);
  if (clean.length <= 1) return [];

  const buckets = new Map<
    string,
    {
      label: string;
      startTs: number;
      endTs: number;
      distanceKm: number;
    }
  >();

  const getBucketMeta = (timestamp: number) => {
    const date = new Date(timestamp);

    if (type === "day") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 1);

      return {
        key: localDayKey(start),
        startTs: start.getTime(),
        endTs: end.getTime(),
        label: start.toLocaleDateString("ro-RO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      };
    }

    if (type === "week") {
      const start = getWeekStart(date);
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 7);

      return {
        key: `wk-${localDayKey(start)}`,
        startTs: start.getTime(),
        endTs: end.getTime(),
        label: `${start.toLocaleDateString("ro-RO", {
          day: "2-digit",
          month: "2-digit",
        })} - ${new Date(end.getTime() - 1).toLocaleDateString("ro-RO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}`,
      };
    }

    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

    return {
      key: `mo-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      startTs: start.getTime(),
      endTs: end.getTime(),
      label: start.toLocaleDateString("ro-RO", {
        month: "long",
        year: "numeric",
      }),
    };
  };

  for (let index = 1; index < clean.length; index += 1) {
    const prev = clean[index - 1];
    const next = clean[index];

    if (!prev || !next) continue;

    const deltaMs = next.gpsTimestamp - prev.gpsTimestamp;
    if (deltaMs <= 0 || deltaMs > MAX_REASONABLE_GAP_MS) continue;

    const segmentDistance = getMetricSegmentDistanceKm(prev, next);
    if (segmentDistance <= 0) continue;

    const meta = getBucketMeta(next.gpsTimestamp);
    const existing = buckets.get(meta.key);
    if (!existing) {
      buckets.set(meta.key, {
        label: meta.label,
        startTs: meta.startTs,
        endTs: meta.endTs,
        distanceKm: segmentDistance,
      });
    } else {
      existing.distanceKm += segmentDistance;
    }
  }

  return [...buckets.entries()]
    .map(([id, value]) => ({
      id,
      label: value.label,
      startTs: value.startTs,
      endTs: value.endTs,
      distanceKm: Number(value.distanceKm.toFixed(2)),
    }))
    .filter((item) => item.distanceKm >= 0)
    .sort((a, b) => b.startTs - a.startTs);
}
