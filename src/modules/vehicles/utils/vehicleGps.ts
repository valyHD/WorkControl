import type {
  VehicleGeoEvent,
  VehicleGeoEventType,
  VehiclePositionItem,
  VehicleStopItem,
} from "../../../types/vehicle";

const DEFAULT_STOP_SPEED_KMH = 4;
const DEFAULT_STOP_MIN_MS = 4 * 60 * 1000;
const DEFAULT_OVERSPEED_COOLDOWN_MS = 5 * 60 * 1000;

export type DateRangePreset = "today" | "last24h" | "last7d" | "custom";
export type VehicleDistanceBucketType = "day" | "week" | "month";

export interface VehicleDistanceBucket {
  id: string;
  label: string;
  startTs: number;
  endTs: number;
  distanceKm: number;
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
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function sanitizePositions(positions: VehiclePositionItem[]): VehiclePositionItem[] {
  return [...positions]
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .filter((item) => !(item.lat === 0 && item.lng === 0))
    .sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);
}

export function samplePositions(
  positions: VehiclePositionItem[],
  maxPoints = 800
): VehiclePositionItem[] {
  if (positions.length <= maxPoints) return positions;

  const bucket = Math.ceil(positions.length / maxPoints);
  return positions.filter((_, index) => index % bucket === 0);
}

export function detectStops(
  positions: VehiclePositionItem[],
  options?: { minStopMs?: number; speedThresholdKmh?: number }
): VehicleStopItem[] {
  const minStopMs = options?.minStopMs ?? DEFAULT_STOP_MIN_MS;
  const speedThresholdKmh = options?.speedThresholdKmh ?? DEFAULT_STOP_SPEED_KMH;

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
        id: `stop-${start.id}-${end.id}`,
        start,
        end,
        durationMs,
        lat: avgLat,
        lng: avgLng,
      });
    }

    run = [];
  };

  for (const point of positions) {
    if ((point.speedKmh ?? 0) <= speedThresholdKmh) {
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
  const markers: VehiclePositionItem[] = [];
  let lastMarkerAt = 0;

  for (const point of positions) {
    if ((point.speedKmh ?? 0) < thresholdKmh) continue;
    if (!lastMarkerAt || point.gpsTimestamp - lastMarkerAt >= cooldownMs) {
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
    events.push({
      id: `${type}-${timestamp}-${events.length}`,
      type,
      timestamp,
      label,
      metadata,
    });
  };

  for (const point of positions) {
    if (point.ignitionOn) {
      add("ignition_on", point.gpsTimestamp, "Contact pornit", {
        speedKmh: point.speedKmh,
      });
      break;
    }
  }

  for (const point of positions) {
    if ((point.speedKmh ?? 0) > 6) {
      add("moving", point.gpsTimestamp, "Vehicul in miscare", {
        speedKmh: point.speedKmh,
      });
      break;
    }
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

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
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
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function calculateRouteDistanceKm(positions: VehiclePositionItem[]): number {
  if (positions.length <= 1) return 0;
  let total = 0;

  for (let index = 1; index < positions.length; index += 1) {
    const prev = positions[index - 1];
    const next = positions[index];

    const odometerDelta = (next.odometerKm ?? 0) - (prev.odometerKm ?? 0);
    if (odometerDelta > 0 && odometerDelta < 20) {
      total += odometerDelta;
      continue;
    }

    const geoDelta = haversineKm(prev.lat, prev.lng, next.lat, next.lng);
    if (geoDelta > 0 && geoDelta < 20) {
      total += geoDelta;
    }
  }

  return Number(total.toFixed(2));
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
  if (positions.length <= 1) return [];

  const buckets = new Map<string, {
    label: string;
    startTs: number;
    endTs: number;
    points: VehiclePositionItem[];
  }>();

  for (const point of positions) {
    const date = new Date(point.gpsTimestamp);
    let key = "";
    let startTs = 0;
    let endTs = 0;
    let label = "";

    if (type === "day") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 1);
      key = start.toISOString().slice(0, 10);
      startTs = start.getTime();
      endTs = end.getTime();
      label = start.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" });
    } else if (type === "week") {
      const start = getWeekStart(date);
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 7);
      key = `wk-${start.toISOString().slice(0, 10)}`;
      startTs = start.getTime();
      endTs = end.getTime();
      label = `${start.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" })} - ${new Date(end.getTime() - 1).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    } else {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      key = `mo-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      startTs = start.getTime();
      endTs = end.getTime();
      label = start.toLocaleDateString("ro-RO", { month: "long", year: "numeric" });
    }

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { label, startTs, endTs, points: [point] });
    } else {
      existing.label = label;
      existing.points.push(point);
    }
  }

  return [...buckets.entries()]
    .map(([id, value]) => ({
      id,
      label: value.label,
      startTs: value.startTs,
      endTs: value.endTs,
      distanceKm: calculateRouteDistanceKm(value.points),
    }))
    .sort((a, b) => b.startTs - a.startTs);
}
