import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, CarFront, List, MapPinned, RefreshCw, RotateCcw } from "lucide-react";
import UserProfileLink from "../../../components/UserProfileLink";
import { ProductPageHeader } from "../../../components/product/ProductPage";
import ProductTabs from "../../../components/product/ProductTabs";
import { useAuth } from "../../../providers/AuthProvider";
import type { VehicleItem, VehiclePositionItem } from "../../../types/vehicle";
import {
  getVehiclePositionsIncremental,
  getVehiclePositionsForSelectedDay,
  subscribeVehiclesList,
} from "../services/vehiclesService";
import {
  createFleetRouteSync,
  FLEET_ROUTE_REFRESH_INTERVAL_MS,
  type FleetRouteSyncController,
} from "../services/fleetRouteSync";
import { fleetRoutePersistentCache } from "../services/fleetRoutePersistentCache";
import {
  filterRouteRenderJitter,
  filterTrackableRoutePositions,
  samplePositions,
  sanitizePositions,
} from "../utils/vehicleGps";
import {
  splitVisibleRealGpsSegments,
  type HiddenGpsInterval,
} from "../utils/vehicleRouteVisibility";
import {
  appendLiveTrailPoint,
  getRenderableLiveTrail,
} from "../utils/vehicleLiveTrail";
import { getUserThemeClass } from "../../../lib/ui/userTheme";

const ACTIVE_ROUTE_REFRESH_MS = 3_000;
const ROUTE_PAGE_SIZE = 1800;
const ROUTE_MAX_PAGES = 18;
const REAL_ROUTE_RENDER_POINTS = 3000;
const GENERATED_ROUTE_RENDER_POINTS = 5600;
const DEFAULT_CENTER: [number, number] = [44.4268, 26.1025];
const REAL_ROUTE_BOUNDARY_CLEANUP_MS = 20 * 60 * 1000;
const REAL_ROUTE_BOUNDARY_JITTER_DISTANCE_KM = 0.6;
const REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM = 1.2;
const REAL_ROUTE_BOUNDARY_IDLE_SPEED_KMH = 8;
const LIVE_ROUTE_ENDPOINT_MAX_GAP_MS = 60 * 60 * 1000;
const LIVE_ROUTE_ENDPOINT_MIN_DISTANCE_KM = 0.05;
const LIVE_ROUTE_ENDPOINT_MAX_DISTANCE_KM = 25;
const LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM = 0.5;
const LIVE_ROUTE_ENDPOINT_MAX_IMPLIED_SPEED_KMH = 180;
const LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH = 6;
const ROUTE_STOP_ANCHOR_MIN_DISTANCE_KM = 0.25;
const ROUTE_STOP_ANCHOR_MAX_DISTANCE_KM = 15;
const ROUTE_STOP_ANCHOR_CONTEXT_GAP_MS = 90 * 60 * 1000;
const ROUTE_STOP_ANCHOR_CLUSTER_KM = 0.25;
const ROUTE_STOP_ANCHOR_CLUSTER_MS = 15 * 60 * 1000;
const REAL_ROUTE_FALLBACK_MIN_DISTANCE_KM = 0.45;
const REAL_ROUTE_FALLBACK_MIN_AVG_SPEED_KMH = 3;
const REAL_ROUTE_FALLBACK_MIN_ODOMETER_KM = 0.1;

type FleetMapView = {
  center: [number, number];
  zoom: number;
  locked: boolean;
};

const currentIcon = new L.DivIcon({
  className: "vehicle-fleet-map-pin",
  html: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function toLocalDayRange(ts = Date.now()) {
  const start = new Date(ts);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setHours(23, 59, 59, 999);
  return { from: start.getTime(), to: Math.min(end.getTime(), ts), dayEnd: end.getTime() };
}

function formatTime(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isValidCoord(lat: unknown, lng: unknown) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVehicleForFocus(vehicle: VehicleItem, queryText: string) {
  const query = normalizeText(queryText);
  if (!query) return 0;

  const label = normalizeText(
    `${vehicle.plateNumber || ""} ${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.vin || ""} ${vehicle.currentDriverUserName || ""}`
  );
  const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
  let score = 0;

  if (label.includes(query)) score += 100;
  tokens.forEach((token) => {
    if (label.includes(token)) score += 28;
  });
  if (tokens.length > 0 && tokens.every((token) => label.includes(token))) score += 45;

  return score;
}

function getFleetVehicleSortLabel(vehicle: VehicleItem) {
  return normalizeText(
    `${vehicle.plateNumber || ""} ${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.currentDriverUserName || ""} ${vehicle.id}`
  );
}

function compareFleetVehicles(a: VehicleItem, b: VehicleItem) {
  const plateCompare = (a.plateNumber || "").localeCompare(b.plateNumber || "", "ro", {
    numeric: true,
    sensitivity: "base",
  });
  if (plateCompare !== 0) return plateCompare;

  return getFleetVehicleSortLabel(a).localeCompare(getFleetVehicleSortLabel(b), "ro", {
    numeric: true,
    sensitivity: "base",
  });
}

function getAdaptiveFleetRoutePointLimit(baseLimit: number, zoom: number) {
  if (!Number.isFinite(zoom)) return baseLimit;

  const minimum = 520;
  const ratio =
    zoom >= 17
      ? 1
      : zoom >= 15
        ? 0.82
        : zoom >= 13
          ? 0.62
          : 0.42;

  return Math.max(minimum, Math.min(baseLimit, Math.round(baseLimit * ratio)));
}

function getFleetMapViewStorageKey(vehicleId: string) {
  return `wc_vehicle_fleet_map_view:${vehicleId}`;
}

function readFleetMapView(vehicleId: string): FleetMapView | null {
  if (!vehicleId || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getFleetMapViewStorageKey(vehicleId));
    if (!raw) return null;

    const data = JSON.parse(raw) as Partial<FleetMapView>;
    const center = Array.isArray(data.center) ? data.center : [];
    const lat = Number(center[0]);
    const lng = Number(center[1]);
    const zoom = Number(data.zoom);

    if (!isValidCoord(lat, lng) || !Number.isFinite(zoom)) return null;

    return {
      center: [lat, lng],
      zoom: Math.max(3, Math.min(20, zoom)),
      locked: data.locked !== false,
    };
  } catch (error) {
    console.warn("[VehicleGpsMapsPage][readFleetMapView]", error);
    return null;
  }
}

function saveFleetMapView(vehicleId: string, view: FleetMapView) {
  if (!vehicleId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getFleetMapViewStorageKey(vehicleId),
      JSON.stringify(view)
    );
  } catch (error) {
    console.warn("[VehicleGpsMapsPage][saveFleetMapView]", error);
  }
}

function gpsSnapshotToPosition(vehicle: VehicleItem): VehiclePositionItem | null {
  const snapshot = vehicle.gpsSnapshot;
  if (!snapshot || !isValidCoord(snapshot.lat, snapshot.lng)) return null;

  return {
    id: `fleet-snapshot-${vehicle.id}-${snapshot.gpsTimestamp}`,
    vehicleId: vehicle.id,
    imei: snapshot.imei || vehicle.tracker?.imei || vehicle.id,
    lat: snapshot.lat,
    lng: snapshot.lng,
    speedKmh: snapshot.speedKmh || 0,
    altitude: snapshot.altitude,
    angle: snapshot.angle,
    satellites: snapshot.satellites,
    gpsTimestamp: snapshot.gpsTimestamp,
    serverTimestamp: snapshot.serverTimestamp,
    ignitionOn: snapshot.ignitionOn,
    odometerKm: snapshot.odometerKm,
    eventIoId: 0,
  };
}

function getRouteTotalDurationMs(vehicle: VehicleItem) {
  const route = vehicle.gpsSim;
  if (!route) return 0;

  return (
    route.totalDurationMs ||
    Math.max(0, (route.points?.[route.points.length - 1]?.ts || 0) - (route.startedAt || 0))
  );
}

function getRouteElapsedMs(vehicle: VehicleItem, now: number) {
  const route = vehicle.gpsSim;
  if (!route || route.active === false) return 0;

  const totalMs = getRouteTotalDurationMs(vehicle);
  const baseElapsed = route.elapsedBeforePauseMs || 0;
  if (route.status === "paused") {
    return Math.min(baseElapsed, totalMs || baseElapsed);
  }

  const resumedAt = route.resumedAt || route.startedAt || now;
  return Math.min(
    baseElapsed + Math.max(0, now - resumedAt),
    totalMs || Number.MAX_SAFE_INTEGER
  );
}

function mapGpsRoutePoints(
  vehicle: VehicleItem,
  now: number,
  mode: "visible" | "full"
): VehiclePositionItem[] {
  const route = vehicle.gpsSim;
  if (!route || route.active === false || !route.points?.length) return [];

  const startedAt = route.startedAt || route.points[0]?.ts || now;
  const elapsedMs = getRouteElapsedMs(vehicle, now);
  const cutoffTs = startedAt + elapsedMs;
  const totalMs = getRouteTotalDurationMs(vehicle);
  const done = totalMs > 0 && elapsedMs >= totalMs;
  const displayImei = vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id;
  const sourcePoints =
    mode === "full"
      ? route.points
      : route.points.filter((point) => done || (point.ts || 0) <= cutoffTs);

  const points = sourcePoints.map((point, index) => ({
    id: `fleet-route-${vehicle.id}-${route.startedAt || startedAt}-${index}`,
    vehicleId: vehicle.id,
    imei: displayImei,
      lat: point.lat,
      lng: point.lng,
      speedKmh: point.speedKmh || 0,
      altitude: 120,
      angle: point.angle,
      satellites: 8,
      gpsTimestamp: point.ts || startedAt,
      serverTimestamp: point.ts || startedAt,
      ignitionOn: point.ignitionOn,
      odometerKm: point.odometerKm,
      eventIoId: 0,
    }));

  return sanitizePositions(points.length ? points : []);
}

function mapSavedRouteSegments(vehicle: VehicleItem, fromTs: number, toTs: number) {
  const displayImei = vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id;

  return (vehicle.gpsSimHistory ?? [])
    .map((route, routeIndex) =>
      sanitizePositions(
        (route.points ?? [])
          .map((point, pointIndex) => ({
            id: `fleet-saved-${vehicle.id}-${route.id || route.startedAt || routeIndex}-${pointIndex}`,
            vehicleId: vehicle.id,
            imei: displayImei,
            lat: point.lat,
            lng: point.lng,
            speedKmh: point.speedKmh || 0,
            altitude: 120,
            angle: point.angle,
            satellites: 8,
            gpsTimestamp: point.ts || route.startedAt || 0,
            serverTimestamp: point.ts || route.startedAt || 0,
            ignitionOn: point.ignitionOn,
            odometerKm: point.odometerKm,
            eventIoId: 0,
          }))
          .filter((point) => point.gpsTimestamp >= fromTs && point.gpsTimestamp <= toTs)
      )
    )
    .filter((segment) => segment.length > 0);
}

function getHiddenIntervals(vehicle: VehicleItem, now: number) {
  const intervals: HiddenGpsInterval[] = [];

  for (const route of vehicle.gpsSimHistory ?? []) {
    const points = route.points ?? [];
    const firstTs = route.startedAt || points[0]?.ts || 0;
    const lastTs = route.stoppedAt || points[points.length - 1]?.ts || 0;
    if (firstTs > 0 && lastTs > firstTs) {
      intervals.push({ startTs: firstTs, endTs: lastTs });
    }
  }

  if (vehicle.gpsSim && vehicle.gpsSim.active !== false && vehicle.gpsSim.points?.length) {
    const startTs = vehicle.gpsSim.startedAt || vehicle.gpsSim.points[0]?.ts || 0;
    const totalMs = getRouteTotalDurationMs(vehicle);
    const endTs = Math.max(
      now + 24 * 60 * 60 * 1000,
      startTs + Math.max(totalMs, 24 * 60 * 60 * 1000)
    );
    if (startTs > 0 && endTs > startTs) {
      intervals.push({ startTs, endTs });
    }
  }

  return intervals;
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

function getRouteSegmentOdometerDeltaKm(segment: VehiclePositionItem[]) {
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (!first || !last) return 0;
  return getRouteOdometerDeltaKm(first, last);
}

function getRouteSegmentMaxSpeedKmh(segment: VehiclePositionItem[]) {
  return segment.reduce(
    (maxSpeed, point) =>
      Math.max(maxSpeed, Number.isFinite(point.speedKmh) ? Number(point.speedKmh) : 0),
    0
  );
}

function shouldRenderFallbackRealRouteSegment(segment: VehiclePositionItem[]) {
  if (segment.length <= 1) return false;

  const rawDistanceKm = getRouteSegmentRawDistanceKm(segment);
  if (rawDistanceKm < REAL_ROUTE_FALLBACK_MIN_DISTANCE_KM) return false;

  const durationHours = getRouteSegmentDurationMs(segment) / 3_600_000;
  const averageSpeedKmh = durationHours > 0 ? rawDistanceKm / durationHours : 0;
  const odometerDeltaKm = getRouteSegmentOdometerDeltaKm(segment);
  const maxSpeedKmh = getRouteSegmentMaxSpeedKmh(segment);

  return (
    odometerDeltaKm >= REAL_ROUTE_FALLBACK_MIN_ODOMETER_KM ||
    maxSpeedKmh >= LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH ||
    averageSpeedKmh >= REAL_ROUTE_FALLBACK_MIN_AVG_SPEED_KMH
  );
}

function shouldPreferFallbackRealRouteSegment(
  cleanSegment: VehiclePositionItem[],
  renderedSegment: VehiclePositionItem[]
) {
  if (!shouldRenderFallbackRealRouteSegment(cleanSegment)) return false;
  if (renderedSegment.length <= 1) return true;

  const cleanDistanceKm = getRouteSegmentRawDistanceKm(cleanSegment);
  const renderedDistanceKm = getRouteSegmentRawDistanceKm(renderedSegment);
  const missingDistanceKm = cleanDistanceKm - renderedDistanceKm;

  return missingDistanceKm >= 0.35 && cleanDistanceKm >= renderedDistanceKm * 1.18;
}

function isRouteSegmentNearHiddenBoundary(
  segment: VehiclePositionItem[],
  intervals: HiddenGpsInterval[]
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

function filterBoundaryRealRouteSegments(
  segments: VehiclePositionItem[][],
  intervals: HiddenGpsInterval[]
) {
  if (!segments.length || !intervals.length) return segments;

  return segments.filter((segment) => {
    if (segment.length <= 1) return false;
    if (!isRouteSegmentNearHiddenBoundary(segment, intervals)) return true;

    const rawDistanceKm = getRouteSegmentRawDistanceKm(segment);
    const durationMs = getRouteSegmentDurationMs(segment);
    const maxSpeedKmh = getRouteSegmentMaxSpeedKmh(segment);
    const looksLikeBoundaryNoise =
      rawDistanceKm <= REAL_ROUTE_BOUNDARY_JITTER_DISTANCE_KM ||
      (rawDistanceKm <= REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM &&
        maxSpeedKmh <= REAL_ROUTE_BOUNDARY_IDLE_SPEED_KMH) ||
      (rawDistanceKm <= REAL_ROUTE_BOUNDARY_IDLE_DISTANCE_KM &&
        durationMs <= 2 * 60 * 1000);

    return !looksLikeBoundaryNoise;
  });
}

function splitVisibleRealRouteSegments(
  positions: VehiclePositionItem[],
  intervals: HiddenGpsInterval[]
) {
  return filterBoundaryRealRouteSegments(
    splitVisibleRealGpsSegments(positions, intervals),
    intervals
  );
}

function getRoutePointSpeedKmh(point: VehiclePositionItem) {
  return Number.isFinite(point.speedKmh) ? Number(point.speedKmh) : 0;
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
  if (!isValidCoord(endpoint.lat, endpoint.lng)) return false;
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
    endpoint.ignitionOn === true || getRoutePointSpeedKmh(endpoint) >= LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH;
  const lastLooksMoving =
    last.ignitionOn === true || getRoutePointSpeedKmh(last) >= LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH;
  const existingRouteLooksReal =
    getRouteSegmentRawDistanceKm(segment) >= LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM ||
    getRouteSegmentMaxSpeedKmh(segment) >= LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH;

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
  const clean = sanitizePositions(rawSegment);
  const trackable = sanitizePositions(trackableSegment);
  if (clean.length <= 1 || trackable.length <= 1) return trackable;

  const existingRouteLooksReal =
    getRouteSegmentRawDistanceKm(trackable) >= LIVE_ROUTE_ENDPOINT_MIN_EXISTING_ROUTE_KM ||
    getRouteSegmentMaxSpeedKmh(trackable) >= LIVE_ROUTE_ENDPOINT_MOVING_SPEED_KMH;
  if (!existingRouteLooksReal) return trackable;

  const anchors: VehiclePositionItem[] = [];
  for (const point of clean) {
    const looksLikeStop =
      point.ignitionOn === false || getRoutePointSpeedKmh(point) <= REAL_ROUTE_BOUNDARY_IDLE_SPEED_KMH;
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

  return anchors.length ? sanitizePositions([...trackable, ...anchors]) : trackable;
}

function buildRenderableRealRouteSegment(
  rawSegment: VehiclePositionItem[],
  maxPoints: number
) {
  const clean = sanitizePositions(rawSegment);
  const movingOnly = filterRouteRenderJitter(filterTrackableRoutePositions(clean));
  const anchored = withRealStopAnchorsForRender(clean, movingOnly);
  if (shouldPreferFallbackRealRouteSegment(clean, anchored)) {
    const fallback = filterRouteRenderJitter(clean);
    return samplePositions(fallback.length > 1 ? fallback : clean, maxPoints);
  }
  return samplePositions(anchored, maxPoints);
}

function FitFleetMap({
  points,
  preserveUserView,
}: {
  points: VehiclePositionItem[];
  preserveUserView: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 0);

    if (preserveUserView) return;

    if (!points.length) {
      map.setView(DEFAULT_CENTER, 11);
      return;
    }

    if (points.length === 1) {
      map.setView([points[0]!.lat, points[0]!.lng], 15);
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 16, animate: false });
    }
  }, [map, points, preserveUserView]);

  return null;
}

function RememberFleetMapView({
  vehicleId,
  onViewChange,
}: {
  vehicleId: string;
  onViewChange: (view: FleetMapView) => void;
}) {
  const map = useMapEvents({});

  useEffect(() => {
    let userInteractionPending = false;
    const container = map.getContainer();

    const markUserInteraction = () => {
      userInteractionPending = true;
    };

    const markZoomControlInteraction = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".leaflet-control-zoom")
      ) {
        markUserInteraction();
      }
    };

    const rememberView = () => {
      if (!userInteractionPending) return;
      userInteractionPending = false;

      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!isValidCoord(center.lat, center.lng) || !Number.isFinite(zoom)) return;

      const nextView: FleetMapView = {
        center: [center.lat, center.lng],
        zoom,
        locked: true,
      };

      saveFleetMapView(vehicleId, nextView);
      onViewChange(nextView);
    };

    container.addEventListener("wheel", markUserInteraction, { passive: true, capture: true });
    container.addEventListener("mousedown", markUserInteraction, { passive: true, capture: true });
    container.addEventListener("touchstart", markUserInteraction, { passive: true, capture: true });
    container.addEventListener("dblclick", markUserInteraction, { passive: true, capture: true });
    container.addEventListener("keydown", markUserInteraction, { passive: true, capture: true });
    container.addEventListener("click", markZoomControlInteraction, true);
    map.on("moveend", rememberView);
    map.on("zoomend", rememberView);

    return () => {
      container.removeEventListener("wheel", markUserInteraction, true);
      container.removeEventListener("mousedown", markUserInteraction, true);
      container.removeEventListener("touchstart", markUserInteraction, true);
      container.removeEventListener("dblclick", markUserInteraction, true);
      container.removeEventListener("keydown", markUserInteraction, true);
      container.removeEventListener("click", markZoomControlInteraction, true);
      map.off("moveend", rememberView);
      map.off("zoomend", rememberView);
    };
  }, [map, onViewChange, vehicleId]);

  return null;
}

type FleetRefreshCommand = {
  id: number;
  forceFull: boolean;
};

function VehicleFleetMapCard({
  vehicle,
  focused = false,
  scopeKey,
  refreshCommand,
}: {
  vehicle: VehicleItem;
  focused?: boolean;
  scopeKey: string;
  refreshCommand: FleetRefreshCommand;
}) {
  const [routePositions, setRoutePositions] = useState<VehiclePositionItem[]>([]);
  const [liveRealTrail, setLiveRealTrail] = useState<VehiclePositionItem[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [storedMapView, setStoredMapView] = useState<FleetMapView | null>(() =>
    readFleetMapView(vehicle.id)
  );
  const routeSyncRef = useRef<FleetRouteSyncController | null>(null);
  const handledRefreshCommandRef = useRef(0);
  const hasPersistedRoute = Boolean(vehicle.gpsSim && vehicle.gpsSim.active !== false && vehicle.gpsSim.points?.length);
  const activeRoute = hasPersistedRoute;
  const { from, to, dayEnd } = useMemo(() => toLocalDayRange(now), [now]);
  const mapZoom = storedMapView?.zoom ?? 13;
  const realRouteRenderPointLimit = useMemo(
    () => getAdaptiveFleetRoutePointLimit(REAL_ROUTE_RENDER_POINTS, mapZoom),
    [mapZoom]
  );
  const generatedRouteRenderPointLimit = useMemo(
    () => getAdaptiveFleetRoutePointLimit(GENERATED_ROUTE_RENDER_POINTS, mapZoom),
    [mapZoom]
  );

  useEffect(() => {
    const controller = createFleetRouteSync({
      scopeKey,
      vehicleId: vehicle.id,
      source: "real",
      fromTs: from,
      toTs: dayEnd,
      refreshMs: FLEET_ROUTE_REFRESH_INTERVAL_MS,
      pageSize: ROUTE_PAGE_SIZE,
      maxPages: ROUTE_MAX_PAGES,
      persistentCache: fleetRoutePersistentCache,
      loader: ({ vehicleId, fromTs, toTs, pageSize, maxPages, mode }) =>
        mode === "full"
          ? getVehiclePositionsForSelectedDay(vehicleId, fromTs, toTs, pageSize, maxPages)
          : getVehiclePositionsIncremental(vehicleId, fromTs, toTs, pageSize, maxPages),
      onData: (items) => setRoutePositions(sanitizePositions(items)),
      onLoading: setLoadingRoute,
      onError: (error) => console.error("[VehicleGpsMapsPage][route-sync]", error),
    });
    routeSyncRef.current = controller;
    void controller.start();

    return () => {
      controller.stop();
      if (routeSyncRef.current === controller) routeSyncRef.current = null;
    };
  }, [dayEnd, from, scopeKey, vehicle.id]);

  useEffect(() => {
    if (!refreshCommand.id || handledRefreshCommandRef.current === refreshCommand.id) return;
    handledRefreshCommandRef.current = refreshCommand.id;
    void routeSyncRef.current?.refresh(refreshCommand.forceFull);
  }, [refreshCommand]);

  useEffect(() => {
    setLiveRealTrail((current) => (current.length ? [] : current));
  }, [from, vehicle.id]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now()),
      activeRoute ? ACTIVE_ROUTE_REFRESH_MS : FLEET_ROUTE_REFRESH_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeRoute]);

  const activeRouteVisiblePositions = useMemo(
    () => (activeRoute ? mapGpsRoutePoints(vehicle, now, "visible") : []),
    [activeRoute, now, vehicle]
  );
  const activeRouteFullPositions = useMemo(
    () => (activeRoute ? mapGpsRoutePoints(vehicle, now, "full") : []),
    [activeRoute, now, vehicle]
  );
  const savedRouteSegments = useMemo(
    () => mapSavedRouteSegments(vehicle, from, to),
    [from, to, vehicle]
  );
  const hiddenIntervals = useMemo(() => getHiddenIntervals(vehicle, now), [now, vehicle]);
  const realRouteSegments = useMemo(
    () => splitVisibleRealRouteSegments(routePositions, hiddenIntervals),
    [hiddenIntervals, routePositions]
  );
  const snapshotPosition = useMemo(() => gpsSnapshotToPosition(vehicle), [
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
    if (activeRoute) {
      setLiveRealTrail((current) => (current.length ? [] : current));
      return;
    }

    if (
      !snapshotPosition ||
      snapshotPosition.gpsTimestamp < from ||
      snapshotPosition.gpsTimestamp > to
    ) {
      return;
    }

    setLiveRealTrail((current) =>
      appendLiveTrailPoint(current, snapshotPosition)
    );
  }, [activeRoute, from, snapshotPosition, to]);

  const stabilizedSnapshotPosition = useMemo(() => {
    if (!snapshotPosition || activeRoute) return snapshotPosition;

    const stabilizationSource = sanitizePositions([...routePositions, snapshotPosition]);
    const stabilizedRoute = filterRouteRenderJitter(stabilizationSource);
    const trackableRoute = filterTrackableRoutePositions(stabilizationSource);
    const latestTrackable = trackableRoute[trackableRoute.length - 1];
    const latestLooksMoving =
      snapshotPosition.ignitionOn === true ||
      (snapshotPosition.ignitionOn !== false && (snapshotPosition.speedKmh ?? 0) >= 10);

    if (latestLooksMoving && latestTrackable?.gpsTimestamp === snapshotPosition.gpsTimestamp) {
      return snapshotPosition;
    }

    return stabilizedRoute[stabilizedRoute.length - 1] ?? latestTrackable ?? snapshotPosition;
  }, [activeRoute, routePositions, snapshotPosition]);
  const currentPosition = activeRoute
    ? activeRouteVisiblePositions[activeRouteVisiblePositions.length - 1] ??
      activeRouteFullPositions[0] ??
      stabilizedSnapshotPosition
    : stabilizedSnapshotPosition;
  const realRouteRenderSegments = useMemo(
    () =>
      appendLiveEndpointToLastRouteSegment(
        realRouteSegments
          .map((segment) =>
            buildRenderableRealRouteSegment(segment, realRouteRenderPointLimit)
          ),
        !activeRoute &&
          currentPosition &&
          currentPosition.gpsTimestamp >= from &&
          currentPosition.gpsTimestamp <= to
          ? currentPosition
          : null
      ),
    [activeRoute, currentPosition, from, realRouteRenderPointLimit, realRouteSegments, to]
  );
  const liveRealRouteRenderSegment = useMemo(
    () =>
      activeRoute
        ? []
        : getRenderableLiveTrail(
            liveRealTrail.filter((point) => point.gpsTimestamp >= from && point.gpsTimestamp <= to),
            realRouteRenderPointLimit
          ),
    [activeRoute, from, liveRealTrail, realRouteRenderPointLimit, to]
  );
  const savedRouteRenderSegments = useMemo(
    () =>
      savedRouteSegments
        .map((segment) => samplePositions(segment, generatedRouteRenderPointLimit))
        .filter((segment) => segment.length > 1),
    [generatedRouteRenderPointLimit, savedRouteSegments]
  );
  const activeRouteRenderPositions = useMemo(
    () => samplePositions(activeRouteVisiblePositions, generatedRouteRenderPointLimit),
    [activeRouteVisiblePositions, generatedRouteRenderPointLimit]
  );
  const routePolylines = useMemo(
    () =>
      [
        ...realRouteRenderSegments.map((positions, index) => ({
          id: `real-${index}`,
          positions,
          opacity: 1,
        })),
        ...(liveRealRouteRenderSegment.length > 1
          ? [{ id: "real-live", positions: liveRealRouteRenderSegment, opacity: 1 }]
          : []),
        ...savedRouteRenderSegments.map((positions, index) => ({
          id: `saved-${index}`,
          positions,
          opacity: 0.92,
        })),
        {
          id: "active",
          positions: activeRouteRenderPositions,
          opacity: 1,
        },
      ]
        .filter((line) => line.positions.length > 1)
        .map((line) => ({
          ...line,
          latLngs: line.positions.map((point) => [point.lat, point.lng] as [number, number]),
          pathOptions: {
            color: "#2563eb",
            weight: mapZoom >= 16 ? 4.5 : 4,
            opacity: line.opacity,
            smoothFactor: mapZoom >= 16 ? 0.3 : 0.7,
          },
        })),
    [
      activeRouteRenderPositions,
      liveRealRouteRenderSegment,
      mapZoom,
      realRouteRenderSegments,
      savedRouteRenderSegments,
    ]
  );
  const routeBoundsPoints = useMemo(
    () =>
      sanitizePositions([
        ...realRouteRenderSegments.flat(),
        ...liveRealRouteRenderSegment,
        ...savedRouteRenderSegments.flat(),
        ...activeRouteRenderPositions,
      ]),
    [
      activeRouteRenderPositions,
      liveRealRouteRenderSegment,
      realRouteRenderSegments,
      savedRouteRenderSegments,
    ]
  );
  const mapPoints = useMemo(
    () => sanitizePositions([...routeBoundsPoints, ...(currentPosition ? [currentPosition] : [])]),
    [currentPosition, routeBoundsPoints]
  );
  const mapCenter = currentPosition
    ? ([currentPosition.lat, currentPosition.lng] as [number, number])
    : DEFAULT_CENTER;
  const initialMapCenter = storedMapView?.center ?? mapCenter;
  const initialMapZoom = storedMapView?.zoom ?? 13;
  const lastSeenAt =
    currentPosition?.gpsTimestamp || vehicle.tracker?.lastSeenAt || vehicle.gpsSnapshot?.serverTimestamp;

  return (
    <article
      id={`vehicle-fleet-map-card-${vehicle.id}`}
      className={`vehicle-fleet-map-card user-accent-card ${getUserThemeClass(vehicle.currentDriverThemeKey || vehicle.ownerThemeKey)} ${focused ? "is-assistant-focused" : ""}`}
    >
      <div className="vehicle-fleet-map-card__head">
        <div>
          <Link to={`/vehicles/${vehicle.id}`} className="vehicle-fleet-map-card__plate">
            {vehicle.plateNumber || "Fara numar"}
          </Link>
          <div className="vehicle-fleet-map-card__driver">
            <span>Sofer curent:</span>{" "}
            <UserProfileLink
              userId={vehicle.currentDriverUserId}
              name={vehicle.currentDriverUserName}
              themeKey={vehicle.currentDriverThemeKey}
              fallback="-"
              className="user-profile-link--plain"
            />
          </div>
        </div>
        <div className="vehicle-fleet-map-card__status">
          {vehicle.gpsSnapshot?.online ? "Online" : "GPS"}
        </div>
      </div>

      <div className="vehicle-fleet-map-card__mapWrap">
        {mapPoints.length ? (
          <MapContainer
            center={initialMapCenter}
            zoom={initialMapZoom}
            scrollWheelZoom={false}
            preferCanvas
            zoomAnimation={false}
            fadeAnimation={false}
            markerZoomAnimation={false}
            className="vehicle-fleet-map-card__map"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors &copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              updateWhenIdle
              updateWhenZooming={false}
              keepBuffer={1}
            />
            <FitFleetMap points={mapPoints} preserveUserView={Boolean(storedMapView?.locked)} />
            <RememberFleetMapView vehicleId={vehicle.id} onViewChange={setStoredMapView} />
            {routePolylines.map((line) => (
              <Polyline
                key={line.id}
                positions={line.latLngs}
                pathOptions={line.pathOptions}
                interactive={false}
              />
            ))}
            {currentPosition ? (
              <Marker position={[currentPosition.lat, currentPosition.lng]} icon={currentIcon}>
                <Popup>
                  {vehicle.plateNumber}
                  <br />
                  {formatTime(currentPosition.gpsTimestamp)}
                </Popup>
              </Marker>
            ) : null}
          </MapContainer>
        ) : (
          <div className="vehicle-fleet-map-card__empty">
            <MapPinned size={22} />
            <span>{loadingRoute ? "Se incarca harta GPS..." : "Nu exista pozitie GPS."}</span>
          </div>
        )}
      </div>

      <div className="vehicle-fleet-map-card__foot">
        <span>{[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-"}</span>
        <span>Ultim GPS: {formatTime(lastSeenAt)}</span>
      </div>
    </article>
  );
}

export default function VehicleGpsMapsPage() {
  const { role, user } = useAuth();
  const location = useLocation();
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const focusScrollKeyRef = useRef("");
  const vehicleOrderRef = useRef<Map<string, number>>(new Map());
  const nextVehicleOrderRef = useRef(0);
  const [refreshCommand, setRefreshCommand] = useState<FleetRefreshCommand>({
    id: 0,
    forceFull: false,
  });
  const routeCacheScopeKey = user?.uid || "anonymous";

  function keepFleetOrderStable(items: VehicleItem[]) {
    const orderedItems = [...items].sort(compareFleetVehicles);
    const liveIds = new Set(orderedItems.map((vehicle) => vehicle.id));

    vehicleOrderRef.current.forEach((_, vehicleId) => {
      if (!liveIds.has(vehicleId)) {
        vehicleOrderRef.current.delete(vehicleId);
      }
    });

    orderedItems.forEach((vehicle) => {
      if (!vehicleOrderRef.current.has(vehicle.id)) {
        vehicleOrderRef.current.set(vehicle.id, nextVehicleOrderRef.current);
        nextVehicleOrderRef.current += 1;
      }
    });

    return orderedItems.sort(
      (a, b) =>
        (vehicleOrderRef.current.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (vehicleOrderRef.current.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  const focusParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedFocusVehicleId = focusParams.get("focusVehicleId") || "";
  const requestedFocusQuery = focusParams.get("assistantVehicle") || "";
  const focusedVehicleId = useMemo(() => {
    if (requestedFocusVehicleId) return requestedFocusVehicleId;
    if (!requestedFocusQuery) return "";

    return (
      vehicles
        .map((vehicle) => ({ vehicle, score: scoreVehicleForFocus(vehicle, requestedFocusQuery) }))
        .filter((entry) => entry.score >= 25)
        .sort((a, b) => b.score - a.score)[0]?.vehicle.id || ""
    );
  }, [requestedFocusQuery, requestedFocusVehicleId, vehicles]);

  const filteredVehicles = vehicles;

  useEffect(() => {
    const unsubscribe = subscribeVehiclesList((items) => {
      setVehicles(keepFleetOrderStable(items ?? []));
      setLoading(false);
    }, { includeGpsSimulation: true });

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error("[VehicleGpsMapsPage][unsubscribe]", error);
      }
    };
  }, []);

  useEffect(() => {
    if (loading || !focusedVehicleId) return;

    const key = `${location.search}:${focusedVehicleId}:${vehicles.length}`;
    if (focusScrollKeyRef.current === key) return;
    focusScrollKeyRef.current = key;

    window.setTimeout(() => {
      const target = document.getElementById(`vehicle-fleet-map-card-${focusedVehicleId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 220);
  }, [focusedVehicleId, loading, location.search, vehicles.length]);

  return (
    <section className="page-section vehicle-gps-map-page">
      <ProductPageHeader
        eyebrow="Flotă live"
        title="Toate GPS-urile"
        description={loading ? "Se încarcă pozițiile..." : `${filteredVehicles.length} din ${vehicles.length} vehicule afișate`}
        actions={[
          { id: "refresh", label: "Actualizează", icon: RefreshCw, onClick: () => setRefreshCommand((current) => ({ id: current.id + 1, forceFull: false })), assistantAction: "refresh-gps-routes" },
          { id: "vehicles", label: "Lista mașini", icon: ArrowLeft, to: "/vehicles", assistantAction: "open-vehicles" },
        ]}
      />

      <ProductTabs
        activeId="map"
        tabs={[
          { id: "list", label: "Listă flotă", to: "/vehicles", icon: List },
          { id: "map", label: "Hartă GPS", to: "/vehicles/gps-map", icon: MapPinned },
        ]}
      />

      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Lista harta GPS</h2>
            <p className="tools-subtitle">
              {loading ? "Se incarca..." : `${filteredVehicles.length} masini`}
            </p>
          </div>
          <div className="tools-header-actions">
            {role === "admin" ? (
              <button
                className="secondary-btn"
                type="button"
                title="Reîncarcă integral traseele doar pentru verificare tehnică"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Reîncărcarea completă consumă multe citiri Firestore. Continui doar pentru diagnostic?"
                    )
                  ) {
                    return;
                  }
                  setRefreshCommand((current) => ({ id: current.id + 1, forceFull: true }));
                }}
              >
                <RotateCcw size={15} /> Reîncarcă complet
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="vehicle-fleet-map-grid">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="vehicle-fleet-map-card">
                <div className="skeleton" style={{ height: 28, width: "45%" }} />
                <div className="skeleton" style={{ height: 260, width: "100%", marginTop: 12 }} />
              </div>
            ))}
          </div>
        ) : filteredVehicles.length ? (
          <div className="vehicle-fleet-map-grid">
            {filteredVehicles.map((vehicle) => (
              <VehicleFleetMapCard
                key={vehicle.id}
                vehicle={vehicle}
                focused={vehicle.id === focusedVehicleId}
                scopeKey={routeCacheScopeKey}
                refreshCommand={refreshCommand}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <CarFront size={22} strokeWidth={1.6} />
            </div>
            <div className="empty-state-title">Nu exista masini adaugate</div>
          </div>
        )}
      </div>
    </section>
  );
}
