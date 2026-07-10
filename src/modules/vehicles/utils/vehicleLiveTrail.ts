import type { VehiclePositionItem } from "../../../types/vehicle";
import { samplePositions, sanitizePositions } from "./vehicleGps";

const DEFAULT_MAX_POINTS = 90;
const TRAIL_MAX_GAP_MS = 15 * 60 * 1000;
const TRAIL_MIN_STEP_KM = 0.01;
const TRAIL_MAX_STEP_KM = 10;
const TRAIL_MIN_DRAW_DISTANCE_KM = 0.05;
const TRAIL_MIN_DRAW_SPEED_KMH = 4;
const TRAIL_MAX_IMPLIED_SPEED_KMH = 220;
const TRAIL_MIN_ODOMETER_STEP_KM = 0.02;

function toSafeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function distanceKm(a: VehiclePositionItem, b: VehiclePositionItem) {
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

function odometerDeltaKm(a: VehiclePositionItem, b: VehiclePositionItem) {
  if (
    typeof a.odometerKm !== "number" ||
    typeof b.odometerKm !== "number" ||
    !Number.isFinite(a.odometerKm) ||
    !Number.isFinite(b.odometerKm)
  ) {
    return 0;
  }

  return Math.max(0, b.odometerKm - a.odometerKm);
}

function maxSpeedKmh(points: VehiclePositionItem[]) {
  return points.reduce(
    (max, point) => Math.max(max, toSafeNumber(point.speedKmh)),
    0
  );
}

function totalDistanceKm(points: VehiclePositionItem[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    total += distanceKm(previous, current);
  }
  return total;
}

function totalOdometerDeltaKm(points: VehiclePositionItem[]) {
  const first = points[0];
  const last = points[points.length - 1];
  return first && last ? odometerDeltaKm(first, last) : 0;
}

function shouldAppendPoint(previous: VehiclePositionItem, next: VehiclePositionItem) {
  if (next.gpsTimestamp <= previous.gpsTimestamp) return false;

  const gapMs = next.gpsTimestamp - previous.gpsTimestamp;
  if (gapMs > TRAIL_MAX_GAP_MS) return false;

  const stepKm = distanceKm(previous, next);
  const odoStepKm = odometerDeltaKm(previous, next);
  const movingBySpeed =
    toSafeNumber(previous.speedKmh) >= TRAIL_MIN_DRAW_SPEED_KMH ||
    toSafeNumber(next.speedKmh) >= TRAIL_MIN_DRAW_SPEED_KMH;
  const movingByOdometer = odoStepKm >= TRAIL_MIN_ODOMETER_STEP_KM;
  const movingByContact = previous.ignitionOn === true || next.ignitionOn === true;

  if (
    stepKm < TRAIL_MIN_STEP_KM &&
    !movingByOdometer &&
    !movingBySpeed &&
    !movingByContact
  ) {
    return false;
  }
  if (stepKm > TRAIL_MAX_STEP_KM) return false;

  const impliedSpeedKmh = stepKm / (gapMs / 3_600_000);
  if (!Number.isFinite(impliedSpeedKmh) || impliedSpeedKmh > TRAIL_MAX_IMPLIED_SPEED_KMH) {
    return false;
  }

  return movingBySpeed || movingByOdometer || movingByContact;
}

export function appendLiveTrailPoint(
  trail: VehiclePositionItem[],
  point: VehiclePositionItem | null,
  maxPoints = DEFAULT_MAX_POINTS
) {
  if (!point) return trail;

  const last = trail[trail.length - 1];
  if (!last) return [point];

  if (point.gpsTimestamp <= last.gpsTimestamp) return trail;

  const clean = sanitizePositions(trail);
  const cleanLast = clean[clean.length - 1];
  if (!cleanLast) return [point];
  if (point.gpsTimestamp <= cleanLast.gpsTimestamp) return trail;

  const gapMs = point.gpsTimestamp - cleanLast.gpsTimestamp;
  if (gapMs > TRAIL_MAX_GAP_MS) return [point];

  if (!shouldAppendPoint(cleanLast, point)) {
    return [...clean.slice(0, -1), point].slice(-maxPoints);
  }

  return [...clean, point].slice(-maxPoints);
}

export function getRenderableLiveTrail(
  trail: VehiclePositionItem[],
  maxPoints = DEFAULT_MAX_POINTS
) {
  const clean = sanitizePositions(trail);
  if (clean.length <= 1) return [];

  const first = clean[0];
  const last = clean[clean.length - 1];
  if (!first || !last || last.gpsTimestamp <= first.gpsTimestamp) return [];

  const distance = totalDistanceKm(clean);
  const odometerDelta = totalOdometerDeltaKm(clean);
  const speed = maxSpeedKmh(clean);
  const durationHours = (last.gpsTimestamp - first.gpsTimestamp) / 3_600_000;
  const averageSpeed = durationHours > 0 ? distance / durationHours : 0;
  const drawable =
    distance >= TRAIL_MIN_DRAW_DISTANCE_KM &&
    (speed >= TRAIL_MIN_DRAW_SPEED_KMH ||
      odometerDelta >= TRAIL_MIN_ODOMETER_STEP_KM ||
      averageSpeed >= TRAIL_MIN_DRAW_SPEED_KMH);

  return drawable ? samplePositions(clean, maxPoints) : [];
}
