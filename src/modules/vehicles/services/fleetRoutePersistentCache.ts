import type { VehiclePositionItem } from "../../../types/vehicle";
import type { FleetRoutePersistentCache } from "./fleetRouteSync";

const DATABASE_NAME = "workcontrol-fleet-route-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "routes";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;
export const MAX_PERSISTED_FLEET_ROUTE_POINTS = 12_000;

type StoredFleetRoute = {
  key: string;
  savedAt: number;
  expiresAt: number;
  points: VehiclePositionItem[];
};

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Cache-ul GPS local nu raspunde."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Cache-ul GPS local a fost anulat."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Cache-ul GPS local a esuat."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB nu este disponibil."));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Cache-ul GPS local nu poate fi deschis."));
    };
  });

  return databasePromise;
}

export function prepareFleetRouteForStorage(points: VehiclePositionItem[]) {
  if (points.length > MAX_PERSISTED_FLEET_ROUTE_POINTS) return null;
  return points;
}

async function pruneOldEntries(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const entries = (await requestResult(store.getAll())) as StoredFleetRoute[];
  const now = Date.now();
  const removable = entries
    .filter((entry) => entry.expiresAt <= now)
    .map((entry) => entry.key);
  const active = entries
    .filter((entry) => entry.expiresAt > now)
    .sort((a, b) => b.savedAt - a.savedAt);
  for (const entry of active.slice(MAX_CACHE_ENTRIES)) removable.push(entry.key);
  for (const key of new Set(removable)) store.delete(key);
  await completed;
}

async function removeStoredRoute(key: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).delete(key);
  await completed;
}

export const fleetRoutePersistentCache: FleetRoutePersistentCache = {
  async read(key) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionDone(transaction);
    const stored = (await requestResult(
      transaction.objectStore(STORE_NAME).get(key),
    )) as StoredFleetRoute | undefined;
    await completed;
    if (!stored || stored.expiresAt <= Date.now() || !Array.isArray(stored.points)) {
      if (stored) await removeStoredRoute(key);
      return null;
    }
    return stored.points;
  },

  async write(key, points) {
    const database = await openDatabase();
    const storedPoints = prepareFleetRouteForStorage(points);
    if (!storedPoints) {
      await removeStoredRoute(key);
      return;
    }
    const now = Date.now();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put({
      key,
      savedAt: now,
      expiresAt: now + CACHE_TTL_MS,
      points: storedPoints,
    } satisfies StoredFleetRoute);
    await completed;
    await pruneOldEntries(database);
  },

  async remove(key) {
    await removeStoredRoute(key);
  },
};
