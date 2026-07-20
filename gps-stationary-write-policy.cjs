const EARTH_RADIUS_METERS = 6_371_000;
const MOVING_SPEED_THRESHOLD_KMH = 5;
const SLOW_MOVEMENT_MIN_SPEED_KMH = 0.5;
const SLOW_MOVEMENT_DISTANCE_METERS = 20;
const MOVING_POINT_INTERVAL_MS = 3_000;
const MOVING_POINT_DISTANCE_METERS = 8;
const IGNITION_ON_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;
const IGNITION_OFF_SNAPSHOT_INTERVAL_MS = 20 * 60 * 1000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceMetersBetweenRecords(left, right) {
  if (!left || !right) return 0;
  const leftLat = Number(left.lat);
  const leftLng = Number(left.lng);
  const rightLat = Number(right.lat);
  const rightLng = Number(right.lng);
  if (![leftLat, leftLng, rightLat, rightLng].every(Number.isFinite)) return 0;

  const dLat = toRadians(rightLat - leftLat);
  const dLng = toRadians(rightLng - leftLng);
  const lat1 = toRadians(leftLat);
  const lat2 = toRadians(rightLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getRecordIgnition(record) {
  const value = record?.io?.[239];
  if (typeof value !== 'number') return null;
  return value === 1;
}

function isImportantGpsEvent(record) {
  return Number(record?.eventIoId || 0) > 0;
}

function isRecordMoving(lastSaved, record) {
  const speedKmh = Math.max(0, Number(record?.speedKmh || 0));
  if (speedKmh >= MOVING_SPEED_THRESHOLD_KMH) return true;

  const ignitionOn = getRecordIgnition(record);
  const movedMeters = distanceMetersBetweenRecords(lastSaved, record);
  return ignitionOn !== false &&
    speedKmh >= SLOW_MOVEMENT_MIN_SPEED_KMH &&
    movedMeters >= SLOW_MOVEMENT_DISTANCE_METERS;
}

function evaluateRealPositionRetention(state, record) {
  const lastSaved = state?.lastSaved || null;
  const lastObserved = state?.lastObserved || null;
  const previousMoving = typeof state?.lastMoving === 'boolean' ? state.lastMoving : null;
  const moving = isRecordMoving(lastSaved, record);
  const ignitionOn = getRecordIgnition(record);
  const previousIgnition = getRecordIgnition(lastObserved);
  const ignitionChanged =
    previousIgnition !== null && ignitionOn !== null && previousIgnition !== ignitionOn;
  const importantEvent = isImportantGpsEvent(record);
  const motionChanged = previousMoving !== null && previousMoving !== moving;

  if (!lastSaved) {
    return { keep: true, moving, ignitionOn, ignitionChanged, importantEvent, motionChanged };
  }

  const deltaMs = Number(record?.gpsTimestamp || 0) - Number(lastSaved.gpsTimestamp || 0);
  if (deltaMs <= 0) {
    return { keep: false, moving, ignitionOn, ignitionChanged, importantEvent, motionChanged };
  }

  if (ignitionChanged || importantEvent || motionChanged) {
    return { keep: true, moving, ignitionOn, ignitionChanged, importantEvent, motionChanged };
  }

  if (!moving) {
    return { keep: false, moving, ignitionOn, ignitionChanged, importantEvent, motionChanged };
  }

  const movedMeters = distanceMetersBetweenRecords(lastSaved, record);
  const keep = deltaMs >= MOVING_POINT_INTERVAL_MS || movedMeters >= MOVING_POINT_DISTANCE_METERS;
  return { keep, moving, ignitionOn, ignitionChanged, importantEvent, motionChanged };
}

function advanceRealPositionRetentionState(state, record, decision) {
  return {
    lastSaved: decision.keep ? record : state?.lastSaved || null,
    lastObserved: record,
    lastMoving: decision.moving,
  };
}

function shouldWriteLiveSnapshot24h({
  lastWriteAt,
  now,
  moving,
  ignitionOn,
  immediate,
  currentKmIncrement,
}) {
  if (immediate || moving || Number(currentKmIncrement || 0) > 0) return true;
  const previousWriteAt = Math.max(0, Number(lastWriteAt || 0));
  if (previousWriteAt === 0) return true;
  const intervalMs = ignitionOn === true
    ? IGNITION_ON_SNAPSHOT_INTERVAL_MS
    : IGNITION_OFF_SNAPSHOT_INTERVAL_MS;
  return Number(now || 0) - previousWriteAt >= intervalMs;
}

module.exports = {
  IGNITION_OFF_SNAPSHOT_INTERVAL_MS,
  IGNITION_ON_SNAPSHOT_INTERVAL_MS,
  advanceRealPositionRetentionState,
  distanceMetersBetweenRecords,
  evaluateRealPositionRetention,
  getRecordIgnition,
  isRecordMoving,
  shouldWriteLiveSnapshot24h,
};
