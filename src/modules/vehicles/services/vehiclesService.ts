import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  getBlob,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { auth, db, functions, storage } from "../../../lib/firebase/firebase";
import { clampQueryLimit } from "../../../lib/firebase/queryLimits";
import {
  buildCompanyScopeConstraints,
  buildUserDirectoryConstraints,
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";
import {
  getUserDirectoryCollectionName,
  getVehicleDirectoryCollectionName,
} from "../../../lib/firebase/companyIsolationRollout";
import type {
  VehicleCommandItem,
  VehicleCommandStatus,
  VehicleCommandType,
  VehicleDailyDiagnosticEvent,
  VehicleDailyDiagnosticSample,
  VehicleDailyDiagnosticSeverity,
  VehicleDailyDiagnosticsSummary,
  VehicleDocumentCategory,
  VehicleDocumentIngestionJob,
  VehicleDocumentIntelligenceStatus,
  VehicleDocumentItem,
  VehicleEventItem,
  VehicleFormValues,
  VehicleGpsDataUsagePeriod,
  VehicleImageItem,
  VehicleItem,
  VehicleLiveDiagnostics,
  VehicleLiveIoGroup,
  VehicleLiveIoItem,
  VehiclePositionItem,
  VehicleStatus,
  VehicleTrackerEventItem,
} from "../../../types/vehicle";
import {
  assertValidVehicleKm,
  normalizeVehiclePlate,
} from "../utils/vehicleValidation";
import type { AppUser } from "../../../types/tool";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import { buildAuditChanges, buildAuditSnapshot, type AuditFieldDescriptor } from "../../audit/utils/auditMetadata";
import {
  mergeVehicleRuntimeLive,
  type VehicleRuntimeLiveData,
} from "../utils/vehicleRuntimeLive";
import {
  mergeVehicleSimulationState,
  type VehicleSimulationStateData,
} from "../utils/vehicleSimulationState";
import {
  buildVehicleDocumentSummary,
  isSupportedVehicleDocumentFile,
  VEHICLE_DOCUMENT_MAX_BYTES,
} from "../utils/vehicleDocumentSummary";

const vehiclesCollection = collection(db, "vehicles");
const vehicleOperationalViewsCollection = collection(db, "vehicleOperationalViews");
const vehicleEventsCollection = collection(db, "vehicleEvents");
const userOperationalViewsCollection = collection(db, "userOperationalViews");
const usersCollection = collection(db, "users");
const vehicleGpsVisibilityRef = doc(db, "systemSettings", "vehicleGpsVisibility");
const VEHICLE_RUNTIME_LIVE_READS_ENABLED =
  String(import.meta.env.VITE_VEHICLE_RUNTIME_LIVE_READS ?? "true").toLowerCase() !== "false";

function vehicleRuntimeLiveRef(vehicleId: string) {
  return doc(db, "vehicles", vehicleId, "positions", "_runtime");
}

function vehicleSimulationStateRef(vehicleId: string) {
  return doc(db, "vehicles", vehicleId, "positions", "_simulation");
}

function mapRuntimeLive(data: DocumentData | undefined): VehicleRuntimeLiveData | null {
  return data && typeof data === "object" ? data as VehicleRuntimeLiveData : null;
}

type RuntimeVehicleListCoordinator = {
  setItems: (items: VehicleItem[]) => void;
  stop: () => void;
};

export type VehiclesListSubscriptionOptions = {
  includeGpsSimulation?: boolean;
};

function createRuntimeVehicleListCoordinator(
  onData: (items: VehicleItem[]) => void,
  options: VehiclesListSubscriptionOptions = {}
): RuntimeVehicleListCoordinator {
  let baseItems = new Map<string, VehicleItem>();
  const runtimeItems = new Map<string, VehicleRuntimeLiveData>();
  const simulationItems = new Map<string, VehicleSimulationStateData>();
  const runtimeStops = new Map<string, () => void>();
  const simulationStops = new Map<string, () => void>();
  const simulationLoaded = new Set<string>();
  let emitQueued = false;
  let stopped = false;

  const emit = () => {
    emitQueued = false;
    if (stopped) return;
    if (
      options.includeGpsSimulation &&
      [...baseItems.keys()].some((vehicleId) => !simulationLoaded.has(vehicleId))
    ) return;
    onData(
      [...baseItems.values()]
        .map((item) => mergeVehicleSimulationState(
          mergeVehicleRuntimeLive(item, runtimeItems.get(item.id)),
          simulationItems.get(item.id)
        ))
        .sort((left, right) => left.plateNumber.localeCompare(right.plateNumber))
    );
  };
  const scheduleEmit = () => {
    if (emitQueued || stopped) return;
    emitQueued = true;
    queueMicrotask(emit);
  };

  return {
    setItems(items) {
      baseItems = new Map(items.map((item) => [item.id, item]));
      for (const [vehicleId, stop] of runtimeStops.entries()) {
        if (baseItems.has(vehicleId)) continue;
        stop();
        runtimeStops.delete(vehicleId);
        runtimeItems.delete(vehicleId);
      }
      for (const [vehicleId, stop] of simulationStops.entries()) {
        if (baseItems.has(vehicleId)) continue;
        stop();
        simulationStops.delete(vehicleId);
        simulationItems.delete(vehicleId);
        simulationLoaded.delete(vehicleId);
      }
      if (VEHICLE_RUNTIME_LIVE_READS_ENABLED) {
        for (const vehicleId of baseItems.keys()) {
          if (runtimeStops.has(vehicleId)) continue;
          const stop = onSnapshot(
            vehicleRuntimeLiveRef(vehicleId),
            (snapshot) => {
              if (snapshot.exists()) runtimeItems.set(vehicleId, mapRuntimeLive(snapshot.data()) ?? {});
              else runtimeItems.delete(vehicleId);
              scheduleEmit();
            },
            (error) => {
              console.warn(`[vehicle-runtime][list][${vehicleId}]`, error);
              runtimeItems.delete(vehicleId);
              scheduleEmit();
            }
          );
          runtimeStops.set(vehicleId, stop);
        }
      }
      if (options.includeGpsSimulation) {
        for (const vehicleId of baseItems.keys()) {
          if (simulationStops.has(vehicleId)) continue;
          const stop = onSnapshot(
            vehicleSimulationStateRef(vehicleId),
            (snapshot) => {
              if (snapshot.exists()) {
                const state = mapVehicleSimulationState(snapshot.data());
                if (state) simulationItems.set(vehicleId, state);
              } else {
                simulationItems.delete(vehicleId);
              }
              simulationLoaded.add(vehicleId);
              scheduleEmit();
            },
            (error) => {
              console.warn(`[vehicle-simulation][list][${vehicleId}]`, error);
              simulationItems.delete(vehicleId);
              simulationLoaded.add(vehicleId);
              scheduleEmit();
            }
          );
          simulationStops.set(vehicleId, stop);
        }
      }
      scheduleEmit();
    },
    stop() {
      stopped = true;
      runtimeStops.forEach((stop) => stop());
      runtimeStops.clear();
      runtimeItems.clear();
      simulationStops.forEach((stop) => stop());
      simulationStops.clear();
      simulationItems.clear();
      simulationLoaded.clear();
      baseItems.clear();
    },
  };
}

export const VEHICLE_GPS_VISIBILITY_OWNER_EMAIL = "ionut.matura23@gmail.com";

export type VehicleGpsVisibilityState = {
  blocked: boolean;
  updatedAt: number;
  updatedBy: string;
  updatedByName: string;
};

const VEHICLE_STATUSES = ["activa", "in_service", "indisponibila", "avariata"] as const;
const VEHICLE_COMMAND_TYPES = ["pulse_dout1", "allow_start", "block_start"] as const;
const VEHICLE_COMMAND_STATUSES = ["requested", "pending", "completed", "failed"] as const;
const vehicleAuditFields: AuditFieldDescriptor<VehicleFormValues>[] = [
  { key: "plateNumber", label: "Numar masina" },
  { key: "brand", label: "Marca" },
  { key: "model", label: "Model" },
  { key: "year", label: "An" },
  { key: "vin", label: "VIN" },
  { key: "fuelType", label: "Combustibil" },
  { key: "status", label: "Status" },
  { key: "currentKm", label: "Km curenti", format: (value) => `${toSafeNumber(value, 0)} km` },
  { key: "initialRecordedKm", label: "Km initiali", format: (value) => `${toSafeNumber(value, 0)} km` },
  { key: "ownerUserName", label: "Responsabil" },
  { key: "currentDriverUserName", label: "Sofer" },
  { key: "maintenanceNotes", label: "Observatii mentenanta" },
  { key: "serviceStrategy", label: "Tip revizie" },
  { key: "serviceIntervalKm", label: "Interval service", format: (value) => `${toSafeNumber(value, 0)} km` },
  { key: "nextServiceKm", label: "Urmatorul service", format: (value) => `${toSafeNumber(value, 0)} km` },
  { key: "nextOilServiceKm", label: "Urmatorul schimb ulei", format: (value) => `${toSafeNumber(value, 0)} km` },
  { key: "nextItpDate", label: "ITP" },
  { key: "nextRcaDate", label: "RCA" },
  { key: "nextCascoDate", label: "CASCO" },
  { key: "nextRovinietaDate", label: "Rovinieta" },
];

const MAX_TOTAL_ROUTE_POINTS = 250000;
const DEFAULT_ROUTE_PAGE_SIZE = 2000;
const DEFAULT_ROUTE_MAX_PAGES = 500;
const ROUTE_INCREMENTAL_OVERLAP_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const ROUTE_QUERY_TIMEOUT_MS = 45_000;
const LIVE_ROUTE_WINDOW_GRACE_MS = 2 * 60 * 1000;
const PROGRESSIVE_ROUTE_RANGE_MS = 30 * 60 * 1000;
const PROGRESSIVE_ROUTE_CHUNK_MS = 30 * 60 * 1000;
const MAX_POLL_BACKOFF_MS = 90_000;
const ROUTE_CACHE_TTL_MS = 10_000;
const DAY_QUERY_CONCURRENCY = 1;
const PERSISTED_ROUTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PERSISTED_ROUTE_CACHE_MAX_ITEMS = 12_000;
const ARCHIVED_ROUTE_LOOKBACK_MS = 29 * 24 * 60 * 60 * 1000;

type RouteCacheItem = {
  key: string;
  expiresAt: number;
  items: VehiclePositionItem[];
};

const routeRangeCache = new Map<string, RouteCacheItem>();
const vehiclePositionArchiveCache = new Map<string, VehiclePositionItem[]>();
const missingVehiclePositionArchiveCache = new Set<string>();

export function canControlVehicleGpsVisibility(email?: string | null): boolean {
  return (
    typeof email === "string" &&
    email.trim().toLowerCase() === VEHICLE_GPS_VISIBILITY_OWNER_EMAIL
  );
}

export function subscribeVehicleGpsVisibility(
  callback: (state: VehicleGpsVisibilityState) => void
) {
  return onSnapshot(
    vehicleGpsVisibilityRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      callback({
        blocked: toSafeBoolean(data.blocked, false),
        updatedAt: toSafeNumber(data.updatedAt, 0),
        updatedBy: toSafeString(data.updatedBy),
        updatedByName: toSafeString(data.updatedByName),
      });
    },
    (error) => {
      console.error("[subscribeVehicleGpsVisibility]", error);
      callback({
        blocked: false,
        updatedAt: 0,
        updatedBy: "",
        updatedByName: "",
      });
    }
  );
}

export async function setVehicleGpsVisibilityBlocked(
  blocked: boolean,
  actor?: { email?: string | null; displayName?: string | null }
) {
  if (!canControlVehicleGpsVisibility(actor?.email)) {
    throw new Error("Nu ai dreptul sa modifici vizibilitatea GPS.");
  }

  await setDoc(
    vehicleGpsVisibilityRef,
    {
      blocked,
      updatedAt: Date.now(),
      updatedBy: actor?.email || "",
      updatedByName: actor?.displayName || actor?.email || "",
    },
    { merge: true }
  );
}


type VehicleUploadDocumentInput = {
  file: File;
  category: VehicleDocumentCategory;
  expiryDate?: string;
};

type VehicleDocumentAiAnalysis = {
  documentType?: VehicleDocumentCategory | "unknown";
  expiryDate?: string;
  issueDate?: string;
  policyNumber?: string;
  providerName?: string;
  vehiclePlateNumber?: string;
  confidence?: number;
  notes?: string;
};

type PersistedRouteCacheItem = {
  vehicleId: string;
  fromTs: number;
  toTs: number;
  savedAt: number;
  items: VehiclePositionItem[];
};

type VehiclePositionArchivePayload = {
  vehicleId?: string;
  dayKey?: string;
  points?: Array<Record<string, unknown>>;
};

type RoutePollingOptions = {
  usePersistedCache?: boolean;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`request_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}
export function subscribeVehicleCommands(
  vehicleId: string,
  callback: (items: VehicleCommandItem[]) => void,
  maxItems = 20
) {
  if (!vehicleId) {
    callback([]);
    return () => undefined;
  }

  const commandsQuery = query(
    collection(db, "vehicles", vehicleId, "commands"),
    orderBy("requestedAt", "desc"),
    limit(maxItems)
  );

  return onSnapshot(
    commandsQuery,
    (snap) => {
      callback(
        snap.docs.map((docItem) =>
          mapVehicleCommandDoc(docItem.id, docItem.data())
        )
      );
    },
    (error) => {
      console.error("[subscribeVehicleCommands]", error);
      callback([]);
    }
  );
}
function toSafeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toSafeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toSafeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toVehicleLiveIoGroup(value: unknown): VehicleLiveIoGroup {
  const groups: VehicleLiveIoGroup[] = [
    "gps",
    "obd",
    "power",
    "connectivity",
    "input_output",
    "bluetooth",
    "system",
    "unknown",
  ];

  return groups.includes(value as VehicleLiveIoGroup)
    ? (value as VehicleLiveIoGroup)
    : "unknown";
}

function toVehicleDailyDiagnosticSeverity(value: unknown): VehicleDailyDiagnosticSeverity {
  const severities: VehicleDailyDiagnosticSeverity[] = ["info", "warning", "critical"];
  return severities.includes(value as VehicleDailyDiagnosticSeverity)
    ? (value as VehicleDailyDiagnosticSeverity)
    : "info";
}

function mapVehicleLiveIoItem(data: Record<string, unknown>): VehicleLiveIoItem {
  return {
    id: toSafeNumber(data.id, 0),
    key: toSafeString(data.key, String(data.id ?? "")),
    label: toSafeString(data.label, `AVL ${String(data.id ?? "")}`),
    group: toVehicleLiveIoGroup(data.group),
    value:
      typeof data.value === "string" ||
      typeof data.value === "number" ||
      typeof data.value === "boolean" ||
      data.value === null
        ? data.value
        : toSafeString(data.value),
    rawValue: data.rawValue,
    displayValue: toSafeString(data.displayValue, String(data.value ?? data.rawValue ?? "-")),
    unit: toSafeString(data.unit),
    description: toSafeString(data.description),
  };
}

function mapVehicleLiveDiagnostics(value: unknown): VehicleLiveDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const data = value as Record<string, unknown>;
  const gpsRaw = toSafeObject(data.gps);
  const decodedRaw = Array.isArray(data.decodedIo) ? data.decodedIo : [];

  return {
    source: toSafeString(data.source),
    imei: toSafeString(data.imei),
    protocol: toSafeString(data.protocol),
    online: toSafeBoolean(data.online, false),
    recordTimestamp: toSafeNumber(data.recordTimestamp, 0),
    serverTimestamp: toSafeNumber(data.serverTimestamp, 0),
    expiresAt: toOptionalNumber(data.expiresAt),
    eventIoId: toOptionalNumber(data.eventIoId),
    totalIo: toOptionalNumber(data.totalIo),
    priority: toOptionalNumber(data.priority),
    bluetoothObdConnected: toOptionalBoolean(data.bluetoothObdConnected) ?? null,
    obdConnected: toOptionalBoolean(data.obdConnected) ?? null,
    gps: Object.keys(gpsRaw).length
      ? {
          lat: toSafeNumber(gpsRaw.lat, 0),
          lng: toSafeNumber(gpsRaw.lng, 0),
          speedKmh: toOptionalNumber(gpsRaw.speedKmh),
          altitude: toOptionalNumber(gpsRaw.altitude),
          angle: toOptionalNumber(gpsRaw.angle),
          satellites: toOptionalNumber(gpsRaw.satellites),
        }
      : undefined,
    obd: toSafeObject(data.obd),
    decodedIo: decodedRaw.map((item) => mapVehicleLiveIoItem(toSafeObject(item))),
    rawIo: toSafeObject(data.rawIo),
  };
}

function mapVehicleDailyDiagnosticEvent(
  index: number,
  value: unknown
): VehicleDailyDiagnosticEvent {
  const data = toSafeObject(value);

  return {
    id: toSafeString(data.id, `event-${index}`),
    key: toSafeString(data.key),
    type: toSafeString(data.type, "diagnostic_event"),
    label: toSafeString(data.label, "Eveniment diagnostic"),
    timestamp: toSafeNumber(data.timestamp, 0),
    severity: toVehicleDailyDiagnosticSeverity(data.severity),
    value:
      typeof data.value === "string" ||
      typeof data.value === "number" ||
      typeof data.value === "boolean" ||
      data.value === null
        ? data.value
        : undefined,
    unit: toSafeString(data.unit),
    details: toSafeString(data.details),
  };
}

function mapVehicleDailyDiagnosticSample(value: unknown): VehicleDailyDiagnosticSample | null {
  const data = toSafeObject(value);
  const timestamp = toSafeNumber(data.timestamp, 0);
  if (!timestamp) return null;

  return {
    timestamp,
    speedKmh: toOptionalNumber(data.speedKmh) ?? null,
    engineRpm: toOptionalNumber(data.engineRpm) ?? null,
    totalOdometerKm: toOptionalNumber(data.totalOdometerKm) ?? null,
    tripOdometerKm: toOptionalNumber(data.tripOdometerKm) ?? null,
    coolantTemperatureC: toOptionalNumber(data.coolantTemperatureC) ?? null,
    engineOilTemperatureC: toOptionalNumber(data.engineOilTemperatureC) ?? null,
    externalVoltageV: toOptionalNumber(data.externalVoltageV) ?? null,
    batteryVoltageV: toOptionalNumber(data.batteryVoltageV) ?? null,
    fuelLevelPct: toOptionalNumber(data.fuelLevelPct) ?? null,
    fuelRateLh: toOptionalNumber(data.fuelRateLh) ?? null,
    engineLoadPct: toOptionalNumber(data.engineLoadPct) ?? null,
    throttlePositionPct: toOptionalNumber(data.throttlePositionPct) ?? null,
  };
}

function mapVehicleDailyDiagnosticsSummary(
  id: string,
  data: Record<string, unknown>
): VehicleDailyDiagnosticsSummary {
  const eventsRaw = Array.isArray(data.events) ? data.events : [];
  const samplesRaw = Array.isArray(data.samples) ? data.samples : [];
  const sensorKeysRaw = Array.isArray(data.availableSensorKeys) ? data.availableSensorKeys : [];

  return {
    id,
    companyId: toSafeString(data.companyId),
    vehicleId: toSafeString(data.vehicleId),
    dayKey: toSafeString(data.dayKey, id),
    imei: toSafeString(data.imei),
    firstRecordAt: toOptionalNumber(data.firstRecordAt),
    lastRecordAt: toOptionalNumber(data.lastRecordAt),
    updatedAt: toOptionalNumber(data.updatedAt),
    packetsCount: toSafeNumber(data.packetsCount, 0),
    summaryText: toSafeString(data.summaryText),
    stats: toSafeObject(data.stats),
    latestObd: toSafeObject(data.latestObd),
    availableSensorKeys: sensorKeysRaw.map((item) => toSafeString(item)).filter(Boolean),
    events: eventsRaw
      .map((item, index) => mapVehicleDailyDiagnosticEvent(index, item))
      .sort((a, b) => b.timestamp - a.timestamp),
    samples: samplesRaw
      .map((item) => mapVehicleDailyDiagnosticSample(item))
      .filter((item): item is VehicleDailyDiagnosticSample => Boolean(item))
      .sort((a, b) => b.timestamp - a.timestamp),
  };
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function normalizePlateNumber(value: string): string {
  return normalizeVehiclePlate(value);
}

function toVehicleStatus(value: unknown): VehicleStatus {
  return VEHICLE_STATUSES.includes(value as VehicleStatus)
    ? (value as VehicleStatus)
    : "activa";
}

function toVehicleCommandType(value: unknown): VehicleCommandType {
  return VEHICLE_COMMAND_TYPES.includes(value as VehicleCommandType)
    ? (value as VehicleCommandType)
    : "allow_start";
}

function toVehicleCommandStatus(value: unknown): VehicleCommandStatus {
  return VEHICLE_COMMAND_STATUSES.includes(value as VehicleCommandStatus)
    ? (value as VehicleCommandStatus)
    : "requested";
}

function sortPositionsAsc(items: VehiclePositionItem[]): VehiclePositionItem[] {
  return [...items].sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);
}

function dedupePositions(items: VehiclePositionItem[]): VehiclePositionItem[] {
  const result: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key =
      item.id || `${item.gpsTimestamp}_${item.lat}_${item.lng}_${item.speedKmh ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function mergePositionItems(
  existing: VehiclePositionItem[],
  incoming: VehiclePositionItem[]
): VehiclePositionItem[] {
  return dedupePositions(sortPositionsAsc([...existing, ...incoming]));
}

function normalizePositionItems(items: VehiclePositionItem[]): VehiclePositionItem[] {
  return dedupePositions(
    sortPositionsAsc(items.filter((item) => isValidLatLng(item.lat, item.lng)))
  );
}

function buildRangeCacheKey(vehicleId: string, fromTs: number, toTs: number): string {
  return `${vehicleId}:${fromTs}:${toTs}`;
}

function getRouteCache(
  vehicleId: string,
  fromTs: number,
  toTs: number
): VehiclePositionItem[] | null {
  const key = buildRangeCacheKey(vehicleId, fromTs, toTs);
  const cached = routeRangeCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    routeRangeCache.delete(key);
    return null;
  }
  return cached.items;
}

function setRouteCache(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  items: VehiclePositionItem[]
): void {
  const key = buildRangeCacheKey(vehicleId, fromTs, toTs);
  routeRangeCache.set(key, {
    key,
    items,
    expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
  });

  if (routeRangeCache.size > 180) {
    const now = Date.now();
    for (const [cacheKey, value] of routeRangeCache.entries()) {
      if (value.expiresAt < now) routeRangeCache.delete(cacheKey);
    }
  }
}

/** Invalideaza cache-ul de rute pentru un vehicul (folosit de simulator) */
export function clearVehicleRouteCache(vehicleId: string): void {
  for (const [key] of routeRangeCache.entries()) {
    if (key.startsWith(`${vehicleId}:`)) {
      routeRangeCache.delete(key);
    }
  }
}

function buildPersistedRouteCacheKey(vehicleId: string, fromTs: number, toTs: number): string {
  return `wc_route_cache:${vehicleId}:${fromTs}:${toTs}`;
}

function buildPersistedRouteCachePrefix(vehicleId: string): string {
  return `wc_route_cache:${vehicleId}:`;
}

function parsePersistedRangeFromKey(key: string): { fromTs: number; toTs: number } | null {
  const parts = key.split(":");
  if (parts.length !== 5) return null;
  const fromTs = Number(parts[3]);
  const toTs = Number(parts[4]);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return null;
  return { fromTs, toTs };
}

function readPersistedRouteCache(
  vehicleId: string,
  fromTs: number,
  toTs: number
): VehiclePositionItem[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(buildPersistedRouteCacheKey(vehicleId, fromTs, toTs));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PersistedRouteCacheItem;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > PERSISTED_ROUTE_CACHE_TTL_MS) return null;

    return normalizePositionItems(parsed.items);
  } catch {
    return null;
  }
}

function readBestPersistedRouteCache(
  vehicleId: string,
  fromTs: number,
  toTs: number
): VehiclePositionItem[] | null {
  if (typeof window === "undefined") return null;

  const exact = readPersistedRouteCache(vehicleId, fromTs, toTs);
  if (exact?.length) return exact;

  try {
    const prefix = buildPersistedRouteCachePrefix(vehicleId);
    let best: { fromTs: number; toTs: number; savedAt: number; items: VehiclePositionItem[] } | null = null;

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;

      const range = parsePersistedRangeFromKey(key);
      if (!range) continue;

      if (range.fromTs > fromTs || range.toTs < fromTs) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as PersistedRouteCacheItem;
      if (!parsed || !Array.isArray(parsed.items)) continue;
      if (Date.now() - Number(parsed.savedAt || 0) > PERSISTED_ROUTE_CACHE_TTL_MS) continue;

      const items = normalizePositionItems(parsed.items).filter(
        (item) => item.gpsTimestamp >= fromTs && item.gpsTimestamp <= toTs
      );
      if (!items.length) continue;

      if (!best || Number(parsed.savedAt || 0) > best.savedAt) {
        best = {
          fromTs: range.fromTs,
          toTs: range.toTs,
          savedAt: Number(parsed.savedAt || 0),
          items,
        };
      }
    }

    return best?.items ?? null;
  } catch {
    return null;
  }
}

function writePersistedRouteCache(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  items: VehiclePositionItem[]
): void {
  if (typeof window === "undefined") return;
  if (!items.length) return;

  try {
    const payload: PersistedRouteCacheItem = {
      vehicleId,
      fromTs,
      toTs,
      savedAt: Date.now(),
      items: items.slice(Math.max(0, items.length - PERSISTED_ROUTE_CACHE_MAX_ITEMS)),
    };

    window.localStorage.setItem(
      buildPersistedRouteCacheKey(vehicleId, fromTs, toTs),
      JSON.stringify(payload)
    );
  } catch {
    // ignore storage quota / private mode errors
  }
}

function getDayKeyFromTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function getDayStartTs(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getTime();
}

function shouldTryArchivedPositions(dayKey: string): boolean {
  const dayStart = getDayStartTs(dayKey);
  return Number.isFinite(dayStart) && dayStart < Date.now() - ARCHIVED_ROUTE_LOOKBACK_MS;
}

function buildVehiclePositionArchivePath(vehicleId: string, dayKey: string): string {
  return `vehicle-position-archives/${vehicleId}/${dayKey}.json`;
}

async function getVehicleArchivedPositionsForDay(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number
): Promise<VehiclePositionItem[]> {
  if (!shouldTryArchivedPositions(dayKey)) return [];

  try {
    const cacheKey = `${vehicleId}:${dayKey}`;
    if (missingVehiclePositionArchiveCache.has(cacheKey)) return [];

    const cached = vehiclePositionArchiveCache.get(cacheKey);
    if (cached) {
      return cached.filter((point) => point.gpsTimestamp >= fromTs && point.gpsTimestamp <= toTs);
    }

    const archiveRef = ref(storage, buildVehiclePositionArchivePath(vehicleId, dayKey));
    const blob = await getBlob(archiveRef);
    const payload = JSON.parse(await blob.text()) as VehiclePositionArchivePayload;
    const points = Array.isArray(payload.points) ? payload.points : [];

    const normalized = normalizePositionItems(
      points
        .map((point, index) =>
          mapVehiclePositionDoc(
            toSafeString(point.id, `${dayKey}-archive-${index}`),
            {
              ...point,
              vehicleId: toSafeString(point.vehicleId, vehicleId),
            }
          )
        )
    );

    vehiclePositionArchiveCache.set(cacheKey, normalized);
    if (vehiclePositionArchiveCache.size > 120) {
      const firstKey = vehiclePositionArchiveCache.keys().next().value;
      if (firstKey) vehiclePositionArchiveCache.delete(firstKey);
    }

    return normalized.filter((point) => point.gpsTimestamp >= fromTs && point.gpsTimestamp <= toTs);
  } catch (error: any) {
    const code = toSafeString(error?.code);
    if (code === "storage/object-not-found") {
      missingVehiclePositionArchiveCache.add(`${vehicleId}:${dayKey}`);
      if (missingVehiclePositionArchiveCache.size > 500) {
        missingVehiclePositionArchiveCache.clear();
      }
    }
    if (code && code !== "storage/object-not-found") {
      console.warn("[getVehicleArchivedPositionsForDay]", vehicleId, dayKey, error);
    }
    return [];
  }
}

function addDays(dayKey: string, days: number): string {
  const ts = getDayStartTs(dayKey) + days * 24 * 60 * 60 * 1000;
  return new Date(ts).toISOString().slice(0, 10);
}

function enumerateDayKeys(fromTs: number, toTs: number): string[] {
  const startKey = getDayKeyFromTs(fromTs);
  const endKey = getDayKeyFromTs(toTs);

  const result: string[] = [];
  let current = startKey;

  while (current <= endKey) {
    result.push(current);
    current = addDays(current, 1);
  }

  return result;
}

function enumerateDayKeysWithNeighbors(fromTs: number, toTs: number): string[] {
  const base = enumerateDayKeys(fromTs, toTs);
  if (!base.length) return [];

  const first = base[0];
  const last = base[base.length - 1];

  return dedupeDayKeys([addDays(first, -1), ...base, addDays(last, 1)]);
}

function enumerateLocalDayKeysWithUtcNeighbors(fromTs: number, toTs: number): string[] {
  const result: string[] = [];
  const cursor = new Date(fromTs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toTs);
  end.setHours(23, 59, 59, 999);

  while (cursor.getTime() <= end.getTime()) {
    const localStart = cursor.getTime();
    const localEnd = localStart + 24 * 60 * 60 * 1000 - 1;
    result.push(...enumerateDayKeysWithNeighbors(localStart, localEnd));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dedupeDayKeys(result);
}

function dedupeDayKeys(dayKeys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const dayKey of dayKeys) {
    if (!dayKey || seen.has(dayKey)) continue;
    seen.add(dayKey);
    result.push(dayKey);
  }

  return result;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limitCount: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];

  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  const slots = Math.max(1, Math.min(limitCount, items.length));
  await Promise.all(new Array(slots).fill(null).map(() => runner()));

  return results;
}

function mapVehicleDoc(id: string, data: Record<string, any>): VehicleItem {
  const gpsSnapshotRaw = data.gpsSnapshot ? toSafeObject(data.gpsSnapshot) : null;
  const trackerRaw = data.tracker ? toSafeObject(data.tracker) : null;
  const gpsDataUsageRaw = data.gpsDataUsage ? toSafeObject(data.gpsDataUsage) : null;
  const gpsDataUsageMonthsRaw = gpsDataUsageRaw ? toSafeObject(gpsDataUsageRaw.months) : {};
  const gpsDataUsageMonths = Object.entries(gpsDataUsageMonthsRaw).reduce(
    (acc, [monthKey, monthValue]) => {
      const monthRaw = toSafeObject(monthValue);
      acc[monthKey] = {
        rxBytes: toSafeNumber(monthRaw.rxBytes, 0),
        txBytes: toSafeNumber(monthRaw.txBytes, 0),
        totalBytes: toSafeNumber(monthRaw.totalBytes, 0),
        recordsCount: toSafeNumber(monthRaw.recordsCount, 0),
        frameCount: toSafeNumber(monthRaw.frameCount, 0),
        lastRxBytes: toSafeNumber(monthRaw.lastRxBytes, 0),
        lastTxBytes: toSafeNumber(monthRaw.lastTxBytes, 0),
        lastTotalBytes: toSafeNumber(monthRaw.lastTotalBytes, 0),
        updatedAt: toSafeNumber(monthRaw.updatedAt, 0),
      };
      return acc;
    },
    {} as Record<string, VehicleGpsDataUsagePeriod>
  );
  const imagesRaw = Array.isArray(data.images) ? data.images : [];
  const documentsRaw = Array.isArray(data.documents) ? data.documents : [];
  const storedCurrentKm = toSafeNumber(data.currentKm, 0);
  const currentKm = storedCurrentKm;
  const initialRecordedKm = toSafeNumber(data.initialRecordedKm, storedCurrentKm || currentKm);
  const serviceStrategy = data.serviceStrategy === "absolute" ? "absolute" : "interval";
  const serviceIntervalKm = toSafeNumber(data.serviceIntervalKm, 15000);
  const documents: VehicleDocumentItem[] = documentsRaw.map((item: any) => ({
    id: toSafeString(item?.id, `${Date.now()}_${Math.random().toString(36).slice(2)}`),
    name: toSafeString(item?.name),
    url: toSafeString(item?.url),
    path: toSafeString(item?.path),
    contentType: toSafeString(item?.contentType),
    sizeBytes: toSafeNumber(item?.sizeBytes, 0),
    extension: toSafeString(item?.extension),
    sha256: toSafeString(item?.sha256) || undefined,
    dedupeKey: toSafeString(item?.dedupeKey) || undefined,
    storageGeneration: toSafeString(item?.storageGeneration) || undefined,
    category: ["service", "itp", "rca", "casco", "leasing_rate", "rca_itp", "rovinieta", "amenda", "other"].includes(item?.category)
       ? item.category === "rca_itp" ? "itp" : item.category
      : "other",
    expiryDate: toSafeString(item?.expiryDate),
    expirySource: ["manual", "ai_confirmed", ""].includes(item?.expirySource)
      ? item.expirySource
      : "",
    intelligenceJobId: toSafeString(item?.intelligenceJobId),
    intelligenceStatus: ["queued", "processing", "needs_review", "applied", "rejected", "failed"].includes(item?.intelligenceStatus)
      ? item.intelligenceStatus
      : undefined,
    intelligenceReviewedAt: toSafeNumber(item?.intelligenceReviewedAt, 0) || undefined,
    intelligenceReviewedByUserId: toSafeString(item?.intelligenceReviewedByUserId) || undefined,
    aiAnalysis: item?.aiAnalysis && typeof item.aiAnalysis === "object"
       ? {
          documentType: ["service", "itp", "rca", "casco", "leasing_rate", "rovinieta", "amenda", "other", "unknown"].includes(item.aiAnalysis.documentType)
             ? item.aiAnalysis.documentType
            : undefined,
          expiryDate: toSafeString(item.aiAnalysis.expiryDate),
          issueDate: toSafeString(item.aiAnalysis.issueDate),
          policyNumber: toSafeString(item.aiAnalysis.policyNumber),
          providerName: toSafeString(item.aiAnalysis.providerName),
          vehiclePlateNumber: toSafeString(item.aiAnalysis.vehiclePlateNumber),
          confidence: toSafeNumber(item.aiAnalysis.confidence, 0),
          fieldConfidence: item.aiAnalysis.fieldConfidence && typeof item.aiAnalysis.fieldConfidence === "object"
            ? Object.fromEntries(
                Object.entries(item.aiAnalysis.fieldConfidence)
                  .filter(([key]) => ["documentType", "expiryDate", "issueDate", "policyNumber", "providerName", "vehiclePlateNumber"].includes(key))
                  .map(([key, value]) => [key, toSafeNumber(value, 0)])
              )
            : undefined,
          notes: toSafeString(item.aiAnalysis.notes),
          analyzedAt: toSafeNumber(item.aiAnalysis.analyzedAt, 0),
        }
      : undefined,
    createdAt: toSafeNumber(item?.createdAt, Date.now()),
    updatedAt: toSafeNumber(item?.updatedAt, 0) || undefined,
  }));
  const storedDocumentSummary = data.documentSummary && typeof data.documentSummary === "object"
    ? data.documentSummary
    : null;

  return {
    id,
    plateNumber: toSafeString(data.plateNumber),
    brand: toSafeString(data.brand),
    model: toSafeString(data.model),
    year: toSafeString(data.year),
    vin: toSafeString(data.vin),
    fuelType: toSafeString(data.fuelType),
    ownerThemeKey: data.ownerThemeKey ?? null,
    currentDriverThemeKey: data.currentDriverThemeKey ?? null,
    status: toVehicleStatus(data.status),
    currentKm,
    initialRecordedKm,

    ownerUserId: toSafeString(data.ownerUserId),
    ownerUserName: toSafeString(data.ownerUserName),

    currentDriverUserId: toSafeString(data.currentDriverUserId),
    currentDriverUserName: toSafeString(data.currentDriverUserName),
    pendingDriverUserId: toSafeString(data.pendingDriverUserId),
    pendingDriverUserName: toSafeString(data.pendingDriverUserName),
    pendingDriverThemeKey: data.pendingDriverThemeKey ?? null,
    pendingDriverRequestedAt: toSafeNumber(data.pendingDriverRequestedAt, 0),

    maintenanceNotes: toSafeString(data.maintenanceNotes),
    serviceStrategy,
    serviceIntervalKm,
    nextServiceKm: toSafeNumber(data.nextServiceKm, 0),
    nextItpDate: toSafeString(data.nextItpDate),
    nextRcaDate: toSafeString(data.nextRcaDate),
    nextCascoDate: toSafeString(data.nextCascoDate),
    nextRovinietaDate: toSafeString(data.nextRovinietaDate),
    nextOilServiceKm: toSafeNumber(data.nextOilServiceKm, 0),

    coverImageUrl: toSafeString(data.coverImageUrl),
    coverThumbUrl: toSafeString(data.coverThumbUrl),
    images: imagesRaw.map((item: any) => ({
      id: toSafeString(item?.id, `${Date.now()}_${Math.random().toString(36).slice(2)}`),
      url: toSafeString(item?.url),
      path: toSafeString(item?.path),
      fileName: toSafeString(item?.fileName),
      createdAt: toSafeNumber(item?.createdAt, Date.now()),
      thumbUrl: toSafeString(item?.thumbUrl),
      thumbPath: toSafeString(item?.thumbPath),
    })),
    documents,
    documentSummary: storedDocumentSummary
      ? {
          count: toSafeNumber(storedDocumentSummary.count, documents.length),
          nextExpiryAt: toSafeString(storedDocumentSummary.nextExpiryAt),
          expiredCount: toSafeNumber(storedDocumentSummary.expiredCount, 0),
          needsReviewCount: toSafeNumber(storedDocumentSummary.needsReviewCount, 0),
          updatedAt: toSafeNumber(storedDocumentSummary.updatedAt, 0),
        }
      : buildVehicleDocumentSummary(documents),

    gpsSnapshot: gpsSnapshotRaw
      ? {
          lat: toSafeNumber(gpsSnapshotRaw.lat, 0),
          lng: toSafeNumber(gpsSnapshotRaw.lng, 0),
          speedKmh: toSafeNumber(gpsSnapshotRaw.speedKmh, 0),
          altitude: toOptionalNumber(gpsSnapshotRaw.altitude),
          angle: toOptionalNumber(gpsSnapshotRaw.angle),
          satellites: toOptionalNumber(gpsSnapshotRaw.satellites),
          gpsTimestamp: toSafeNumber(gpsSnapshotRaw.gpsTimestamp, 0),
          serverTimestamp: toSafeNumber(gpsSnapshotRaw.serverTimestamp, 0),
          expiresAt: toOptionalNumber(gpsSnapshotRaw.expiresAt),
          ignitionOn: toSafeBoolean(gpsSnapshotRaw.ignitionOn, false),
          odometerKm: toOptionalNumber(gpsSnapshotRaw.odometerKm),
          tripOdometerKm: toOptionalNumber(gpsSnapshotRaw.tripOdometerKm),
          imei: toSafeString(gpsSnapshotRaw.imei),
          online: toSafeBoolean(gpsSnapshotRaw.online, false),
          rawIo: toSafeObject(gpsSnapshotRaw.rawIo),
        }
      : null,

    liveDiagnostics: mapVehicleLiveDiagnostics(data.liveDiagnostics),

    gpsDataUsage: gpsDataUsageRaw
      ? {
          rxBytes: toSafeNumber(gpsDataUsageRaw.rxBytes, 0),
          txBytes: toSafeNumber(gpsDataUsageRaw.txBytes, 0),
          totalBytes: toSafeNumber(gpsDataUsageRaw.totalBytes, 0),
          recordsCount: toSafeNumber(gpsDataUsageRaw.recordsCount, 0),
          frameCount: toSafeNumber(gpsDataUsageRaw.frameCount, 0),
          lastRxBytes: toSafeNumber(gpsDataUsageRaw.lastRxBytes, 0),
          lastTxBytes: toSafeNumber(gpsDataUsageRaw.lastTxBytes, 0),
          lastTotalBytes: toSafeNumber(gpsDataUsageRaw.lastTotalBytes, 0),
          updatedAt: toSafeNumber(gpsDataUsageRaw.updatedAt, 0),
          currentMonthKey: toSafeString(gpsDataUsageRaw.currentMonthKey),
          months: gpsDataUsageMonths,
        }
      : null,

    tracker: trackerRaw
      ? {
          imei: toSafeString(trackerRaw.imei),
          lastSeenAt: toSafeNumber(trackerRaw.lastSeenAt, 0),
          updatedAt: toSafeNumber(trackerRaw.updatedAt, 0),
          protocol: toSafeString(trackerRaw.protocol),
        }
      : null,

    createdAt: toSafeNumber(data.createdAt, Date.now()),
    updatedAt: toSafeNumber(data.updatedAt, Date.now()),
    gpsSim: (() => {
      const s = data.gpsSim;
      if (!s || typeof s !== "object") return null;
      const pts = Array.isArray(s.points) ? s.points : [];
      return {
        active: Boolean(s.active),
        status:
          s.status === "paused" || s.status === "done" || s.status === "running"
             ? s.status
            : Boolean(s.active)
               ? "running"
              : "done",
        startedAt: toSafeNumber(s.startedAt, 0),
        resumedAt: toSafeNumber(s.resumedAt, 0),
        pausedAt: s.pausedAt === null ? null : toSafeNumber(s.pausedAt, 0),
        elapsedBeforePauseMs: toSafeNumber(s.elapsedBeforePauseMs, 0),
        totalDurationMs: toSafeNumber(s.totalDurationMs, 0),
        totalDistanceKm: toSafeNumber(s.totalDistanceKm, 0),
        destinationQuery: toSafeString(s.destinationQuery),
        destinationDisplay: toSafeString(s.destinationDisplay),
        startLat: toOptionalNumber(s.startLat),
        startLng: toOptionalNumber(s.startLng),
        endLat: toOptionalNumber(s.endLat),
        endLng: toOptionalNumber(s.endLng),
        points: pts.map((p: Record<string, unknown>) => ({
          lat: toSafeNumber(p.lat, 0),
          lng: toSafeNumber(p.lng, 0),
          speedKmh: toSafeNumber(p.speedKmh, 0),
          angle: toSafeNumber(p.angle, 0),
          odometerKm: toSafeNumber(p.odometerKm, 0),
          ts: toSafeNumber(p.ts, 0),
          ignitionOn: Boolean(p.ignitionOn),
        })),
      };
    })(),
    gpsSimHistory: (() => {
      const history = Array.isArray(data.gpsSimHistory) ? data.gpsSimHistory : [];
      return history.map((entry: Record<string, unknown>, index) => {
        const pts = Array.isArray(entry.points) ? entry.points : [];
        return {
          id: toSafeString(entry.id) || `sim-history-${index}`,
          active: false,
          status: "done" as const,
          startedAt: toSafeNumber(entry.startedAt, 0),
          stoppedAt: toSafeNumber(entry.stoppedAt, 0),
          totalDistanceKm: toSafeNumber(entry.totalDistanceKm, 0),
          totalDurationMs: toSafeNumber(entry.totalDurationMs, 0),
          destinationQuery: toSafeString(entry.destinationQuery),
          destinationDisplay: toSafeString(entry.destinationDisplay),
          startLat: toOptionalNumber(entry.startLat),
          startLng: toOptionalNumber(entry.startLng),
          endLat: toOptionalNumber(entry.endLat),
          endLng: toOptionalNumber(entry.endLng),
          points: pts.map((p: Record<string, unknown>) => ({
            lat: toSafeNumber(p.lat, 0),
            lng: toSafeNumber(p.lng, 0),
            speedKmh: toSafeNumber(p.speedKmh, 0),
            angle: toSafeNumber(p.angle, 0),
            odometerKm: toSafeNumber(p.odometerKm, 0),
            ts: toSafeNumber(p.ts, 0),
            ignitionOn: Boolean(p.ignitionOn),
          })),
        };
      });
    })(),
  };
}

function mapVehicleSimulationState(
  data: DocumentData | undefined
): VehicleSimulationStateData | null {
  if (!data || typeof data !== "object") return null;
  const vehicleId = toSafeString(data.vehicleId);
  const mapped = mapVehicleDoc(vehicleId || "_simulation", data);

  return {
    schemaVersion: toSafeNumber(data.schemaVersion, 1),
    vehicleId,
    ...(Object.hasOwn(data, "gpsSim") ? { gpsSim: mapped.gpsSim } : {}),
    ...(Object.hasOwn(data, "gpsSimHistory")
      ? { gpsSimHistory: mapped.gpsSimHistory }
      : {}),
    updatedAt: toSafeNumber(data.updatedAt, 0),
  };
}

async function resizeImage(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.src = String(reader.result);
    };

    reader.onerror = () => reject(new Error("Nu am putut citi fisierul."));
    image.onerror = () => reject(new Error("Nu am putut incarca imaginea."));

    image.onload = () => {
      let { width, height } = image;

      if (width <= 0 || height <= 0) {
        reject(new Error("Dimensiuni imagine invalide."));
        return;
      }

      if (width > options.maxWidth) {
        height = Math.round((height * options.maxWidth) / width);
        width = options.maxWidth;
      }

      if (height > options.maxHeight) {
        width = Math.round((width * options.maxHeight) / height);
        height = options.maxHeight;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Nu am putut crea canvas."));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Nu am putut genera imaginea."));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        options.quality
      );
    };

    reader.readAsDataURL(file);
  });
}

export async function getVehicleUsers(): Promise<AppUser[]> {
  const context = await getCurrentCompanyAccessContext();
  const source = getUserDirectoryCollectionName() === "userOperationalViews"
    ? userOperationalViewsCollection
    : usersCollection;
  const usersQuery = query(
    source,
    ...buildUserDirectoryConstraints(context),
    orderBy("fullName", "asc"),
    limit(250)
  );
  const snap = await getDocs(usersQuery);

  const users = new Map<string, AppUser>();
  snap.docs.forEach((docItem) => {
    const uid = toSafeString(docItem.data().uid, docItem.id);
    users.set(uid, {
      id: uid,
      uid,
      themeKey: docItem.data().themeKey ?? null,
      fullName: toSafeString(docItem.data().fullName, "Utilizator fara nume"),
      email: toSafeString(docItem.data().email),
      active: docItem.data().active ?? true,
      role: toSafeString(docItem.data().role),
    });
  });
  return [...users.values()];
}

export async function getVehiclesList(maxItems = 250): Promise<VehicleItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const resultLimit = clampQueryLimit(maxItems, 250, 250);
  const source = getVehicleDirectoryCollectionName() === "vehicleOperationalViews"
    ? vehicleOperationalViewsCollection
    : vehiclesCollection;
  if (context.role !== "angajat") {
    const snap = await getDocs(query(
      source,
      ...buildCompanyScopeConstraints(context),
      orderBy("plateNumber", "asc"),
      limit(resultLimit)
    ));
    return snap.docs.map((docItem) => mapVehicleDoc(docItem.id, docItem.data()));
  }
  const assignmentFields = ["ownerUserId", "currentDriverUserId", "pendingDriverUserId"] as const;
  const snapshots = await Promise.all(assignmentFields.map((field) => getDocs(query(
    source,
    ...buildCompanyScopeConstraints(context),
    where(field, "==", context.uid),
    limit(resultLimit)
  ))));
  const unique = new Map<string, VehicleItem>();
  snapshots.forEach((snap) => snap.docs.forEach((docItem) => {
    unique.set(docItem.id, mapVehicleDoc(docItem.id, docItem.data()));
  }));
  return [...unique.values()].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));
}

export function subscribeVehiclesList(
  onData: (items: VehicleItem[]) => void,
  options: VehiclesListSubscriptionOptions = {}
): () => void {
  let unsubscribe: () => void = () => {};
  let cancelled = false;
  const coordinator = createRuntimeVehicleListCoordinator(onData, options);
  void getCurrentCompanyAccessContext()
    .then((context) => {
      if (cancelled) return;
      const source = getVehicleDirectoryCollectionName() === "vehicleOperationalViews"
        ? vehicleOperationalViewsCollection
        : vehiclesCollection;
      if (context.role !== "angajat") {
        unsubscribe = onSnapshot(
          query(
            source,
            ...buildCompanyScopeConstraints(context),
            orderBy("plateNumber", "asc"),
            limit(250)
          ),
          (snap) => coordinator.setItems(
            snap.docs.map((docItem) => mapVehicleDoc(docItem.id, docItem.data()))
          ),
          (error) => {
            console.error("[subscribeVehiclesList]", error);
            coordinator.setItems([]);
          }
        );
        return;
      }
      const assignmentFields = ["ownerUserId", "currentDriverUserId", "pendingDriverUserId"] as const;
      const resultSets = assignmentFields.map(() => new Map<string, VehicleItem>());
      const emit = () => {
        const unique = new Map<string, VehicleItem>();
        resultSets.forEach((items) => items.forEach((item, id) => unique.set(id, item)));
        coordinator.setItems([...unique.values()]);
      };
      const subscriptions = assignmentFields.map((field, index) => onSnapshot(
        query(
          source,
          ...buildCompanyScopeConstraints(context),
          where(field, "==", context.uid),
          limit(250)
        ),
        (snap) => {
          resultSets[index] = new Map(snap.docs.map((docItem) => [
            docItem.id,
            mapVehicleDoc(docItem.id, docItem.data()),
          ]));
          emit();
        },
        (error) => console.error(`[subscribeVehiclesList][${field}]`, error)
      ));
      unsubscribe = () => subscriptions.forEach((stop) => stop());
    })
    .catch((error) => {
      console.error("[subscribeVehiclesList][company]", error);
      coordinator.setItems([]);
    });
  return () => {
    cancelled = true;
    unsubscribe();
    coordinator.stop();
  };
}

export async function getVehicleById(vehicleId: string): Promise<VehicleItem | null> {
  if (!vehicleId) return null;

  const [snap, runtimeSnap, simulationSnap] = await Promise.all([
    getDoc(doc(db, "vehicles", vehicleId)),
    VEHICLE_RUNTIME_LIVE_READS_ENABLED
      ? getDoc(vehicleRuntimeLiveRef(vehicleId)).catch(() => null)
      : Promise.resolve(null),
    getDoc(vehicleSimulationStateRef(vehicleId)).catch(() => null),
  ]);
  if (!snap.exists()) return null;

  return mergeVehicleSimulationState(
    mergeVehicleRuntimeLive(
      mapVehicleDoc(snap.id, snap.data()),
      runtimeSnap?.exists() ? mapRuntimeLive(runtimeSnap.data()) : null
    ),
    simulationSnap?.exists() ? mapVehicleSimulationState(simulationSnap.data()) : null
  );
}

export async function getMyVehicleForUser(userId: string): Promise<VehicleItem | null> {
  if (!userId) return null;

  const context = await getCurrentCompanyAccessContext();
  const scope = buildCompanyScopeConstraints(context);

  const [driverSnap, ownerSnap] = await Promise.all([
    getDocs(
      query(
        vehiclesCollection,
        ...scope,
        where("currentDriverUserId", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(1)
      )
    ),
    getDocs(
      query(
        vehiclesCollection,
        ...scope,
        where("ownerUserId", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(1)
      )
    ),
  ]);

  const preferredDoc = driverSnap.docs[0] || ownerSnap.docs[0];
  if (!preferredDoc) return null;

  return mapVehicleDoc(preferredDoc.id, preferredDoc.data());
}

export function subscribeVehicleById(
  vehicleId: string,
  onData: (item: VehicleItem | null) => void
): () => void {
  if (!vehicleId) {
    onData(null);
    return () => undefined;
  }

  let baseVehicle: VehicleItem | null = null;
  let runtimeLive: VehicleRuntimeLiveData | null = null;
  let simulationState: VehicleSimulationStateData | null = null;
  let baseLoaded = false;
  let simulationLoaded = false;
  const emit = () => {
    if (!baseLoaded || !simulationLoaded) return;
    onData(baseVehicle
      ? mergeVehicleSimulationState(
          mergeVehicleRuntimeLive(baseVehicle, runtimeLive),
          simulationState
        )
      : null);
  };

  const stopVehicle = onSnapshot(
    doc(db, "vehicles", vehicleId),
    (snap) => {
      baseLoaded = true;
      if (!snap.exists()) {
        baseVehicle = null;
        emit();
        return;
      }
      baseVehicle = mapVehicleDoc(snap.id, snap.data());
      emit();
    },
    (error) => {
      console.error("[subscribeVehicleById]", error);
      onData(null);
    }
  );
  const stopRuntime = VEHICLE_RUNTIME_LIVE_READS_ENABLED
    ? onSnapshot(
        vehicleRuntimeLiveRef(vehicleId),
        (snapshot) => {
          runtimeLive = snapshot.exists() ? mapRuntimeLive(snapshot.data()) : null;
          emit();
        },
        (error) => {
          console.warn(`[vehicle-runtime][detail][${vehicleId}]`, error);
          runtimeLive = null;
          emit();
        }
      )
    : () => undefined;
  const stopSimulation = onSnapshot(
    vehicleSimulationStateRef(vehicleId),
    (snapshot) => {
      simulationState = snapshot.exists() ? mapVehicleSimulationState(snapshot.data()) : null;
      simulationLoaded = true;
      emit();
    },
    (error) => {
      console.warn(`[vehicle-simulation][detail][${vehicleId}]`, error);
      simulationState = null;
      simulationLoaded = true;
      emit();
    }
  );

  return () => {
    stopVehicle();
    stopRuntime();
    stopSimulation();
  };
}

export function subscribeVehicleDailyDiagnostics(
  vehicleId: string,
  dayKey: string,
  onData: (item: VehicleDailyDiagnosticsSummary | null) => void
): () => void {
  if (!vehicleId || !dayKey) {
    onData(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, "vehicles", vehicleId, "diagnosticDays", dayKey),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }

      onData(mapVehicleDailyDiagnosticsSummary(snap.id, snap.data() as Record<string, unknown>));
    },
    (error) => {
      console.error("[subscribeVehicleDailyDiagnostics]", error);
      onData(null);
    }
  );
}

export function subscribeVehicleDiagnosticHistory(
  vehicleId: string,
  onData: (items: VehicleDailyDiagnosticsSummary[]) => void,
  daysLimit = 14
): () => void {
  if (!vehicleId) {
    onData([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, "vehicles", vehicleId, "diagnosticDays"),
      orderBy("dayKey", "desc"),
      limit(daysLimit)
    ),
    (snap) => {
      onData(
        snap.docs.map((docItem) =>
          mapVehicleDailyDiagnosticsSummary(docItem.id, docItem.data() as Record<string, unknown>)
        )
      );
    },
    (error) => {
      console.error("[subscribeVehicleDiagnosticHistory]", error);
      onData([]);
    }
  );
}

export async function isPlateNumberUsed(
  plateNumber: string,
  excludeVehicleId?: string
): Promise<boolean> {
  const clean = normalizePlateNumber(plateNumber);
  if (!clean) return false;

  const context = await getCurrentCompanyAccessContext();

  const snap = await getDocs(
    query(
      vehiclesCollection,
      ...buildCompanyScopeConstraints(context),
      where("plateNumber", "==", clean),
      limit(10)
    )
  );

  if (snap.empty) return false;
  return snap.docs.some((docItem) => docItem.id !== excludeVehicleId);
}

export async function createVehicle(values: VehicleFormValues): Promise<string> {
  assertValidVehicleKm(values.currentKm, "Km curenti");
  assertValidVehicleKm(values.initialRecordedKm, "Km initiali");
  const now = Date.now();
  const savedValues = {
    ...values,
    plateNumber: normalizePlateNumber(values.plateNumber),
    initialRecordedKm: values.initialRecordedKm || values.currentKm || 0,
  };
  const companyId =
    values.companyId || requirePrimaryCompanyId(await getCurrentCompanyAccessContext());

  const refDoc = await addDoc(vehiclesCollection, {
    ...savedValues,
    companyId,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    refDoc.id,
    "created",
    `Masina ${values.plateNumber} a fost creata.`
  );

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_created",
    entityId: refDoc.id,
    title: "Masina adaugata",
    message: `A fost adaugata masina ${normalizePlateNumber(values.plateNumber)}.`,
    directUserId: values.currentDriverUserId || "",
    ownerUserId: values.ownerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
    metadata: {
      fieldsText: buildAuditSnapshot(savedValues, vehicleAuditFields),
      fieldsCount: buildAuditSnapshot(savedValues, vehicleAuditFields).length,
    },
  });

  return refDoc.id;
}

export async function updateVehicle(
  vehicleId: string,
  values: VehicleFormValues
): Promise<void> {
  assertValidVehicleKm(values.currentKm, "Km curenti");
  assertValidVehicleKm(values.initialRecordedKm, "Km initiali");
  const existingSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const previousStatus = toVehicleStatus(existingData?.status);
  const previousOwnerUserId = toSafeString(existingData?.ownerUserId);
  const savedValues = {
    ...values,
    plateNumber: normalizePlateNumber(values.plateNumber),
    initialRecordedKm: values.initialRecordedKm || values.currentKm || 0,
  };
  const changesText = buildAuditChanges(
    existingData as Partial<VehicleFormValues> | null,
    savedValues,
    vehicleAuditFields
  );

  const protectedAssignmentsChanged =
    toSafeString(existingData?.ownerUserId) !== savedValues.ownerUserId ||
    toSafeString(existingData?.currentDriverUserId) !== savedValues.currentDriverUserId;
  const protectedMileageChanged =
    toSafeNumber(existingData?.currentKm, 0) !== savedValues.currentKm ||
    toSafeNumber(existingData?.initialRecordedKm, 0) !== savedValues.initialRecordedKm;
  const directValues: Record<string, unknown> = { ...savedValues };
  [
    "currentKm",
    "initialRecordedKm",
    "ownerUserId",
    "ownerUserName",
    "ownerThemeKey",
    "currentDriverUserId",
    "currentDriverUserName",
    "currentDriverThemeKey",
    "pendingDriverUserId",
    "pendingDriverUserName",
    "pendingDriverThemeKey",
    "pendingDriverRequestedAt",
  ].forEach((field) => delete directValues[field]);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    ...directValues,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  if (protectedAssignmentsChanged) {
    const setAssignments = httpsCallable<
      { vehicleId: string; ownerUserId: string; currentDriverUserId: string },
      { vehicleId: string }
    >(functions, "setVehicleAssignments");
    await setAssignments({
      vehicleId,
      ownerUserId: savedValues.ownerUserId,
      currentDriverUserId: savedValues.currentDriverUserId,
    });
  }
  if (protectedMileageChanged) {
    await updateVehicleMileage(vehicleId, savedValues.currentKm, savedValues.initialRecordedKm);
  }

  await addVehicleEvent(
    vehicleId,
    "updated",
    `Masina ${values.plateNumber} a fost actualizata.`
  );

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_updated",
    entityId: vehicleId,
    title: "Masina actualizata",
    message: `Datele masinii ${normalizePlateNumber(values.plateNumber)} au fost actualizate.`,
    directUserId: values.currentDriverUserId || "",
    ownerUserId: values.ownerUserId || previousOwnerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
    metadata: {
      changesText,
      changesCount: changesText.length,
    },
  });

  if (previousStatus !== values.status) {
    await addVehicleEvent(
      vehicleId,
      "updated",
      `Statusul masinii ${values.plateNumber} a fost schimbat din "${previousStatus || "-"}" in "${values.status}".`
    );

    await dispatchNotificationEvent({
      module: "vehicles",
      eventType: "vehicle_status_changed",
      entityId: vehicleId,
      title: "Status masina schimbat",
      message: `Masina ${values.plateNumber} are acum statusul ${values.status}.`,
      directUserId: values.currentDriverUserId || "",
      ownerUserId: values.ownerUserId || previousOwnerUserId || "",
      actorUserId: values.ownerUserId || "",
      actorUserName: values.ownerUserName || "Responsabil",
      actorUserThemeKey: values.ownerThemeKey ?? null,
      metadata: {
        changesText: [`Status: ${previousStatus || "-"} -> ${values.status}`],
        changesCount: 1,
      },
    });
  }

}

export async function addVehicleEvent(
  vehicleId: string,
  type: VehicleEventItem["type"],
  message: string,
  actor?: {
    actorUserId?: string;
    actorUserName?: string;
    actorUserThemeKey?: string | null;
  }
): Promise<void> {
  const actorUserId = actor?.actorUserId || auth.currentUser?.uid || "";
  await addDoc(vehicleEventsCollection, {
    vehicleId,
    type,
    message,
    actorUserId,
    actorUserName: actor?.actorUserName ?? "",
    actorUserThemeKey: actor?.actorUserThemeKey ?? null,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}

function toVehicleEventType(value: unknown): VehicleEventItem["type"] {
  return value === "created" ||
    value === "updated" ||
    value === "driver_changed" ||
    value === "images_updated" ||
    value === "claimed" ||
    value === "comment"
    ? value
    : "updated";
}

export async function getVehicleEvents(vehicleId: string): Promise<VehicleEventItem[]> {
  if (!vehicleId) return [];

  const snap = await getDocs(
    query(vehicleEventsCollection, where("vehicleId", "==", vehicleId))
  );

  const events = snap.docs.map((docItem) => ({
    id: docItem.id,
    vehicleId: toSafeString(docItem.data().vehicleId),
    type: toVehicleEventType(docItem.data().type),
    message: toSafeString(docItem.data().message),
    createdAt: toSafeNumber(docItem.data().createdAt, Date.now()),
    actorUserId: toSafeString(docItem.data().actorUserId),
    actorUserName: toSafeString(docItem.data().actorUserName),
    actorUserThemeKey: docItem.data().actorUserThemeKey ?? null,
  }));

  return events.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addVehicleComment(
  vehicleId: string,
  comment: string,
  actor: {
    actorUserId?: string;
    actorUserName?: string;
    actorUserThemeKey?: string | null;
  }
): Promise<void> {
  const cleanComment = comment.trim();
  if (!vehicleId || !cleanComment) return;

  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = vehicleSnap.exists() ? vehicleSnap.data() : null;
  const plateNumber = data?.plateNumber ?? vehicleId;

  await addVehicleEvent(vehicleId, "comment", `Comentariu: ${cleanComment}`, actor);

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_updated",
    entityId: vehicleId,
    title: "Comentariu masina",
    message: `${actor.actorUserName || "Utilizator"} a adaugat un comentariu la masina ${plateNumber}: ${cleanComment}`,
    notificationPath: `/vehicles/${vehicleId}`,
    directUserId: toSafeString(data?.currentDriverUserId),
    ownerUserId: toSafeString(data?.ownerUserId),
    actorUserId: actor.actorUserId ?? "",
    actorUserName: actor.actorUserName ?? "Utilizator",
    actorUserThemeKey: actor.actorUserThemeKey ?? null,
    metadata: {
      fieldsText: [`Comentariu: ${cleanComment}`],
      fieldsCount: 1,
    },
  });
}

export async function uploadVehicleImages(
  vehicleId: string,
  files: File[]
): Promise<VehicleImageItem[]> {
  const uploadedItems: VehicleImageItem[] = [];

  for (const file of files) {
    const safeBaseName = `${Date.now()}_${file.name
      .replace(/\s+/g, "_")
      .replace(/[^\w.-]/g, "")
      .replace(/\.[^/.]+$/, "")}`;

    const fullPath = `vehicles/${vehicleId}/images/${safeBaseName}.jpg`;
    const thumbPath = `vehicles/${vehicleId}/images/thumb_${safeBaseName}.jpg`;

    const fullRef = ref(storage, fullPath);
    const thumbRef = ref(storage, thumbPath);

    const fullBlob = await resizeImage(file, {
      maxWidth: 1400,
      maxHeight: 1400,
      quality: 0.82,
    });

    const thumbBlob = await resizeImage(file, {
      maxWidth: 240,
      maxHeight: 240,
      quality: 0.72,
    });

    await uploadBytes(fullRef, fullBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });
    await uploadBytes(thumbRef, thumbBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });

    const fullUrl = await getDownloadURL(fullRef);
    const thumbUrl = await getDownloadURL(thumbRef);

    uploadedItems.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      url: fullUrl,
      path: fullPath,
      fileName: file.name,
      createdAt: Date.now(),
      thumbUrl,
      thumbPath,
    });
  }

  return uploadedItems;
}

export async function saveVehicleImages(
  vehicleId: string,
  currentImages: VehicleImageItem[],
  newImages: VehicleImageItem[]
): Promise<void> {
  const merged = [...currentImages, ...newImages];
  const coverImageUrl = merged[0]?.url ?? "";
  const coverThumbUrl = merged[0]?.thumbUrl ?? merged[0]?.url ?? "";

  await updateDoc(doc(db, "vehicles", vehicleId), {
    images: merged,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "images_updated",
    "Imaginile masinii au fost actualizate."
  );

  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = vehicleSnap.exists() ? vehicleSnap.data() : null;
  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_images_updated",
    entityId: vehicleId,
    title: "Poze masina actualizate",
    message: `Au fost adaugate ${newImages.length} poze pentru masina ${data?.plateNumber ?? vehicleId}.`,
    directUserId: toSafeString(data?.currentDriverUserId),
    ownerUserId: toSafeString(data?.ownerUserId),
  });
}

function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("request_timeout_");
}


export async function uploadVehicleDocuments(
  vehicleId: string,
  files: VehicleUploadDocumentInput[]
): Promise<VehicleDocumentItem[]> {
  const uploadedItems: VehicleDocumentItem[] = [];

  for (const item of files) {
    const file = item.file;
    if (!isSupportedVehicleDocumentFile(file)) {
      throw new Error("Documentele masinii trebuie sa fie PDF, JPG, PNG sau WEBP si maximum 18 MB.");
    }
    const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() || "" : "";
    const safeBaseName = `${Date.now()}_${file.name
      .replace(/\s+/g, "_")
      .replace(/[^\w.-]/g, "")}`;

    const fullPath = `vehicles/${vehicleId}/documents/${item.category}/${safeBaseName}`;
    const fullRef = ref(storage, fullPath);
    await uploadBytes(fullRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private,max-age=604800",
      customMetadata: {
        maxBytes: String(VEHICLE_DOCUMENT_MAX_BYTES),
      },
    });

    const url = await getDownloadURL(fullRef);

    uploadedItems.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: file.name,
      url,
      path: fullPath,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size || 0,
      extension: ext,
      category: item.category,
      expiryDate: item.expiryDate || "",
      expirySource: item.expiryDate ? "manual" : "",
      createdAt: Date.now(),
    });
  }

  return uploadedItems;
}

function normalizeAiCategory(value?: string): VehicleDocumentCategory | null {
  const safeValue = String(value || "").trim().toLowerCase();
  if (["service", "itp", "rca", "casco", "leasing_rate", "rovinieta", "amenda", "other"].includes(safeValue)) {
    return safeValue as VehicleDocumentCategory;
  }
  return null;
}

function isDateString(value?: string): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export async function analyzeVehicleDocumentWithAi(
  item: VehicleDocumentItem
): Promise<VehicleDocumentAiAnalysis | null> {
  if (!item.path) return null;

  const analyzeDocument = httpsCallable<
    { storagePath: string; fileName: string; contentType: string },
    VehicleDocumentAiAnalysis
  >(functions, "analyzeVehicleDocument");

  const result = await analyzeDocument({
    storagePath: item.path,
    fileName: item.name,
    contentType: item.contentType,
  });

  return result.data ?? null;
}

export async function enrichVehicleDocumentsWithAi(
  documents: VehicleDocumentItem[]
): Promise<VehicleDocumentItem[]> {
  const enriched: VehicleDocumentItem[] = [];

  for (const item of documents) {
    try {
      const analysis = await analyzeVehicleDocumentWithAi(item);
      if (!analysis) {
        enriched.push(item);
        continue;
      }

      const detectedCategory = normalizeAiCategory(analysis.documentType);
      const detectedExpiryDate = isDateString(analysis.expiryDate) ? analysis.expiryDate : "";
      const confidence = Number(analysis.confidence || 0);

      enriched.push({
        ...item,
        category: confidence >= 0.55 && detectedCategory ? detectedCategory : item.category,
        expiryDate: detectedExpiryDate || item.expiryDate || "",
        aiAnalysis: {
          ...analysis,
          documentType: detectedCategory || analysis.documentType || "unknown",
          expiryDate: detectedExpiryDate,
          confidence,
          analyzedAt: Date.now(),
        },
      });
    } catch (error) {
      console.warn("[enrichVehicleDocumentsWithAi]", item.name, error);
      enriched.push(item);
    }
  }

  return enriched;
}

type VehicleDocumentJobReference = {
  vehicleId: string;
  documentId: string;
  jobId: string;
};

function normalizeVehicleDocumentJob(value: unknown): VehicleDocumentIngestionJob {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = ["queued", "processing", "needs_review", "applied", "rejected", "failed"].includes(String(raw.status))
    ? raw.status as VehicleDocumentIntelligenceStatus
    : "queued";
  return {
    jobId: toSafeString(raw.jobId),
    status,
    result: raw.result && typeof raw.result === "object"
      ? raw.result as VehicleDocumentIngestionJob["result"]
      : null,
    model: toSafeString(raw.model) || undefined,
    extractionVersion: toSafeString(raw.extractionVersion) || undefined,
    attempts: toSafeNumber(raw.attempts, 0),
    errorCode: toSafeString(raw.errorCode) || undefined,
    createdAt: toSafeNumber(raw.createdAt, 0),
    updatedAt: toSafeNumber(raw.updatedAt, 0),
    decision: ["applied", "rejected", "rolled_back", ""].includes(String(raw.decision))
      ? raw.decision as VehicleDocumentIngestionJob["decision"]
      : "",
  };
}

export async function queueVehicleDocumentsForAnalysis(
  vehicleId: string,
  documents: VehicleDocumentItem[]
): Promise<VehicleDocumentItem[]> {
  const createJob = httpsCallable<
    { vehicleId: string; documentId: string; storagePath: string; fileName: string; contentType: string },
    VehicleDocumentIngestionJob & { created?: boolean }
  >(functions, "createVehicleDocumentIngestionJob");
  const queued: VehicleDocumentItem[] = [];

  for (const item of documents) {
    try {
      const response = await createJob({
        vehicleId,
        documentId: item.id,
        storagePath: item.path,
        fileName: item.name,
        contentType: item.contentType,
      });
      const job = normalizeVehicleDocumentJob(response.data);
      queued.push({
        ...item,
        intelligenceJobId: job.jobId,
        intelligenceStatus: job.decision === "applied" ? "applied" : job.status,
      });
    } catch (error) {
      console.warn("[queueVehicleDocumentsForAnalysis]", item.name, error);
      queued.push(item);
    }
  }
  return queued;
}

export async function getVehicleDocumentIngestionJob(
  reference: VehicleDocumentJobReference
): Promise<VehicleDocumentIngestionJob> {
  const getJob = httpsCallable<VehicleDocumentJobReference, VehicleDocumentIngestionJob>(
    functions,
    "getVehicleDocumentIngestionJob"
  );
  const response = await getJob(reference);
  return normalizeVehicleDocumentJob(response.data);
}

export async function retryVehicleDocumentIngestionJob(
  reference: VehicleDocumentJobReference
): Promise<void> {
  const retryJob = httpsCallable<VehicleDocumentJobReference, { status: string }>(
    functions,
    "retryVehicleDocumentIngestionJob"
  );
  await retryJob(reference);
}

export async function applyVehicleDocumentIngestionJob(
  reference: VehicleDocumentJobReference,
  acceptedFields: Array<"documentType" | "expiryDate">
): Promise<void> {
  const applyJob = httpsCallable<
    VehicleDocumentJobReference & { acceptedFields: string[]; confirm: true },
    { operationId: string; duplicate: boolean }
  >(functions, "applyVehicleDocumentIngestionJob");
  await applyJob({ ...reference, acceptedFields, confirm: true });
}

export async function rejectVehicleDocumentIngestionJob(
  reference: VehicleDocumentJobReference
): Promise<void> {
  const rejectJob = httpsCallable<
    VehicleDocumentJobReference & { confirm: true },
    { decisionId: string; status: string }
  >(functions, "rejectVehicleDocumentIngestionJob");
  await rejectJob({ ...reference, confirm: true });
}

export async function rollbackVehicleDocumentIngestionJob(
  reference: VehicleDocumentJobReference
): Promise<void> {
  const rollbackJob = httpsCallable<
    VehicleDocumentJobReference & { confirm: true },
    { operationId: string; status: string }
  >(functions, "rollbackVehicleDocumentIngestionJob");
  await rollbackJob({ ...reference, confirm: true });
}

export async function saveVehicleDocuments(
  vehicleId: string,
  currentDocuments: VehicleDocumentItem[],
  newDocuments: VehicleDocumentItem[]
): Promise<void> {
  const merged = [...currentDocuments, ...newDocuments];
  const newestExpiryByCategory = newDocuments.reduce<Record<string, string>>((acc, item) => {
    if (item.expiryDate && ["itp", "rca", "casco", "rovinieta"].includes(item.category)) {
      acc[item.category] = item.expiryDate;
    }
    return acc;
  }, {});

  await updateDoc(doc(db, "vehicles", vehicleId), {
    documents: merged,
    documentSummary: buildVehicleDocumentSummary(merged),
    ...(newestExpiryByCategory.itp ? { nextItpDate: newestExpiryByCategory.itp } : {}),
    ...(newestExpiryByCategory.rca ? { nextRcaDate: newestExpiryByCategory.rca } : {}),
    ...(newestExpiryByCategory.casco ? { nextCascoDate: newestExpiryByCategory.casco } : {}),
    ...(newestExpiryByCategory.rovinieta ? { nextRovinietaDate: newestExpiryByCategory.rovinieta } : {}),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "updated",
    "Documentele vehiculului au fost actualizate."
  );

  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = vehicleSnap.exists() ? vehicleSnap.data() : null;
  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_documents_updated",
    entityId: vehicleId,
    title: "Documente masina actualizate",
    message: `Au fost actualizate documentele masinii ${data?.plateNumber ?? vehicleId}.`,
    directUserId: toSafeString(data?.currentDriverUserId),
    ownerUserId: toSafeString(data?.ownerUserId),
  });

}

export async function removeVehicleDocument(
  vehicleId: string,
  documents: VehicleDocumentItem[],
  documentId: string
): Promise<VehicleDocumentItem[]> {
  const documentToDelete = documents.find((docItem) => docItem.id === documentId);
  if (!documentToDelete) return documents;

  const updated = documents.filter((docItem) => docItem.id !== documentId);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    documents: updated,
    documentSummary: buildVehicleDocumentSummary(updated),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(vehicleId, "updated", "Un document al vehiculului a fost sters.");

  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = vehicleSnap.exists() ? vehicleSnap.data() : null;
  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_document_deleted",
    entityId: vehicleId,
    title: "Document masina sters",
    message: `Un document al masinii ${data?.plateNumber ?? vehicleId} a fost sters.`,
    directUserId: toSafeString(data?.currentDriverUserId),
    ownerUserId: toSafeString(data?.ownerUserId),
  });
  return updated;
}

export async function restoreVehicleDocuments(
  vehicleId: string,
  documents: VehicleDocumentItem[]
): Promise<void> {
  await updateDoc(doc(db, "vehicles", vehicleId), {
    documents,
    documentSummary: buildVehicleDocumentSummary(documents),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function setVehicleCoverImage(
  vehicleId: string,
  imageUrl: string
): Promise<void> {
  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  if (!snap.exists()) return;

  const data = snap.data();
  const images = Array.isArray(data.images) ? data.images : [];
  const selected = images.find((img: any) => img.url === imageUrl);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    coverImageUrl: imageUrl,
    coverThumbUrl: selected?.thumbUrl ?? imageUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "images_updated",
    "Poza principala a masinii a fost schimbata."
  );

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_cover_changed",
    entityId: vehicleId,
    title: "Poza principala masina schimbata",
    message: `Poza principala pentru masina ${data.plateNumber ?? vehicleId} a fost schimbata.`,
    directUserId: toSafeString(data.currentDriverUserId),
    ownerUserId: toSafeString(data.ownerUserId),
  });
}

export async function restoreVehicleCoverImage(
  vehicleId: string,
  coverImageUrl: string,
  coverThumbUrl: string
): Promise<void> {
  await updateDoc(doc(db, "vehicles", vehicleId), {
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function removeVehicleImage(
  vehicleId: string,
  images: VehicleImageItem[],
  imageId: string
): Promise<VehicleImageItem[]> {
  const imageToDelete = images.find((img) => img.id === imageId);
  if (!imageToDelete) return images;

  const updated = images.filter((img) => img.id !== imageId);
  const coverImageUrl = updated[0]?.url ?? "";
  const coverThumbUrl = updated[0]?.thumbUrl ?? updated[0]?.url ?? "";

  await updateDoc(doc(db, "vehicles", vehicleId), {
    images: updated,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(vehicleId, "images_updated", "O imagine a fost stearsa.");

  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = vehicleSnap.exists() ? vehicleSnap.data() : null;
  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_image_deleted",
    entityId: vehicleId,
    title: "Poza masina stearsa",
    message: `O poza a masinii ${data?.plateNumber ?? vehicleId} a fost stearsa.`,
    directUserId: toSafeString(data?.currentDriverUserId),
    ownerUserId: toSafeString(data?.ownerUserId),
  });
  return updated;
}

export async function restoreVehicleImages(
  vehicleId: string,
  images: VehicleImageItem[],
  coverImageUrl: string,
  coverThumbUrl: string
): Promise<void> {
  await updateDoc(doc(db, "vehicles", vehicleId), {
    images,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function changeVehicleDriver(
  vehicleId: string,
  nextDriverUserId: string,
  nextDriverUserName: string,
  nextDriverThemeKey: string | null
): Promise<void> {
  void nextDriverUserName;
  void nextDriverThemeKey;
  const callable = httpsCallable<
    { vehicleId: string; nextDriverUserId: string },
    { vehicleId: string; pendingDriverUserId: string }
  >(functions, "requestVehicleTransfer");
  await callable({ vehicleId, nextDriverUserId });
}

export async function acceptVehicleDriverChange(
  vehicleId: string,
  accepterUserId: string
): Promise<void> {
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== accepterUserId) {
    throw new Error("Solicitarea poate fi acceptata numai de destinatar.");
  }
  const callable = httpsCallable<{ vehicleId: string }, { vehicleId: string }>(
    functions,
    "acceptVehicleTransfer"
  );
  await callable({ vehicleId });
}

export async function claimVehicleForCurrentUser(
  vehicleId: string,
  userId: string,
  userName: string,
  userThemeKey: string | null
): Promise<void> {
  void userName;
  void userThemeKey;
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== userId) throw new Error("Poti prelua vehiculul numai pentru tine.");
  const callable = httpsCallable<{ vehicleId: string }, { vehicleId: string }>(
    functions,
    "claimVehicle"
  );
  await callable({ vehicleId });
}

export async function updateVehicleMileage(
  vehicleId: string,
  currentKm: number,
  initialRecordedKm?: number
): Promise<void> {
  assertValidVehicleKm(currentKm, "Km curenti");
  if (initialRecordedKm !== undefined) assertValidVehicleKm(initialRecordedKm, "Km initiali");
  const callable = httpsCallable<
    { vehicleId: string; currentKm: number; initialRecordedKm?: number },
    { vehicleId: string; currentKm: number }
  >(functions, "updateVehicleMileage");
  await callable({ vehicleId, currentKm, initialRecordedKm });
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = snap.exists() ? snap.data() : null;

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_deleted",
    entityId: vehicleId,
    title: "Masina stearsa",
    message: `Masina ${data?.plateNumber ?? vehicleId} a fost stearsa din sistem.`,
    ownerUserId: data?.ownerUserId ?? "",
  });
  await deleteDoc(doc(db, "vehicles", vehicleId));
}

function mapVehiclePositionDoc(id: string, data: Record<string, any>): VehiclePositionItem {
  return {
    id,
    vehicleId: toSafeString(data.vehicleId),
    imei: toSafeString(data.imei),
    lat: toSafeNumber(data.lat, 0),
    lng: toSafeNumber(data.lng, 0),
    speedKmh: toSafeNumber(data.speedKmh, 0),
    altitude: toSafeNumber(data.altitude, 0),
    angle: toSafeNumber(data.angle, 0),
    satellites: toSafeNumber(data.satellites, 0),
    gpsTimestamp: toSafeNumber(data.gpsTimestamp, 0),
    serverTimestamp: toSafeNumber(data.serverTimestamp, 0),
    eventIoId: toSafeNumber(data.eventIoId, 0),
    ignitionOn: toOptionalBoolean(data.ignitionOn),
    odometerKm: toOptionalNumber(data.odometerKm),
    rawIo: toSafeObject(data.rawIo),
  };
}

function mapVehicleTrackerEventDoc(
  id: string,
  data: Record<string, any>
): VehicleTrackerEventItem {
  return {
    id,
    type: toSafeString(data.type, "tracker_event"),
    timestamp: toSafeNumber(data.timestamp ?? data.gpsTimestamp ?? data.createdAt, Date.now()),
    lat: toOptionalNumber(data.lat),
    lng: toOptionalNumber(data.lng),
    speedKmh: toOptionalNumber(data.speedKmh),
    metadata: toSafeObject(data.metadata),
  };
}

function mapVehicleCommandDoc(id: string, data: Record<string, any>): VehicleCommandItem {
  const type = toVehicleCommandType(data.type);
  const status = toVehicleCommandStatus(data.status);

  return {
    id,
    type,
    status,
    requestedBy: toSafeString(data.requestedBy, "system"),
    requestedAt: toSafeNumber(data.requestedAt, Date.now()),
    completedAt:
      data.completedAt === null || data.completedAt === undefined
        ? null
        : toSafeNumber(data.completedAt, Date.now()),
    providerMessage: toSafeString(data.providerMessage),
    result: toSafeString(data.result),
    durationSec:
      data.durationSec === null || data.durationSec === undefined
        ? null
        : toSafeNumber(data.durationSec, 0),
  };
}

async function getVehiclePositionsForDay(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  const allItems: VehiclePositionItem[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  const pointsRef = collection(
    db,
    "vehicles",
    vehicleId,
    "positionDays",
    dayKey,
    "points"
  ) as CollectionReference<DocumentData>;

  let firestoreError: unknown = null;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const constraints: QueryConstraint[] = [
        where("gpsTimestamp", ">=", fromTs),
        where("gpsTimestamp", "<=", toTs),
        orderBy("gpsTimestamp", "asc"),
        limit(pageSize),
      ];

      if (lastDoc) {
        constraints.push(startAfter(lastDoc));
      }

      const q = query(pointsRef, ...constraints);
      const snap = await withTimeout(getDocs(q), ROUTE_QUERY_TIMEOUT_MS);

      if (snap.empty) break;

      const pageItems: VehiclePositionItem[] = snap.docs.map((docItem) =>
        mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
      );

      allItems.push(...pageItems);

      if (allItems.length >= MAX_TOTAL_ROUTE_POINTS) {
        console.warn(
          `[getVehiclePositionsForDay] limita atinsa vehicleId=${vehicleId} dayKey=${dayKey} points=${allItems.length}`
        );
        break;
      }

      if (snap.docs.length < pageSize) {
        break;
      }

      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (!lastDoc) break;
    }
  } catch (error) {
    firestoreError = error;
  }

  const archivedItems = await getVehicleArchivedPositionsForDay(vehicleId, dayKey, fromTs, toTs);
  if (firestoreError && !archivedItems.length) throw firestoreError;

  return normalizePositionItems([...allItems, ...archivedItems]);
}

async function getVehicleIncrementalPositionsForDay(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  const allItems: VehiclePositionItem[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  const pointsRef = collection(
    db,
    "vehicles",
    vehicleId,
    "positionDays",
    dayKey,
    "points"
  ) as CollectionReference<DocumentData>;

  for (let page = 0; page < maxPages; page += 1) {
    const constraints: QueryConstraint[] = [
      where("gpsTimestamp", ">=", fromTs),
      where("gpsTimestamp", "<=", toTs),
      orderBy("gpsTimestamp", "asc"),
      limit(pageSize),
    ];
    if (lastDoc) constraints.push(startAfter(lastDoc));

    const snap = await withTimeout(
      getDocs(query(pointsRef, ...constraints)),
      ROUTE_QUERY_TIMEOUT_MS
    );
    if (snap.empty) break;

    allItems.push(
      ...snap.docs.map((docItem) =>
        mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
      )
    );
    if (allItems.length >= MAX_TOTAL_ROUTE_POINTS || snap.docs.length < pageSize) break;

    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (!lastDoc) break;
  }

  return normalizePositionItems(allItems);
}

async function getVehicleLatestPositionsForDay(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number,
  maxItems: number
): Promise<VehiclePositionItem[]> {
  const pointsRef = collection(
    db,
    "vehicles",
    vehicleId,
    "positionDays",
    dayKey,
    "points"
  ) as CollectionReference<DocumentData>;

  const snap = await withTimeout(
    getDocs(
      query(
        pointsRef,
        where("gpsTimestamp", ">=", fromTs),
        where("gpsTimestamp", "<=", toTs),
        orderBy("gpsTimestamp", "desc"),
        limit(maxItems)
      )
    ),
    ROUTE_QUERY_TIMEOUT_MS
  );

  return normalizePositionItems(
    snap.docs.map((docItem) =>
      mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
    )
  );
}

async function getVehiclePositionsFromFlatCollection(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  const allItems: VehiclePositionItem[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  const pointsRef = collection(db, "vehicles", vehicleId, "positions") as CollectionReference<
    DocumentData
  >;

  for (let page = 0; page < maxPages; page += 1) {
    const constraints: QueryConstraint[] = [
      where("gpsTimestamp", ">=", fromTs),
      where("gpsTimestamp", "<=", toTs),
      orderBy("gpsTimestamp", "asc"),
      limit(pageSize),
    ];

    if (lastDoc) {
      constraints.push(startAfter(lastDoc));
    }

    const q = query(pointsRef, ...constraints);
    const snap = await withTimeout(getDocs(q), ROUTE_QUERY_TIMEOUT_MS);
    if (snap.empty) break;

    allItems.push(
      ...snap.docs.map((docItem) =>
        mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
      )
    );

    if (allItems.length >= MAX_TOTAL_ROUTE_POINTS) {
      break;
    }

    if (snap.docs.length < pageSize) {
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (!lastDoc) break;
  }

  return allItems;
}

async function getVehicleLatestPositionsFromFlatCollection(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  maxItems: number
): Promise<VehiclePositionItem[]> {
  const pointsRef = collection(db, "vehicles", vehicleId, "positions") as CollectionReference<
    DocumentData
  >;

  const snap = await withTimeout(
    getDocs(
      query(
        pointsRef,
        where("gpsTimestamp", ">=", fromTs),
        where("gpsTimestamp", "<=", toTs),
        orderBy("gpsTimestamp", "desc"),
        limit(maxItems)
      )
    ),
    ROUTE_QUERY_TIMEOUT_MS
  );

  return normalizePositionItems(
    snap.docs.map((docItem) =>
      mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
    )
  );
}

async function getVehicleLatestPositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  maxItems: number
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const dayKeys = dedupeDayKeys([getDayKeyFromTs(toTs), getDayKeyFromTs(fromTs)]).sort((a, b) =>
    b.localeCompare(a)
  );
  const dayResults = await runWithConcurrency(
    dayKeys,
    DAY_QUERY_CONCURRENCY,
    async (dayKey) =>
      getVehicleLatestPositionsForDay(vehicleId, dayKey, fromTs, toTs, maxItems).catch(
        (error) => {
          console.warn("[getVehicleLatestPositionsRange][positionDays]", dayKey, error);
          return [] as VehiclePositionItem[];
        }
      )
  );

  const flatItems = await getVehicleLatestPositionsFromFlatCollection(
    vehicleId,
    fromTs,
    toTs,
    maxItems
  ).catch((error) => {
    console.warn("[getVehicleLatestPositionsRange][flatCollection]", error);
    return [] as VehiclePositionItem[];
  });

  const normalized = normalizePositionItems([...dayResults.flat(), ...flatItems]);
  return normalized.slice(Math.max(0, normalized.length - maxItems));
}

function enumerateTimeChunks(
  fromTs: number,
  toTs: number,
  chunkMs = PROGRESSIVE_ROUTE_CHUNK_MS,
  newestFirst = false
) {
  const chunks: Array<{ fromTs: number; toTs: number }> = [];
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) return chunks;

  for (let chunkFromTs = fromTs; chunkFromTs <= toTs; chunkFromTs += chunkMs) {
    chunks.push({
      fromTs: chunkFromTs,
      toTs: Math.min(toTs, chunkFromTs + chunkMs - 1),
    });
  }

  return newestFirst ? chunks.reverse() : chunks;
}

async function getVehiclePositionsForDayInChunks(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES,
  chunkMs = PROGRESSIVE_ROUTE_CHUNK_MS
): Promise<VehiclePositionItem[]> {
  const dayStart = getDayStartTs(dayKey);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  const safeFromTs = Math.max(fromTs, dayStart);
  const safeToTs = Math.min(toTs, dayEnd);
  if (safeFromTs > safeToTs) return [];

  const items: VehiclePositionItem[] = [];

  for (const chunk of enumerateTimeChunks(safeFromTs, safeToTs, chunkMs)) {
    try {
      items.push(
        ...(await getVehiclePositionsForDay(
          vehicleId,
          dayKey,
          chunk.fromTs,
          chunk.toTs,
          pageSize,
          maxPages
        ))
      );
    } catch (error) {
      console.warn(
        "[getVehiclePositionsForDayInChunks]",
        dayKey,
        new Date(chunk.fromTs).toISOString(),
        error
      );
    }
  }

  return normalizePositionItems(items);
}

async function getVehiclePositionsFromFlatCollectionInChunks(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  const items: VehiclePositionItem[] = [];

  for (const chunk of enumerateTimeChunks(fromTs, toTs)) {
    try {
      items.push(
        ...(await getVehiclePositionsFromFlatCollection(
          vehicleId,
          chunk.fromTs,
          chunk.toTs,
          pageSize,
          maxPages
        ))
      );
    } catch (error) {
      console.warn(
        "[getVehiclePositionsFromFlatCollectionInChunks]",
        new Date(chunk.fromTs).toISOString(),
        error
      );
    }
  }

  return normalizePositionItems(items);
}

export function subscribeVehiclePositions(
  vehicleId: string,
  onData: (items: VehiclePositionItem[]) => void,
  maxItems = 300
): () => void {
  if (!vehicleId) {
    onData([]);
    return () => undefined;
  }

  const snapRef = doc(db, "vehicles", vehicleId);
  let requestSeq = 0;

  return onSnapshot(
    snapRef,
    async (snap) => {
      const currentSeq = ++requestSeq;

      try {
        if (!snap.exists()) {
          onData([]);
          return;
        }

        const data = snap.data();
        const gpsSnapshot = data?.gpsSnapshot;
        if (!gpsSnapshot?.gpsTimestamp) {
          onData([]);
          return;
        }

        const toTs = Number(gpsSnapshot.gpsTimestamp);
        const fromTs = Math.max(0, toTs - 24 * 60 * 60 * 1000);

        const items = await getVehiclePositionsRange(
          vehicleId,
          fromTs,
          toTs,
          maxItems,
          5
        );

        if (currentSeq !== requestSeq) return;
        onData(items.slice(Math.max(0, items.length - maxItems)));
      } catch (error) {
        console.error("[subscribeVehiclePositions]", error);
      }
    },
    (error) => {
      console.error("[subscribeVehiclePositions]", error);
    }
  );
}

export async function getVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const cached = getRouteCache(vehicleId, fromTs, toTs);
  if (cached) return cached;

  const rangeItems: VehiclePositionItem[] = [];
  const dayKeys = enumerateLocalDayKeysWithUtcNeighbors(fromTs, toTs).sort((a, b) =>
    b.localeCompare(a)
  );
  if (dayKeys.length > 0) {
    const dayResults = await runWithConcurrency(
      dayKeys,
      DAY_QUERY_CONCURRENCY,
      async (dayKey) =>
        getVehiclePositionsForDayInChunks(vehicleId, dayKey, fromTs, toTs, pageSize, maxPages).catch(
          (error) => {
            console.warn("[getVehiclePositionsRange][positionDays]", dayKey, error);
            return [] as VehiclePositionItem[];
          }
        )
    );

    const allItems = dayResults.flat();
    if (allItems.length >= MAX_TOTAL_ROUTE_POINTS) {
      console.warn(
        `[getVehiclePositionsRange] limita atinsa vehicleId=${vehicleId} points=${allItems.length}`
      );
    }
    rangeItems.push(...allItems);
  }

  try {
    const flatItems = await getVehiclePositionsFromFlatCollectionInChunks(
      vehicleId,
      fromTs,
      toTs,
      pageSize,
      maxPages
    );
    rangeItems.push(...flatItems);
  } catch (error) {
    console.warn("[getVehiclePositionsRange][flatCollectionMerge]", error);
  }

  const normalized = normalizePositionItems(rangeItems).slice(0, MAX_TOTAL_ROUTE_POINTS);

  setRouteCache(vehicleId, fromTs, toTs, normalized);
  return normalized;
}

async function getVehiclePositionsRangeProgressive(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  onProgress: (items: VehiclePositionItem[]) => void,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const isProgressiveRange = toTs - fromTs >= PROGRESSIVE_ROUTE_RANGE_MS;
  const cached = isProgressiveRange ? null : getRouteCache(vehicleId, fromTs, toTs);
  if (cached) {
    onProgress(cached);
    return cached;
  }

  let mergedItems: VehiclePositionItem[] = [];
  const dayKeys = enumerateLocalDayKeysWithUtcNeighbors(fromTs, toTs).sort((a, b) =>
    b.localeCompare(a)
  );

  for (const dayKey of dayKeys) {
    const dayStart = getDayStartTs(dayKey);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
    const dayFromTs = Math.max(fromTs, dayStart);
    const dayToTs = Math.min(toTs, dayEnd);
    if (dayFromTs > dayToTs) continue;

    for (const chunk of enumerateTimeChunks(dayFromTs, dayToTs, PROGRESSIVE_ROUTE_CHUNK_MS, true)) {
      try {
        const [dayItems, flatItems] = await Promise.all([
          getVehiclePositionsForDay(
            vehicleId,
            dayKey,
            chunk.fromTs,
            chunk.toTs,
            pageSize,
            maxPages
          ).catch((error) => {
            console.warn(
              "[getVehiclePositionsRangeProgressive][positionDays]",
              dayKey,
              error
            );
            return [] as VehiclePositionItem[];
          }),
          getVehiclePositionsFromFlatCollection(
            vehicleId,
            chunk.fromTs,
            chunk.toTs,
            pageSize,
            maxPages
          ).catch((error) => {
            console.warn(
              "[getVehiclePositionsRangeProgressive][flatCollection]",
              dayKey,
              error
            );
            return [] as VehiclePositionItem[];
          }),
        ]);

        const incoming = normalizePositionItems([...dayItems, ...flatItems]);
        if (!incoming.length) continue;

        mergedItems = mergePositionItems(mergedItems, incoming).slice(0, MAX_TOTAL_ROUTE_POINTS);
        onProgress(mergedItems);
      } catch (error) {
        console.warn("[getVehiclePositionsRangeProgressive][chunk]", dayKey, error);
      }
    }
  }

  setRouteCache(vehicleId, fromTs, toTs, mergedItems);
  return mergedItems;
}

function mapGpsSnapshotToPosition(vehicle: VehicleItem): VehiclePositionItem | null {
  const snapshot = vehicle.gpsSnapshot;
  if (!snapshot || !isValidLatLng(snapshot.lat, snapshot.lng) || !snapshot.gpsTimestamp) {
    return null;
  }

  return {
    id: `gpsSnapshot-${vehicle.id}-${snapshot.gpsTimestamp}`,
    vehicleId: vehicle.id,
    imei: snapshot.imei,
    lat: snapshot.lat,
    lng: snapshot.lng,
    speedKmh: snapshot.speedKmh || 0,
    altitude: snapshot.altitude,
    angle: snapshot.angle,
    satellites: snapshot.satellites,
    gpsTimestamp: snapshot.gpsTimestamp,
    serverTimestamp: snapshot.serverTimestamp || snapshot.gpsTimestamp,
    ignitionOn: snapshot.ignitionOn,
    odometerKm: snapshot.odometerKm,
  };
}

export async function getLatestVehiclePosition(
  vehicle: VehicleItem | null
): Promise<VehiclePositionItem | null> {
  if (!vehicle?.id) return null;

  const candidates: VehiclePositionItem[] = [];
  const snapshotPosition = mapGpsSnapshotToPosition(vehicle);
  if (snapshotPosition) candidates.push(snapshotPosition);

  const now = Date.now();
  const snapshotTs = vehicle.gpsSnapshot?.gpsTimestamp || 0;
  const dayKeys = dedupeDayKeys([
    getDayKeyFromTs(now),
    snapshotTs ? getDayKeyFromTs(snapshotTs) : "",
    addDays(getDayKeyFromTs(now), -1),
  ]);

  for (const dayKey of dayKeys) {
    try {
      const pointsRef = collection(
        db,
        "vehicles",
        vehicle.id,
        "positionDays",
        dayKey,
        "points"
      ) as CollectionReference<DocumentData>;

      const snap = await withTimeout(
        getDocs(query(pointsRef, orderBy("gpsTimestamp", "desc"), limit(1)))
      );
      const docItem = snap.docs[0];
      if (docItem) {
        candidates.push(mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>));
      }
    } catch (error) {
      console.warn("[getLatestVehiclePosition][positionDays]", dayKey, error);
    }
  }

  try {
    const pointsRef = collection(db, "vehicles", vehicle.id, "positions") as CollectionReference<
      DocumentData
    >;
    const snap = await withTimeout(
      getDocs(query(pointsRef, orderBy("gpsTimestamp", "desc"), limit(1)))
    );
    const docItem = snap.docs[0];
    if (docItem) {
      candidates.push(mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>));
    }
  } catch (error) {
    console.warn("[getLatestVehiclePosition][flatCollection]", error);
  }

  const clean = normalizePositionItems(candidates);
  return clean.sort((a, b) => b.gpsTimestamp - a.gpsTimestamp)[0] ?? null;
}

export async function getVehiclePositionsRangeChunked(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  return getVehiclePositionsRange(vehicleId, fromTs, toTs, pageSize, maxPages);
}

export async function getVehiclePositionsForSelectedDay(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const rangeItems: VehiclePositionItem[] = [];
  const dayKeys = enumerateDayKeys(fromTs, toTs);

  for (const dayKey of dayKeys) {
    try {
      const items = await getVehiclePositionsForDay(
        vehicleId,
        dayKey,
        fromTs,
        toTs,
        pageSize,
        maxPages
      );
      rangeItems.push(...items);
    } catch (error) {
      console.warn("[getVehiclePositionsForSelectedDay][positionDays]", dayKey, error);
    }
  }

  try {
    const flatItems = await getVehiclePositionsFromFlatCollection(
      vehicleId,
      fromTs,
      toTs,
      pageSize,
      maxPages
    );
    rangeItems.push(...flatItems);
  } catch (error) {
    console.warn("[getVehiclePositionsForSelectedDay][flatCollection]", error);
  }

  return normalizePositionItems(rangeItems).slice(0, MAX_TOTAL_ROUTE_POINTS);
}

export async function getVehiclePositionsForSelectedDayChunked(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = 300,
  maxPages = 12,
  chunkMs = 2 * 60 * 60 * 1000
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const rangeItems: VehiclePositionItem[] = [];
  for (const dayKey of enumerateDayKeys(fromTs, toTs)) {
    rangeItems.push(
      ...(await getVehiclePositionsForDayInChunks(
        vehicleId,
        dayKey,
        fromTs,
        toTs,
        pageSize,
        maxPages,
        chunkMs
      ))
    );
  }

  return normalizePositionItems(rangeItems).slice(0, MAX_TOTAL_ROUTE_POINTS);
}

export async function getVehiclePositionsIncremental(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const rangeItems: VehiclePositionItem[] = [];
  for (const dayKey of enumerateDayKeys(fromTs, toTs)) {
    try {
      rangeItems.push(
        ...(await getVehicleIncrementalPositionsForDay(
          vehicleId,
          dayKey,
          fromTs,
          toTs,
          pageSize,
          maxPages
        ))
      );
    } catch (error) {
      console.warn("[getVehiclePositionsIncremental][positionDays]", dayKey, error);
    }
  }

  return normalizePositionItems(rangeItems).slice(0, MAX_TOTAL_ROUTE_POINTS);
}

export function pollVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  onData: (items: VehiclePositionItem[]) => void,
  onError?: (error: unknown) => void,
  refreshMs = 15000,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES,
  options: RoutePollingOptions = {}
): () => void {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    onData([]);
    return () => undefined;
  }

  let stopped = false;
  let timer: number | null = null;
  let currentItems: VehiclePositionItem[] = [];
  let lastLoadedToTs = fromTs;
  let errorStreak = 0;
  let forceFastRetry = false;
  const usePersistedCache = options.usePersistedCache !== false;

  const startedAt = Date.now();
  const followsLiveTail = toTs >= startedAt - LIVE_ROUTE_WINDOW_GRACE_MS;
  const getEffectiveToTs = () => (followsLiveTail ? Date.now() : toTs);
  const isPastWindow = () => !followsLiveTail && toTs < Date.now() - 30_000;

  const scheduleNext = () => {
    if (stopped || isPastWindow()) return;
    if (forceFastRetry) {
      forceFastRetry = false;
      timer = window.setTimeout(loadIncremental, 250);
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      timer = window.setTimeout(loadIncremental, refreshMs);
      return;
    }

    const backoffMs = Math.min(
      MAX_POLL_BACKOFF_MS,
      refreshMs * Math.max(1, Math.pow(2, errorStreak))
    );
    timer = window.setTimeout(loadIncremental, backoffMs);
  };

  const loadInitial = async () => {
    let useProgressiveLoad = false;
    try {
      const effectiveToTs = getEffectiveToTs();
      useProgressiveLoad = effectiveToTs - fromTs >= PROGRESSIVE_ROUTE_RANGE_MS;
      if (followsLiveTail) {
        onData(currentItems);

        const latestItems = await getVehicleLatestPositionsRange(
          vehicleId,
          fromTs,
          effectiveToTs,
          Math.min(pageSize, 700)
        ).catch(() => []);

        if (!stopped && latestItems.length > 0) {
          currentItems = mergePositionItems(currentItems, latestItems);
          lastLoadedToTs =
            currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
          errorStreak = 0;
          onData(currentItems);
        }
      }

      const persisted = !usePersistedCache || useProgressiveLoad
        ? null
        : readBestPersistedRouteCache(vehicleId, fromTs, toTs);
      if (persisted && persisted.length > 0) {
        currentItems = persisted;
        lastLoadedToTs =
          persisted[persisted.length - 1]?.gpsTimestamp ?? fromTs;
        errorStreak = 0;
        onData(currentItems);

        if (useProgressiveLoad) {
          const items = await getVehiclePositionsRangeProgressive(
            vehicleId,
            fromTs,
            effectiveToTs,
            (partialItems) => {
              if (stopped) return;
              currentItems = mergePositionItems(currentItems, partialItems);
              lastLoadedToTs =
                currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
              onData(currentItems);
            },
            pageSize,
            maxPages
          );

          if (stopped) return;
          currentItems = mergePositionItems(currentItems, items);
          lastLoadedToTs =
            currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
          onData(currentItems);
          writePersistedRouteCache(vehicleId, fromTs, toTs, currentItems);
          return;
        }

        const incrementalFromTs = Math.max(
          fromTs,
          lastLoadedToTs - ROUTE_INCREMENTAL_OVERLAP_MS
        );

        if (incrementalFromTs <= effectiveToTs) {
          const incoming = await getVehiclePositionsRange(
            vehicleId,
            incrementalFromTs,
            effectiveToTs,
            pageSize,
            maxPages
          );
          currentItems = mergePositionItems(currentItems, incoming);
          lastLoadedToTs =
            currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
          onData(currentItems);
          writePersistedRouteCache(vehicleId, fromTs, toTs, currentItems);
        }
        return;
      }

      const items = useProgressiveLoad
        ? await getVehiclePositionsRangeProgressive(
            vehicleId,
            fromTs,
            effectiveToTs,
            (partialItems) => {
              if (stopped) return;
              currentItems = partialItems;
              lastLoadedToTs =
                partialItems[partialItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
              onData(currentItems);
            },
            pageSize,
            maxPages
          )
        : await getVehiclePositionsRange(
            vehicleId,
            fromTs,
            effectiveToTs,
            pageSize,
            maxPages
          );

      if (stopped) return;

      currentItems = items;
      lastLoadedToTs =
        items.length > 0 ? items[items.length - 1].gpsTimestamp : fromTs;
      errorStreak = 0;

      onData(currentItems);
      writePersistedRouteCache(vehicleId, fromTs, toTs, currentItems);
    } catch (error) {
      if (isRequestTimeout(error)) {
        console.warn(
          useProgressiveLoad
             ? "[pollVehiclePositionsRange][initial-progressive-timeout]"
            : "[pollVehiclePositionsRange][initial-timeout]",
          error
        );
      } else {
        console.error("[pollVehiclePositionsRange][initial]", error);
      }
      errorStreak += 1;
      if (!stopped && !useProgressiveLoad) onError?.(error);
      if (!stopped) onData(currentItems);
    } finally {
      scheduleNext();
    }
  };

  const loadIncremental = async () => {
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        onData(currentItems);
        scheduleNext();
        return;
      }

      const effectiveToTs = getEffectiveToTs();
      const incrementalFromTs = Math.max(
        fromTs,
        lastLoadedToTs - ROUTE_INCREMENTAL_OVERLAP_MS
      );

      if (incrementalFromTs > effectiveToTs) {
        onData(currentItems);
        scheduleNext();
        return;
      }

      const useProgressiveLoad = effectiveToTs - incrementalFromTs >= PROGRESSIVE_ROUTE_RANGE_MS;
      const incoming = useProgressiveLoad
        ? await getVehiclePositionsRangeProgressive(
            vehicleId,
            incrementalFromTs,
            effectiveToTs,
            (partialItems) => {
              if (stopped || !partialItems.length) return;
              currentItems = mergePositionItems(currentItems, partialItems);
              lastLoadedToTs =
                currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
              onData(currentItems);
            },
            pageSize,
            maxPages
          )
        : await getVehiclePositionsRange(
            vehicleId,
            incrementalFromTs,
            effectiveToTs,
            pageSize,
            maxPages
          );

      if (stopped) return;

      if (incoming.length > 0) {
        currentItems = mergePositionItems(currentItems, incoming);

        if (currentItems.length > MAX_TOTAL_ROUTE_POINTS) {
          currentItems = currentItems.slice(
            Math.max(0, currentItems.length - MAX_TOTAL_ROUTE_POINTS)
          );
        }

        lastLoadedToTs =
          currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
      }

      errorStreak = 0;

      onData(currentItems);
      writePersistedRouteCache(vehicleId, fromTs, toTs, currentItems);
    } catch (error) {
      if (isRequestTimeout(error)) {
        console.warn("[pollVehiclePositionsRange][incremental-timeout]", error);
      } else {
        console.error("[pollVehiclePositionsRange][incremental]", error);
      }
      errorStreak += 1;
      if (!stopped) onError?.(error);
      onData(currentItems);
    } finally {
      scheduleNext();
    }
  };

  const handleBackOnline = () => {
    if (stopped || isPastWindow()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    forceFastRetry = true;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void loadIncremental();
  };

  void loadInitial();
  if (typeof window !== "undefined") {
    window.addEventListener("online", handleBackOnline);
    document.addEventListener("visibilitychange", handleBackOnline);
  }

  return () => {
    stopped = true;
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleBackOnline);
      document.removeEventListener("visibilitychange", handleBackOnline);
    }
  };
}

export function subscribeVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  onData: (items: VehiclePositionItem[]) => void,
  refreshMs = 15000
): () => void {
  return pollVehiclePositionsRange(
    vehicleId,
    fromTs,
    toTs,
    onData,
    undefined,
    refreshMs
  );
}

export async function getVehicleTrackerEvents(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  maxItems = 500
): Promise<VehicleTrackerEventItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const eventsQuery = query(
    collection(db, "vehicles", vehicleId, "events"),
    where("timestamp", ">=", fromTs),
    where("timestamp", "<=", toTs),
    orderBy("timestamp", "asc"),
    limit(maxItems)
  );

  const snap = await withTimeout(getDocs(eventsQuery));
  return snap.docs.map((docItem) => mapVehicleTrackerEventDoc(docItem.id, docItem.data()));
}

export async function getVehicleCommands(
  vehicleId: string,
  maxItems = 20
): Promise<VehicleCommandItem[]> {
  if (!vehicleId) return [];

  const commandsQuery = query(
    collection(db, "vehicles", vehicleId, "commands"),
    orderBy("requestedAt", "desc"),
    limit(maxItems)
  );

  const snap = await getDocs(commandsQuery);
  return snap.docs.map((docItem) => mapVehicleCommandDoc(docItem.id, docItem.data()));
}

export async function requestVehicleCommand(
  vehicleId: string,
  payload: {
    type: "pulse_dout1" | "allow_start" | "block_start";
    requestedBy: string;
    durationSec?: number | null;
  }
): Promise<string> {
  if (!vehicleId) {
    throw new Error("vehicleId lipsa");
  }

  const requestId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  const callable = httpsCallable<
    {
      vehicleId: string;
      type: VehicleCommandType;
      durationSec?: number | null;
      requestId: string;
    },
    { commandId: string; duplicate: boolean; status: VehicleCommandStatus }
  >(functions, "requestVehicleCommand");
  const response = await callable({
    vehicleId,
    type: payload.type,
    durationSec: payload.durationSec ?? null,
    requestId,
  });

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType:
      payload.type === "pulse_dout1"
        ? "vehicle_started"
        : payload.type === "block_start"
        ? "vehicle_block_start_requested"
        : "vehicle_command_requested",
    entityId: vehicleId,
    title:
      payload.type === "pulse_dout1"
        ? "Cerere pornire masina"
        : payload.type === "block_start"
        ? "Cerere blocare pornire"
        : "Comanda vehicul noua",
    message:
      payload.type === "pulse_dout1"
        ? "S-a trimis comanda de pornire a masinii (DOUT1)."
        : payload.type === "block_start"
        ? "S-a trimis comanda de blocare a pornirii."
        : `S-a trimis comanda ${payload.type} pentru vehicul.`,
    actorUserName: payload.requestedBy,
  });

  if (!response.data.commandId) throw new Error("Comanda nu a returnat un identificator valid.");
  return response.data.commandId;
}
