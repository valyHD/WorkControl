import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, RefreshCw } from "lucide-react";
import type {
  VehicleGeoEvent,
  VehicleItem,
  VehiclePositionItem,
  VehicleStopItem,
} from "../../../types/vehicle";
import {
  getVehiclePositionsForSelectedDay,
  getVehicleTrackerEvents,
} from "../services/vehiclesService";
import {
  buildDistanceHistory,
  calculateRouteDurationMs,
  buildTimelineEvents,
  calculateRouteDistanceKm,
  detectOverspeed,
  filterRouteRenderJitter,
  filterStationaryGpsJitter,
  filterTrackableRoutePositions,
  formatDuration,
  samplePositions,
  sanitizePositions,
  type DateRangePreset,
  type VehicleDistanceBucket,
} from "../utils/vehicleGps";
import {
  appendLiveTrailPoint,
  getRenderableLiveTrail,
} from "../utils/vehicleLiveTrail";
import VehicleGpsStatsCard from "./VehicleGpsStatsCard";
import VehicleTripTimeline from "./VehicleTripTimeline";
import { useAuth } from "../../../providers/AuthProvider";

const DEFAULT_OVERSPEED_THRESHOLD = 140;
const LIVE_REFRESH_MS = 5000;
const ROUTE_RENDER_POINTS = 6000;
const ROUTE_ANALYSIS_POINTS = 6000;
const CRUMB_POINTS = 0;
const OVERSPEED_RENDER_POINTS = 16;
const STOP_RENDER_LIMIT = 32;
const MOBILE_ROUTE_RENDER_POINTS = 1800;
const MOBILE_ROUTE_ANALYSIS_POINTS = 1800;
const MOBILE_CRUMB_POINTS = 0;
const MOBILE_OVERSPEED_RENDER_POINTS = 5;
const MOBILE_STOP_RENDER_LIMIT = 8;
const ACTIVE_SIM_RENDER_POINTS = 192;
const MOBILE_ACTIVE_SIM_RENDER_POINTS = 96;
const MOBILE_ROUTE_PAGE_SIZE = 1200;
const DESKTOP_ROUTE_PAGE_SIZE = 2500;
const MOBILE_ROUTE_MAX_PAGES = 36;
const DESKTOP_ROUTE_MAX_PAGES = 80;
const LONG_RANGE_ROUTE_PAGE_SIZE = 150;
const LONG_RANGE_ROUTE_MAX_PAGES = 500;
const LIVE_INCREMENTAL_OVERLAP_MS = 12_000;
const ANALYSIS_COMMIT_MS = 10_000;
const MOBILE_ANALYSIS_COMMIT_MS = 20_000;
const SIGNATURE_SAMPLE_POINTS = 16;
const SIMULATION_UI_REFRESH_MS = 3_000;
const LONG_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SIM_DISPLAY_SPEED_KMH = 10;
const MAX_SIM_DISPLAY_SPEED_KMH = 63;
const SIM_DISPLAY_SPEED_SLOT_MS = 20_000;
const REAL_CONTACT_OFF_SPEED_KMH = 4;
const REAL_MOVING_SPEED_KMH = 6;
const REAL_STOP_GAP_MS = 6 * 60 * 1000;
const REAL_STOP_GAP_MAX_DISTANCE_KM = 0.35;
const REAL_STOP_DUPLICATE_WINDOW_MS = 12 * 60 * 1000;
const REAL_STOP_CLUSTER_DISTANCE_KM = 0.12;
const REAL_CONTACT_FRESH_GPS_MS = 90 * 1000;
const REAL_ROUTE_BOUNDARY_CLEANUP_MS = 20 * 60 * 1000;
const REAL_ROUTE_BOUNDARY_JITTER_DISTANCE_KM = 0.6;
const REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM = 1.2;
const REAL_ROUTE_BOUNDARY_IDLE_SPEED_KMH = 8;
const LIVE_ROUTE_ENDPOINT_MAX_GAP_MS = 60 * 60 * 1000;
const LIVE_ROUTE_ENDPOINT_MIN_DISTANCE_KM = 0.05;
const LIVE_ROUTE_ENDPOINT_MAX_DISTANCE_KM = 25;
const LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM = 0.5;
const LIVE_ROUTE_ENDPOINT_MAX_IMPLIED_SPEED_KMH = 180;
const ROUTE_STOP_ANCHOR_MIN_DISTANCE_KM = 0.25;
const ROUTE_STOP_ANCHOR_MAX_DISTANCE_KM = 15;
const ROUTE_STOP_ANCHOR_CONTEXT_GAP_MS = 90 * 60 * 1000;
const ROUTE_STOP_ANCHOR_CLUSTER_KM = 0.25;
const ROUTE_STOP_ANCHOR_CLUSTER_MS = 15 * 60 * 1000;

const currentIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--current",
  html: "",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const overspeedIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--overspeed",
  html: "<span>!</span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const PLANNED_ROUTE_OPTIONS = {
  color: "#2563eb",
  weight: 3,
  opacity: 0.3,
  dashArray: "8 8",
  smoothFactor: 2.5,
};

const STOP_MARKER_OPTIONS = {
  color: "#dc2626",
  fillColor: "#ef4444",
  fillOpacity: 0.85,
  weight: 2,
};

const CRUMB_MARKER_OPTIONS = {
  color: "#60a5fa",
  fillOpacity: 0.7,
};

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function toDateInputValue(ts = Date.now()) {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getLocalDayRange(dayValue: string) {
  const start = new Date(`${dayValue}T00:00:00`);
  if (!Number.isFinite(start.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return { from: fallback.getTime(), to: Date.now() };
  }

  const end = new Date(start.getTime());
  end.setHours(23, 59, 59, 999);

  return {
    from: start.getTime(),
    to: Math.min(end.getTime(), Date.now()),
  };
}

function getRelativeDayValue(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return toDateInputValue(date.getTime());
}

function formatQuickDayLabel(dayValue: string, offsetDays: number) {
  if (offsetDays === 0) return "Azi";
  if (offsetDays === 1) return "Ieri";

  const date = new Date(`${dayValue}T12:00:00`);
  return date.toLocaleDateString("ro-RO", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidCoordPair(lat: unknown, lng: unknown) {
  if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function getTrustedTotalOdometerKm(value: unknown, initialRecordedKm: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (initialRecordedKm > 0 && value < initialRecordedKm) return 0;
  return value;
}

function safeRoutePoints(items: VehiclePositionItem[]) {
  const clean = sanitizePositions(items).filter(
    (item) =>
      isFiniteCoord(item.lat) &&
      isFiniteCoord(item.lng) &&
      Math.abs(item.lat) <= 90 &&
      Math.abs(item.lng) <= 180
  );

  const deduped: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of clean) {
    const key = `${item.gpsTimestamp}_${item.lat}_${item.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function isWithinRange(ts: number | undefined, fromTs: number, toTs: number) {
  return typeof ts === "number" && Number.isFinite(ts) && ts >= fromTs && ts <= toTs;
}

function mergeDistanceBuckets(...bucketLists: VehicleDistanceBucket[][]): VehicleDistanceBucket[] {
  const merged = new Map<string, VehicleDistanceBucket>();

  for (const buckets of bucketLists) {
    for (const bucket of buckets) {
      const existing = merged.get(bucket.id);
      if (!existing) {
        merged.set(bucket.id, { ...bucket });
        continue;
      }

      merged.set(bucket.id, {
        ...existing,
        startTs: Math.min(existing.startTs, bucket.startTs),
        endTs: Math.max(existing.endTs, bucket.endTs),
        distanceKm: Number(((existing.distanceKm || 0) + (bucket.distanceKm || 0)).toFixed(2)),
      });
    }
  }

  return [...merged.values()].sort((a, b) => b.startTs - a.startTs);
}

function sumRouteDistanceKm(segments: VehiclePositionItem[][]) {
  return Number(
    segments
      .reduce((total, segment) => total + calculateRouteDistanceKm(segment), 0)
      .toFixed(2)
  );
}

function sumRouteDurationMs(segments: VehiclePositionItem[][]) {
  return segments.reduce((total, segment) => total + calculateRouteDurationMs(segment), 0);
}

function calculateRouteProgressDistanceKm(points: VehiclePositionItem[]) {
  if (points.length <= 1) return 0;

  const first = points[0];
  const last = points[points.length - 1];
  if (
    typeof first?.odometerKm === "number" &&
    Number.isFinite(first.odometerKm) &&
    typeof last?.odometerKm === "number" &&
    Number.isFinite(last.odometerKm) &&
    last.odometerKm >= first.odometerKm
  ) {
    return Number((last.odometerKm - first.odometerKm).toFixed(2));
  }

  return calculateRouteDistanceKm(points);
}

function buildPositionsSignature(items: VehiclePositionItem[]) {
  if (!items.length) return "0";
  const first = items[0];
  const last = items[items.length - 1];
  const step = Math.max(1, Math.floor(items.length / SIGNATURE_SAMPLE_POINTS));

  let checksum = 0;
  for (let i = 0; i < items.length; i += step) {
    const item = items[i];
    checksum +=
      Math.round(item.lat * 1000) +
      Math.round(item.lng * 1000) +
      (item.speedKmh ?? 0) +
      (item.gpsTimestamp % 10000);
  }

  return `${items.length}:${first.gpsTimestamp}:${last.gpsTimestamp}:${checksum}`;
}

function buildRoutePointKey(item: VehiclePositionItem) {
  const lat = Number.isFinite(item.lat) ? item.lat.toFixed(6) : String(item.lat);
  const lng = Number.isFinite(item.lng) ? item.lng.toFixed(6) : String(item.lng);
  return item.id || `${item.gpsTimestamp}_${lat}_${lng}_${Math.round(item.speedKmh ?? 0)}`;
}

function mergeRoutePositionItems(
  existing: VehiclePositionItem[],
  incoming: VehiclePositionItem[]
) {
  if (!existing.length) return sanitizePositions(incoming);
  if (!incoming.length) return existing;

  const merged = new Map<string, VehiclePositionItem>();
  for (const item of existing) {
    merged.set(buildRoutePointKey(item), item);
  }
  for (const item of incoming) {
    if (!isValidCoordPair(item.lat, item.lng)) continue;
    merged.set(buildRoutePointKey(item), item);
  }

  return sanitizePositions([...merged.values()]);
}

function hasNewerRoutePoint(items: VehiclePositionItem[], lastLoadedTs: number) {
  return items.some((item) => (item.gpsTimestamp || 0) > lastLoadedTs);
}

function getAdaptiveRoutePointLimit(baseLimit: number, zoom: number, compact: boolean) {
  if (!Number.isFinite(zoom)) return baseLimit;

  const minimum = compact ? 420 : 1200;
  const ratio =
    zoom >= 17
      ? 1
      : zoom >= 15
        ? compact
          ? 0.76
          : 0.86
        : zoom >= 13
          ? compact
            ? 0.56
            : 0.68
          : compact
            ? 0.34
            : 0.42;

  return Math.max(minimum, Math.min(baseLimit, Math.round(baseLimit * ratio)));
}

function getDisplaySimulationSpeedKmh(
  _speedKmh: number | undefined,
  ignitionOn: boolean | undefined,
  timestamp: number,
  startedAt: number,
  isEdgePoint: boolean
) {
  if (!ignitionOn || isEdgePoint) return 0;
  const slot = Math.max(0, Math.floor((timestamp - startedAt) / SIM_DISPLAY_SPEED_SLOT_MS));
  const minDisplaySpeed = 16;
  const maxDisplaySpeed = 62;
  const speedRange = maxDisplaySpeed - minDisplaySpeed + 1;
  const variedSpeed = minDisplaySpeed + ((slot * 17 + 43) % speedRange);
  const speed = variedSpeed;

  return Math.min(
    MAX_SIM_DISPLAY_SPEED_KMH,
    Math.max(MIN_SIM_DISPLAY_SPEED_KMH, Math.round(speed))
  );
}

function getMaxRouteSpeedKmh(items: VehiclePositionItem[]) {
  let maxSpeed = 0;
  for (const item of items) {
    const speed = Number.isFinite(item.speedKmh) ? Number(item.speedKmh) : 0;
    if (speed > maxSpeed) maxSpeed = speed;
  }
  return maxSpeed;
}

function findLastPointIndexAtOrBefore(items: VehiclePositionItem[], timestamp: number) {
  let low = 0;
  let high = items.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = items[middle]?.gpsTimestamp ?? 0;

    if (value <= timestamp) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

function getRouteItemStartTs(item: { startedAt?: number; points?: Array<{ ts?: number }> }) {
  const firstPointTs = item.points?.[0]?.ts;
  const startTs = item.startedAt || firstPointTs || 0;
  return Number.isFinite(startTs) ? startTs : 0;
}

function getRouteItemEndTs(
  item: {
    startedAt?: number;
    stoppedAt?: number;
    totalDurationMs?: number;
    points?: Array<{ ts?: number }>;
  },
  fallbackEndTs?: number
) {
  const lastPointTs = item.points?.[item.points.length - 1]?.ts || 0;
  const durationEndTs =
    item.startedAt && item.totalDurationMs ? item.startedAt + item.totalDurationMs : 0;
  const endTs = Math.max(item.stoppedAt || 0, lastPointTs, durationEndTs, fallbackEndTs || 0);
  return Number.isFinite(endTs) ? endTs : 0;
}

function buildHiddenRealGpsIntervals(vehicle: VehicleItem, activeFallbackEndTs: number) {
  const intervals: Array<{ startTs: number; endTs: number }> = [];

  for (const item of vehicle.gpsSimHistory ?? []) {
    const startTs = getRouteItemStartTs(item);
    const endTs = getRouteItemEndTs(item);
    if (startTs > 0 && endTs > startTs) {
      intervals.push({ startTs, endTs });
    }
  }

  const activeItem = vehicle.gpsSim;
  if (activeItem && activeItem.active !== false && (activeItem.points?.length ?? 0) > 0) {
    const startTs = getRouteItemStartTs(activeItem);
    const endTs = getRouteItemEndTs(activeItem, activeFallbackEndTs);
    if (startTs > 0 && endTs > startTs) {
      intervals.push({ startTs, endTs });
    }
  }

  return intervals
    .sort((a, b) => a.startTs - b.startTs)
    .reduce<Array<{ startTs: number; endTs: number }>>((merged, item) => {
      const previous = merged[merged.length - 1];
      if (!previous || item.startTs > previous.endTs) {
        merged.push({ ...item });
        return merged;
      }
      previous.endTs = Math.max(previous.endTs, item.endTs);
      return merged;
    }, []);
}

function filterHiddenRealGpsPositions(
  positions: VehiclePositionItem[],
  intervals: Array<{ startTs: number; endTs: number }>
) {
  if (!positions.length || !intervals.length) return positions;

  return positions.filter((point) => {
    const timestamp = point.gpsTimestamp;
    return !intervals.some((interval) => timestamp >= interval.startTs && timestamp <= interval.endTs);
  });
}

function crossesHiddenRealGpsInterval(
  prevTs: number,
  nextTs: number,
  intervals: Array<{ startTs: number; endTs: number }>
) {
  return intervals.some((interval) => prevTs < interval.startTs && nextTs > interval.endTs);
}

function splitVisibleRealGpsSegments(
  positions: VehiclePositionItem[],
  intervals: Array<{ startTs: number; endTs: number }>
) {
  const visible = filterStationaryGpsJitter(filterHiddenRealGpsPositions(positions, intervals));
  if (!visible.length) return [];
  if (!intervals.length) return [visible];

  const segments: VehiclePositionItem[][] = [];
  let current: VehiclePositionItem[] = [];

  for (const point of visible) {
    const previous = current[current.length - 1];
    if (
      previous &&
      crossesHiddenRealGpsInterval(previous.gpsTimestamp, point.gpsTimestamp, intervals)
    ) {
      if (current.length) segments.push(current);
      current = [point];
      continue;
    }

    current.push(point);
  }

  if (current.length) segments.push(current);
  return segments;
}

function getLastRoutePoint(segments: VehiclePositionItem[][]) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const point = segment?.[segment.length - 1];
    if (point) return point;
  }

  return null;
}

function buildTerminalSimulationStop(
  segment: VehiclePositionItem[],
  idPrefix: string
): VehicleStopItem | null {
  const end = segment[segment.length - 1];
  if (!end) return null;

  const isStopped = end.ignitionOn === false || (end.speedKmh ?? 0) <= 1;
  if (!isStopped) return null;

  const start: VehiclePositionItem = {
    ...end,
    id: `${end.id || idPrefix}-terminal-start`,
    gpsTimestamp: Math.max(0, end.gpsTimestamp - 60_000),
    serverTimestamp: Math.max(0, end.serverTimestamp - 60_000),
  };

  return {
    id: `${idPrefix}-terminal-stop-${end.gpsTimestamp}`,
    start,
    end,
    durationMs: 60_000,
    lat: end.lat,
    lng: end.lng,
  };
}

function buildContactOffStop(
  point: VehiclePositionItem | null,
  forceContactOff = false
): VehicleStopItem | null {
  if (!point || (!forceContactOff && !isRealContactOffPoint(point))) return null;

  const start: VehiclePositionItem = {
    ...point,
    id: `${point.id || point.gpsTimestamp}-contact-off-start`,
    gpsTimestamp: Math.max(0, point.gpsTimestamp - 60_000),
    serverTimestamp: Math.max(0, point.serverTimestamp - 60_000),
    speedKmh: 0,
    ignitionOn: false,
  };

  return {
    id: `real-contact-off-${point.id || point.gpsTimestamp}`,
    start,
    end: {
      ...point,
      speedKmh: 0,
      ignitionOn: false,
    },
    durationMs: 60_000,
    lat: point.lat,
    lng: point.lng,
  };
}

function buildSimulationStartStop(
  vehicle: VehicleItem,
  fallbackPoint: VehiclePositionItem | null
): VehicleStopItem | null {
  const simulation = vehicle.gpsSim;
  if (!simulation || simulation.active === false || !simulation.startedAt) return null;

  const firstPoint = simulation.points?.[0] ?? null;
  const lat = fallbackPoint?.lat ?? simulation.startLat ?? firstPoint?.lat;
  const lng = fallbackPoint?.lng ?? simulation.startLng ?? firstPoint?.lng;
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!isValidCoordPair(safeLat, safeLng)) return null;

  const timestamp = Math.max(
    0,
    Math.min(
      fallbackPoint?.gpsTimestamp ?? simulation.startedAt - 1000,
      simulation.startedAt - 1
    )
  );
  const point: VehiclePositionItem = {
    id: `pre-simulation-stop-${vehicle.id}-${simulation.startedAt}`,
    vehicleId: vehicle.id,
    imei: fallbackPoint?.imei || vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id,
    lat: safeLat,
    lng: safeLng,
    speedKmh: 0,
    altitude: fallbackPoint?.altitude,
    angle: fallbackPoint?.angle,
    satellites: fallbackPoint?.satellites,
    gpsTimestamp: timestamp,
    serverTimestamp: fallbackPoint?.serverTimestamp ?? timestamp,
    ignitionOn: false,
    odometerKm: fallbackPoint?.odometerKm ?? vehicle.gpsSnapshot?.odometerKm,
    eventIoId: fallbackPoint?.eventIoId,
  };

  return buildContactOffStop(point, true);
}

function getLastPositionBefore(
  positions: VehiclePositionItem[],
  timestamp: number
): VehiclePositionItem | null {
  if (!timestamp || !positions.length) return null;

  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const point = positions[index];
    if (point.gpsTimestamp <= timestamp && isValidCoordPair(point.lat, point.lng)) {
      return point;
    }
  }

  return null;
}

function getSafeRouteSpeedKmh(point: VehiclePositionItem) {
  return Number.isFinite(point.speedKmh) ? Math.max(0, Number(point.speedKmh)) : 0;
}

function routePointDistanceKm(a: VehiclePositionItem, b: VehiclePositionItem) {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getRouteSegmentRawDistanceKm(segment: VehiclePositionItem[]) {
  if (segment.length <= 1) return 0;

  let distanceKm = 0;
  for (let index = 1; index < segment.length; index += 1) {
    const previous = segment[index - 1];
    const current = segment[index];
    if (!previous || !current) continue;
    distanceKm += routePointDistanceKm(previous, current);
  }

  return distanceKm;
}

function getRouteSegmentDurationMs(segment: VehiclePositionItem[]) {
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (!first || !last) return 0;
  return Math.max(0, last.gpsTimestamp - first.gpsTimestamp);
}

function isRouteSegmentNearHiddenBoundary(
  segment: VehiclePositionItem[],
  intervals: Array<{ startTs: number; endTs: number }>
) {
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (!first || !last || !intervals.length) return false;

  return intervals.some(
    (interval) =>
      Math.abs(last.gpsTimestamp - interval.startTs) <= REAL_ROUTE_BOUNDARY_CLEANUP_MS ||
      Math.abs(first.gpsTimestamp - interval.endTs) <= REAL_ROUTE_BOUNDARY_CLEANUP_MS
  );
}

function filterBoundaryRealGpsSegments(
  segments: VehiclePositionItem[][],
  intervals: Array<{ startTs: number; endTs: number }>
) {
  if (!segments.length || !intervals.length) return segments;

  return segments.filter((segment) => {
    if (segment.length <= 1) return false;
    if (!isRouteSegmentNearHiddenBoundary(segment, intervals)) return true;

    const rawDistanceKm = getRouteSegmentRawDistanceKm(segment);
    const durationMs = getRouteSegmentDurationMs(segment);
    const maxSpeedKmh = getMaxRouteSpeedKmh(segment);
    const looksLikeBoundaryNoise =
      rawDistanceKm <= REAL_ROUTE_BOUNDARY_JITTER_DISTANCE_KM ||
      (rawDistanceKm <= REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM &&
        maxSpeedKmh <= REAL_ROUTE_BOUNDARY_IDLE_SPEED_KMH) ||
      (rawDistanceKm <= REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM &&
        durationMs <= 2 * 60 * 1000);

    return !looksLikeBoundaryNoise;
  });
}

function getVisibleRealGpsSegments(
  positions: VehiclePositionItem[],
  intervals: Array<{ startTs: number; endTs: number }>
) {
  return filterBoundaryRealGpsSegments(
    splitVisibleRealGpsSegments(positions, intervals),
    intervals
  );
}

function getRouteOdometerDeltaKm(
  start: VehiclePositionItem,
  end: VehiclePositionItem
) {
  if (
    typeof start.odometerKm !== "number" ||
    typeof end.odometerKm !== "number" ||
    !Number.isFinite(start.odometerKm) ||
    !Number.isFinite(end.odometerKm)
  ) {
    return 0;
  }

  return Math.max(0, end.odometerKm - start.odometerKm);
}

function shouldAppendLiveEndpointToRoute(
  segment: VehiclePositionItem[],
  endpoint: VehiclePositionItem | null
) {
  const last = segment[segment.length - 1];
  if (!last || !endpoint) return false;
  if (!isValidCoordPair(endpoint.lat, endpoint.lng)) return false;
  if (endpoint.gpsTimestamp <= last.gpsTimestamp) return false;
  if (last.id && endpoint.id && last.id === endpoint.id) return false;

  const gapMs = endpoint.gpsTimestamp - last.gpsTimestamp;
  if (gapMs <= 0 || gapMs > LIVE_ROUTE_ENDPOINT_MAX_GAP_MS) return false;

  const distanceKm = routePointDistanceKm(last, endpoint);
  if (distanceKm < LIVE_ROUTE_ENDPOINT_MIN_DISTANCE_KM) return false;
  if (distanceKm > LIVE_ROUTE_ENDPOINT_MAX_DISTANCE_KM) return false;

  const impliedSpeedKmh = distanceKm / (gapMs / 3_600_000);
  if (!Number.isFinite(impliedSpeedKmh) || impliedSpeedKmh > LIVE_ROUTE_ENDPOINT_MAX_IMPLIED_SPEED_KMH) {
    return false;
  }
  if (gapMs <= 60_000 && distanceKm > 2) return false;

  const odometerDeltaKm = getRouteOdometerDeltaKm(last, endpoint);
  const hasTrustedOdometerStep =
    odometerDeltaKm >= LIVE_ROUTE_ENDPOINT_MIN_DISTANCE_KM &&
    odometerDeltaKm <= LIVE_ROUTE_ENDPOINT_MAX_DISTANCE_KM;
  const endpointLooksMoving =
    endpoint.ignitionOn === true || getSafeRouteSpeedKmh(endpoint) >= REAL_MOVING_SPEED_KMH;
  const lastLooksMoving =
    last.ignitionOn === true || getSafeRouteSpeedKmh(last) >= REAL_MOVING_SPEED_KMH;
  const existingRouteLooksReal =
    getRouteSegmentRawDistanceKm(segment) >= LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM ||
    getMaxRouteSpeedKmh(segment) >= REAL_MOVING_SPEED_KMH;

  return hasTrustedOdometerStep || endpointLooksMoving || lastLooksMoving || existingRouteLooksReal;
}

function appendLiveEndpointToLastRouteSegment(
  segments: VehiclePositionItem[][],
  endpoint: VehiclePositionItem | null
) {
  if (!endpoint || !segments.length) return segments;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment?.length) continue;
    if (!shouldAppendLiveEndpointToRoute(segment, endpoint)) return segments;

    return segments.map((item, itemIndex) =>
      itemIndex === index ? [...item, endpoint] : item
    );
  }

  return segments;
}

function getNearestRouteDistanceKm(
  points: VehiclePositionItem[],
  target: VehiclePositionItem
) {
  if (!points.length) return Number.POSITIVE_INFINITY;

  let nearestKm = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distanceKm = routePointDistanceKm(point, target);
    if (distanceKm < nearestKm) nearestKm = distanceKm;
  }

  return nearestKm;
}

function hasTrackableContextNearPoint(
  trackable: VehiclePositionItem[],
  target: VehiclePositionItem
) {
  let before: VehiclePositionItem | null = null;
  let after: VehiclePositionItem | null = null;

  for (const point of trackable) {
    if (point.gpsTimestamp < target.gpsTimestamp) {
      before = point;
      continue;
    }
    if (point.gpsTimestamp > target.gpsTimestamp) {
      after = point;
      break;
    }
  }

  const beforeGap = before ? target.gpsTimestamp - before.gpsTimestamp : Number.POSITIVE_INFINITY;
  const afterGap = after ? after.gpsTimestamp - target.gpsTimestamp : Number.POSITIVE_INFINITY;

  return beforeGap <= ROUTE_STOP_ANCHOR_CONTEXT_GAP_MS || afterGap <= ROUTE_STOP_ANCHOR_CONTEXT_GAP_MS;
}

function addClusteredStopAnchor(
  anchors: VehiclePositionItem[],
  point: VehiclePositionItem
) {
  const existingIndex = anchors.findIndex(
    (item) =>
      Math.abs(item.gpsTimestamp - point.gpsTimestamp) <= ROUTE_STOP_ANCHOR_CLUSTER_MS &&
      routePointDistanceKm(item, point) <= ROUTE_STOP_ANCHOR_CLUSTER_KM
  );

  if (existingIndex >= 0) {
    anchors[existingIndex] =
      point.gpsTimestamp >= anchors[existingIndex].gpsTimestamp ? point : anchors[existingIndex];
    return;
  }

  anchors.push(point);
}

function withRealStopAnchorsForRender(
  rawSegment: VehiclePositionItem[],
  trackableSegment: VehiclePositionItem[]
) {
  const clean = safeRoutePoints(rawSegment);
  const trackable = safeRoutePoints(trackableSegment);
  if (clean.length <= 1 || trackable.length <= 1) return trackable;

  const existingRouteLooksReal =
    getRouteSegmentRawDistanceKm(trackable) >= LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM ||
    getMaxRouteSpeedKmh(trackable) >= REAL_MOVING_SPEED_KMH;
  if (!existingRouteLooksReal) return trackable;

  const anchors: VehiclePositionItem[] = [];
  for (const point of clean) {
    const looksLikeStop = point.ignitionOn === false || getSafeRouteSpeedKmh(point) <= REAL_CONTACT_OFF_SPEED_KMH;
    if (!looksLikeStop) continue;
    if (!hasTrackableContextNearPoint(trackable, point)) continue;

    const nearestKm = getNearestRouteDistanceKm(trackable, point);
    if (nearestKm < ROUTE_STOP_ANCHOR_MIN_DISTANCE_KM || nearestKm > ROUTE_STOP_ANCHOR_MAX_DISTANCE_KM) continue;

    addClusteredStopAnchor(anchors, {
      ...point,
      speedKmh: 0,
      ignitionOn: false,
    });
  }

  return anchors.length ? safeRoutePoints([...trackable, ...anchors]) : trackable;
}

function buildRenderableRealRouteSegment(
  rawSegment: VehiclePositionItem[],
  maxPoints: number
) {
  const clean = safeRoutePoints(rawSegment);
  const movingOnly = filterRouteRenderJitter(filterTrackableRoutePositions(clean));
  return samplePositions(withRealStopAnchorsForRender(clean, movingOnly), maxPoints);
}

function isRealContactOffPoint(point: VehiclePositionItem, trustIgnitionState = true) {
  const speed = getSafeRouteSpeedKmh(point);
  if (trustIgnitionState && point.ignitionOn === false) return true;
  if (trustIgnitionState && point.ignitionOn === true) return false;
  return speed <= REAL_CONTACT_OFF_SPEED_KMH;
}

function isRealMovingPoint(point: VehiclePositionItem, trustIgnitionState = true) {
  const speed = getSafeRouteSpeedKmh(point);
  if (trustIgnitionState && point.ignitionOn === true) return true;
  if (trustIgnitionState && point.ignitionOn === false && speed < REAL_MOVING_SPEED_KMH) {
    return false;
  }
  return speed >= REAL_MOVING_SPEED_KMH;
}

function isDisplayedRealContactOff(vehicle: VehicleItem, point: VehiclePositionItem | null) {
  if (!point) return false;
  if (point.ignitionOn === false) return true;
  if (isRealContactOffPoint(point, false)) return true;

  const trackerPingAt =
    vehicle.tracker?.lastSeenAt ||
    vehicle.tracker?.updatedAt ||
    point.serverTimestamp ||
    point.gpsTimestamp ||
    0;
  const gpsAgeMs = point.gpsTimestamp ? Date.now() - point.gpsTimestamp : Number.POSITIVE_INFINITY;
  const trackerOnline = trackerPingAt > 0 && Date.now() - trackerPingAt <= LIVE_REFRESH_MS * 2;
  const hasFreshMotion = trackerOnline && gpsAgeMs <= REAL_CONTACT_FRESH_GPS_MS;

  return !hasFreshMotion;
}

function buildContactOffStopFromRun(
  run: VehiclePositionItem[],
  idPrefix: string,
  index: number
): VehicleStopItem | null {
  if (!run.length) return null;
  const start = run[0];
  const end = run[run.length - 1] ?? start;
  if (!start || !end) return null;
  const durationMs = Math.max(0, end.gpsTimestamp - start.gpsTimestamp);

  return {
    id: `${idPrefix}-contact-off-${index}-${start.gpsTimestamp}`,
    start: {
      ...start,
      speedKmh: 0,
      ignitionOn: false,
    },
    end: {
      ...end,
      speedKmh: 0,
      ignitionOn: false,
    },
    durationMs: Math.max(60_000, durationMs),
    lat: end.lat,
    lng: end.lng,
  };
}

function buildGapStopBetweenPoints(
  previous: VehiclePositionItem,
  next: VehiclePositionItem,
  idPrefix: string,
  index: number
): VehicleStopItem | null {
  const durationMs = next.gpsTimestamp - previous.gpsTimestamp;
  if (durationMs < REAL_STOP_GAP_MS) return null;
  if (routePointDistanceKm(previous, next) > REAL_STOP_GAP_MAX_DISTANCE_KM) return null;

  const lat = (previous.lat + next.lat) / 2;
  const lng = (previous.lng + next.lng) / 2;
  const start: VehiclePositionItem = {
    ...previous,
    id: `${previous.id || previous.gpsTimestamp}-gap-stop-start`,
    speedKmh: 0,
    ignitionOn: false,
  };
  const end: VehiclePositionItem = {
    ...next,
    id: `${next.id || next.gpsTimestamp}-gap-stop-end`,
    speedKmh: 0,
    ignitionOn: false,
  };

  return {
    id: `${idPrefix}-gap-stop-${index}-${previous.gpsTimestamp}-${next.gpsTimestamp}`,
    start,
    end,
    durationMs,
    lat,
    lng,
  };
}

function buildContactOffStopsFromSegments(
  segments: VehiclePositionItem[][],
  idPrefix: string
) {
  const stops: VehicleStopItem[] = [];
  let runIndex = 0;

  for (const segment of segments) {
    let run: VehiclePositionItem[] = [];
    let hasSeenMovement = false;
    let lastPoint: VehiclePositionItem | null = null;
    const hasExplicitIgnitionOn = segment.some((point) => point.ignitionOn === true);
    const trustIgnitionState = hasExplicitIgnitionOn;

    const flush = () => {
      const stop = buildContactOffStopFromRun(run, idPrefix, runIndex);
      if (stop) {
        stops.push(stop);
        runIndex += 1;
      }
      run = [];
    };

    for (const point of segment) {
      const isContactOffPoint = isRealContactOffPoint(point, trustIgnitionState);
      const isMovingPoint = isRealMovingPoint(point, trustIgnitionState);
      const previous = run[run.length - 1];
      const gapMs = previous ? point.gpsTimestamp - previous.gpsTimestamp : 0;

      if (isMovingPoint && hasSeenMovement && lastPoint && !run.length) {
        const gapStop = buildGapStopBetweenPoints(lastPoint, point, idPrefix, runIndex);
        if (gapStop) {
          stops.push(gapStop);
          runIndex += 1;
        }
      }

      if (isMovingPoint) {
        flush();
        hasSeenMovement = true;
        lastPoint = point;
        continue;
      }

      if (isContactOffPoint && hasSeenMovement) {
        if (previous && gapMs <= 0) {
          flush();
        }
        run.push(point);
        lastPoint = point;
        continue;
      }

      flush();
      lastPoint = point;
    }

    if (run.length) flush();
  }

  return stops;
}

function mergeNearbyStopItems(items: VehicleStopItem[]) {
  const merged: VehicleStopItem[] = [];

  for (const item of items.sort((a, b) => a.end.gpsTimestamp - b.end.gpsTimestamp)) {
    const duplicate = merged.some(
      (existing) =>
        Math.abs(existing.end.gpsTimestamp - item.end.gpsTimestamp) <=
          REAL_STOP_DUPLICATE_WINDOW_MS &&
        Math.round(existing.lat * 10000) === Math.round(item.lat * 10000) &&
        Math.round(existing.lng * 10000) === Math.round(item.lng * 10000)
    );

    if (!duplicate) merged.push(item);
  }

  return merged;
}

function getStopSourceKind(item: VehicleStopItem) {
  return item.id.includes("sim") ? "sim" : "real";
}

function mergeDistinctStopItems(items: VehicleStopItem[]) {
  const clusters: VehicleStopItem[] = [];

  for (const item of items.sort((a, b) => a.end.gpsTimestamp - b.end.gpsTimestamp)) {
    const sourceKind = getStopSourceKind(item);
    const existingIndex = clusters.findIndex(
      (existing) =>
        getStopSourceKind(existing) === sourceKind &&
        routePointDistanceKm(
          { ...existing.end, lat: existing.lat, lng: existing.lng },
          { ...item.end, lat: item.lat, lng: item.lng }
        ) <= REAL_STOP_CLUSTER_DISTANCE_KM
    );

    if (existingIndex < 0) {
      clusters.push(item);
      continue;
    }

    const existing = clusters[existingIndex];
    const newestLocation =
      item.end.gpsTimestamp >= existing.end.gpsTimestamp ? item : existing;
    const mergedDurationMs =
      Math.max(existing.end.gpsTimestamp, item.end.gpsTimestamp) -
      Math.min(existing.start.gpsTimestamp, item.start.gpsTimestamp);

    clusters[existingIndex] = {
      ...existing,
      id: existing.id,
      start:
        item.start.gpsTimestamp < existing.start.gpsTimestamp ? item.start : existing.start,
      end: item.end.gpsTimestamp > existing.end.gpsTimestamp ? item.end : existing.end,
      durationMs: Math.max(existing.durationMs, item.durationMs, mergedDurationMs, 60_000),
      lat: newestLocation.lat,
      lng: newestLocation.lng,
    };
  }

  return clusters.sort((a, b) => a.end.gpsTimestamp - b.end.gpsTimestamp);
}

function gpsSnapshotToPosition(vehicle: VehicleItem): VehiclePositionItem | null {
  const snapshot = vehicle.gpsSnapshot;
  if (!snapshot || !isValidCoordPair(snapshot.lat, snapshot.lng)) return null;

  return {
    id: `snapshot-${vehicle.id}-${snapshot.gpsTimestamp || snapshot.serverTimestamp || Date.now()}`,
    vehicleId: vehicle.id,
    imei: snapshot.imei || vehicle.tracker?.imei || vehicle.id,
    lat: snapshot.lat,
    lng: snapshot.lng,
    speedKmh: snapshot.speedKmh || 0,
    altitude: snapshot.altitude || 0,
    angle: snapshot.angle || 0,
    satellites: snapshot.satellites || 0,
    gpsTimestamp: snapshot.gpsTimestamp || Date.now(),
    serverTimestamp: snapshot.serverTimestamp || snapshot.gpsTimestamp || Date.now(),
    ignitionOn: snapshot.ignitionOn,
    odometerKm: snapshot.odometerKm,
    eventIoId: 0,
  };
}

function findFirstRouteMovementPoint(
  positions: VehiclePositionItem[]
): VehiclePositionItem | null {
  const clean = safeRoutePoints(positions);
  if (clean.length <= 1) return null;

  for (let index = 1; index < clean.length; index += 1) {
    const previous = clean[index - 1];
    const point = clean[index];
    if (!previous || !point) continue;

    const speed = getSafeRouteSpeedKmh(point);
    const distanceKm = routePointDistanceKm(previous, point);
    if (speed >= REAL_MOVING_SPEED_KMH || distanceKm >= 0.03) {
      return point;
    }
  }

  return null;
}

function withActiveRouteMovingEvent(
  events: VehicleGeoEvent[],
  activePositions: VehiclePositionItem[]
) {
  if (activePositions.length <= 1) return events;

  const firstPoint = activePositions[0];
  const startedAt = firstPoint?.gpsTimestamp || 0;
  const hasMovingEvent = events.some(
    (event) =>
      event.type === "moving" &&
      (!startedAt || event.timestamp >= startedAt - 1000)
  );
  if (hasMovingEvent) return events;

  const movingPoint = findFirstRouteMovementPoint(activePositions);
  if (!movingPoint) return events;

  const movingEvent: VehicleGeoEvent = {
    id: `active-route-moving-${movingPoint.gpsTimestamp}`,
    type: "moving",
    timestamp: movingPoint.gpsTimestamp,
    label: "Vehicul in miscare",
    metadata: {
      speedKmh: movingPoint.speedKmh,
    },
  };

  return [...events, movingEvent];
}

function compactTripTimelineEvents(events: VehicleGeoEvent[]) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const result: VehicleGeoEvent[] = [];
  let engineState: "unknown" | "on" | "off" = "unknown";
  let moving = false;

  for (const event of sorted) {
    const previous = result[result.length - 1];

    if (event.type === "ignition_on") {
      if (engineState === "on") continue;
      engineState = "on";
      moving = false;
      result.push(event);
      continue;
    }

    if (event.type === "moving") {
      if (moving) continue;
      engineState = "on";
      moving = true;
      result.push(event);
      continue;
    }

    if (event.type === "ignition_off") {
      if (
        engineState === "off" &&
        previous?.type === "ignition_off" &&
        Math.abs(previous.timestamp - event.timestamp) <= 60_000
      ) {
        continue;
      }
      engineState = "off";
      moving = false;
      result.push(event);
      continue;
    }

    if (event.type === "stop") {
      engineState = "off";
      moving = false;
      result.push(event);
      continue;
    }

    result.push(event);
  }

  return result;
}

function FitRouteBounds({
  points,
  trigger,
}: {
  points: VehiclePositionItem[];
  trigger: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !points.length) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;

      try {
        const container = map.getContainer();
        if (!container || !container.isConnected) return;

        map.stop();
        map.invalidateSize(false);

        if (points.length === 1) {
          map.setView([points[0].lat, points[0].lng], 15, { animate: false });
          return;
        }

        const validLatLngs = points
          .map((item) => [item.lat, item.lng] as [number, number])
          .filter(
            ([lat, lng]) =>
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              Math.abs(lat) <= 90 &&
              Math.abs(lng) <= 180
          );

        if (!validLatLngs.length) return;

        const bounds = L.latLngBounds(validLatLngs);
        if (!bounds.isValid()) return;

        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 17,
          animate: false,
        });
      } catch (error) {
        console.error("[FitRouteBounds error]", error);
      }
    };

    const timer = window.setTimeout(run, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try {
        map.stop();
      } catch {
        //
      }
    };
  }, [map, trigger]);

  return null;
}

function TrackMapZoom({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const updateZoom = () => onZoomChange(map.getZoom());

    updateZoom();
    map.on("zoomend", updateZoom);

    return () => {
      map.off("zoomend", updateZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

type Props = {
  vehicle: VehicleItem;
  onKmEstimateChange?: (km: number) => void;
  simulationPositions?: VehiclePositionItem[];
  simulationPlannedPositions?: VehiclePositionItem[];
  simulationActive?: boolean;
};

function GpsSectionDropdown({
  title,
  children,
  defaultOpen = false,
  lazy = false,
  onOpenChange,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  lazy?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="vehicle-inline-dropdown"
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setIsOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
      <summary className="vehicle-inline-dropdown__summary">
        <span className="panel-title">{title}</span>
      </summary>
      <div className="vehicle-inline-dropdown__body">
        {!lazy || isOpen ? children : null}
      </div>
    </details>
  );
}

function useIsCompactViewport() {
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== "undefined"
       ? window.matchMedia("(max-width: 768px)").matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setIsCompact(query.matches);

    update();
    query.addEventListener("change", update);

    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  return isCompact;
}

export default function VehicleLiveRouteCard({
  vehicle,
  onKmEstimateChange,
  simulationPositions = [],
  simulationPlannedPositions = [],
  simulationActive = false,
}: Props) {
  const { user } = useAuth();
  const authReady = true;
  const isCompactViewport = useIsCompactViewport();
  const baseRouteRenderPointLimit = isCompactViewport
     ? MOBILE_ROUTE_RENDER_POINTS
    : ROUTE_RENDER_POINTS;
  const routeAnalysisPointLimit = isCompactViewport
     ? MOBILE_ROUTE_ANALYSIS_POINTS
    : ROUTE_ANALYSIS_POINTS;
  const activeSimulationRenderPointLimit = isCompactViewport
     ? MOBILE_ACTIVE_SIM_RENDER_POINTS
    : ACTIVE_SIM_RENDER_POINTS;
  const crumbPointLimit = isCompactViewport ? MOBILE_CRUMB_POINTS : CRUMB_POINTS;
  const overspeedRenderPointLimit = isCompactViewport
     ? MOBILE_OVERSPEED_RENDER_POINTS
    : OVERSPEED_RENDER_POINTS;
  const stopRenderLimit = isCompactViewport ? MOBILE_STOP_RENDER_LIMIT : STOP_RENDER_LIMIT;
  const simRenderIntervalMs = SIMULATION_UI_REFRESH_MS;
  const analysisCommitIntervalMs = isCompactViewport
     ? MOBILE_ANALYSIS_COMMIT_MS
    : ANALYSIS_COMMIT_MS;

  const [mapZoom, setMapZoom] = useState(13);
  const routeRenderPointLimit = useMemo(
    () => getAdaptiveRoutePointLimit(baseRouteRenderPointLimit, mapZoom, isCompactViewport),
    [baseRouteRenderPointLimit, isCompactViewport, mapZoom]
  );
  const realRouteRenderPointLimit = Math.ceil(routeRenderPointLimit * 1.1);
  const [, setPreset] = useState<DateRangePreset>("today");
  const initialDayValue = toDateInputValue();
  const initialRange = getLocalDayRange(initialDayValue);
  const [selectedDayValue, setSelectedDayValue] = useState(initialDayValue);
  const [fromTs, setFromTs] = useState<number>(initialRange.from);
  const [toTs, setToTs] = useState<number>(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<VehiclePositionItem[]>([]);
  const [overspeedThreshold, setOverspeedThreshold] = useState<number>(
    DEFAULT_OVERSPEED_THRESHOLD
  );
  const [overspeedThresholdDraft, setOverspeedThresholdDraft] = useState<string | null>(null);
  const [externalEventsCount, setExternalEventsCount] = useState(0);
  const [boundsTrigger, setBoundsTrigger] = useState(0);
  const [analysisRoutePositions, setAnalysisRoutePositions] = useState<VehiclePositionItem[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  const [liveRealTrail, setLiveRealTrail] = useState<VehiclePositionItem[]>([]);
  const [simRenderNow, setSimRenderNow] = useState(() => Date.now());
  const [historyWindowTs] = useState(() => Date.now());
  const [historyDaysOpen, setHistoryDaysOpen] = useState(false);
  const [historyPeriodsOpen, setHistoryPeriodsOpen] = useState(false);
  const [routeEventsOpen, setRouteEventsOpen] = useState(false);
  const timelineOpen = true;
  const mountedRef = useRef(true);
  const routeSignatureRef = useRef("");
  const analysisSignatureRef = useRef("");
  const activeRangeKeyRef = useRef("");
  const routeLoadSeqRef = useRef(0);
  const routePositionsRef = useRef<VehiclePositionItem[]>([]);
  const lastRealLoadedTsRef = useRef(0);
  const lastAnalysisCommitAtRef = useRef(0);
  const monotonicKmVehicleRef = useRef(`${vehicle.id}:real`);
  const initialRecordedKm = vehicle.initialRecordedKm || 0;
  const storedInitialKm =
    typeof vehicle.currentKm === "number" &&
    Number.isFinite(vehicle.currentKm) &&
    vehicle.currentKm >= initialRecordedKm
      ? vehicle.currentKm
      : initialRecordedKm;
  const initialOdometerEstimateKm =
    getTrustedTotalOdometerKm(vehicle.gpsSnapshot?.odometerKm, initialRecordedKm) ||
    storedInitialKm;
  const monotonicEstimatedKmRef = useRef(initialOdometerEstimateKm);
  const monotonicRouteDistanceRef = useRef({ key: "", distanceKm: 0 });
  const monotonicRouteMaxSpeedRef = useRef({ key: "", maxSpeed: 0 });
  const hasSnapshot = isValidCoordPair(vehicle.gpsSnapshot?.lat, vehicle.gpsSnapshot?.lng);
  const selectedRangeMs = Math.max(0, toTs - fromTs);
  const selectedRangeIsLong = selectedRangeMs >= LONG_RANGE_MS;
  const routePageSize = selectedRangeIsLong
     ? LONG_RANGE_ROUTE_PAGE_SIZE
    : isCompactViewport
       ? MOBILE_ROUTE_PAGE_SIZE
      : DESKTOP_ROUTE_PAGE_SIZE;
  const routeMaxPages = selectedRangeIsLong
     ? LONG_RANGE_ROUTE_MAX_PAGES
    : isCompactViewport
       ? MOBILE_ROUTE_MAX_PAGES
      : DESKTOP_ROUTE_MAX_PAGES;
  const shouldBuildRouteEvents =
    !selectedRangeIsLong || routeEventsOpen || timelineOpen;
  const quickDayOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, offsetDays) => {
        const value = getRelativeDayValue(offsetDays);
        return {
          value,
          label: formatQuickDayLabel(value, offsetDays),
        };
      }),
    [historyWindowTs]
  );
  async function loadMeta() {
    if (!authReady || !user) return;

    try {
      const extEvents = await getVehicleTrackerEvents(vehicle.id, fromTs, toTs).catch(() => []);

      if (!mountedRef.current) return;
      setExternalEventsCount(extEvents.length);
    } catch (error) {
      console.error("[VehicleLiveRouteCard][loadMeta]", error);
      if (!mountedRef.current) return;
      setExternalEventsCount(0);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const updateOnlineState = () => {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (!mountedRef.current) return;
      setIsOffline(offline);
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    routeSignatureRef.current = "";
    analysisSignatureRef.current = "";
    activeRangeKeyRef.current = `${vehicle.id}:${fromTs}:${toTs}`;
    routePositionsRef.current = [];
    lastRealLoadedTsRef.current = 0;
    lastAnalysisCommitAtRef.current = 0;
    setLoading(true);
    setPositions([]);
    setAnalysisRoutePositions([]);
    setLiveRealTrail([]);
    setLastDataAt(null);
    setIsOffline(false);
  }, [fromTs, toTs, vehicle.id]);

  useEffect(() => {
    const rangeKey = `${vehicle.id}:${fromTs}:${toTs}`;
    const loadSeq = routeLoadSeqRef.current + 1;
    routeLoadSeqRef.current = loadSeq;
    activeRangeKeyRef.current = rangeKey;
    let cancelled = false;
    let liveTimer: number | null = null;

    const stillCurrent = () =>
      mountedRef.current &&
      !cancelled &&
      routeLoadSeqRef.current === loadSeq &&
      activeRangeKeyRef.current === rangeKey;

    const applyRoute = (
      route: VehiclePositionItem[],
      options: { forceAnalysis?: boolean } = {}
    ) => {
      const analysisClean = sanitizePositions(route);
      const jitterFilteredRoute = filterStationaryGpsJitter(analysisClean);
      const clean = safeRoutePoints(jitterFilteredRoute);
      const nextSignature = buildPositionsSignature(clean);
      const nextAnalysisSignature = buildPositionsSignature(analysisClean);

      if (!stillCurrent()) return;

      const now = Date.now();
      const routeChanged = routeSignatureRef.current !== nextSignature;
      const analysisChanged = analysisSignatureRef.current !== nextAnalysisSignature;
      const shouldCommitAnalysis =
        options.forceAnalysis ||
        (analysisChanged &&
          now - lastAnalysisCommitAtRef.current >= analysisCommitIntervalMs);

      routePositionsRef.current = analysisClean;
      lastRealLoadedTsRef.current = analysisClean[analysisClean.length - 1]?.gpsTimestamp ?? fromTs;

      if (!routeChanged && !shouldCommitAnalysis) {
        setLastDataAt(Date.now());
        setLoading(false);
        return;
      }

      if (routeChanged) {
        routeSignatureRef.current = nextSignature;
      }

      if (shouldCommitAnalysis) {
        analysisSignatureRef.current = nextAnalysisSignature;
        lastAnalysisCommitAtRef.current = now;
      }

      startTransition(() => {
        if (routeChanged) setPositions(clean);
        if (shouldCommitAnalysis) setAnalysisRoutePositions(analysisClean);
      });
      setIsOffline(false);
      setLastDataAt(Date.now());
      setLoading(false);
    };

    async function loadInitial() {
      if (!authReady) {
        setLoading(true);
        return;
      }

      if (!user) {
        setLoading(false);
        routePositionsRef.current = [];
        lastRealLoadedTsRef.current = 0;
        setPositions([]);
        setAnalysisRoutePositions([]);
        return;
      }

      setLoading(true);

      try {
        const effectiveToTs = selectedDayValue === toDateInputValue() ? Date.now() : toTs;
        const route = await getVehiclePositionsForSelectedDay(
          vehicle.id,
          fromTs,
          effectiveToTs,
          routePageSize,
          routeMaxPages
        );
        applyRoute(route, { forceAnalysis: true });
      } catch (error) {
        console.error("[VehicleLiveRouteCard][loadSelectedDayRoute]", error);
        if (!stillCurrent()) return;
        setLoading(false);
        setIsOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
      }
    }

    async function loadLiveIncrement() {
      if (!stillCurrent() || selectedDayValue !== toDateInputValue()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      const loadedUntil = lastRealLoadedTsRef.current || fromTs;
      const incrementalFromTs = Math.max(fromTs, loadedUntil - LIVE_INCREMENTAL_OVERLAP_MS);
      const effectiveToTs = Date.now();
      if (incrementalFromTs > effectiveToTs) return;

      try {
        const incoming = await getVehiclePositionsForSelectedDay(
          vehicle.id,
          incrementalFromTs,
          effectiveToTs,
          routePageSize,
          6
        );
        if (!stillCurrent() || !incoming.length) return;
        if (!hasNewerRoutePoint(incoming, lastRealLoadedTsRef.current)) {
          setLastDataAt(Date.now());
          setLoading(false);
          return;
        }
        applyRoute(mergeRoutePositionItems(routePositionsRef.current, incoming));
      } catch (error) {
        console.warn("[VehicleLiveRouteCard][loadLiveIncrement]", error);
      }
    }

    void loadInitial().then(() => {
      if (!stillCurrent() || selectedDayValue !== toDateInputValue()) return;
      liveTimer = window.setInterval(() => {
        void loadLiveIncrement();
      }, LIVE_REFRESH_MS);
    });

    return () => {
      cancelled = true;
      if (liveTimer !== null) window.clearInterval(liveTimer);
    };
  }, [
    authReady,
    fromTs,
    routeMaxPages,
    routePageSize,
    analysisCommitIntervalMs,
    selectedDayValue,
    toTs,
    user,
    vehicle.id,
  ]);

  useEffect(() => {
    if (!authReady || !user) return;
    void loadMeta();
  }, [authReady, user, vehicle.id, fromTs, toTs]);

  const gpsSimHasPoints = (vehicle.gpsSim?.points?.length ?? 0) > 0;
  const gpsSimVisible = gpsSimHasPoints && vehicle.gpsSim?.active !== false;
  const gpsSimTotalDurationMs =
    vehicle.gpsSim?.totalDurationMs ||
    Math.max(
      0,
      (vehicle.gpsSim?.points?.[vehicle.gpsSim.points.length - 1]?.ts || 0) -
        (vehicle.gpsSim?.startedAt || 0)
    );
  const gpsSimElapsedMs = useMemo(() => {
    if (!gpsSimVisible || !vehicle.gpsSim) return 0;
    const baseElapsed = vehicle.gpsSim.elapsedBeforePauseMs || 0;
    if (vehicle.gpsSim.status === "paused") {
      return Math.min(baseElapsed, gpsSimTotalDurationMs || baseElapsed);
    }
    const resumedAt = vehicle.gpsSim.resumedAt || vehicle.gpsSim.startedAt || simRenderNow;
    return Math.min(
      baseElapsed + Math.max(0, simRenderNow - resumedAt),
      gpsSimTotalDurationMs || Number.MAX_SAFE_INTEGER
    );
  }, [gpsSimTotalDurationMs, gpsSimVisible, simRenderNow, vehicle.gpsSim]);
  const gpsSimDone =
    gpsSimVisible && gpsSimTotalDurationMs > 0 && gpsSimElapsedMs >= gpsSimTotalDurationMs;
  const gpsSimRunning =
    gpsSimVisible && vehicle.gpsSim?.status !== "paused" && !gpsSimDone;
  useEffect(() => {
    if (!gpsSimVisible || !gpsSimRunning) {
      setSimRenderNow(Date.now());
      return;
    }

    setSimRenderNow(Date.now());
    const refreshMs = simRenderIntervalMs;
    const timer = window.setInterval(() => {
      setSimRenderNow(Date.now());
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [gpsSimRunning, gpsSimVisible, simRenderIntervalMs]);

  const selectedDayIsToday = selectedDayValue === toDateInputValue();
  const liveDisplayNow = Math.max(simRenderNow, Date.now());
  const displayToTs = selectedDayIsToday ? Math.max(toTs, liveDisplayNow) : toTs;
  const historyDisplayToTs = displayToTs;

  const gpsSimPositions: VehiclePositionItem[] = useMemo(() => {
    if (!gpsSimVisible || !vehicle.gpsSim?.points) return [];
    const startedAt = vehicle.gpsSim.startedAt || vehicle.gpsSim.points[0]?.ts || 0;
    const lastIndex = vehicle.gpsSim.points.length - 1;
    const displayImei = vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id;
    return vehicle.gpsSim.points.map((p, i) => {
      const timestamp = p.ts || startedAt + i * 4000;
      const speedKmh = getDisplaySimulationSpeedKmh(
        p.speedKmh,
        p.ignitionOn,
        timestamp,
        startedAt,
        i === 0 || i === lastIndex
      );
      return {
        id: `gpssim-${i}`,
        vehicleId: vehicle.id,
        imei: displayImei,
        lat: p.lat, lng: p.lng,
        speedKmh,
        altitude: 120,
        angle: p.angle,
        satellites: 8,
        gpsTimestamp: timestamp,
        serverTimestamp: timestamp,
        ignitionOn: p.ignitionOn,
        odometerKm: p.odometerKm,
        eventIoId: 0,
      };
    });
  }, [gpsSimVisible, vehicle.gpsSim, vehicle.gpsSnapshot?.imei, vehicle.id, vehicle.tracker?.imei]);

  const gpsSimHistorySegments: VehiclePositionItem[][] = useMemo(() => {
    const history = vehicle.gpsSimHistory ?? [];
    const displayImei = vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id;

    const persistedHistorySegments = history
      .map((simulation, simIndex) => {
        const points = simulation.points ?? [];
        const startedAt = simulation.startedAt || points[0]?.ts || 0;
        const lastIndex = points.length - 1;
        return safeRoutePoints(
          points
            .map((p, pointIndex) => {
              const timestamp = p.ts || startedAt + pointIndex * 4000;
              const speedKmh = getDisplaySimulationSpeedKmh(
                p.speedKmh,
                p.ignitionOn,
                timestamp,
                startedAt,
                pointIndex === 0 || pointIndex === lastIndex
              );
              return {
                id: `gpssim-history-${simulation.id || simIndex}-${pointIndex}`,
                vehicleId: vehicle.id,
                imei: displayImei,
                lat: p.lat,
                lng: p.lng,
                speedKmh,
                altitude: 120,
                angle: p.angle,
                satellites: 8,
                gpsTimestamp: timestamp,
                serverTimestamp: timestamp,
                ignitionOn: p.ignitionOn,
                odometerKm: p.odometerKm,
                eventIoId: 0,
              };
            })
            .filter((point) => isWithinRange(point.gpsTimestamp, fromTs, historyDisplayToTs))
        );
      })
      .filter((segment) => segment.length > 0);

    const localRouteStartTs =
      simulationActive && simulationPositions.length > 0
        ? simulationPositions[0]?.gpsTimestamp || 0
        : 0;
    const activeRouteStartTs =
      vehicle.gpsSim?.startedAt || gpsSimPositions[0]?.gpsTimestamp || 0;
    const hasPendingPreviousRoute =
      gpsSimVisible &&
      localRouteStartTs > 0 &&
      activeRouteStartTs > 0 &&
      activeRouteStartTs < localRouteStartTs - 1000;
    if (!hasPendingPreviousRoute) return persistedHistorySegments;

    const cutoffTs = gpsSimDone
      ? Number.POSITIVE_INFINITY
      : activeRouteStartTs + gpsSimElapsedMs;
    const pendingPreviousRoute = safeRoutePoints(
      gpsSimPositions
        .filter((point) => point.gpsTimestamp <= cutoffTs)
        .filter((point) => isWithinRange(point.gpsTimestamp, fromTs, historyDisplayToTs))
    );

    return pendingPreviousRoute.length > 0
      ? [...persistedHistorySegments, pendingPreviousRoute]
      : persistedHistorySegments;
  }, [
    fromTs,
    gpsSimDone,
    gpsSimElapsedMs,
    gpsSimPositions,
    gpsSimVisible,
    historyDisplayToTs,
    simulationActive,
    simulationPositions,
    vehicle.gpsSimHistory,
    vehicle.gpsSim?.startedAt,
    vehicle.gpsSnapshot?.imei,
    vehicle.id,
    vehicle.tracker?.imei,
  ]);

  const gpsSimHistoryPositions: VehiclePositionItem[] = useMemo(
    () => safeRoutePoints(gpsSimHistorySegments.flat()),
    [gpsSimHistorySegments]
  );

  const gpsSimCurrentIndex = useMemo(() => {
    if (!gpsSimPositions.length) return -1;
    if (gpsSimDone) return gpsSimPositions.length - 1;
    const cutoff = (vehicle.gpsSim?.startedAt || simRenderNow) + gpsSimElapsedMs;
    return Math.max(0, findLastPointIndexAtOrBefore(gpsSimPositions, cutoff));
  }, [gpsSimDone, gpsSimElapsedMs, gpsSimPositions, simRenderNow, vehicle.gpsSim?.startedAt]);

  const gpsSimVisiblePrefix = useMemo(() => {
    if (!gpsSimPositions.length || gpsSimCurrentIndex < 0) return [];
    return gpsSimPositions.slice(0, gpsSimCurrentIndex + 1);
  }, [gpsSimCurrentIndex, gpsSimPositions]);

  const gpsSimOverlayActive = gpsSimVisible || simulationActive;
  const localActiveRouteStartTs =
    simulationActive && simulationPositions.length > 0
      ? simulationPositions[0]?.gpsTimestamp || 0
      : 0;
  const localActiveRouteEndTs =
    localActiveRouteStartTs > 0
      ? Math.max(
          localActiveRouteStartTs + 24 * 60 * 60 * 1000,
          simulationPositions[simulationPositions.length - 1]?.gpsTimestamp || localActiveRouteStartTs
        )
      : 0;
  const gpsSimStartedAt = vehicle.gpsSim?.startedAt || 0;
  const hiddenRealGpsActiveEndTs = gpsSimOverlayActive && gpsSimStartedAt > 0
     ? Math.max(
        gpsSimStartedAt + Math.max(gpsSimTotalDurationMs, 24 * 60 * 60 * 1000)
      )
    : 0;
  const hiddenRealGpsIntervals = useMemo(() => {
    const intervals = buildHiddenRealGpsIntervals(vehicle, hiddenRealGpsActiveEndTs);
    if (localActiveRouteStartTs > 0 && localActiveRouteEndTs > localActiveRouteStartTs) {
      return [
        ...intervals,
        { startTs: localActiveRouteStartTs, endTs: localActiveRouteEndTs },
      ];
    }
    return intervals;
  }, [
    hiddenRealGpsActiveEndTs,
    localActiveRouteEndTs,
    localActiveRouteStartTs,
    vehicle.gpsSim,
    vehicle.gpsSimHistory,
  ]);

  const shouldUseLocalSimulation = simulationActive && simulationPositions.length > 0;
  const hasLiveSimulation = gpsSimVisible || shouldUseLocalSimulation;
  const hasPlannedSimulation = simulationActive && simulationPlannedPositions.length > 0;
  const hasSimulationOverlay =
    gpsSimOverlayActive || hasLiveSimulation || gpsSimHistoryPositions.length > 0;
  const effectiveSimPositions = shouldUseLocalSimulation
    ? simulationPositions
    : gpsSimVisible
       ? gpsSimVisiblePrefix
      : [];
  const displayedHistorySimulationPositions = useMemo(
    () => samplePositions(gpsSimHistoryPositions, routeRenderPointLimit),
    [gpsSimHistoryPositions, routeRenderPointLimit]
  );
  const displayedEffectiveSimPositions = useMemo(
    () =>
      samplePositions(
        effectiveSimPositions,
        hasLiveSimulation ? activeSimulationRenderPointLimit : routeRenderPointLimit
      ),
    [activeSimulationRenderPointLimit, effectiveSimPositions, hasLiveSimulation, routeRenderPointLimit]
  );
  const realStatsSegments = useMemo(
    () => {
      const source = analysisRoutePositions.length ? analysisRoutePositions : positions;
      return getVisibleRealGpsSegments(source, hiddenRealGpsIntervals)
        .map((segment) => filterTrackableRoutePositions(segment))
        .filter((segment) => segment.length > 1);
    },
    [analysisRoutePositions, hiddenRealGpsIntervals, positions]
  );
  const realDisplaySegments = useMemo(
    () => getVisibleRealGpsSegments(positions, hiddenRealGpsIntervals),
    [hiddenRealGpsIntervals, positions]
  );
  const realDisplayPositions = useMemo(
    () => safeRoutePoints(realDisplaySegments.flat()),
    [realDisplaySegments]
  );
  const realDisplayTrackableSegments = useMemo(
    () =>
      realDisplaySegments
        .map((segment) => filterTrackableRoutePositions(segment))
        .filter((segment) => segment.length > 1),
    [realDisplaySegments]
  );
  const realDisplayTrackablePositions = useMemo(
    () => safeRoutePoints(realDisplayTrackableSegments.flat()),
    [realDisplayTrackableSegments]
  );
  const activeSimulationPositionsInRange = useMemo(
    () =>
      hasLiveSimulation
         ? effectiveSimPositions.filter((point) =>
            isWithinRange(point.gpsTimestamp, fromTs, displayToTs)
          )
        : [],
    [displayToTs, effectiveSimPositions, fromTs, hasLiveSimulation]
  );
  const currentSimulationPosition = useMemo<VehiclePositionItem | null>(() => {
    if (!hasLiveSimulation) return null;
    const point = shouldUseLocalSimulation
       ? simulationPositions[simulationPositions.length - 1] ?? null
      : gpsSimVisible
         ? gpsSimPositions[gpsSimCurrentIndex] ?? null
        : null;
    if (!point) return null;

    if (gpsSimDone || point.ignitionOn === false) {
      return {
        ...point,
        speedKmh: 0,
        ignitionOn: false,
      };
    }

    return point;
  }, [
    gpsSimDone,
    gpsSimCurrentIndex,
    gpsSimPositions,
    gpsSimVisible,
    hasLiveSimulation,
    shouldUseLocalSimulation,
    simulationPositions,
  ]);
  const displayPositions = useMemo(
    () =>
      safeRoutePoints([
        ...realDisplayTrackablePositions,
        ...displayedHistorySimulationPositions,
        ...(hasLiveSimulation
           ? displayedEffectiveSimPositions.filter((point) =>
              isWithinRange(point.gpsTimestamp, fromTs, displayToTs)
            )
          : []),
      ]),
    [
      displayToTs,
      displayedEffectiveSimPositions,
      displayedHistorySimulationPositions,
      fromTs,
      hasLiveSimulation,
      realDisplayTrackablePositions,
    ]
  );
  const deferredPositions = useDeferredValue(displayPositions);

  const realAnalysisSourceSegments = useMemo(() => {
    const source = analysisRoutePositions.length ? analysisRoutePositions : positions;
    return getVisibleRealGpsSegments(source, hiddenRealGpsIntervals);
  }, [
    analysisRoutePositions,
    hiddenRealGpsIntervals,
    positions,
  ]);
  const realContactOffSourceSegments = useMemo(() => {
    const source = analysisRoutePositions.length ? analysisRoutePositions : positions;
    const visible = filterHiddenRealGpsPositions(source, hiddenRealGpsIntervals);
    return visible.length ? [sanitizePositions(visible)] : [];
  }, [analysisRoutePositions, hiddenRealGpsIntervals, positions]);
  const realAnalysisSegments = useMemo(
    () =>
      realAnalysisSourceSegments
        .map((segment) => filterTrackableRoutePositions(segment))
        .filter((segment) => segment.length > 1)
        .map((segment) => samplePositions(segment, routeAnalysisPointLimit)),
    [realAnalysisSourceSegments, routeAnalysisPointLimit]
  );
  const latestRealLivePosition = useMemo(
    () => getLastRoutePoint(realAnalysisSegments),
    [realAnalysisSegments]
  );
  const realAnalysisPoints = useMemo(
    () => safeRoutePoints(realAnalysisSegments.flat()),
    [realAnalysisSegments]
  );
  const historySimulationAnalysisPoints = useMemo(
    () => safeRoutePoints(gpsSimHistorySegments.flatMap((segment) => samplePositions(segment, routeAnalysisPointLimit))),
    [gpsSimHistorySegments, routeAnalysisPointLimit]
  );
  const historySimulationAnalysisSegments = useMemo(
    () => gpsSimHistorySegments.map((segment) => samplePositions(segment, routeAnalysisPointLimit)),
    [gpsSimHistorySegments, routeAnalysisPointLimit]
  );
  const activeSimulationAnalysisPoints = useMemo(
    () => samplePositions(activeSimulationPositionsInRange, routeAnalysisPointLimit),
    [activeSimulationPositionsInRange, routeAnalysisPointLimit]
  );
  const analysisPoints = useMemo(
    () =>
      safeRoutePoints([
        ...realAnalysisPoints,
        ...historySimulationAnalysisPoints,
        ...activeSimulationAnalysisPoints,
      ]),
    [activeSimulationAnalysisPoints, historySimulationAnalysisPoints, realAnalysisPoints]
  );

  const detectedRouteEvents = useMemo(() => {
    if (!shouldBuildRouteEvents) {
      return { overspeedItems: [] };
    }

    const overspeed = [
      ...realAnalysisSegments.flatMap((segment) => detectOverspeed(segment, overspeedThreshold)),
      ...historySimulationAnalysisSegments.flatMap((segment) =>
        detectOverspeed(segment, overspeedThreshold)
      ),
      ...detectOverspeed(activeSimulationAnalysisPoints, overspeedThreshold),
    ];
    return { overspeedItems: overspeed };
  }, [
    activeSimulationAnalysisPoints,
    historySimulationAnalysisSegments,
    overspeedThreshold,
    realAnalysisSegments,
    shouldBuildRouteEvents,
  ]);
  const overspeedItems = detectedRouteEvents.overspeedItems;

  const routeStats = useMemo(() => {
    const statsPositions = analysisPoints.length ? analysisPoints : displayPositions;
    const start = statsPositions[0] ?? displayPositions[0] ?? null;
    const end =
      displayPositions[displayPositions.length - 1] ??
      statsPositions[statsPositions.length - 1] ??
      null;
    const activeProgressDistanceKm = hasLiveSimulation
      ? calculateRouteProgressDistanceKm(activeSimulationPositionsInRange)
      : 0;
    const activeProgressDurationMs =
      hasLiveSimulation && activeSimulationPositionsInRange.length > 1
        ? Math.max(
            0,
            (activeSimulationPositionsInRange[activeSimulationPositionsInRange.length - 1]?.gpsTimestamp || 0) -
              (activeSimulationPositionsInRange[0]?.gpsTimestamp || 0)
          )
        : 0;
    const calculatedMaxSpeed = Math.max(
      getMaxRouteSpeedKmh(realAnalysisPoints.length ? realAnalysisPoints : statsPositions),
      getMaxRouteSpeedKmh(historySimulationAnalysisPoints),
      getMaxRouteSpeedKmh(activeSimulationPositionsInRange)
    );
    const calculatedDistanceKm = Number(
      (
        sumRouteDistanceKm(realStatsSegments) +
        sumRouteDistanceKm(historySimulationAnalysisSegments) +
        activeProgressDistanceKm
      ).toFixed(2)
    );
    const activeRouteDistanceKey =
      vehicle.gpsSim?.startedAt ||
      activeSimulationPositionsInRange[0]?.gpsTimestamp ||
      "none";
    const simulationDistanceKey = `${vehicle.id}:${fromTs}:${toTs}:${activeRouteDistanceKey}`;
    let distanceKm = calculatedDistanceKm;
    if (gpsSimVisible || simulationActive) {
      const previous = monotonicRouteDistanceRef.current;
      distanceKm =
        previous.key === simulationDistanceKey
           ? Math.max(previous.distanceKm, calculatedDistanceKm)
          : calculatedDistanceKm;
      monotonicRouteDistanceRef.current = { key: simulationDistanceKey, distanceKm };
    } else if (monotonicRouteDistanceRef.current.key !== "") {
      monotonicRouteDistanceRef.current = { key: "", distanceKm: 0 };
    }

    let maxSpeed = calculatedMaxSpeed;
    if (gpsSimVisible || simulationActive) {
      const previous = monotonicRouteMaxSpeedRef.current;
      maxSpeed =
        previous.key === simulationDistanceKey
           ? Math.max(previous.maxSpeed, calculatedMaxSpeed)
          : calculatedMaxSpeed;
      monotonicRouteMaxSpeedRef.current = { key: simulationDistanceKey, maxSpeed };
    } else if (monotonicRouteMaxSpeedRef.current.key !== "") {
      monotonicRouteMaxSpeedRef.current = { key: "", maxSpeed: 0 };
    }

    const durationMs =
      sumRouteDurationMs(realStatsSegments) +
      sumRouteDurationMs(historySimulationAnalysisSegments) +
      activeProgressDurationMs;

    return {
      start,
      end,
      maxSpeed,
      distanceKm,
      duration: formatDuration(durationMs),
    };
  }, [
    analysisPoints,
    activeSimulationPositionsInRange,
    displayPositions,
    fromTs,
    gpsSimVisible,
    hasLiveSimulation,
    historySimulationAnalysisPoints,
    historySimulationAnalysisSegments,
    realAnalysisPoints,
    realStatsSegments,
    simulationActive,
    toTs,
    vehicle.gpsSim?.startedAt,
    vehicle.id,
  ]);
  const showRealCurrentMarker = !hasSimulationOverlay;

  const normalizedHistorySegments = useMemo(() => {
    const source = analysisRoutePositions.length ? analysisRoutePositions : positions;
    const realNormalizedSegments = getVisibleRealGpsSegments(
      source,
      hiddenRealGpsIntervals
    )
      .map((segment) => filterTrackableRoutePositions(segment))
      .filter((segment) => segment.length > 1)
      .map((segment) =>
        samplePositions(
          safeRoutePoints(segment),
          routeAnalysisPointLimit
        )
      );
    const simulationNormalizedSegments = [
      ...gpsSimHistorySegments.map((segment) =>
        samplePositions(
          safeRoutePoints(segment),
          routeAnalysisPointLimit
        )
      ),
      ...(hasLiveSimulation && activeSimulationPositionsInRange.length
        ? [
            samplePositions(
              safeRoutePoints(activeSimulationPositionsInRange),
              routeAnalysisPointLimit
            ),
          ]
        : []),
    ];

    return {
      realNormalizedSegments,
      simulationNormalizedSegments,
    };
  }, [
    activeSimulationPositionsInRange,
    analysisRoutePositions,
    gpsSimHistorySegments,
    hasLiveSimulation,
    hiddenRealGpsIntervals,
    positions,
    routeAnalysisPointLimit,
  ]);

  const baseHistoryStats = useMemo(() => {
    const { realNormalizedSegments, simulationNormalizedSegments } = normalizedHistorySegments;
    const dayBuckets = mergeDistanceBuckets(
      ...realNormalizedSegments.map((segment) => buildDistanceHistory(segment, "day")),
      ...simulationNormalizedSegments.map((segment) => buildDistanceHistory(segment, "day"))
    );
    const nowDate = new Date(historyWindowTs);
    const todayKey = `${nowDate.getFullYear()}-${String(
      nowDate.getMonth() + 1
    ).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;
    const todayKm = dayBuckets.find((item) => item.id === todayKey)?.distanceKm ?? 0;
    const totalTrackedKm = Number(
      dayBuckets.reduce((total, item) => total + (item.distanceKm || 0), 0).toFixed(2)
    );

    return {
      todayKm,
      totalTrackedKm,
      dayBuckets,
    };
  }, [historyWindowTs, normalizedHistorySegments]);

  const detailedHistoryStats = useMemo(() => {
    if (!historyPeriodsOpen) {
      return {
        weekBuckets: [] as VehicleDistanceBucket[],
        monthBuckets: [] as VehicleDistanceBucket[],
      };
    }

    const { realNormalizedSegments, simulationNormalizedSegments } = normalizedHistorySegments;
    const weekBuckets = mergeDistanceBuckets(
      ...realNormalizedSegments.map((segment) => buildDistanceHistory(segment, "week")),
      ...simulationNormalizedSegments.map((segment) => buildDistanceHistory(segment, "week"))
    );
    const monthBuckets = mergeDistanceBuckets(
      ...realNormalizedSegments.map((segment) => buildDistanceHistory(segment, "month")),
      ...simulationNormalizedSegments.map((segment) => buildDistanceHistory(segment, "month"))
    );

    return {
      weekBuckets,
      monthBuckets,
    };
  }, [historyPeriodsOpen, normalizedHistorySegments]);

  const historyStats = useMemo(() => {
    const physicalSnapshotOdometerKm = getTrustedTotalOdometerKm(
      vehicle.gpsSnapshot?.odometerKm,
      initialRecordedKm
    );
    const liveRealOdometerKm = getTrustedTotalOdometerKm(
      latestRealLivePosition?.odometerKm,
      initialRecordedKm
    );
    const hasRealOdometer = physicalSnapshotOdometerKm > 0 || liveRealOdometerKm > 0;
    const absoluteRealOdometerKm = Math.max(
      physicalSnapshotOdometerKm,
      liveRealOdometerKm
    );
    const storedVehicleKm =
      typeof vehicle.currentKm === "number" &&
      Number.isFinite(vehicle.currentKm) &&
      vehicle.currentKm >= initialRecordedKm
        ? vehicle.currentKm
        : initialRecordedKm;
    const absoluteCurrentKm = Math.max(storedVehicleKm, absoluteRealOdometerKm);
    const monitoredFromOdometerKm = Math.max(
      0,
      absoluteCurrentKm - initialRecordedKm
    );
    const totalTrackedKm = Number(
      Math.max(
        baseHistoryStats.totalTrackedKm,
        monitoredFromOdometerKm
      ).toFixed(2)
    );
    const calculatedEstimatedCurrentKm = Number(
      Math.max(
        absoluteCurrentKm,
        initialRecordedKm + totalTrackedKm
      ).toFixed(2)
    );
    const activeRouteStartedAt =
      vehicle.gpsSim?.startedAt ||
      activeSimulationPositionsInRange[0]?.gpsTimestamp ||
      "none";
    const kmShouldStayMonotonic = gpsSimVisible || simulationActive;
    const monotonicKmKey = `${vehicle.id}:${
      hasRealOdometer ? "real-odometer" : "stored"
    }:${vehicle.currentKm || 0}:${kmShouldStayMonotonic ? activeRouteStartedAt : "real"}`;
    if (monotonicKmVehicleRef.current !== monotonicKmKey) {
      monotonicKmVehicleRef.current = monotonicKmKey;
      monotonicEstimatedKmRef.current = calculatedEstimatedCurrentKm;
    }
    const estimatedCurrentKm = Number(
      (kmShouldStayMonotonic
        ? Math.max(monotonicEstimatedKmRef.current, calculatedEstimatedCurrentKm)
        : calculatedEstimatedCurrentKm
      ).toFixed(2)
    );
    monotonicEstimatedKmRef.current = estimatedCurrentKm;

    return {
      todayKm: Number(baseHistoryStats.todayKm.toFixed(2)),
      totalTrackedKm,
      estimatedCurrentKm,
      dayBuckets: baseHistoryStats.dayBuckets,
    };
  }, [
    baseHistoryStats,
    latestRealLivePosition?.odometerKm,
    initialRecordedKm,
    activeSimulationPositionsInRange,
    gpsSimVisible,
    simulationActive,
    vehicle.currentKm,
    vehicle.gpsSim?.startedAt,
    vehicle.gpsSnapshot?.odometerKm,
    vehicle.id,
  ]);

  useEffect(() => {
    if (!onKmEstimateChange) return;
    onKmEstimateChange(historyStats.estimatedCurrentKm);
  }, [historyStats.estimatedCurrentKm, onKmEstimateChange]);

  const selectedPeriodDistanceKm = useMemo(() => {
    return routeStats.distanceKm;
  }, [routeStats.distanceKm]);

  const selectedDayLabel = useMemo(() => {
    const date = new Date(`${selectedDayValue}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return selectedDayValue;
    return date.toLocaleDateString("ro-RO", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }, [selectedDayValue]);

  const latestSnapshotPosition = useMemo(() => gpsSnapshotToPosition(vehicle), [
    vehicle.gpsSnapshot?.altitude,
    vehicle.gpsSnapshot?.angle,
    vehicle.gpsSnapshot?.gpsTimestamp,
    vehicle.gpsSnapshot?.imei,
    vehicle.gpsSnapshot?.ignitionOn,
    vehicle.gpsSnapshot?.lat,
    vehicle.gpsSnapshot?.lng,
    vehicle.gpsSnapshot?.odometerKm,
    vehicle.gpsSnapshot?.satellites,
    vehicle.gpsSnapshot?.serverTimestamp,
    vehicle.gpsSnapshot?.speedKmh,
    vehicle.id,
    vehicle.tracker?.imei,
  ]);

  useEffect(() => {
    if (!selectedDayIsToday || gpsSimOverlayActive || hasLiveSimulation) {
      setLiveRealTrail((current) => (current.length ? [] : current));
      return;
    }

    if (
      !latestSnapshotPosition ||
      !isWithinRange(latestSnapshotPosition.gpsTimestamp, fromTs, displayToTs)
    ) {
      return;
    }

    setLiveRealTrail((current) =>
      appendLiveTrailPoint(current, latestSnapshotPosition)
    );
  }, [
    displayToTs,
    fromTs,
    gpsSimOverlayActive,
    hasLiveSimulation,
    latestSnapshotPosition,
    selectedDayIsToday,
  ]);

  const stabilizedLatestPosition = useMemo(() => {
    if (!latestSnapshotPosition || hasLiveSimulation) return latestSnapshotPosition;

    const stabilizationSource = safeRoutePoints([...realDisplayPositions, latestSnapshotPosition]);
    const stabilizedRoute = filterRouteRenderJitter(stabilizationSource);
    const trackableRoute = filterTrackableRoutePositions(stabilizationSource);
    const latestTrackable = trackableRoute[trackableRoute.length - 1];
    const latestLooksMoving =
      latestSnapshotPosition.ignitionOn === true ||
      (latestSnapshotPosition.ignitionOn !== false && (latestSnapshotPosition.speedKmh ?? 0) >= 10);

    if (
      latestLooksMoving &&
      latestTrackable?.gpsTimestamp === latestSnapshotPosition.gpsTimestamp
    ) {
      return latestSnapshotPosition;
    }

    return stabilizedRoute[stabilizedRoute.length - 1] ?? latestTrackable ?? latestSnapshotPosition;
  }, [hasLiveSimulation, latestSnapshotPosition, realDisplayPositions]);

  const routeRenderPositions = useMemo(
    () => samplePositions(deferredPositions, routeRenderPointLimit),
    [deferredPositions, routeRenderPointLimit]
  );
  const liveRealTrailRouteSegment = useMemo(
    () =>
      gpsSimOverlayActive || hasLiveSimulation
        ? []
        : getRenderableLiveTrail(
            liveRealTrail.filter((point) =>
              isWithinRange(point.gpsTimestamp, fromTs, displayToTs)
            ),
            realRouteRenderPointLimit
          ),
    [
      displayToTs,
      fromTs,
      gpsSimOverlayActive,
      hasLiveSimulation,
      liveRealTrail,
      realRouteRenderPointLimit,
    ]
  );
  const realRouteRenderSegments = useMemo(
    () =>
      appendLiveEndpointToLastRouteSegment(
        realDisplaySegments.map((segment) =>
          buildRenderableRealRouteSegment(segment, realRouteRenderPointLimit)
        ),
        !gpsSimOverlayActive &&
          stabilizedLatestPosition &&
          isWithinRange(stabilizedLatestPosition.gpsTimestamp, fromTs, displayToTs)
          ? stabilizedLatestPosition
          : null
      ),
    [
      displayToTs,
      fromTs,
      gpsSimOverlayActive,
      realDisplaySegments,
      realRouteRenderPointLimit,
      stabilizedLatestPosition,
    ]
  );
  const historySimulationRouteRenderSegments = useMemo(
    () => gpsSimHistorySegments.map((segment) => samplePositions(segment, routeRenderPointLimit)),
    [gpsSimHistorySegments, routeRenderPointLimit]
  );
  const activeSimulationRouteRenderPositions = useMemo(
    () => samplePositions(activeSimulationPositionsInRange, activeSimulationRenderPointLimit),
    [activeSimulationPositionsInRange, activeSimulationRenderPointLimit]
  );

  const plannedRouteRenderPositions = useMemo(
    () => samplePositions(simulationPlannedPositions, routeRenderPointLimit),
    [routeRenderPointLimit, simulationPlannedPositions]
  );

  const routePolylines = useMemo(
    () =>
      [
        ...realRouteRenderSegments.map((positions, index) => ({
          id: `real-${index}`,
          positions,
          opacity: 1,
        })),
        ...(liveRealTrailRouteSegment.length > 1
          ? [{ id: "real-live", positions: liveRealTrailRouteSegment, opacity: 1 }]
          : []),
        ...historySimulationRouteRenderSegments.map((positions, index) => ({
          id: `history-sim-${index}`,
          positions,
          opacity: 0.9,
        })),
        { id: "active-sim", positions: activeSimulationRouteRenderPositions, opacity: 1 },
      ]
        .filter((line) => line.positions.length > 1)
        .map((line) => ({
          ...line,
          latLngs: line.positions.map((item) => [item.lat, item.lng] as [number, number]),
          pathOptions: {
            color: "#2563eb",
            weight: 5,
            opacity: line.opacity,
            smoothFactor:
              mapZoom >= 16
                ? isCompactViewport
                  ? 0.45
                  : 0.3
                : isCompactViewport
                  ? 1.1
                  : 0.6,
          },
        })),
    [
      activeSimulationRouteRenderPositions,
      historySimulationRouteRenderSegments,
      isCompactViewport,
      liveRealTrailRouteSegment,
      mapZoom,
      realRouteRenderSegments,
    ]
  );

  const plannedRoutePolyline = useMemo(
    () => plannedRouteRenderPositions.map((item) => [item.lat, item.lng] as [number, number]),
    [plannedRouteRenderPositions]
  );

  const boundsPoints = useMemo(
    () => {
      const renderedRoutePoints = safeRoutePoints([
        ...realRouteRenderSegments.flat(),
        ...liveRealTrailRouteSegment,
        ...historySimulationRouteRenderSegments.flat(),
        ...activeSimulationRouteRenderPositions,
      ]);

      return renderedRoutePoints.length
        ? renderedRoutePoints
        : routeRenderPositions.length
          ? routeRenderPositions
          : plannedRouteRenderPositions;
    },
    [
      activeSimulationRouteRenderPositions,
      historySimulationRouteRenderSegments,
      liveRealTrailRouteSegment,
      plannedRouteRenderPositions,
      realRouteRenderSegments,
      routeRenderPositions,
    ]
  );

  const renderedOverspeedItems = useMemo(
    () => samplePositions(overspeedItems, overspeedRenderPointLimit),
    [overspeedItems, overspeedRenderPointLimit]
  );

  const terminalSimulationStopItems = useMemo(() => {
    const stops: VehicleStopItem[] = [];

    historySimulationAnalysisSegments.forEach((segment, index) => {
      const stop = buildTerminalSimulationStop(segment, `history-sim-${index}`);
      if (stop) stops.push(stop);
    });

    if (gpsSimDone) {
      const stop = buildTerminalSimulationStop(
        activeSimulationAnalysisPoints,
        "active-sim"
      );
      if (stop) stops.push(stop);
    }

    return stops;
  }, [activeSimulationAnalysisPoints, gpsSimDone, historySimulationAnalysisSegments]);

  const realContactOffHistoryStopItems = useMemo(() => {
    const stops = mergeNearbyStopItems(
      buildContactOffStopsFromSegments(realContactOffSourceSegments, "real-history")
    );

    if (!gpsSimOverlayActive || !gpsSimStartedAt) return stops;
    return stops.filter((stop) => stop.end.gpsTimestamp < gpsSimStartedAt);
  }, [gpsSimOverlayActive, gpsSimStartedAt, realContactOffSourceSegments]);

  const preSimulationStopItem = useMemo(() => {
    if (!gpsSimOverlayActive) return null;
    const simulationStartTs = vehicle.gpsSim?.startedAt || 0;
    const source = analysisRoutePositions.length ? analysisRoutePositions : positions;
    const fallbackPoint = getLastPositionBefore(source, simulationStartTs);
    return buildSimulationStartStop(vehicle, fallbackPoint);
  }, [
    analysisRoutePositions,
    gpsSimOverlayActive,
    positions,
    vehicle.gpsSim,
    vehicle.gpsSnapshot?.imei,
    vehicle.gpsSnapshot?.odometerKm,
    vehicle.id,
    vehicle.tracker?.imei,
  ]);

  const realContactOffStopItem = useMemo(() => {
    if (gpsSimOverlayActive) return null;

    const snapshotPoint = stabilizedLatestPosition;
    const preferredPoint = stabilizedLatestPosition ?? latestRealLivePosition;
    const realPoint =
      preferredPoint && isDisplayedRealContactOff(vehicle, preferredPoint)
         ? preferredPoint
        : snapshotPoint && isDisplayedRealContactOff(vehicle, snapshotPoint)
           ? snapshotPoint
          : null;

    return buildContactOffStop(realPoint, Boolean(realPoint));
  }, [
    gpsSimOverlayActive,
    latestRealLivePosition,
    stabilizedLatestPosition,
    vehicle.gpsSnapshot,
    vehicle.id,
    vehicle.tracker?.lastSeenAt,
    vehicle.tracker?.imei,
    vehicle.tracker?.updatedAt,
  ]);

  const allStopItems = useMemo(() => {
    const merged = new Map<string, VehicleStopItem>();

    for (const item of [
      ...realContactOffHistoryStopItems,
      ...terminalSimulationStopItems,
      ...(preSimulationStopItem ? [preSimulationStopItem] : []),
      ...(realContactOffStopItem ? [realContactOffStopItem] : []),
    ]) {
      const key = `${Math.round(item.lat * 100000)}:${Math.round(item.lng * 100000)}:${item.end.gpsTimestamp}`;
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    }

    return [...merged.values()].sort((a, b) => a.end.gpsTimestamp - b.end.gpsTimestamp);
  }, [
    preSimulationStopItem,
    realContactOffHistoryStopItems,
    realContactOffStopItem,
    terminalSimulationStopItems,
  ]);

  const distinctStopItems = useMemo(
    () => mergeDistinctStopItems(allStopItems),
    [allStopItems]
  );

  const renderedStopItems = useMemo(() => {
    if (distinctStopItems.length <= stopRenderLimit) return distinctStopItems;
    const stride = Math.ceil(distinctStopItems.length / stopRenderLimit);
    return distinctStopItems.filter((_, index) => index % stride === 0);
  }, [distinctStopItems, stopRenderLimit]);

  const timelinePositions = useMemo(() => {
    const items = [...analysisPoints];
    if (
      !gpsSimOverlayActive &&
      stabilizedLatestPosition &&
      isWithinRange(stabilizedLatestPosition.gpsTimestamp, fromTs, displayToTs)
    ) {
      items.push(stabilizedLatestPosition);
    }

    return safeRoutePoints(items);
  }, [
    analysisPoints,
    displayToTs,
    fromTs,
    gpsSimOverlayActive,
    stabilizedLatestPosition,
  ]);

  const tripTimeline = useMemo(
    () => {
      if (!timelineOpen) return [];
      const rawEvents = buildTimelineEvents(
        timelinePositions,
        renderedStopItems,
        overspeedItems
      );
      const withActiveMovement = hasLiveSimulation
        ? withActiveRouteMovingEvent(rawEvents, activeSimulationPositionsInRange)
        : rawEvents;
      return compactTripTimelineEvents(withActiveMovement);
    },
    [
      activeSimulationPositionsInRange,
      hasLiveSimulation,
      overspeedItems,
      renderedStopItems,
      timelineOpen,
      timelinePositions,
    ]
  );
  const currentMapPosition = hasLiveSimulation
    ? currentSimulationPosition
    : stabilizedLatestPosition ?? routeStats.end;
  const realCurrentMarkerPosition =
    showRealCurrentMarker ? stabilizedLatestPosition ?? routeStats.end : null;

  const mapCenter = useMemo<[number, number]>(() => {
    if (
      currentSimulationPosition &&
      isValidCoordPair(currentSimulationPosition.lat, currentSimulationPosition.lng)
    ) {
      return [currentSimulationPosition.lat, currentSimulationPosition.lng];
    }
    if (
      !hasLiveSimulation &&
      stabilizedLatestPosition &&
      isValidCoordPair(stabilizedLatestPosition.lat, stabilizedLatestPosition.lng)
    ) {
      return [stabilizedLatestPosition.lat, stabilizedLatestPosition.lng];
    }
    const plannedStart = plannedRouteRenderPositions[0];
    if (plannedStart && isValidCoordPair(plannedStart.lat, plannedStart.lng)) {
      return [plannedStart.lat, plannedStart.lng];
    }
    if (routeStats.end && isValidCoordPair(routeStats.end.lat, routeStats.end.lng)) {
      return [routeStats.end.lat, routeStats.end.lng];
    }
    return [44.4268, 26.1025];
  }, [
    currentSimulationPosition,
    hasLiveSimulation,
    plannedRouteRenderPositions,
    routeStats.end,
    stabilizedLatestPosition,
  ]);

  function applyDayValue(dayValue: string) {
    const range = getLocalDayRange(dayValue);
    const isToday = dayValue === toDateInputValue();
    setSelectedDayValue(dayValue);
    setPreset(isToday ? "today" : "custom");
    setFromTs(range.from);
    setToTs(range.to);
  }

  const crumbPositions = useMemo(
    () => (crumbPointLimit > 0 ? samplePositions(deferredPositions, crumbPointLimit) : []),
    [crumbPointLimit, deferredPositions]
  );

  const handleMapZoomChange = useCallback((zoom: number) => {
    setMapZoom((currentZoom) => (currentZoom === zoom ? currentZoom : zoom));
  }, []);

  return (
    <div className="panel vehicle-live-route-card">
      <div className="vehicle-live-route-card__header">
        <div>
          <h3 className="panel-title">Harta mare live</h3>
        </div>

        <div className="vehicle-live-route-card__actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void loadMeta()}
            disabled={!authReady || !user}
          >
            <RefreshCw size={14} /> Refresh
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={() => setBoundsTrigger((value) => value + 1)}
            disabled={!displayPositions.length && !plannedRouteRenderPositions.length}
          >
            <Crosshair size={14} /> Centreaza traseul
          </button>
        </div>
      </div>

      <div className="vehicle-range-toolbar">
        {quickDayOptions.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`vehicle-filter-chip ${selectedDayValue === item.value ? "active" : ""}`}
            onClick={() => applyDayValue(item.value)}
          >
            {item.label}
          </button>
        ))}

        <label className="vehicle-threshold-label">
          Zi traseu
          <input
            type="date"
            value={selectedDayValue}
            max={toDateInputValue()}
            onChange={(event) => {
              if (event.target.value) applyDayValue(event.target.value);
            }}
          />
        </label>

        <label className="vehicle-threshold-label">
          Prag overspeed
          <input
            type="number"
            min={20}
            max={220}
            step={5}
            value={overspeedThresholdDraft ?? String(overspeedThreshold)}
            onChange={(event) => {
              const rawValue = event.target.value;
              setOverspeedThresholdDraft(rawValue);
              if (rawValue.trim() === "") {
                setOverspeedThreshold(DEFAULT_OVERSPEED_THRESHOLD);
                return;
              }

              const next = Number(rawValue);
              setOverspeedThreshold(
                Number.isFinite(next)
                  ? Math.min(220, Math.max(20, next))
                  : DEFAULT_OVERSPEED_THRESHOLD
              );
            }}
            onBlur={() => setOverspeedThresholdDraft(null)}
          />
          <span className="tools-subtitle" style={{ marginLeft: 8 }}>
            implicit 140 km/h
          </span>
        </label>
      </div>

      <GpsSectionDropdown title="Tracker live" defaultOpen>
      <div className="vehicle-live-route-card__mapWrap">
        <MapContainer
          center={mapCenter}
          zoom={13}
          scrollWheelZoom
          preferCanvas
          zoomAnimation={!isCompactViewport}
          fadeAnimation={!isCompactViewport}
          markerZoomAnimation={!isCompactViewport}
          className="vehicle-live-route-card__map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            updateWhenIdle
            updateWhenZooming={false}
            keepBuffer={1}
          />
          <TrackMapZoom onZoomChange={handleMapZoomChange} />

          {boundsTrigger > 0 && boundsPoints.length > 0 && (
            <FitRouteBounds points={boundsPoints} trigger={boundsTrigger} />
          )}

          {displayPositions.length > 0 ||
          liveRealTrailRouteSegment.length > 1 ||
          hasPlannedSimulation ||
          renderedStopItems.length > 0 ||
          Boolean(currentMapPosition && hasLiveSimulation) ? (
            <>
              {hasPlannedSimulation && plannedRoutePolyline.length > 1 && (
                <Pane name="planned-route" style={{ zIndex: 405 }}>
                  <Polyline
                    positions={plannedRoutePolyline}
                    pathOptions={PLANNED_ROUTE_OPTIONS}
                    interactive={false}
                  />
                </Pane>
              )}

              <Pane name="route" style={{ zIndex: 410 }}>
                {routePolylines.map((line) => (
                  <Polyline
                    key={line.id}
                    positions={line.latLngs}
                    pathOptions={line.pathOptions}
                    interactive={false}
                  />
                ))}
              </Pane>

              {realCurrentMarkerPosition && showRealCurrentMarker && (
                <Marker
                  position={[realCurrentMarkerPosition.lat, realCurrentMarkerPosition.lng]}
                  icon={currentIcon}
                >
                  <Popup>Pozitie curenta</Popup>
                </Marker>
              )}

              {currentMapPosition && hasLiveSimulation && (
                <Marker position={[currentMapPosition.lat, currentMapPosition.lng]} icon={currentIcon}>
                  <Popup>Pozitie curenta</Popup>
                </Marker>
              )}

              {hasSimulationOverlay && !gpsSimOverlayActive && !hasLiveSimulation && hasSnapshot && (
                <Marker
                  position={[
                    vehicle.gpsSnapshot?.lat ?? mapCenter[0],
                    vehicle.gpsSnapshot?.lng ?? mapCenter[1],
                  ]}
                  icon={currentIcon}
                >
                  <Popup>
                    Pozitie curenta GPS real: {formatDate(vehicle.gpsSnapshot?.gpsTimestamp)}
                  </Popup>
                </Marker>
              )}

              {renderedStopItems.map((stop) => (
                <CircleMarker
                  key={stop.id}
                  center={[stop.lat, stop.lng]}
                  radius={7}
                  pathOptions={STOP_MARKER_OPTIONS}
                >
                  <Popup>
                    {`Oprire ${formatDuration(stop.durationMs)}`}
                    <br />
                    {formatDate(stop.start.gpsTimestamp)} - {formatDate(stop.end.gpsTimestamp)}
                  </Popup>
                </CircleMarker>
              ))}

              {renderedOverspeedItems.map((point) => (
                <Marker
                  key={`overspeed-${point.id || point.gpsTimestamp}`}
                  position={[point.lat, point.lng]}
                  icon={overspeedIcon}
                >
                  <Popup>
                    Depasire viteza: {point.speedKmh} km/h - {formatDate(point.gpsTimestamp)}
                  </Popup>
                </Marker>
              ))}

              <Pane name="crumbs" style={{ zIndex: 390 }}>
                {crumbPositions.map((item) => (
                  <CircleMarker
                    key={`crumb-${item.id || item.gpsTimestamp}`}
                    center={[item.lat, item.lng]}
                    radius={2.5}
                    pathOptions={CRUMB_MARKER_OPTIONS}
                    interactive={false}
                  />
                ))}
              </Pane>
            </>
          ) : !hasSimulationOverlay && hasSnapshot ? (
            <Marker
              position={[
                vehicle.gpsSnapshot?.lat ?? mapCenter[0],
                vehicle.gpsSnapshot?.lng ?? mapCenter[1],
              ]}
              icon={currentIcon}
            >
              <Popup>
                Ultima pozitie disponibila: {formatDate(vehicle.gpsSnapshot?.gpsTimestamp)}
              </Popup>
            </Marker>
          ) : null}
        </MapContainer>

        {!authReady ? (
          <div className="vehicle-live-route-card__empty">
            Se initializeaza autentificarea...
          </div>
        ) : isOffline ? (
          <div className="vehicle-live-route-card__empty">
            Fara internet momentan. Pastram ultima ruta vizibila si reluam automat cand revine netul.
            {lastDataAt ? ` Ultima sincronizare: ${formatDate(lastDataAt)}.` : ""}
          </div>
        ) : loading ? (
          <div className="vehicle-live-route-card__loading">
            <RefreshCw size={18} aria-hidden="true" />
            <span>Se incarca traseul pentru {selectedDayLabel}...</span>
          </div>
        ) : !loading && displayPositions.length === 0 && !hasSnapshot ? (
          <div className="vehicle-live-route-card__empty">
            Nu exista traseu sau date suficiente pentru intervalul ales.
          </div>
        ) : null}
      </div>
      </GpsSectionDropdown>

      <div className="vehicle-trip-timeline-section">
        <VehicleTripTimeline items={tripTimeline} />
      </div>

      <div className="vehicle-gps-stats-grid">
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km perioada selectata</span>
          <strong>{selectedPeriodDistanceKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km azi</span>
          <strong>{historyStats.todayKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km total monitorizat</span>
          <strong>{historyStats.totalTrackedKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km total estimat masina</span>
          <strong>{historyStats.estimatedCurrentKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Puncte traseu</span>
          <strong>{displayPositions.length}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Durata traseu</span>
          <strong>{routeStats.duration}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Viteza maxima</span>
          <strong>{routeStats.maxSpeed} km/h</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Opriri detectate</span>
          <strong>{shouldBuildRouteEvents ? renderedStopItems.length : "-"}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Overspeed</span>
          <strong>{shouldBuildRouteEvents ? overspeedItems.length : "-"}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Evenimente tracker</span>
          <strong>{externalEventsCount}</strong>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <GpsSectionDropdown
          title="Istoric km pe zile"
          lazy
          onOpenChange={setHistoryDaysOpen}
        >
          {historyDaysOpen ? <div className="simple-list">
            {historyStats.dayBuckets.slice(0, 8).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {!historyStats.dayBuckets.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu exista date de istoric disponibile.
                  </div>
                </div>
              </div>
            )}
          </div> : null}
        </GpsSectionDropdown>

        <GpsSectionDropdown
          title="Istoric km pe saptamani / luni"
          lazy
          onOpenChange={setHistoryPeriodsOpen}
        >
          {historyPeriodsOpen ? <div className="simple-list">
            {detailedHistoryStats.weekBuckets.slice(0, 4).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Saptamana: {item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {detailedHistoryStats.monthBuckets.slice(0, 4).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Luna: {item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {!detailedHistoryStats.weekBuckets.length && !detailedHistoryStats.monthBuckets.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu exista date de istoric disponibile.
                  </div>
                </div>
              </div>
            )}
          </div> : null}
        </GpsSectionDropdown>
      </div>

      <div className="vehicle-gps-detail-grid">
        <VehicleGpsStatsCard
          vehicle={vehicle}
          odometerKmOverride={historyStats.estimatedCurrentKm}
          livePositionOverride={currentSimulationPosition ?? latestRealLivePosition}
          livePositionOverrideIsVirtual={Boolean(currentSimulationPosition)}
        />

        <GpsSectionDropdown
          title="Opriri & overspeed"
          lazy={selectedRangeIsLong}
          onOpenChange={setRouteEventsOpen}
        >
          {shouldBuildRouteEvents ? <div className="simple-list">
            {renderedStopItems.slice(0, 6).map((stop) => (
              <div key={stop.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    {`Oprire ${formatDuration(stop.durationMs)}`}
                  </div>
                  <div className="simple-list-subtitle">
                    {formatDate(stop.start.gpsTimestamp)} - {formatCoords(stop.lat, stop.lng)}
                  </div>
                </div>
              </div>
            ))}

            {overspeedItems.slice(0, 6).map((point) => (
              <div
                key={`list-overspeed-${point.id || point.gpsTimestamp}`}
                className="simple-list-item"
              >
                <div className="simple-list-text">
                  <div className="simple-list-label">Depasire: {point.speedKmh} km/h</div>
                  <div className="simple-list-subtitle">
                    {formatDate(point.gpsTimestamp)} - {formatCoords(point.lat, point.lng)}
                  </div>
                </div>
              </div>
            ))}

            {!renderedStopItems.length && !overspeedItems.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu au fost detectate opriri sau depasiri.
                  </div>
                </div>
              </div>
            )}
          </div> : null}
        </GpsSectionDropdown>
      </div>

    </div>
  );
}
