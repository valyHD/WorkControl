require("dotenv").config();
console.log("[BOOT] WorkControl GPS server file loaded");

const fs = require("fs");
const net = require("net");
const admin = require("firebase-admin");
const { exec } = require("child_process");
const util = require("util");
const {
  computeConsolidatedMileage,
  normalizeRuntimeLiveConfig,
  shouldUseRuntimeLive,
  shouldWriteDayMetadata,
} = require("./gps-write-amplification-core.cjs");

const execAsync = util.promisify(exec);

const serviceAccount = JSON.parse(
  fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const PORT = Number(process.env.TCP_PORT || 5001);

const activeDevices = new Map();
const healthyLoggedImei = new Set();
const pendingCodec12ByImei = new Map();
const COMMAND_RESPONSE_TIMEOUT_MS = 15000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const SOCKET_IDLE_TIMEOUT_MS = 120000;

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CLEANUP_FILE = "/tmp/workcontrol-last-cleanup.txt";
const TRACKER_BINDING_CACHE_TTL_MS = 60_000;
const UNBOUND_LOG_THROTTLE_MS = 15 * 60 * 1000;
const SNAPSHOT_WRITE_MIN_INTERVAL_MS = Number(process.env.LIVE_SNAPSHOT_WRITE_INTERVAL_MS || 1_000);
const LIVE_DIAGNOSTICS_TTL_MS = Number(process.env.LIVE_DIAGNOSTICS_TTL_MS || 30_000);
const MIN_POINT_INTERVAL_MS_MOVING = Number(process.env.ROUTE_POINT_INTERVAL_MS_MOVING || 3_000);
const MIN_POINT_INTERVAL_MS_IDLE = 180_000;
const MIN_POINT_DISTANCE_METERS = Number(process.env.ROUTE_POINT_DISTANCE_METERS || 8);
const IDLE_JITTER_DISTANCE_METERS = 80;
const IDLE_JITTER_MAX_INTERVAL_MS = 10 * 60 * 1000;
const MOVING_SPEED_THRESHOLD_KMH = 5;
const MAX_DISTANCE_STEP_METERS = 2000;
const MAX_ODOMETER_INCREMENT_KM = 500;
const trackerBindingCache = new Map();
const lastSavedPointByImei = new Map();
const lastOdometerKmByImei = new Map();
const lastSnapshotWriteByVehicle = new Map();
const lastDayMetadataWriteByVehicle = new Map();
const lastRuntimeRootFlushByVehicle = new Map();
const runtimeInitializationByVehicle = new Map();
const saveQueueByImei = new Map();
const lastUnboundLogByImei = new Map();
const NOTIFICATION_LISTENER_START_TS = Date.now();
const NOTIFICATION_STARTUP_GRACE_MS = 90_000;
const NOTIFICATION_PUSH_BATCH_LIMIT = 120;
const DIAGNOSTIC_DAY_EVENT_LIMIT = 250;
const DIAGNOSTIC_DAY_SAMPLE_LIMIT = 1440;
const OBD_OVERSPEED_KMH = Number(process.env.OBD_OVERSPEED_KMH || 130);
const OBD_HIGH_RPM = Number(process.env.OBD_HIGH_RPM || 4000);
const OBD_CRITICAL_RPM = Number(process.env.OBD_CRITICAL_RPM || 5000);
const OBD_COOLANT_WARNING_C = Number(process.env.OBD_COOLANT_WARNING_C || 105);
const OBD_COOLANT_CRITICAL_C = Number(process.env.OBD_COOLANT_CRITICAL_C || 115);
const OBD_OIL_WARNING_C = Number(process.env.OBD_OIL_WARNING_C || 120);
const OBD_LOW_VOLTAGE_V = Number(process.env.OBD_LOW_VOLTAGE_V || 11.5);
const OBD_LOW_FUEL_PCT = Number(process.env.OBD_LOW_FUEL_PCT || 10);
const GPS_COST_CONFIG_CACHE_MS = 60_000;
const GPS_COST_DEFAULT_FLUSH_SECONDS = 45;
const GPS_COST_MIN_FLUSH_SECONDS = 30;
const GPS_COST_MAX_FLUSH_SECONDS = 60;
const GPS_COST_MAX_BUFFERED_RECORDS = 500;
const GPS_COST_FLUSH_CHECK_MS = 5_000;
const gpsCostBuffers = new Map();
const WRITE_AMPLIFICATION_LOG_INTERVAL_MS = 5 * 60 * 1000;
const writeAmplificationCounters = {
  runtimeSnapshotWrites: 0,
  legacyRootSnapshotWrites: 0,
  runtimeRootFlushes: 0,
  dayMetadataWrites: 0,
  dayMetadataWritesSkipped: 0,
  lastLoggedAt: Date.now(),
};
let gpsCostConfigCache = {
  value: {
    enabled: false,
    canaryTrackerImeis: new Set(),
    diagnosticFlushSeconds: GPS_COST_DEFAULT_FLUSH_SECONDS,
    runtimeLive: normalizeRuntimeLiveConfig({}),
  },
  expiresAt: 0,
};

function toByteCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
}

function getGpsDataUsageMonthKey(ts = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ts));
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}_${month}`;
}

function normalizeGpsDataUsageDelta(delta) {
  if (!delta || typeof delta !== "object") return null;

  const rxBytes = toByteCount(delta.rxBytes);
  const txBytes = toByteCount(delta.txBytes);
  const recordsCount = toByteCount(delta.recordsCount);
  const frameCount = toByteCount(delta.frameCount);
  const totalBytes = rxBytes + txBytes;

  if (totalBytes <= 0 && recordsCount <= 0 && frameCount <= 0) return null;

  return {
    rxBytes,
    txBytes,
    totalBytes,
    recordsCount,
    frameCount,
  };
}

function mergeGpsDataUsageDeltas(current, incoming) {
  const left = normalizeGpsDataUsageDelta(current) || {
    rxBytes: 0,
    txBytes: 0,
    totalBytes: 0,
    recordsCount: 0,
    frameCount: 0,
  };
  const right = normalizeGpsDataUsageDelta(incoming);
  if (!right) return normalizeGpsDataUsageDelta(left);

  return normalizeGpsDataUsageDelta({
    rxBytes: left.rxBytes + right.rxBytes,
    txBytes: left.txBytes + right.txBytes,
    recordsCount: left.recordsCount + right.recordsCount,
    frameCount: left.frameCount + right.frameCount,
  });
}

function normalizeGpsCostConfig(data) {
  const rawImeis = Array.isArray(data?.canaryTrackerImeis) ? data.canaryTrackerImeis : [];
  const flushSeconds = Number(data?.diagnosticFlushSeconds);

  return {
    enabled: data?.enabled === true,
    canaryTrackerImeis: new Set(
      rawImeis
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 100)
    ),
    diagnosticFlushSeconds: Math.max(
      GPS_COST_MIN_FLUSH_SECONDS,
      Math.min(
        GPS_COST_MAX_FLUSH_SECONDS,
        Number.isFinite(flushSeconds) ? Math.round(flushSeconds) : GPS_COST_DEFAULT_FLUSH_SECONDS
      )
    ),
    runtimeLive: normalizeRuntimeLiveConfig(data),
  };
}

function maybeLogWriteAmplificationCounters(now = Date.now()) {
  if (now - writeAmplificationCounters.lastLoggedAt < WRITE_AMPLIFICATION_LOG_INTERVAL_MS) return;
  console.log(`[WRITE AMPLIFICATION METRICS] ${JSON.stringify({
    windowSeconds: Math.round((now - writeAmplificationCounters.lastLoggedAt) / 1000),
    runtimeSnapshotWrites: writeAmplificationCounters.runtimeSnapshotWrites,
    legacyRootSnapshotWrites: writeAmplificationCounters.legacyRootSnapshotWrites,
    runtimeRootFlushes: writeAmplificationCounters.runtimeRootFlushes,
    dayMetadataWrites: writeAmplificationCounters.dayMetadataWrites,
    dayMetadataWritesSkipped: writeAmplificationCounters.dayMetadataWritesSkipped,
  })}`);
  writeAmplificationCounters.runtimeSnapshotWrites = 0;
  writeAmplificationCounters.legacyRootSnapshotWrites = 0;
  writeAmplificationCounters.runtimeRootFlushes = 0;
  writeAmplificationCounters.dayMetadataWrites = 0;
  writeAmplificationCounters.dayMetadataWritesSkipped = 0;
  writeAmplificationCounters.lastLoggedAt = now;
}

async function getGpsCostOptimizationConfig() {
  const now = Date.now();
  if (gpsCostConfigCache.expiresAt > now) return gpsCostConfigCache.value;

  try {
    const snap = await db
      .collection("systemPrivateSettings")
      .doc("gpsCostOptimization")
      .get();
    const value = normalizeGpsCostConfig(snap.exists ? snap.data() : null);
    gpsCostConfigCache = { value, expiresAt: now + GPS_COST_CONFIG_CACHE_MS };
  } catch (error) {
    console.warn("[GPS COST CONFIG] Nu am putut actualiza configuratia; pastrez valoarea cache.", error);
    gpsCostConfigCache.expiresAt = now + GPS_COST_CONFIG_CACHE_MS;
  }

  return gpsCostConfigCache.value;
}

function getGpsCostBuffer(vehicleId, imei) {
  let buffer = gpsCostBuffers.get(imei);
  if (!buffer) {
    buffer = {
      vehicleId,
      imei,
      recordsByDay: new Map(),
      dataUsageDelta: null,
      bufferedRecords: 0,
      lastFlushAt: Date.now(),
      flushing: null,
      counters: {
        packetsReceived: 0,
        diagnosticWrites: 0,
        usageWrites: 0,
        flushes: 0,
      },
    };
    gpsCostBuffers.set(imei, buffer);
  }
  return buffer;
}

function restoreGpsCostBuffer(buffer, recordsByDay, dataUsageDelta) {
  for (const [dayKey, records] of recordsByDay.entries()) {
    const existing = buffer.recordsByDay.get(dayKey) || [];
    buffer.recordsByDay.set(dayKey, [...records, ...existing]);
    buffer.bufferedRecords += records.length;
  }
  buffer.dataUsageDelta = mergeGpsDataUsageDeltas(dataUsageDelta, buffer.dataUsageDelta);
}

async function flushGpsCostBuffer(imei, reason = "interval") {
  const buffer = gpsCostBuffers.get(imei);
  if (!buffer) return;
  if (buffer.flushing) return buffer.flushing;
  if (buffer.bufferedRecords <= 0 && !buffer.dataUsageDelta) return;

  const recordsByDay = buffer.recordsByDay;
  let dataUsageDelta = buffer.dataUsageDelta;
  const recordsCount = buffer.bufferedRecords;
  let diagnosticWrites = 0;
  let usageWrite = false;
  buffer.recordsByDay = new Map();
  buffer.dataUsageDelta = null;
  buffer.bufferedRecords = 0;

  buffer.flushing = (async () => {
    const startedAt = Date.now();
    const vehicleRef = db.collection("vehicles").doc(buffer.vehicleId);
    try {
      const gpsCostConfig = await getGpsCostOptimizationConfig();
      const useRuntimeLive = shouldUseRuntimeLive(gpsCostConfig.runtimeLive, buffer.imei);
      const runtimeRef = vehicleRef.collection("positions").doc("_runtime");
      for (const [dayKey, dayRecords] of recordsByDay.entries()) {
        if (!dayRecords.length) continue;
        await updateDailyDiagnostics(
          vehicleRef,
          buffer.vehicleId,
          buffer.imei,
          dayKey,
          dayRecords,
          Date.now()
        );
        recordsByDay.delete(dayKey);
        diagnosticWrites += 1;
        buffer.counters.diagnosticWrites += 1;
      }

      if (dataUsageDelta) {
        if (useRuntimeLive) {
          await writeVehicleRuntimeDataUsageOnly(
            vehicleRef,
            runtimeRef,
            buffer.vehicleId,
            buffer.imei,
            dataUsageDelta,
            Date.now()
          );
        } else {
          await writeVehicleDataUsageOnly(vehicleRef, buffer.imei, dataUsageDelta, Date.now());
        }
        dataUsageDelta = null;
        usageWrite = true;
        buffer.counters.usageWrites += 1;
      }

      if (useRuntimeLive) {
        await flushVehicleRuntimeToRoot(
          vehicleRef,
          runtimeRef,
          buffer.vehicleId,
          gpsCostConfig.runtimeLive.rootFlushSeconds,
          Date.now()
        );
      }

      buffer.lastFlushAt = Date.now();
      buffer.counters.flushes += 1;
      console.log(
        `[GPS COST METRICS] ${JSON.stringify({
          imei: buffer.imei,
          vehicleId: buffer.vehicleId,
          reason,
          records: recordsCount,
          diagnosticWrites,
          usageWrite,
          durationMs: Date.now() - startedAt,
          totals: buffer.counters,
        })}`
      );
    } catch (error) {
      restoreGpsCostBuffer(buffer, recordsByDay, dataUsageDelta);
      console.error(`[GPS COST FLUSH ERROR] imei=${buffer.imei} reason=${reason}`, error);
      throw error;
    } finally {
      buffer.flushing = null;
    }
  })();

  return buffer.flushing;
}

async function queueGpsCostAggregation({
  vehicleId,
  imei,
  diagnosticGroups,
  dataUsageDelta,
  flushSeconds,
}) {
  const buffer = getGpsCostBuffer(vehicleId, imei);
  for (const [dayKey, records] of diagnosticGroups.entries()) {
    const existing = buffer.recordsByDay.get(dayKey) || [];
    buffer.recordsByDay.set(dayKey, [...existing, ...records]);
    buffer.bufferedRecords += records.length;
  }
  buffer.dataUsageDelta = mergeGpsDataUsageDeltas(buffer.dataUsageDelta, dataUsageDelta);
  buffer.counters.packetsReceived += Array.from(diagnosticGroups.values()).reduce(
    (sum, records) => sum + records.length,
    0
  );

  const dueAt = buffer.lastFlushAt + flushSeconds * 1000;
  if (Date.now() >= dueAt || buffer.bufferedRecords >= GPS_COST_MAX_BUFFERED_RECORDS) {
    await flushGpsCostBuffer(imei, buffer.bufferedRecords >= GPS_COST_MAX_BUFFERED_RECORDS ? "buffer_limit" : "interval");
  }
}

async function flushAllGpsCostBuffers(reason = "shutdown") {
  await Promise.allSettled(
    [...gpsCostBuffers.keys()].map((imei) => flushGpsCostBuffer(imei, reason))
  );
}

function buildGpsDataUsageUpdateFields(delta, now) {
  const usage = normalizeGpsDataUsageDelta(delta);
  if (!usage) return {};

  const monthKey = getGpsDataUsageMonthKey(now);
  const monthPrefix = `gpsDataUsage.months.${monthKey}`;
  const fields = {
    "gpsDataUsage.currentMonthKey": monthKey,
    "gpsDataUsage.lastRxBytes": usage.rxBytes,
    "gpsDataUsage.lastTxBytes": usage.txBytes,
    "gpsDataUsage.lastTotalBytes": usage.totalBytes,
    "gpsDataUsage.updatedAt": now,
    "gpsDataUsage.updatedAtServer": admin.firestore.FieldValue.serverTimestamp(),
    [`${monthPrefix}.lastRxBytes`]: usage.rxBytes,
    [`${monthPrefix}.lastTxBytes`]: usage.txBytes,
    [`${monthPrefix}.lastTotalBytes`]: usage.totalBytes,
    [`${monthPrefix}.updatedAt`]: now,
    [`${monthPrefix}.updatedAtServer`]: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (usage.rxBytes > 0) {
    fields["gpsDataUsage.rxBytes"] = admin.firestore.FieldValue.increment(usage.rxBytes);
    fields[`${monthPrefix}.rxBytes`] = admin.firestore.FieldValue.increment(usage.rxBytes);
  }
  if (usage.txBytes > 0) {
    fields["gpsDataUsage.txBytes"] = admin.firestore.FieldValue.increment(usage.txBytes);
    fields[`${monthPrefix}.txBytes`] = admin.firestore.FieldValue.increment(usage.txBytes);
  }
  if (usage.totalBytes > 0) {
    fields["gpsDataUsage.totalBytes"] = admin.firestore.FieldValue.increment(usage.totalBytes);
    fields[`${monthPrefix}.totalBytes`] = admin.firestore.FieldValue.increment(usage.totalBytes);
  }
  if (usage.recordsCount > 0) {
    fields["gpsDataUsage.recordsCount"] = admin.firestore.FieldValue.increment(usage.recordsCount);
    fields[`${monthPrefix}.recordsCount`] = admin.firestore.FieldValue.increment(usage.recordsCount);
  }
  if (usage.frameCount > 0) {
    fields["gpsDataUsage.frameCount"] = admin.firestore.FieldValue.increment(usage.frameCount);
    fields[`${monthPrefix}.frameCount`] = admin.firestore.FieldValue.increment(usage.frameCount);
  }

  return fields;
}

function buildGpsDataUsageInitialValue(delta, now) {
  const usage = normalizeGpsDataUsageDelta(delta);
  if (!usage) return null;

  const monthKey = getGpsDataUsageMonthKey(now);
  const monthUsage = {
    rxBytes: usage.rxBytes,
    txBytes: usage.txBytes,
    totalBytes: usage.totalBytes,
    recordsCount: usage.recordsCount,
    frameCount: usage.frameCount,
    lastRxBytes: usage.rxBytes,
    lastTxBytes: usage.txBytes,
    lastTotalBytes: usage.totalBytes,
    updatedAt: now,
    updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
  };

  return {
    rxBytes: usage.rxBytes,
    txBytes: usage.txBytes,
    totalBytes: usage.totalBytes,
    recordsCount: usage.recordsCount,
    frameCount: usage.frameCount,
    lastRxBytes: usage.rxBytes,
    lastTxBytes: usage.txBytes,
    lastTotalBytes: usage.totalBytes,
    updatedAt: now,
    updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
    currentMonthKey: monthKey,
    months: {
      [monthKey]: monthUsage,
    },
  };
}

function addSessionTxBytes(session, bytes) {
  if (!session) return;
  session.pendingTxBytes = toByteCount(session.pendingTxBytes) + toByteCount(bytes);
}

function takeSessionDataUsageDelta(session, recordsCount) {
  const delta = {
    rxBytes: toByteCount(session?.pendingRxBytes),
    txBytes: toByteCount(session?.pendingTxBytes),
    recordsCount: toByteCount(recordsCount),
    frameCount: 1,
  };

  if (session) {
    session.pendingRxBytes = 0;
    session.pendingTxBytes = 0;
  }

  return delta;
}

const FMC130_IO_DEFINITIONS = {
  1: { key: "digitalInput1", label: "Intrare digitala 1", group: "input_output", description: "Digital Input 1" },
  9: { key: "analogInput1V", label: "Intrare analogica 1", group: "input_output", unit: "V", multiplier: 0.001, decimals: 3, description: "Analog Input 1" },
  12: { key: "fuelUsedGpsL", label: "Combustibil folosit GPS", group: "gps", unit: "L", multiplier: 0.001, decimals: 3, description: "Fuel Used GPS" },
  15: { key: "ecoScore", label: "Eco score", group: "gps", description: "Eco Score" },
  16: { key: "totalOdometerKm", label: "Odometru total AVL 16", group: "obd", unit: "km", multiplier: 0.001, decimals: 1, description: "Total Odometer; seteaza sursa pe OBD in FMC130" },
  13: { key: "fuelRateGpsL100Km", label: "Consum GPS", group: "gps", unit: "l/100km", multiplier: 0.01, decimals: 2, description: "Fuel Rate GPS" },
  21: { key: "gsmSignal", label: "Semnal GSM", group: "connectivity", unit: "/5", description: "GSM Signal" },
  24: { key: "gnssSpeedKmh", label: "Viteza GNSS", group: "gps", unit: "km/h", description: "GNSS Speed" },
  30: { key: "dtcCount", label: "Numar coduri defecte", group: "obd", description: "Number of DTC" },
  31: { key: "engineLoadPct", label: "Sarcina motor", group: "obd", unit: "%", description: "Engine Load" },
  32: { key: "coolantTemperatureC", label: "Temperatura lichid racire", group: "obd", unit: "C", signedBits: 8, description: "Coolant Temperature" },
  33: { key: "shortFuelTrimPct", label: "Short fuel trim", group: "obd", unit: "%", signedBits: 8, description: "Short Fuel Trim" },
  34: { key: "fuelPressureKpa", label: "Presiune combustibil", group: "obd", unit: "kPa", description: "Fuel pressure" },
  35: { key: "intakeMapKpa", label: "Presiune admisie MAP", group: "obd", unit: "kPa", description: "Intake MAP" },
  36: { key: "engineRpm", label: "Turatie motor", group: "obd", unit: "rpm", description: "Engine RPM" },
  37: { key: "vehicleSpeedKmh", label: "Viteza vehicul OBD", group: "obd", unit: "km/h", description: "Vehicle Speed" },
  38: { key: "timingAdvanceDeg", label: "Avans aprindere", group: "obd", unit: "deg", signedBits: 8, description: "Timing Advance" },
  39: { key: "intakeAirTemperatureC", label: "Temperatura aer admisie", group: "obd", unit: "C", signedBits: 8, description: "Intake Air Temperature" },
  40: { key: "mafGps", label: "Debit aer MAF", group: "obd", unit: "g/sec", multiplier: 0.01, decimals: 2, description: "MAF air flow rate" },
  41: { key: "throttlePositionPct", label: "Pozitie acceleratie", group: "obd", unit: "%", description: "Throttle Position" },
  42: { key: "engineRuntimeSec", label: "Timp functionare motor", group: "obd", unit: "s", description: "Runtime since engine start" },
  43: { key: "distanceMilOnKm", label: "Distanta cu MIL aprins", group: "obd", unit: "km", description: "Distance Traveled MIL On" },
  44: { key: "relativeFuelRailPressureKpa", label: "Presiune rampa relativa", group: "obd", unit: "kPa", multiplier: 0.1, decimals: 1, description: "Relative Fuel Rail Pressure" },
  45: { key: "directFuelRailPressureKpa", label: "Presiune rampa directa", group: "obd", unit: "kPa", multiplier: 10, description: "Direct Fuel Rail Pressure" },
  46: { key: "commandedEgrPct", label: "EGR comandat", group: "obd", unit: "%", description: "Commanded EGR" },
  47: { key: "egrErrorPct", label: "Eroare EGR", group: "obd", unit: "%", signedBits: 8, description: "EGR Error" },
  48: { key: "fuelLevelPct", label: "Nivel combustibil", group: "obd", unit: "%", description: "Fuel Level" },
  49: { key: "distanceSinceCodesClearKm", label: "Distanta de la stergere coduri", group: "obd", unit: "km", description: "Distance Since Codes Clear" },
  50: { key: "barometricPressureKpa", label: "Presiune barometrica", group: "obd", unit: "kPa", description: "Barometric Pressure" },
  51: { key: "controlModuleVoltageV", label: "Tensiune modul control", group: "obd", unit: "V", multiplier: 0.001, decimals: 3, description: "Control Module Voltage" },
  52: { key: "absoluteLoadPct", label: "Sarcina absoluta", group: "obd", unit: "%", description: "Absolute Load Value" },
  53: { key: "ambientAirTemperatureC", label: "Temperatura exterioara", group: "obd", unit: "C", signedBits: 8, description: "Ambient Air Temperature" },
  54: { key: "timeRunMilOnMin", label: "Timp cu MIL aprins", group: "obd", unit: "min", description: "Time Run With MIL On" },
  55: { key: "timeSinceCodesClearedMin", label: "Timp de la stergere coduri", group: "obd", unit: "min", description: "Time Since Codes Cleared" },
  56: { key: "absoluteFuelRailPressureKpa", label: "Presiune rampa absoluta", group: "obd", unit: "kPa", multiplier: 10, description: "Absolute Fuel Rail Pressure" },
  57: { key: "hybridBatteryLifePct", label: "Baterie hibrid", group: "obd", unit: "%", description: "Hybrid battery pack life" },
  58: { key: "engineOilTemperatureC", label: "Temperatura ulei motor", group: "obd", unit: "C", description: "Engine Oil Temperature" },
  59: { key: "fuelInjectionTimingDeg", label: "Avans injectie", group: "obd", unit: "deg", multiplier: 0.01, decimals: 2, signedBits: 16, description: "Fuel injection timing" },
  60: { key: "fuelRateLh", label: "Consum instant", group: "obd", unit: "L/h", multiplier: 0.01, decimals: 2, description: "Fuel Rate" },
  66: { key: "externalVoltageV", label: "Tensiune externa", group: "power", unit: "V", multiplier: 0.001, decimals: 3, description: "External Voltage" },
  67: { key: "batteryVoltageV", label: "Tensiune baterie interna", group: "power", unit: "V", multiplier: 0.001, decimals: 3, description: "Battery Voltage" },
  68: { key: "batteryCurrentA", label: "Curent baterie", group: "power", unit: "A", multiplier: 0.001, decimals: 3, description: "Battery Current" },
  69: { key: "gnssStatus", label: "Status GNSS", group: "gps", description: "GNSS Status" },
  80: { key: "dataMode", label: "Mod date", group: "system", description: "Data Mode" },
  199: { key: "tripOdometerKm", label: "Odometer trip", group: "gps", unit: "km", multiplier: 0.001, decimals: 1, description: "Trip Odometer" },
  181: { key: "gnssPdop", label: "GNSS PDOP", group: "gps", multiplier: 0.1, decimals: 1, description: "GNSS PDOP" },
  182: { key: "gnssHdop", label: "GNSS HDOP", group: "gps", multiplier: 0.1, decimals: 1, description: "GNSS HDOP" },
  200: { key: "sleepMode", label: "Sleep mode", group: "system", description: "Sleep Mode" },
  205: { key: "gsmCellId", label: "GSM Cell ID", group: "connectivity", description: "GSM Cell ID" },
  206: { key: "gsmAreaCode", label: "GSM Area Code", group: "connectivity", description: "GSM Area Code" },
  239: { key: "ignitionOn", label: "Contact", group: "input_output", description: "Ignition" },
  240: { key: "movement", label: "Miscare", group: "gps", description: "Movement" },
  241: { key: "activeGsmOperator", label: "Operator GSM activ", group: "connectivity", description: "Active GSM Operator" },
  179: { key: "digitalOutput1", label: "Iesire digitala 1", group: "input_output", description: "Digital Output 1" },
  251: { key: "idling", label: "Ralanti", group: "obd", description: "Idling" },
  263: { key: "btStatus", label: "Status Bluetooth", group: "bluetooth", description: "Bluetooth status" },
  264: { key: "btData", label: "Date Bluetooth SPP", group: "bluetooth", description: "Bluetooth SPP payload" },
  281: { key: "faultCodes", label: "Coduri defecte", group: "obd", description: "Fault Codes" },
  385: { key: "beaconData", label: "Beacon Bluetooth", group: "bluetooth", description: "Beacon data" },
  540: { key: "throttlePositionGroupPct", label: "Pozitie acceleratie grup", group: "obd", unit: "%", description: "Throttle Position Value From PID Group" },
  541: { key: "commandedEquivalenceRatio", label: "Raport aer-combustibil comandat", group: "obd", multiplier: 0.01, decimals: 2, description: "Fuel-Air Commanded Equivalence Ratio" },
  542: { key: "intakeMap2Kpa", label: "Presiune admisie MAP 2", group: "obd", unit: "kPa", description: "Intake Manifold Absolute Pressure" },
  543: { key: "hybridBatteryPackVoltageV", label: "Tensiune sistem hibrid", group: "obd", unit: "V", description: "Hybrid System Voltage" },
  544: { key: "hybridSystemCurrentA", label: "Curent sistem hibrid", group: "obd", unit: "A", signedBits: 16, description: "Hybrid System Current" },
  548: { key: "advancedBeaconData", label: "Beacon Bluetooth avansat", group: "bluetooth", description: "Advanced beacon data" },
  759: { key: "fuelType", label: "Tip combustibil OBD", group: "obd", description: "Fuel Type" },
};

function normalizeSignedIoValue(value, bits) {
  if (typeof value !== "number" || !Number.isFinite(value) || !bits) return value;

  const limit = 2 ** bits;
  const signLimit = 2 ** (bits - 1);
  return value >= signLimit ? value - limit : value;
}

function roundIoValue(value, decimals) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = 10 ** Math.max(0, decimals || 0);
  return Math.round(value * factor) / factor;
}

function formatIoDisplayValue(value, unit) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Da" : "Nu";
  return unit ? `${value} ${unit}` : String(value);
}

function normalizeIoValue(id, rawValue, definition) {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) return rawValue;

  let value = normalizeSignedIoValue(rawValue, definition?.signedBits);
  if (typeof value === "number" && Number.isFinite(value) && typeof definition?.multiplier === "number") {
    value *= definition.multiplier;
  }

  return roundIoValue(value, definition?.decimals);
}

function buildDecodedIoItems(io) {
  return Object.entries(io || {})
    .map(([idText, rawValue]) => {
      const id = Number(idText);
      const definition = FMC130_IO_DEFINITIONS[id] || {
        key: `avl_${idText}`,
        label: `AVL ${idText}`,
        group: "unknown",
      };
      const value = normalizeIoValue(id, rawValue, definition);

      return {
        id: Number.isFinite(id) ? id : 0,
        key: definition.key,
        label: definition.label,
        group: definition.group,
        value,
        rawValue,
        displayValue: formatIoDisplayValue(value, definition.unit),
        unit: definition.unit || "",
        description: definition.description || "",
      };
    })
    .sort((a, b) => a.id - b.id);
}

function buildLiveDiagnosticsSnapshot(imei, record, now) {
  const decodedIo = buildDecodedIoItems(record.io);
  const metrics = {};

  for (const item of decodedIo) {
    if (!item.key || item.key.startsWith("avl_")) continue;
    metrics[item.key] = item.value;
  }

  const hasObdData = decodedIo.some((item) => item.group === "obd");

  return {
    source: "fmc130",
    imei,
    protocol: "teltonika_codec_8e_tcp",
    online: true,
    recordTimestamp: record.gpsTimestamp,
    serverTimestamp: now,
    expiresAt: now + LIVE_DIAGNOSTICS_TTL_MS,
    eventIoId: record.eventIoId,
    totalIo: record.totalIo,
    priority: record.priority,
    bluetoothObdConnected: hasObdData ? true : null,
    obdConnected: hasObdData ? true : null,
    gps: {
      lat: record.lat,
      lng: record.lng,
      speedKmh: record.speedKmh,
      altitude: record.altitude,
      angle: record.angle,
      satellites: record.satellites,
    },
    obd: metrics,
    decodedIo,
    rawIo: record.io || {},
  };
}

function toFiniteMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getMetric(metrics, key) {
  if (!metrics || typeof metrics !== "object") return null;
  return toFiniteMetric(metrics[key]);
}

function getMetricValue(metrics, key) {
  if (!metrics || typeof metrics !== "object") return null;
  return metrics[key] ?? null;
}

function makeDiagnosticEvent(type, timestamp, label, severity, value, unit, details) {
  const minuteBucket = Math.floor(Number(timestamp || Date.now()) / 60000);
  const eventValue =
    value === null || value === undefined || value === ""
      ? "na"
      : String(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 32);
  const key = `${type}:${minuteBucket}:${eventValue}`;

  return {
    id: key,
    key,
    type,
    label,
    timestamp,
    severity,
    value: value ?? null,
    unit: unit || "",
    details: details || "",
  };
}

function buildUnusualDiagnosticEvents(diagnostics, record) {
  const events = [];
  const metrics = diagnostics?.obd || {};
  const timestamp = diagnostics?.recordTimestamp || record.gpsTimestamp || Date.now();
  const speedKmh =
    getMetric(metrics, "vehicleSpeedKmh") ??
    getMetric(metrics, "gnssSpeedKmh") ??
    toFiniteMetric(record.speedKmh);
  const rpm = getMetric(metrics, "engineRpm");
  const coolant = getMetric(metrics, "coolantTemperatureC");
  const oil = getMetric(metrics, "engineOilTemperatureC");
  const externalVoltage = getMetric(metrics, "externalVoltageV");
  const fuelLevel = getMetric(metrics, "fuelLevelPct");
  const engineLoad = getMetric(metrics, "engineLoadPct");
  const throttle = getMetric(metrics, "throttlePositionPct");
  const dtcCount = getMetric(metrics, "dtcCount");
  const faultCodes = getMetricValue(metrics, "faultCodes");
  const idling = getMetricValue(metrics, "idling");

  if (speedKmh !== null && speedKmh >= OBD_OVERSPEED_KMH) {
    events.push(
      makeDiagnosticEvent(
        "overspeed",
        timestamp,
        "Viteza neobisnuit de mare",
        speedKmh >= OBD_OVERSPEED_KMH + 30 ? "critical" : "warning",
        speedKmh,
        "km/h",
        `Prag setat: ${OBD_OVERSPEED_KMH} km/h`
      )
    );
  }

  if (rpm !== null && rpm >= OBD_HIGH_RPM) {
    events.push(
      makeDiagnosticEvent(
        "high_rpm",
        timestamp,
        "Turatie motor ridicata",
        rpm >= OBD_CRITICAL_RPM ? "critical" : "warning",
        rpm,
        "rpm",
        `Praguri: ${OBD_HIGH_RPM}/${OBD_CRITICAL_RPM} rpm`
      )
    );
  }

  if (coolant !== null && coolant >= OBD_COOLANT_WARNING_C) {
    events.push(
      makeDiagnosticEvent(
        "high_coolant_temp",
        timestamp,
        "Temperatura lichid racire ridicata",
        coolant >= OBD_COOLANT_CRITICAL_C ? "critical" : "warning",
        coolant,
        "C",
        `Praguri: ${OBD_COOLANT_WARNING_C}/${OBD_COOLANT_CRITICAL_C} C`
      )
    );
  }

  if (oil !== null && oil >= OBD_OIL_WARNING_C) {
    events.push(
      makeDiagnosticEvent(
        "high_oil_temp",
        timestamp,
        "Temperatura ulei motor ridicata",
        "warning",
        oil,
        "C",
        `Prag setat: ${OBD_OIL_WARNING_C} C`
      )
    );
  }

  if (externalVoltage !== null && externalVoltage > 0 && externalVoltage < OBD_LOW_VOLTAGE_V) {
    events.push(
      makeDiagnosticEvent(
        "low_voltage",
        timestamp,
        "Tensiune alimentare scazuta",
        "warning",
        externalVoltage,
        "V",
        `Prag setat: ${OBD_LOW_VOLTAGE_V} V`
      )
    );
  }

  if (fuelLevel !== null && fuelLevel >= 0 && fuelLevel <= OBD_LOW_FUEL_PCT) {
    events.push(
      makeDiagnosticEvent(
        "low_fuel",
        timestamp,
        "Combustibil aproape terminat",
        fuelLevel <= 5 ? "critical" : "warning",
        fuelLevel,
        "%",
        `Prag setat: ${OBD_LOW_FUEL_PCT}%`
      )
    );
  }

  if (dtcCount !== null && dtcCount > 0) {
    events.push(
      makeDiagnosticEvent(
        "dtc_detected",
        timestamp,
        "Coduri defecte OBD detectate",
        "warning",
        dtcCount,
        "",
        "FMC130 a transmis DTC count mai mare decat zero"
      )
    );
  }

  if (
    faultCodes !== null &&
    faultCodes !== undefined &&
    String(faultCodes).trim() &&
    String(faultCodes).trim() !== "0"
  ) {
    events.push(
      makeDiagnosticEvent(
        "fault_codes",
        timestamp,
        "Coduri defecte transmise",
        "warning",
        String(faultCodes).trim(),
        "",
        "Valoare raw Fault Codes"
      )
    );
  }

  if (engineLoad !== null && engineLoad >= 95) {
    events.push(
      makeDiagnosticEvent(
        "high_engine_load",
        timestamp,
        "Sarcina motor foarte mare",
        "info",
        engineLoad,
        "%",
        "Engine Load peste 95%"
      )
    );
  }

  if (throttle !== null && throttle >= 95) {
    events.push(
      makeDiagnosticEvent(
        "high_throttle",
        timestamp,
        "Acceleratie aproape maxima",
        "info",
        throttle,
        "%",
        "Throttle Position peste 95%"
      )
    );
  }

  if (idling === true || idling === 1 || idling === "1") {
    events.push(
      makeDiagnosticEvent(
        "idling",
        timestamp,
        "Ralanti detectat",
        "info",
        1,
        "",
        "OBD/FMC a transmis idling activ"
      )
    );
  }

  return events;
}

function mergeDiagnosticEvents(existingEvents, incomingEvents) {
  const byKey = new Map();

  for (const event of [...(existingEvents || []), ...(incomingEvents || [])]) {
    if (!event || typeof event !== "object") continue;
    const key = event.key || event.id;
    if (!key) continue;
    byKey.set(key, event);
  }

  return [...byKey.values()]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, DIAGNOSTIC_DAY_EVENT_LIMIT);
}

function mergeDiagnosticSamples(existingSamples, incomingSamples) {
  const byKey = new Map();

  for (const sample of [...(existingSamples || []), ...(incomingSamples || [])]) {
    if (!sample || typeof sample !== "object") continue;
    const timestamp = Number(sample.timestamp || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const key = String(Math.floor(timestamp / 60_000));
    byKey.set(key, sample);
  }

  return [...byKey.values()]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, DIAGNOSTIC_DAY_SAMPLE_LIMIT);
}

function updateMaxStat(stats, key, value) {
  const numeric = toFiniteMetric(value);
  if (numeric === null) return;
  const current = toFiniteMetric(stats[key]);
  if (current === null || numeric > current) stats[key] = numeric;
}

function updateMinStat(stats, key, value) {
  const numeric = toFiniteMetric(value);
  if (numeric === null) return;
  const current = toFiniteMetric(stats[key]);
  if (current === null || numeric < current) stats[key] = numeric;
}

function buildDailyDiagnosticSummaryText(stats, events) {
  const eventCount = Array.isArray(events) ? events.length : 0;
  const criticalCount = Array.isArray(events)
    ? events.filter((event) => event.severity === "critical").length
    : 0;
  const warningCount = Array.isArray(events)
    ? events.filter((event) => event.severity === "warning").length
    : 0;
  const maxSpeed = toFiniteMetric(stats.maxSpeedKmh);
  const maxRpm = toFiniteMetric(stats.maxEngineRpm);
  const maxCoolant = toFiniteMetric(stats.maxCoolantTemperatureC);

  if (!eventCount) {
    return "Nu sunt evenimente neobisnuite inregistrate pentru ziua curenta.";
  }

  const parts = [`${eventCount} evenimente neobisnuite`];
  if (criticalCount) parts.push(`${criticalCount} critice`);
  if (warningCount) parts.push(`${warningCount} avertizari`);
  if (maxSpeed !== null) parts.push(`viteza maxima ${maxSpeed} km/h`);
  if (maxRpm !== null) parts.push(`turatie maxima ${maxRpm} rpm`);
  if (maxCoolant !== null) parts.push(`temperatura maxima ${maxCoolant} C`);

  return parts.join(", ") + ".";
}

async function updateDailyDiagnostics(vehicleRef, vehicleId, imei, dayKey, dayRecords, now) {
  if (!dayRecords.length) return;

  const diagnosticsItems = dayRecords.map((record) => buildLiveDiagnosticsSnapshot(imei, record, now));
  const incomingEvents = diagnosticsItems.flatMap((diagnostics, index) =>
    buildUnusualDiagnosticEvents(diagnostics, dayRecords[index])
  );
  const incomingSamples = diagnosticsItems.map((diagnostics) => ({
    timestamp: diagnostics.recordTimestamp,
    speedKmh: diagnostics.obd?.vehicleSpeedKmh ?? diagnostics.gps?.speedKmh ?? null,
    engineRpm: diagnostics.obd?.engineRpm ?? null,
    totalOdometerKm: diagnostics.obd?.totalOdometerKm ?? null,
    tripOdometerKm: diagnostics.obd?.tripOdometerKm ?? null,
    coolantTemperatureC: diagnostics.obd?.coolantTemperatureC ?? null,
    engineOilTemperatureC: diagnostics.obd?.engineOilTemperatureC ?? null,
    externalVoltageV: diagnostics.obd?.externalVoltageV ?? null,
    batteryVoltageV: diagnostics.obd?.batteryVoltageV ?? null,
    fuelLevelPct: diagnostics.obd?.fuelLevelPct ?? null,
    fuelRateLh: diagnostics.obd?.fuelRateLh ?? null,
    engineLoadPct: diagnostics.obd?.engineLoadPct ?? null,
    throttlePositionPct: diagnostics.obd?.throttlePositionPct ?? null,
  }));
  const firstRecordAt = Math.min(...dayRecords.map((record) => record.gpsTimestamp));
  const lastRecordAt = Math.max(...dayRecords.map((record) => record.gpsTimestamp));
  const latestDiagnostics = diagnosticsItems[diagnosticsItems.length - 1];
  const dayRef = vehicleRef.collection("diagnosticDays").doc(dayKey);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    const existing = snap.exists ? snap.data() || {} : {};
    const stats = { ...(existing.stats || {}) };

    for (const diagnostics of diagnosticsItems) {
      const metrics = diagnostics.obd || {};
      updateMaxStat(stats, "maxSpeedKmh", metrics.vehicleSpeedKmh ?? diagnostics.gps?.speedKmh);
      updateMaxStat(stats, "maxEngineRpm", metrics.engineRpm);
      updateMaxStat(stats, "maxTotalOdometerKm", metrics.totalOdometerKm);
      updateMaxStat(stats, "maxTripOdometerKm", metrics.tripOdometerKm);
      updateMaxStat(stats, "maxCoolantTemperatureC", metrics.coolantTemperatureC);
      updateMaxStat(stats, "maxEngineOilTemperatureC", metrics.engineOilTemperatureC);
      updateMaxStat(stats, "maxFuelRateLh", metrics.fuelRateLh);
      updateMaxStat(stats, "maxEngineLoadPct", metrics.engineLoadPct);
      updateMaxStat(stats, "maxThrottlePositionPct", metrics.throttlePositionPct);
      updateMinStat(stats, "minExternalVoltageV", metrics.externalVoltageV);
      updateMinStat(stats, "minBatteryVoltageV", metrics.batteryVoltageV);
      updateMinStat(stats, "minFuelLevelPct", metrics.fuelLevelPct);
      updateMaxStat(stats, "maxDtcCount", metrics.dtcCount);
    }

    const existingEvents = Array.isArray(existing.events) ? existing.events : [];
    const mergedEvents = mergeDiagnosticEvents(existingEvents, incomingEvents);
    const existingSamples = Array.isArray(existing.samples) ? existing.samples : [];
    const mergedSamples = mergeDiagnosticSamples(existingSamples, incomingSamples);
    const previousFirstRecordAt = Number(existing.firstRecordAt || 0);
    const previousLastRecordAt = Number(existing.lastRecordAt || 0);
    const availableSensorKeys = Array.from(
      new Set([
        ...(Array.isArray(existing.availableSensorKeys) ? existing.availableSensorKeys : []),
        ...Object.keys(latestDiagnostics?.obd || {}),
      ])
    ).sort();

    tx.set(
      dayRef,
      {
        vehicleId,
        imei,
        dayKey,
        firstRecordAt:
          previousFirstRecordAt > 0
            ? Math.min(previousFirstRecordAt, firstRecordAt)
            : firstRecordAt,
        lastRecordAt: Math.max(previousLastRecordAt || 0, lastRecordAt),
        packetsCount: Number(existing.packetsCount || 0) + dayRecords.length,
        updatedAt: now,
        updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
        stats,
        latestObd: latestDiagnostics?.obd || {},
        availableSensorKeys,
        samples: mergedSamples,
        events: mergedEvents,
        eventKeys: mergedEvents.map((event) => event.key || event.id).filter(Boolean),
        summaryText: buildDailyDiagnosticSummaryText(stats, mergedEvents),
      },
      { merge: true }
    );
  });
}

function isCodec12SuccessPayload(payload) {
  const text = String(payload || "").toLowerCase();

  if (!text.trim()) return false;
  if (text.includes("error")) return false;
  if (text.includes("invalid")) return false;
  if (text.includes("failed")) return false;
  if (text.includes("unknown")) return false;
  if (text.includes("bad syntax")) return false;

  return true;
}

function resolveNotificationPath(moduleName, eventType, entityId, explicitPath) {
  const explicitValue = String(explicitPath || "").trim();
  const moduleValue = String(moduleName || "").trim();
  const eventValue = String(eventType || "").trim();
  const entityValue = String(entityId || "").trim();

  if (explicitValue.startsWith("/")) return explicitValue;
  if (moduleValue === "tools" && entityValue) return `/tools/${entityValue}`;
  if (moduleValue === "vehicles" && entityValue) return `/vehicles/${entityValue}`;
  if (moduleValue === "timesheets" && entityValue) return `/timesheets/${entityValue}`;
  if (moduleValue === "users" && entityValue) return `/users/${entityValue}/edit`;
  if (moduleValue === "maintenance" && eventValue.startsWith("maintenance_part_order")) return "/maintenance/orders";
  if (moduleValue === "maintenance" && entityValue) return `/maintenance/${entityValue}`;
  if (moduleValue === "expenses") return "/expenses/scan";
  if (moduleValue === "projects") return "/projects";
  if (moduleValue === "notifications") return "/notifications";

  if (eventValue === "notification_rule_changed") return "/notification-rules";
  if (
    eventValue === "backup_requested" ||
    eventValue === "backup_completed" ||
    eventValue === "backup_failed" ||
    eventValue === "data_retention_cleanup"
  ) {
    return "/control-panel";
  }

  if (moduleValue === "web" || moduleValue === "server" || moduleValue === "system" || moduleValue === "backup") {
    return "/control-panel";
  }

  return "/notifications";
}

async function collectPushTokensForUser(userId) {
  if (!userId) return [];

  const snap = await db
    .collection("pushTokens")
    .where("userId", "==", userId)
    .limit(NOTIFICATION_PUSH_BATCH_LIMIT)
    .get();

  if (snap.empty) return [];

  return snap.docs
    .map((docSnap) => ({
      id: docSnap.id,
      token: String(docSnap.data().token || "").trim(),
    }))
    .filter((item) => item.token);
}

async function sendPushForNotification(docSnap) {
  const data = docSnap.data() || {};

  if (data.pushDispatchedAt || data.pushDispatchStatus === "sent") {
    return;
  }

  const createdAt = Number(data.createdAt || 0);
  if (createdAt > 0 && createdAt < NOTIFICATION_LISTENER_START_TS - NOTIFICATION_STARTUP_GRACE_MS) {
    return;
  }

  const userId = String(data.userId || "").trim();
  if (!userId) return;

  const tokenItems = await collectPushTokensForUser(userId);
  if (tokenItems.length === 0) {
    console.warn(`[PUSH BRIDGE] No push tokens for userId=${userId} notificationId=${docSnap.id}`);
    await docSnap.ref.set(
      {
        pushDispatchStatus: "no_tokens",
        pushDispatchCheckedAt: Date.now(),
      },
      { merge: true }
    );
    return;
  }

  const path = resolveNotificationPath(data.module, data.eventType, data.entityId, data.notificationPath);
  const title = String(data.title || "Notificare WorkControl");
  const body = String(data.message || "");
  const webPushTopic = `wc-${docSnap.id}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);

  const response = await admin.messaging().sendEachForMulticast({
    tokens: tokenItems.map((item) => item.token),
    data: {
      title,
      body,
      path,
      notificationId: docSnap.id,
      module: String(data.module || ""),
      eventType: String(data.eventType || ""),
      entityId: String(data.entityId || ""),
      soundEnabled: data.soundEnabled === false ? "false" : "true",
    },
    webpush: {
      headers: {
        Topic: webPushTopic,
        TTL: "3600",
        Urgency: "normal",
      },
      fcmOptions: {
        link: path,
      },
    },
  });

  const invalidTokenDocIds = [];

  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = String(result.error?.code || "");
    if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
      invalidTokenDocIds.push(tokenItems[index].id);
    }
  });

  if (invalidTokenDocIds.length > 0) {
    await Promise.all(
      invalidTokenDocIds.map((id) => db.collection("pushTokens").doc(id).delete().catch(() => null))
    );
  }

  await docSnap.ref.set(
    {
      pushDispatchedAt: Date.now(),
      pushDispatchStatus: response.successCount > 0 ? "sent" : "failed",
      pushDispatchSuccessCount: response.successCount,
      pushDispatchFailureCount: response.failureCount,
    },
    { merge: true }
  );

  console.log(
    `[PUSH BRIDGE] notificationId=${docSnap.id} userId=${userId} sent=${response.successCount} failed=${response.failureCount}`
  );
}

function startNotificationPushBridge() {
  console.log("[PUSH BRIDGE] Starting notification -> FCM bridge listener");

  return db
    .collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(NOTIFICATION_PUSH_BATCH_LIMIT)
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const payload = change.doc.data() || {};
          console.log(
            `[PUSH BRIDGE] New notification detected id=${change.doc.id} userId=${String(payload.userId || "")} title="${String(payload.title || "")}"`
          );
          void sendPushForNotification(change.doc).catch((error) => {
            console.error("[PUSH BRIDGE][SEND ERROR]", error);
          });
        });
      },
      (error) => {
        console.error("[PUSH BRIDGE][LISTENER ERROR]", error);
      }
    );
}
function bytesToUnsignedBigInt(buffer) {
  let value = 0n;
  for (const byte of buffer) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}
function clearPendingCommandForImei(imei, reason) {
  if (!imei) return;

  const pending = pendingCodec12ByImei.get(imei);
  if (!pending) return;

  pendingCodec12ByImei.delete(imei);
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }

  void db
    .collection("vehicles")
    .doc(pending.vehicleId)
    .collection("commands")
    .doc(pending.commandId)
    .update({
      status: "failed",
      result: "failed",
      providerMessage: reason || `Conexiunea TCP cu ${imei} s-a inchis`,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .catch((error) => {
      console.error("[PENDING COMMAND CLEAR ERROR]", error);
    });
}
function decodeIoValue(buffer) {
  if (!buffer || buffer.length === 0) return null;
  if (buffer.length <= 6) return Number(bytesToUnsignedBigInt(buffer));
  return buffer.toString("hex");
}

function isValidImei(value) {
  return typeof value === "string" && /^\d{15}$/.test(value.trim());
}

function safeRemote(socket) {
  return `${socket.remoteAddress || "unknown"}:${socket.remotePort || "?"}`;
}

function clearActiveDeviceIfMatches(imei, socket) {
  if (!imei) return;

  const current = activeDevices.get(imei);
  if (!current) return;

  if (current.socket === socket) {
    activeDevices.delete(imei);
    healthyLoggedImei.delete(imei);
    clearPendingCommandForImei(imei, `Dispozitivul ${imei} s-a deconectat`);
    console.log(`[TCP DISCONNECTED] imei=${imei}`);
  }
}

function crc16IBM(buffer) {
  let crc = 0x0000;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }

  return crc & 0xffff;
}

function buildCodec12Command(commandText) {
  const commandBytes = Buffer.from(commandText, "ascii");
  const dataSize = 1 + 1 + 1 + 4 + commandBytes.length + 1;
  const packet = Buffer.alloc(4 + 4 + dataSize + 4);

  let offset = 0;

  packet.writeUInt32BE(0, offset);
  offset += 4;

  packet.writeUInt32BE(dataSize, offset);
  offset += 4;

  packet.writeUInt8(0x0c, offset);
  offset += 1;

  packet.writeUInt8(0x01, offset);
  offset += 1;

  packet.writeUInt8(0x05, offset);
  offset += 1;

  packet.writeUInt32BE(commandBytes.length, offset);
  offset += 4;

  commandBytes.copy(packet, offset);
  offset += commandBytes.length;

  packet.writeUInt8(0x01, offset);
  offset += 1;

  const crcSource = packet.subarray(8, offset);
  const crc = crc16IBM(crcSource);

  packet.writeUInt32BE(crc, offset);
  offset += 4;

  return packet;
}

function parseCodec12Packet(frame) {
  if (frame.length < 17) {
    throw new Error("Codec12 frame prea scurt");
  }

  const preamble = frame.readUInt32BE(0);
  if (preamble !== 0) {
    throw new Error("Codec12 preamble invalid");
  }

  const dataLength = frame.readUInt32BE(4);
  const totalLength = 8 + dataLength + 4;

  if (frame.length < totalLength) {
    throw new Error("Codec12 frame incomplet");
  }

  let offset = 8;

  const codecId = frame.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x0c) {
    throw new Error(`Codec12 invalid: 0x${codecId.toString(16)}`);
  }

  const quantity1 = frame.readUInt8(offset);
  offset += 1;

  const type = frame.readUInt8(offset);
  offset += 1;

  const payloadSize = frame.readUInt32BE(offset);
  offset += 4;

  const payload = frame.subarray(offset, offset + payloadSize).toString("ascii");
  offset += payloadSize;

  const quantity2 = frame.readUInt8(offset);
  offset += 1;

  const crc = frame.readUInt32BE(offset);
  offset += 4;

  return {
    totalLength,
    dataLength,
    codecId,
    quantity1,
    quantity2,
    type,
    payloadSize,
    payload,
    crc,
  };
}

function parseCodec8ERecord(buffer, startOffset) {
  let offset = startOffset;

  const gpsTimestamp = Number(buffer.readBigUInt64BE(offset));
  offset += 8;

  const priority = buffer.readUInt8(offset);
  offset += 1;

  const lng = buffer.readInt32BE(offset) / 10000000;
  offset += 4;

  const lat = buffer.readInt32BE(offset) / 10000000;
  offset += 4;

  const altitude = buffer.readUInt16BE(offset);
  offset += 2;

  const angle = buffer.readUInt16BE(offset);
  offset += 2;

  const satellites = buffer.readUInt8(offset);
  offset += 1;

  const speedKmh = buffer.readUInt16BE(offset);
  offset += 2;

  const eventIoId = buffer.readUInt16BE(offset);
  offset += 2;

  const totalIo = buffer.readUInt16BE(offset);
  offset += 2;

  const io = {};

  const n1 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n1; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 1));
    offset += 1;
  }

  const n2 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n2; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 2));
    offset += 2;
  }

  const n4 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n4; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 4));
    offset += 4;
  }

  const n8 = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < n8; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;
    io[id] = decodeIoValue(buffer.subarray(offset, offset + 8));
    offset += 8;
  }

  const nx = buffer.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < nx; i++) {
    const id = buffer.readUInt16BE(offset);
    offset += 2;

    const len = buffer.readUInt16BE(offset);
    offset += 2;

    io[id] = decodeIoValue(buffer.subarray(offset, offset + len));
    offset += len;
  }

  return {
    nextOffset: offset,
    record: {
      gpsTimestamp,
      priority,
      lat,
      lng,
      altitude,
      angle,
      satellites,
      speedKmh,
      eventIoId,
      totalIo,
      io,
    },
  };
}
async function claimCommandIfRequested(commandRef) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(commandRef);
    if (!snap.exists) {
      return null;
    }

    const data = snap.data() || {};
    if (data.status !== "requested") {
      return null;
    }

    tx.update(commandRef, {
      status: "pending",
      result: "sending",
      providerMessage: "Comanda preluata de gateway.",
      pickedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return data;
  });
}
function parseTcpAvlPacket(frame) {
  if (frame.length < 12) {
    throw new Error("Frame prea scurt");
  }

  const preamble = frame.readUInt32BE(0);
  if (preamble !== 0) {
    throw new Error("Preamble invalid");
  }

  const dataLength = frame.readUInt32BE(4);
  const totalLength = 8 + dataLength + 4;

  if (frame.length < totalLength) {
    throw new Error("Frame incomplet");
  }

  const codecId = frame.readUInt8(8);
  const recordCount = frame.readUInt8(9);

  if (codecId !== 0x8e) {
    throw new Error(`Codec nesuportat acum: 0x${codecId.toString(16)}`);
  }

  let offset = 10;
  const records = [];

  for (let i = 0; i < recordCount; i++) {
    const parsed = parseCodec8ERecord(frame, offset);
    records.push(parsed.record);
    offset = parsed.nextOffset;
  }

  const recordCount2 = frame.readUInt8(offset);
  offset += 1;

  if (recordCount !== recordCount2) {
    throw new Error("recordCount1 != recordCount2");
  }

  const crc = frame.readUInt32BE(offset);
  offset += 4;

  return {
    totalLength,
    dataLength,
    codecId,
    recordCount,
    crc,
    records,
  };
}

function isValidGpsRecord(record) {
  return (
    typeof record.lat === "number" &&
    typeof record.lng === "number" &&
    Number.isFinite(record.lat) &&
    Number.isFinite(record.lng) &&
    Math.abs(record.lat) <= 90 &&
    Math.abs(record.lng) <= 180 &&
    !(record.lat === 0 && record.lng === 0)
  );
}

function getDayKeyFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildPointId(record) {
  const latPart = Math.round(record.lat * 100000);
  const lngPart = Math.round(record.lng * 100000);
  return `${record.gpsTimestamp}_${latPart}_${lngPart}`;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const earthRadius = 6_371_000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function shouldKeepRecord(lastSaved, record) {
  if (!lastSaved) return true;

  const deltaMs = record.gpsTimestamp - lastSaved.gpsTimestamp;
  if (deltaMs <= 0) return false;

  const speedKmh = Number(record.speedKmh || 0);
  const moving = speedKmh >= MOVING_SPEED_THRESHOLD_KMH;
  const minInterval = moving ? MIN_POINT_INTERVAL_MS_MOVING : MIN_POINT_INTERVAL_MS_IDLE;
  const movedMeters = distanceMeters(lastSaved.lat, lastSaved.lng, record.lat, record.lng);

  if (
    !moving &&
    deltaMs <= IDLE_JITTER_MAX_INTERVAL_MS &&
    movedMeters < IDLE_JITTER_DISTANCE_METERS
  ) {
    return false;
  }

  if (deltaMs < minInterval && movedMeters < MIN_POINT_DISTANCE_METERS) {
    return false;
  }

  return true;
}

function distanceMetersBetween(a, b) {
  if (!a || !b) return 0;
  return distanceMeters(a.lat, a.lng, b.lat, b.lng);
}

function computeDistanceIncrementKm(previousPoint, points) {
  if (!Array.isArray(points) || !points.length) return 0;

  let totalMeters = 0;
  let prev = previousPoint || null;

  for (const point of points) {
    if (!prev) {
      prev = point;
      continue;
    }

    const segmentMeters = distanceMetersBetween(prev, point);
    if (
      Number.isFinite(segmentMeters) &&
      segmentMeters >= 0 &&
      segmentMeters <= MAX_DISTANCE_STEP_METERS
    ) {
      totalMeters += segmentMeters;
    }

    prev = point;
  }

  return Number((totalMeters / 1000).toFixed(3));
}

function getRecordOdometerKm(record) {
  const odometerMeters = typeof record?.io?.[16] === "number" ? record.io[16] : null;
  if (odometerMeters === null) return null;

  const odometerKm = odometerMeters / 1000;
  return Number.isFinite(odometerKm) && odometerKm >= 0 ? odometerKm : null;
}

function getRecordRoundedOdometerKm(record) {
  const odometerKm = getRecordOdometerKm(record);
  return odometerKm !== null ? Number(odometerKm.toFixed(1)) : null;
}

function buildGpsSnapshotFromRecord(imei, record, now) {
  const ignitionOn =
    typeof record.io[239] === "number" ? record.io[239] === 1 : null;

  return {
    lat: record.lat,
    lng: record.lng,
    speedKmh: record.speedKmh,
    gpsTimestamp: record.gpsTimestamp,
    serverTimestamp: now,
    expiresAt: now + LIVE_DIAGNOSTICS_TTL_MS,
    ignitionOn,
    odometerKm: getRecordRoundedOdometerKm(record),
    tripOdometerKm:
      typeof record.io[199] === "number"
        ? Number((record.io[199] / 1000).toFixed(1))
        : null,
    imei,
    online: true,
    satellites: record.satellites,
    altitude: record.altitude,
    angle: record.angle,
    rawIo: record.io || {},
  };
}

async function writeVehicleLiveSnapshot(
  vehicleRef,
  vehicleId,
  imei,
  latestSnapshot,
  latestDiagnostics,
  currentKmIncrement,
  dataUsageDelta,
  now
) {
  const usageInitialValue = buildGpsDataUsageInitialValue(dataUsageDelta, now);
  const updatePayload = {
    gpsSnapshot: latestSnapshot,
    liveDiagnostics: latestDiagnostics,
    "tracker.imei": imei,
    "tracker.lastSeenAt": now,
    "tracker.updatedAt": now,
    "tracker.protocol": "teltonika_codec_8e_tcp",
    ...buildGpsDataUsageUpdateFields(dataUsageDelta, now),
    updatedAt: now,
  };

  if (currentKmIncrement > 0) {
    updatePayload.currentKm = admin.firestore.FieldValue.increment(currentKmIncrement);
  }

  try {
    await vehicleRef.update(updatePayload);
  } catch (error) {
    if (error?.code !== 5 && error?.code !== "not-found") {
      throw error;
    }

    await vehicleRef.set(
      {
        gpsSnapshot: latestSnapshot,
        liveDiagnostics: latestDiagnostics,
        ...(usageInitialValue ? { gpsDataUsage: usageInitialValue } : {}),
        ...(currentKmIncrement > 0
          ? {
              currentKm: admin.firestore.FieldValue.increment(currentKmIncrement),
            }
          : {}),
        tracker: {
          imei,
          lastSeenAt: now,
          updatedAt: now,
          protocol: "teltonika_codec_8e_tcp",
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

async function ensureVehicleRuntimeDocument(vehicleRef, runtimeRef, vehicleId) {
  const existing = runtimeInitializationByVehicle.get(vehicleId);
  if (existing) return existing;

  const initialization = (async () => {
    const [vehicleSnap, runtimeSnap] = await Promise.all([
      vehicleRef.get(),
      runtimeRef.get(),
    ]);
    const vehicleData = vehicleSnap.exists ? vehicleSnap.data() || {} : {};
    const runtimeData = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
    const currentBase = Number(runtimeData.mileageBaseKm);
    if (runtimeSnap.exists && Number.isFinite(currentBase) && currentBase >= 0) return;

    await runtimeRef.set(
      {
        schemaVersion: 1,
        vehicleId,
        mileageBaseKm: Math.max(0, Number(vehicleData.currentKm || 0)),
        pendingCurrentKm: Math.max(0, Number(runtimeData.pendingCurrentKm || 0)),
        createdAt: Date.now(),
        createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  })().catch((error) => {
    runtimeInitializationByVehicle.delete(vehicleId);
    throw error;
  });

  runtimeInitializationByVehicle.set(vehicleId, initialization);
  return initialization;
}

async function writeVehicleRuntimeLiveSnapshot(
  vehicleRef,
  runtimeRef,
  vehicleId,
  imei,
  latestSnapshot,
  latestDiagnostics,
  currentKmIncrement,
  dataUsageDelta,
  now
) {
  await ensureVehicleRuntimeDocument(vehicleRef, runtimeRef, vehicleId);
  const updatePayload = {
    schemaVersion: 1,
    vehicleId,
    gpsSnapshot: latestSnapshot,
    liveDiagnostics: latestDiagnostics,
    "tracker.imei": imei,
    "tracker.lastSeenAt": now,
    "tracker.updatedAt": now,
    "tracker.protocol": "teltonika_codec_8e_tcp",
    ...buildGpsDataUsageUpdateFields(dataUsageDelta, now),
    updatedAt: now,
    updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (currentKmIncrement > 0) {
    updatePayload.pendingCurrentKm = admin.firestore.FieldValue.increment(currentKmIncrement);
  }

  try {
    await runtimeRef.update(updatePayload);
  } catch (error) {
    if (error?.code !== 5 && error?.code !== "not-found") throw error;
    runtimeInitializationByVehicle.delete(vehicleId);
    await ensureVehicleRuntimeDocument(vehicleRef, runtimeRef, vehicleId);
    await runtimeRef.update(updatePayload);
  }
  writeAmplificationCounters.runtimeSnapshotWrites += 1;
}

async function writeVehicleRuntimeDataUsageOnly(
  vehicleRef,
  runtimeRef,
  vehicleId,
  imei,
  dataUsageDelta,
  now
) {
  const usageUpdateFields = buildGpsDataUsageUpdateFields(dataUsageDelta, now);
  if (!Object.keys(usageUpdateFields).length) return;
  await ensureVehicleRuntimeDocument(vehicleRef, runtimeRef, vehicleId);
  await runtimeRef.update({
    ...usageUpdateFields,
    "tracker.imei": imei,
    "tracker.lastSeenAt": now,
    "tracker.updatedAt": now,
    "tracker.protocol": "teltonika_codec_8e_tcp",
    updatedAt: now,
    updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function flushVehicleRuntimeToRoot(
  vehicleRef,
  runtimeRef,
  vehicleId,
  rootFlushSeconds,
  now,
  force = false
) {
  const lastFlushAt = lastRuntimeRootFlushByVehicle.get(vehicleId) || 0;
  if (!force && lastFlushAt > 0 && now - lastFlushAt < rootFlushSeconds * 1000) {
    return false;
  }

  const wrote = await db.runTransaction(async (transaction) => {
    const [vehicleSnap, runtimeSnap] = await Promise.all([
      transaction.get(vehicleRef),
      transaction.get(runtimeRef),
    ]);
    if (!runtimeSnap.exists) return false;

    const vehicleData = vehicleSnap.exists ? vehicleSnap.data() || {} : {};
    const runtimeData = runtimeSnap.data() || {};
    const pendingCurrentKm = Math.max(0, Number(runtimeData.pendingCurrentKm || 0));
    const consolidatedKm = computeConsolidatedMileage(
      vehicleData.currentKm,
      runtimeData.mileageBaseKm,
      pendingCurrentKm
    );
    const tracker = runtimeData.tracker && typeof runtimeData.tracker === "object"
      ? runtimeData.tracker
      : {};
    const rootPayload = {
      currentKm: consolidatedKm,
      ...(runtimeData.gpsDataUsage ? { gpsDataUsage: runtimeData.gpsDataUsage } : {}),
      "tracker.imei": tracker.imei || "",
      "tracker.lastSeenAt": Number(tracker.lastSeenAt || now),
      "tracker.updatedAt": Number(tracker.updatedAt || now),
      "tracker.protocol": tracker.protocol || "teltonika_codec_8e_tcp",
      updatedAt: now,
    };

    if (vehicleSnap.exists) {
      transaction.update(vehicleRef, rootPayload);
    } else {
      transaction.set(
        vehicleRef,
        {
          currentKm: consolidatedKm,
          ...(runtimeData.gpsDataUsage ? { gpsDataUsage: runtimeData.gpsDataUsage } : {}),
          tracker: {
            imei: tracker.imei || "",
            lastSeenAt: Number(tracker.lastSeenAt || now),
            updatedAt: Number(tracker.updatedAt || now),
            protocol: tracker.protocol || "teltonika_codec_8e_tcp",
          },
          updatedAt: now,
        },
        { merge: true }
      );
    }
    transaction.set(
      runtimeRef,
      {
        mileageBaseKm: consolidatedKm,
        pendingCurrentKm: 0,
        lastRootFlushAt: now,
        lastRootFlushAtServer: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });

  if (wrote) {
    lastRuntimeRootFlushByVehicle.set(vehicleId, now);
    writeAmplificationCounters.runtimeRootFlushes += 1;
  }
  return wrote;
}

async function writeVehicleDataUsageOnly(vehicleRef, imei, dataUsageDelta, now) {
  const usageUpdateFields = buildGpsDataUsageUpdateFields(dataUsageDelta, now);
  if (!Object.keys(usageUpdateFields).length) return;

  const usageInitialValue = buildGpsDataUsageInitialValue(dataUsageDelta, now);
  const updatePayload = {
    ...usageUpdateFields,
    "tracker.imei": imei,
    "tracker.lastSeenAt": now,
    "tracker.updatedAt": now,
    "tracker.protocol": "teltonika_codec_8e_tcp",
    updatedAt: now,
  };

  try {
    await vehicleRef.update(updatePayload);
  } catch (error) {
    if (error?.code !== 5 && error?.code !== "not-found") {
      throw error;
    }

    await vehicleRef.set(
      {
        ...(usageInitialValue ? { gpsDataUsage: usageInitialValue } : {}),
        tracker: {
          imei,
          lastSeenAt: now,
          updatedAt: now,
          protocol: "teltonika_codec_8e_tcp",
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

function computeOdometerIncrementKm(previousOdometerKm, points) {
  if (!Array.isArray(points) || !points.length) {
    return { incrementKm: 0, latestOdometerKm: previousOdometerKm ?? null };
  }

  let previous =
    typeof previousOdometerKm === "number" && Number.isFinite(previousOdometerKm)
      ? previousOdometerKm
      : null;
  let latest = previous;
  let incrementKm = 0;

  for (const point of points) {
    const odometerKm = getRecordOdometerKm(point);
    if (odometerKm === null) continue;

    if (previous !== null) {
      const deltaKm = odometerKm - previous;
      if (deltaKm > 0 && deltaKm <= MAX_ODOMETER_INCREMENT_KM) {
        incrementKm += deltaKm;
      }
    }

    previous = odometerKm;
    latest = odometerKm;
  }

  return {
    incrementKm: Number(incrementKm.toFixed(3)),
    latestOdometerKm: latest,
  };
}

function getLastCleanupTs() {
  try {
    if (!fs.existsSync(LAST_CLEANUP_FILE)) return 0;
    const raw = fs.readFileSync(LAST_CLEANUP_FILE, "utf8").trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function setLastCleanupTs(ts) {
  try {
    fs.writeFileSync(LAST_CLEANUP_FILE, String(ts));
  } catch (error) {
    console.error("[CLEANUP WRITE ERROR]", error);
  }
}

async function runCommandSafe(command) {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout && stdout.trim()) {
      console.log(`[CLEANUP CMD OK] ${command}`);
    }
    if (stderr && stderr.trim()) {
      console.warn(`[CLEANUP CMD STDERR] ${command} -> ${stderr.trim()}`);
    }
  } catch (error) {
    console.error(`[CLEANUP CMD ERROR] ${command}`, error);
  }
}

async function runServerCleanup() {
  console.log("[CLEANUP START] incepe curatarea automata");

  await runCommandSafe("pm2 flush");
  await runCommandSafe("journalctl --vacuum-time=3d");
  await runCommandSafe("journalctl --vacuum-size=100M");
  await runCommandSafe("apt clean");
  await runCommandSafe("apt autoclean");
  await runCommandSafe("apt autoremove -y");
  await runCommandSafe("find /var/log -type f -name '*.gz' -mtime +7 -delete");
  await runCommandSafe("find /var/log -type f -name '*.log' -size +50M -exec truncate -s 0 {} \\;");
  await runCommandSafe("npm cache clean --force");
  await runCommandSafe("du -sh /var/log ~/.pm2/logs 2>/dev/null || true");
  await runCommandSafe("df -h /");

  setLastCleanupTs(Date.now());

  console.log("[CLEANUP DONE] curatarea automata s-a terminat");
}

async function maybeRunServerCleanup() {
  const now = Date.now();
  const lastCleanup = getLastCleanupTs();

  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return;
  }

  await runServerCleanup();
}

function startCleanupScheduler() {
  void maybeRunServerCleanup();

  setInterval(() => {
    void maybeRunServerCleanup();
  }, 60 * 60 * 1000);
}

async function saveRecordsToFirestore(imei, records, dataUsageDelta = null) {
  const cacheEntry = trackerBindingCache.get(imei);
  let binding = cacheEntry?.expiresAt > Date.now() ? cacheEntry.binding : null;

  if (!binding) {
    const bindingRef = db.collection("trackerBindings").doc(imei);
    const bindingSnap = await bindingRef.get();
    if (bindingSnap.exists) {
      binding = bindingSnap.data();
      trackerBindingCache.set(imei, {
        binding,
        expiresAt: Date.now() + TRACKER_BINDING_CACHE_TTL_MS,
      });
    }
  }

  if (!binding) {
    console.warn(`[WARN] IMEI fara binding: ${imei}`);
    const now = Date.now();
    const lastLoggedAt = lastUnboundLogByImei.get(imei) || 0;
    if (now - lastLoggedAt >= UNBOUND_LOG_THROTTLE_MS) {
      lastUnboundLogByImei.set(imei, now);
      await db.collection("unboundTrackerPackets").add({
        imei,
        recordsCount: records.length,
        createdAt: now,
        sample: records[0] || null,
      });
    }
    return;
  }

  const vehicleId = binding.vehicleId;
  const vehicleRef = db.collection("vehicles").doc(vehicleId);
  const now = Date.now();
  const gpsCostConfig = await getGpsCostOptimizationConfig();
  const useGpsCostCanary =
    gpsCostConfig.enabled && gpsCostConfig.canaryTrackerImeis.has(String(imei));
  const useRuntimeLive = shouldUseRuntimeLive(gpsCostConfig.runtimeLive, imei);
  const runtimeRef = vehicleRef.collection("positions").doc("_runtime");

  const validRecords = records
    .filter(isValidGpsRecord)
    .sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);

  if (!validRecords.length) {
    console.warn(`[WARN] imei=${imei} batch fara coordonate GPS valide`);
    return;
  }

  const previousSavedPointFromMemory = lastSavedPointByImei.get(imei) || null;
  let previousSavedPoint = previousSavedPointFromMemory;
  const recordsForStorage = [];
  for (const record of validRecords) {
    if (shouldKeepRecord(previousSavedPoint, record)) {
      recordsForStorage.push(record);
      previousSavedPoint = record;
    }
  }

  if (previousSavedPoint) {
    lastSavedPointByImei.set(imei, previousSavedPoint);
  }

  const distanceIncrementKm = computeDistanceIncrementKm(
    previousSavedPointFromMemory,
    recordsForStorage
  );
  let previousOdometerKm = lastOdometerKmByImei.get(imei);
  const hasOdometerInBatch = validRecords.some((record) => getRecordOdometerKm(record) !== null);

  if (hasOdometerInBatch && (typeof previousOdometerKm !== "number" || !Number.isFinite(previousOdometerKm))) {
    const [vehicleSnap, runtimeSnap] = await Promise.all([
      vehicleRef.get().catch(() => null),
      useRuntimeLive ? runtimeRef.get().catch(() => null) : Promise.resolve(null),
    ]);
    const snapshotOdometerKm = Number(
      runtimeSnap?.data()?.gpsSnapshot?.odometerKm
      ?? vehicleSnap?.data()?.gpsSnapshot?.odometerKm
    );
    previousOdometerKm = Number.isFinite(snapshotOdometerKm) ? snapshotOdometerKm : null;
  }

  const odometerIncrement = computeOdometerIncrementKm(previousOdometerKm, validRecords);
  if (typeof odometerIncrement.latestOdometerKm === "number" && Number.isFinite(odometerIncrement.latestOdometerKm)) {
    lastOdometerKmByImei.set(imei, odometerIncrement.latestOdometerKm);
  }

  const currentKmIncrement = odometerIncrement.incrementKm > 0
    ? odometerIncrement.incrementKm
    : distanceIncrementKm;

  const latestRecord = validRecords[validRecords.length - 1] || null;
  const latestDiagnostics = latestRecord ? buildLiveDiagnosticsSnapshot(imei, latestRecord, now) : null;
  const latestSnapshot = latestRecord ? buildGpsSnapshotFromRecord(imei, latestRecord, now) : null;
  const diagnosticGroups = new Map();
  const positionGroups = new Map();

  for (const record of validRecords) {
    const dayKey = getDayKeyFromTs(record.gpsTimestamp);
    if (!diagnosticGroups.has(dayKey)) diagnosticGroups.set(dayKey, []);
    diagnosticGroups.get(dayKey).push(record);
  }

  for (const record of recordsForStorage) {
    const dayKey = getDayKeyFromTs(record.gpsTimestamp);
    if (!positionGroups.has(dayKey)) positionGroups.set(dayKey, []);
    positionGroups.get(dayKey).push(record);
  }

  if (recordsForStorage.length > 0) {
    for (const [dayKey, dayRecords] of positionGroups.entries()) {
      const dayRef = db
        .collection("vehicles")
        .doc(vehicleId)
        .collection("positionDays")
        .doc(dayKey);

      const dayChunks = chunkArray(dayRecords, 450);
      const dayMetadataKey = `${vehicleId}:${dayKey}`;
      const shouldRefreshDayMetadata = !useRuntimeLive || shouldWriteDayMetadata(
        lastDayMetadataWriteByVehicle.get(dayMetadataKey),
        now,
        gpsCostConfig.runtimeLive.dayMetadataRefreshSeconds
      );
      let dayMetadataWritten = false;

      for (const dayChunk of dayChunks) {
        const batch = db.batch();

        if (shouldRefreshDayMetadata && !dayMetadataWritten) {
          batch.set(
            dayRef,
            {
              vehicleId,
              imei,
              dayKey,
              updatedAt: now,
              updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          dayMetadataWritten = true;
        }

        for (const record of dayChunk) {
          const ignitionOn =
            typeof record.io[239] === "number" ? record.io[239] === 1 : null;

          const pointPayload = {
            imei,
            vehicleId,
            dayKey,
            lat: Number(record.lat.toFixed(6)),
            lng: Number(record.lng.toFixed(6)),
            speedKmh: record.speedKmh,
            altitude: record.altitude,
            angle: record.angle,
            satellites: record.satellites,
            gpsTimestamp: record.gpsTimestamp,
            serverTimestamp: now,
            eventIoId: record.eventIoId,
            ignitionOn,
            odometerKm: getRecordRoundedOdometerKm(record),
            tripOdometerKm:
              typeof record.io[199] === "number"
                ? Number((record.io[199] / 1000).toFixed(1))
                : null,
            rawIo: record.io || {},
          };

          const pointRef = dayRef.collection("points").doc(buildPointId(record));
          batch.set(
            pointRef,
            pointPayload,
            { merge: true }
          );
        }

        await batch.commit();
      }

      if (dayMetadataWritten) {
        lastDayMetadataWriteByVehicle.set(dayMetadataKey, now);
        writeAmplificationCounters.dayMetadataWrites += 1;
      } else if (useRuntimeLive) {
        writeAmplificationCounters.dayMetadataWritesSkipped += 1;
      }
    }
  }

  if (useGpsCostCanary) {
    await queueGpsCostAggregation({
      vehicleId,
      imei,
      diagnosticGroups,
      dataUsageDelta,
      flushSeconds: gpsCostConfig.diagnosticFlushSeconds,
    });
  } else {
    for (const [dayKey, dayRecords] of diagnosticGroups.entries()) {
      await updateDailyDiagnostics(vehicleRef, vehicleId, imei, dayKey, dayRecords, now);
    }
  }

  if (latestSnapshot) {
    const lastSnapshotWriteAt = lastSnapshotWriteByVehicle.get(vehicleId) || 0;
    const shouldWriteSnapshot =
      now - lastSnapshotWriteAt >= SNAPSHOT_WRITE_MIN_INTERVAL_MS ||
      (latestSnapshot.speedKmh || 0) >= MOVING_SPEED_THRESHOLD_KMH ||
      currentKmIncrement > 0;
    if (shouldWriteSnapshot) {
      if (useRuntimeLive) {
        await writeVehicleRuntimeLiveSnapshot(
          vehicleRef,
          runtimeRef,
          vehicleId,
          imei,
          latestSnapshot,
          latestDiagnostics,
          gpsCostConfig.runtimeLive.dualWriteRoot ? 0 : currentKmIncrement,
          useGpsCostCanary ? null : dataUsageDelta,
          now
        );
        if (gpsCostConfig.runtimeLive.dualWriteRoot) {
          await writeVehicleLiveSnapshot(
            vehicleRef,
            vehicleId,
            imei,
            latestSnapshot,
            latestDiagnostics,
            currentKmIncrement,
            useGpsCostCanary ? null : dataUsageDelta,
            now
          );
          writeAmplificationCounters.legacyRootSnapshotWrites += 1;
        } else {
          await flushVehicleRuntimeToRoot(
            vehicleRef,
            runtimeRef,
            vehicleId,
            gpsCostConfig.runtimeLive.rootFlushSeconds,
            now
          );
        }
      } else {
        await writeVehicleLiveSnapshot(
          vehicleRef,
          vehicleId,
          imei,
          latestSnapshot,
          latestDiagnostics,
          currentKmIncrement,
          useGpsCostCanary ? null : dataUsageDelta,
          now
        );
        writeAmplificationCounters.legacyRootSnapshotWrites += 1;
      }
      lastSnapshotWriteByVehicle.set(vehicleId, now);
    } else {
      if (!useGpsCostCanary) {
        if (useRuntimeLive) {
          await writeVehicleRuntimeDataUsageOnly(
            vehicleRef,
            runtimeRef,
            vehicleId,
            imei,
            dataUsageDelta,
            now
          );
        } else {
          await writeVehicleDataUsageOnly(vehicleRef, imei, dataUsageDelta, now);
        }
      }
    }
  } else {
    const usageInitialValue = buildGpsDataUsageInitialValue(
      useGpsCostCanary ? null : dataUsageDelta,
      now
    );
    await vehicleRef.set(
      {
        ...(usageInitialValue ? { gpsDataUsage: usageInitialValue } : {}),
        tracker: {
          imei,
          lastSeenAt: now,
          updatedAt: now,
          protocol: "teltonika_codec_8e_tcp",
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }

  if (!healthyLoggedImei.has(imei)) {
    healthyLoggedImei.add(imei);
    console.log(
      `[TRACKER OK] imei=${imei} vehicleId=${vehicleId} recordsIn=${validRecords.length} recordsSaved=${recordsForStorage.length}`
    );
  }
  maybeLogWriteAmplificationCounters(now);
}

function enqueueTrackerSave(imei, task) {
  const key = String(imei || "");
  const previous = saveQueueByImei.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  saveQueueByImei.set(key, current);
  void current.finally(() => {
    if (saveQueueByImei.get(key) === current) saveQueueByImei.delete(key);
  });
  return current;
}

function sendCodec12CommandToDevice(imei, commandText, meta) {
  const entry = activeDevices.get(imei);

  if (!entry || !entry.socket || entry.socket.destroyed) {
    throw new Error(`Dispozitivul ${imei} nu are conexiune TCP activa`);
  }

  const packet = buildCodec12Command(commandText);

  if (meta?.vehicleId && meta?.commandId) {
    const existing = pendingCodec12ByImei.get(imei);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(async () => {
      const pending = pendingCodec12ByImei.get(imei);
      if (!pending) return;

      pendingCodec12ByImei.delete(imei);

      try {
        await db
          .collection("vehicles")
          .doc(pending.vehicleId)
          .collection("commands")
          .doc(pending.commandId)
          .update({
            status: "failed",
            result: "failed",
            providerMessage: `Timeout asteptand raspuns Codec12 de la ${imei}`,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
      } catch (error) {
        console.error("[COMMAND TIMEOUT UPDATE ERROR]", error);
      }
    }, COMMAND_RESPONSE_TIMEOUT_MS);

    pendingCodec12ByImei.set(imei, {
      vehicleId: meta.vehicleId,
      commandId: meta.commandId,
      commandText,
      timeout,
      requestedAt: Date.now(),
    });
  }

  if (typeof entry.reportTxBytes === "function") {
    entry.reportTxBytes(packet.length);
  }

  entry.socket.write(packet, (err) => {
    if (err) {
      console.error(`[CMD WRITE ERROR] imei=${imei} command="${commandText}"`, err);
      return;
    }

    console.log(
      `[CMD SENT] imei=${imei} command="${commandText}" hex=${packet.toString("hex")}`
    );
  });

  activeDevices.set(imei, {
    socket: entry.socket,
    lastSeenAt: Date.now(),
  });
}
function mapCommandToTeltonika(commandDoc) {
  const durationSec =
    typeof commandDoc?.durationSec === "number" && commandDoc.durationSec > 0
      ? Math.max(1, Math.min(600, Math.round(commandDoc.durationSec)))
      : 60;

  if (commandDoc.type === "pulse_dout1") {
    return `setdigout 1? ${durationSec}`;
  }

  if (commandDoc.type === "block_start") {
    return "setdigout 0? 0";
  }

  if (commandDoc.type === "allow_start") {
    return "setdigout 1? 0";
  }

  throw new Error(`Tip comanda necunoscut: ${commandDoc.type}`);
}
async function processVehicleCommand(vehicleId, commandId, commandDoc) {
  const commandRef = db
    .collection("vehicles")
    .doc(vehicleId)
    .collection("commands")
    .doc(commandId);

  try {
    const vehicleSnap = await db.collection("vehicles").doc(vehicleId).get();
    if (!vehicleSnap.exists) {
      throw new Error("Vehicle not found");
    }

    const vehicle = vehicleSnap.data() || {};
    const imei = vehicle?.tracker?.imei;

    if (!imei) {
      throw new Error("IMEI lipsa in vehicles/{vehicleId}.tracker.imei");
    }

    const entry = activeDevices.get(imei);
    if (!entry || !entry.socket || entry.socket.destroyed) {
      await commandRef.update({
        status: "failed",
        result: "failed",
        providerMessage: `Dispozitivul ${imei} nu are conexiune TCP activa`,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }

    const teltonikaCommand = mapCommandToTeltonika(commandDoc);

    console.log(
      `[COMMAND QUEUED] vehicleId=${vehicleId} commandId=${commandId} imei=${imei} teltonika="${teltonikaCommand}"`
    );

await commandRef.update({
  status: "pending",
  result: "sending",
  providerMessage: `Se trimite catre ${imei}: ${teltonikaCommand}`,
  sentCommand: teltonikaCommand,
  updatedAt: Date.now(),
});

sendCodec12CommandToDevice(imei, teltonikaCommand, {
  vehicleId,
  commandId,
});
  } catch (error) {
    console.error(
      `[COMMAND ERROR] vehicleId=${vehicleId} commandId=${commandId}`,
      error
    );

    await commandRef.update({
      status: "failed",
      result: "failed",
      providerMessage: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
function watchVehicleCommands() {
  const serverStartedAt = Date.now();

  db.collectionGroup("commands")
    .where("status", "==", "requested")
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;

          const docSnap = change.doc;
          const data = docSnap.data() || {};
          const vehicleRef = docSnap.ref.parent.parent;

          if (!vehicleRef) return;

          const requestedAt =
            typeof data.requestedAt === "number" ? data.requestedAt : 0;

          // ignoram comenzile vechi la pornirea serverului
          if (requestedAt && requestedAt < serverStartedAt - 5000) {
            console.log(
              `[COMMAND SKIPPED OLD] vehicleId=${vehicleRef.id} commandId=${docSnap.id} requestedAt=${requestedAt}`
            );
            return;
          }

          void (async () => {
            try {
              const claimed = await claimCommandIfRequested(docSnap.ref);
              if (!claimed) {
                return;
              }

              await processVehicleCommand(vehicleRef.id, docSnap.id, claimed);
            } catch (err) {
              console.error("[COMMAND PROCESS ERROR]", err);
            }
          })();
        });
      },
      (error) => {
        console.error("[COMMAND WATCH ERROR]", error);
      }
    );
}

const server = net.createServer((socket) => {
  const remote = safeRemote(socket);

  console.log(`[TCP CONNECTED] ${remote}`);

  socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS);

  const session = {
    stage: "imei",
    imei: null,
    buffer: Buffer.alloc(0),
    pendingRxBytes: 0,
    pendingTxBytes: 0,
  };

  socket.on("timeout", () => {
    console.warn(`[SOCKET TIMEOUT] ${remote}`);
    socket.destroy();
  });

  socket.on("data", (chunk) => {
    try {
      session.pendingRxBytes += toByteCount(chunk.length);
      session.buffer = Buffer.concat([session.buffer, chunk]);

      if (session.buffer.length > MAX_BUFFER_BYTES) {
        console.warn(`[BUFFER OVERFLOW] ${remote} bytes=${session.buffer.length}`);
        socket.destroy();
        return;
      }

      while (session.buffer.length > 0) {
        if (session.stage === "imei") {
          if (session.buffer.length < 2) return;

          const imeiLength = session.buffer.readUInt16BE(0);

          if (imeiLength <= 0 || imeiLength > 32) {
            const sampleHex = session.buffer
              .subarray(0, Math.min(16, session.buffer.length))
              .toString("hex");
            console.warn(
              `[INVALID IMEI LENGTH] ${remote} imeiLength=${imeiLength} sample=${sampleHex}`
            );
            socket.destroy();
            return;
          }

          if (session.buffer.length < 2 + imeiLength) return;

          const rawImei = session.buffer
            .subarray(2, 2 + imeiLength)
            .toString("ascii")
            .trim();

          if (!isValidImei(rawImei)) {
            console.warn(`[INVALID IMEI] ${remote} value="${rawImei}"`);
            socket.destroy();
            return;
          }

          const imei = rawImei;

          session.imei = imei;
          activeDevices.set(imei, {
            socket,
            lastSeenAt: Date.now(),
            reportTxBytes: (bytes) => addSessionTxBytes(session, bytes),
          });

          session.buffer = session.buffer.subarray(2 + imeiLength);
          session.stage = "avl";

          console.log(`[IMEI ACCEPTED] imei=${imei} remote=${remote}`);
          const imeiAck = Buffer.from([0x01]);
          addSessionTxBytes(session, imeiAck.length);
          socket.write(imeiAck);
          continue;
        }

        if (session.stage === "avl") {
          if (session.buffer.length < 12) return;

          const preamble = session.buffer.readUInt32BE(0);
          if (preamble !== 0) {
            const sampleHex = session.buffer
              .subarray(0, Math.min(24, session.buffer.length))
              .toString("hex");

            console.warn(
              `[INVALID PREAMBLE] imei=${session.imei} remote=${remote} sample=${sampleHex}`
            );
            socket.destroy();
            return;
          }

          const dataLength = session.buffer.readUInt32BE(4);
          const totalLength = 8 + dataLength + 4;

          if (dataLength <= 0 || totalLength > MAX_BUFFER_BYTES) {
            console.warn(
              `[INVALID FRAME LENGTH] imei=${session.imei} remote=${remote} dataLength=${dataLength} totalLength=${totalLength}`
            );
            socket.destroy();
            return;
          }

          if (session.buffer.length < totalLength) return;

          const frame = session.buffer.subarray(0, totalLength);
          session.buffer = session.buffer.subarray(totalLength);

          const codecId = frame.readUInt8(8);

          if (session.imei) {
            activeDevices.set(session.imei, {
              socket,
              lastSeenAt: Date.now(),
              reportTxBytes: (bytes) => addSessionTxBytes(session, bytes),
            });
          }

          if (codecId === 0x8e) {
            const packet = parseTcpAvlPacket(frame);

            const ack = Buffer.alloc(4);
            ack.writeUInt32BE(packet.recordCount, 0);
            addSessionTxBytes(session, ack.length);
            socket.write(ack);

            const dataUsageDelta = takeSessionDataUsageDelta(session, packet.records.length);
            void enqueueTrackerSave(
              session.imei,
              () => saveRecordsToFirestore(session.imei, packet.records, dataUsageDelta)
            ).catch((error) => {
              console.error(`[FIRESTORE SAVE ERROR] imei=${session.imei}`, error);
            });

            continue;
          }

if (codecId === 0x0c) {
  const packet = parseCodec12Packet(frame);

  console.log(
    `[CODEC12 RESPONSE] imei=${session.imei} type=0x${packet.type.toString(16)} qty1=${packet.quantity1} qty2=${packet.quantity2} payload="${packet.payload}"`
  );

  const pending = pendingCodec12ByImei.get(session.imei);

  if (pending) {
    pendingCodec12ByImei.delete(session.imei);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    const ok = isCodec12SuccessPayload(packet.payload);

    void db
      .collection("vehicles")
      .doc(pending.vehicleId)
      .collection("commands")
      .doc(pending.commandId)
      .update({
        status: ok ? "completed" : "failed",
        result: ok ? "success" : "failed",
        providerMessage: packet.payload || "",
        responseType: packet.type,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .catch((error) => {
        console.error("[COMMAND RESPONSE UPDATE ERROR]", error);
      });
  }

  continue;
}

          console.warn(
            `[UNSUPPORTED CODEC] imei=${session.imei} codec=0x${codecId.toString(16)}`
          );
        }
      }
    } catch (error) {
      console.error(`[TCP ERROR] ${remote}`, error);
      socket.destroy();
    }
  });

  socket.on("error", (error) => {
    clearActiveDeviceIfMatches(session.imei, socket);
    console.error(`[SOCKET ERROR] ${remote}`, error);
  });

  socket.on("close", () => {
    clearActiveDeviceIfMatches(session.imei, socket);
    if (session.imei) {
      void flushGpsCostBuffer(session.imei, "disconnect").catch(() => undefined);
    }
    if (!session.imei) {
      console.log(`[TCP DISCONNECTED] ${remote}`);
    }
  });
});

server.on("error", (error) => {
  console.error("[SERVER ERROR]", error);
});

watchVehicleCommands();
startCleanupScheduler();
const gpsCostFlushTimer = setInterval(() => {
  void (async () => {
    const config = await getGpsCostOptimizationConfig();
    const dueAfterMs = config.diagnosticFlushSeconds * 1000;
    for (const [imei, buffer] of gpsCostBuffers.entries()) {
      if (Date.now() - buffer.lastFlushAt >= dueAfterMs) {
        await flushGpsCostBuffer(imei, "timer").catch(() => undefined);
      }
    }
  })();
}, GPS_COST_FLUSH_CHECK_MS);
gpsCostFlushTimer.unref?.();
// Push-ul este trimis de Firebase Cloud Function `sendPushOnNotificationCreated`.
// Daca il pornim si aici, aceeasi notificare poate ajunge de doua ori pe telefon.

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER STARTED] GPS gateway listening on 0.0.0.0:${PORT}`);
});

let shutdownStarted = false;
async function shutdownGpsGateway(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[SERVER SHUTDOWN] signal=${signal}`);
  clearInterval(gpsCostFlushTimer);
  await flushAllGpsCostBuffers("shutdown");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once("SIGINT", () => void shutdownGpsGateway("SIGINT"));
process.once("SIGTERM", () => void shutdownGpsGateway("SIGTERM"));
