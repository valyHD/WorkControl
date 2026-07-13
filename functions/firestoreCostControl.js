const DEFAULT_FIRESTORE_COST_CONTROL = Object.freeze({
  emergencyMode: true,
  fleetRoutesOnDemandOnly: true,
  fleetRoutesCompactAll: true,
  disableBackgroundRouteSync: true,
  maxFleetSnapshotRefreshSeconds: 60,
  maxRoutePointsPerRequest: 2000,
  fleetRouteRefreshMinutes: 30,
  fleetRoutePointsPerVehicle: 50,
  disableHiddenPageListeners: true,
  billingRefreshMinutes: 30,
});

const CONFIG_CACHE_MS = 5 * 60 * 1000;
let cachedConfig = null;
let configRequest = null;

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function normalizeFirestoreCostControl(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    emergencyMode: data.emergencyMode !== false,
    fleetRoutesOnDemandOnly: data.fleetRoutesOnDemandOnly !== false,
    fleetRoutesCompactAll: data.fleetRoutesCompactAll !== false,
    disableBackgroundRouteSync: data.disableBackgroundRouteSync !== false,
    maxFleetSnapshotRefreshSeconds: clampInteger(
      data.maxFleetSnapshotRefreshSeconds,
      DEFAULT_FIRESTORE_COST_CONTROL.maxFleetSnapshotRefreshSeconds,
      30,
      300
    ),
    maxRoutePointsPerRequest: clampInteger(
      data.maxRoutePointsPerRequest,
      DEFAULT_FIRESTORE_COST_CONTROL.maxRoutePointsPerRequest,
      200,
      2000
    ),
    fleetRouteRefreshMinutes: clampInteger(
      data.fleetRouteRefreshMinutes,
      DEFAULT_FIRESTORE_COST_CONTROL.fleetRouteRefreshMinutes,
      15,
      180
    ),
    fleetRoutePointsPerVehicle: clampInteger(
      data.fleetRoutePointsPerVehicle,
      DEFAULT_FIRESTORE_COST_CONTROL.fleetRoutePointsPerVehicle,
      20,
      100
    ),
    disableHiddenPageListeners: data.disableHiddenPageListeners !== false,
    billingRefreshMinutes: clampInteger(
      data.billingRefreshMinutes,
      DEFAULT_FIRESTORE_COST_CONTROL.billingRefreshMinutes,
      15,
      180
    ),
  };
}

async function getFirestoreCostControl(db, options = {}) {
  const now = Date.now();
  if (!options.force && cachedConfig?.expiresAt > now) return cachedConfig.value;
  if (!options.force && configRequest) return configRequest;

  configRequest = (async () => {
    const snap = await db.collection("systemPrivateSettings").doc("firestoreCostControl").get();
    const value = normalizeFirestoreCostControl(snap.exists ? snap.data() : null);
    cachedConfig = { value, expiresAt: Date.now() + CONFIG_CACHE_MS };
    return value;
  })();

  try {
    return await configRequest;
  } finally {
    configRequest = null;
  }
}

async function saveFirestoreCostControl(db, admin, input, userId) {
  const value = normalizeFirestoreCostControl(input);
  await db
    .collection("systemPrivateSettings")
    .doc("firestoreCostControl")
    .set(
      {
        ...value,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
        updatedBy: userId,
      },
      { merge: true }
    );
  cachedConfig = { value, expiresAt: Date.now() + CONFIG_CACHE_MS };
  return value;
}

function resetFirestoreCostControlCacheForTests() {
  cachedConfig = null;
  configRequest = null;
}

module.exports = {
  DEFAULT_FIRESTORE_COST_CONTROL,
  getFirestoreCostControl,
  normalizeFirestoreCostControl,
  resetFirestoreCostControlCacheForTests,
  saveFirestoreCostControl,
};
