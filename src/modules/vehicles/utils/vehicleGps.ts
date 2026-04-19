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
const MAX_REASONABLE_POINT_JUMP_KM = 20; // evita salturi GPS false
const MAX_REASONABLE_ODOMETER_STEP_KM = 20; // evita odometru corupt
const MIN_MOVING_SPEED_KMH = 6;
const START_TO_MOVE_MAX_MS = 10 * 60 * 1000;
const MIN_ENGINE_ON_VOLTAGE = 12.2;

export type DateRangePreset = "today" | "last24h" | "last7d" | "custom";
export type VehicleDistanceBucketType = "day" | "week" | "month";

export interface VehicleDistanceBucket {
  id: string;
  label: string;
  startTs: number;
  endTs: number;
  distanceKm: number;
}

function extractVoltageFromRawIo(rawIo: unknown): number | null {
  if (!rawIo || typeof rawIo !== "object") return null;
  const io = rawIo as Record<string, unknown>;

  const candidates = [
    io["66"],
    io["67"],
    io["68"],
    io["externalVoltage"],
    io["batteryVoltage"],
    io["voltage"],
  ];

  for (const candidate of candidates) {
    if (!isFiniteNumber(candidate)) continue;
    const value = Number(candidate);

    if (value > 1000) {
      const volts = value / 1000;
      if (volts >= 6 && volts <= 36) return volts;
      continue;
    }

    if (value >= 6 && value <= 36) {
      return value;
    }
  }

  return null;
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
      ignitionOn: Boolean(item.ignitionOn),
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

  const firstIgnitionOn = positions.find((point) => point.ignitionOn);
  if (firstIgnitionOn) {
    add("ignition_on", firstIgnitionOn.gpsTimestamp, "Contact pornit", {
      speedKmh: firstIgnitionOn.speedKmh,
    });
  }

  const firstMoving = positions.find((point) => toSafeSpeed(point.speedKmh) > MIN_MOVING_SPEED_KMH);
  if (firstMoving) {
    add("moving", firstMoving.gpsTimestamp, "Vehicul in miscare", {
      speedKmh: firstMoving.speedKmh,
    });
  }

  for (const stop of stops) {
    add("stop", stop.start.gpsTimestamp, "Stationare detectata", {
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

  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const point = positions[index];
    if (!point.ignitionOn) {
      add("ignition_off", point.gpsTimestamp, "Contact oprit", {
        speedKmh: point.speedKmh,
      });
      break;
    }
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

export function calculateRouteDistanceKm(positions: VehiclePositionItem[]): number {
  if (!Array.isArray(positions) || positions.length <= 1) return 0;

  let total = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const prev = positions[index - 1];
    const next = positions[index];

    if (!prev || !next) continue;

    const timeDeltaMs = next.gpsTimestamp - prev.gpsTimestamp;
    if (timeDeltaMs <= 0) continue;
    if (timeDeltaMs > MAX_REASONABLE_GAP_MS) continue;

const prevOdo = toSafeOdometer(prev.odometerKm);
const nextOdo = toSafeOdometer(next.odometerKm);
const odometerDelta =
  prevOdo !== undefined && nextOdo !== undefined ? nextOdo - prevOdo : undefined;

if (
  odometerDelta !== undefined &&
  odometerDelta > 0 &&
  odometerDelta < MAX_REASONABLE_ODOMETER_STEP_KM
) {
      total += odometerDelta;
      continue;
    }

    const geoDelta = haversineKm(prev.lat, prev.lng, next.lat, next.lng);

    if (geoDelta <= 0) continue;
    if (geoDelta >= MAX_REASONABLE_POINT_JUMP_KM) continue;

    total += geoDelta;
  }

  return Number(total.toFixed(2));
}

export function filterTrackableRoutePositions(
  positions: VehiclePositionItem[]
): VehiclePositionItem[] {
  const clean = sanitizePositions(positions);
  if (!clean.length) return [];

  const result: VehiclePositionItem[] = [];
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
      if (toSafeSpeed(point.speedKmh) >= MIN_MOVING_SPEED_KMH) {
        firstMovingIndex = index;
        break;
      }
    }

    if (firstMovingIndex < 0) {
      segment = [];
      return;
    }

    const voltageAtStart = extractVoltageFromRawIo(start.rawIo);
    const voltageAtMove = extractVoltageFromRawIo(segment[firstMovingIndex].rawIo);
    const hasEngineVoltage =
      (voltageAtStart !== null && voltageAtStart >= MIN_ENGINE_ON_VOLTAGE) ||
      (voltageAtMove !== null && voltageAtMove >= MIN_ENGINE_ON_VOLTAGE);

    if (!hasEngineVoltage && (voltageAtStart !== null || voltageAtMove !== null)) {
      segment = [];
      return;
    }

    result.push(...segment.slice(firstMovingIndex));
    segment = [];
  };

  for (const point of clean) {
    if (point.ignitionOn) {
      segment.push(point);
      continue;
    }

    flushSegment();
  }

  flushSegment();

  return result.length ? sanitizePositions(result) : [];
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
      points: VehiclePositionItem[];
    }
  >();

  for (const point of clean) {
    const date = new Date(point.gpsTimestamp);
    let key = "";
    let startTs = 0;
    let endTs = 0;
    let label = "";

    if (type === "day") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 1);

      key = localDayKey(start);
      startTs = start.getTime();
      endTs = end.getTime();
      label = start.toLocaleDateString("ro-RO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } else if (type === "week") {
      const start = getWeekStart(date);
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 7);

      key = `wk-${localDayKey(start)}`;
      startTs = start.getTime();
      endTs = end.getTime();
      label = `${start.toLocaleDateString("ro-RO", {
        day: "2-digit",
        month: "2-digit",
      })} - ${new Date(end.getTime() - 1).toLocaleDateString("ro-RO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })}`;
    } else {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

      key = `mo-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      startTs = start.getTime();
      endTs = end.getTime();
      label = start.toLocaleDateString("ro-RO", {
        month: "long",
        year: "numeric",
      });
    }

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        label,
        startTs,
        endTs,
        points: [point],
      });
    } else {
      existing.points.push(point);
    }
  }

  return [...buckets.entries()]
    .map(([id, value]) => {
      const bucketPoints = value.points.sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);

      return {
        id,
        label: value.label,
        startTs: value.startTs,
        endTs: value.endTs,
        distanceKm: calculateRouteDistanceKm(bucketPoints),
      };
    })
    .filter((item) => item.distanceKm >= 0)
    .sort((a, b) => b.startTs - a.startTs);
}
