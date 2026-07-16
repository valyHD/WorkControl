const RUNTIME_ROOT_FLUSH_MIN_SECONDS = 300;
const RUNTIME_ROOT_FLUSH_MAX_SECONDS = 1800;
const RUNTIME_ROOT_FLUSH_DEFAULT_SECONDS = 600;
const DAY_METADATA_MIN_SECONDS = 300;
const DAY_METADATA_MAX_SECONDS = 1800;
const DAY_METADATA_DEFAULT_SECONDS = 600;

function clampSeconds(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  return Math.max(minimum, Math.min(maximum, resolved));
}

function normalizeTrackerSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 100)
  );
}

function normalizeRuntimeLiveConfig(data) {
  const runtime = data?.runtimeLive && typeof data.runtimeLive === "object"
    ? data.runtimeLive
    : {};
  return {
    enabled: runtime.enabled === true || data?.runtimeLiveEnabled === true,
    allTrackers: runtime.allTrackers === true,
    trackerImeis: normalizeTrackerSet(runtime.trackerImeis || data?.runtimeTrackerImeis),
    dualWriteRoot: runtime.dualWriteRoot !== false,
    rootFlushSeconds: clampSeconds(
      runtime.rootFlushSeconds ?? data?.runtimeRootFlushSeconds,
      RUNTIME_ROOT_FLUSH_DEFAULT_SECONDS,
      RUNTIME_ROOT_FLUSH_MIN_SECONDS,
      RUNTIME_ROOT_FLUSH_MAX_SECONDS
    ),
    dayMetadataRefreshSeconds: clampSeconds(
      runtime.dayMetadataRefreshSeconds ?? data?.runtimeDayMetadataRefreshSeconds,
      DAY_METADATA_DEFAULT_SECONDS,
      DAY_METADATA_MIN_SECONDS,
      DAY_METADATA_MAX_SECONDS
    ),
  };
}

function shouldUseRuntimeLive(config, imei) {
  return Boolean(
    config?.enabled && (
      config.allTrackers === true ||
      config.trackerImeis instanceof Set && config.trackerImeis.has(String(imei))
    )
  );
}

function shouldWriteDayMetadata(lastWriteAt, now, refreshSeconds) {
  const last = Number(lastWriteAt || 0);
  const current = Number(now || 0);
  return last <= 0 || current - last >= Number(refreshSeconds || 0) * 1000;
}

function computeConsolidatedMileage(rootCurrentKm, mileageBaseKm, pendingCurrentKm) {
  const root = Number.isFinite(Number(rootCurrentKm)) ? Math.max(0, Number(rootCurrentKm)) : 0;
  const base = Number.isFinite(Number(mileageBaseKm)) ? Math.max(0, Number(mileageBaseKm)) : 0;
  const pending = Number.isFinite(Number(pendingCurrentKm))
    ? Math.max(0, Number(pendingCurrentKm))
    : 0;
  return Number((Math.max(root, base) + pending).toFixed(3));
}

function buildRuntimeRootPayload(vehicleData, runtimeData, now) {
  const tracker = runtimeData?.tracker && typeof runtimeData.tracker === "object"
    ? runtimeData.tracker
    : {};
  const currentKm = computeConsolidatedMileage(
    vehicleData?.currentKm,
    runtimeData?.mileageBaseKm,
    runtimeData?.pendingCurrentKm
  );

  return {
    currentKm,
    ...(runtimeData?.gpsSnapshot ? { gpsSnapshot: runtimeData.gpsSnapshot } : {}),
    ...(runtimeData?.liveDiagnostics ? { liveDiagnostics: runtimeData.liveDiagnostics } : {}),
    ...(runtimeData?.gpsDataUsage ? { gpsDataUsage: runtimeData.gpsDataUsage } : {}),
    "tracker.imei": tracker.imei || "",
    "tracker.lastSeenAt": Number(tracker.lastSeenAt || now),
    "tracker.updatedAt": Number(tracker.updatedAt || now),
    "tracker.protocol": tracker.protocol || "teltonika_codec_8e_tcp",
    updatedAt: now,
  };
}

module.exports = {
  buildRuntimeRootPayload,
  computeConsolidatedMileage,
  normalizeRuntimeLiveConfig,
  shouldUseRuntimeLive,
  shouldWriteDayMetadata,
  RUNTIME_ROOT_FLUSH_DEFAULT_SECONDS,
};
