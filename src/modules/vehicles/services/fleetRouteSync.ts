import type { VehiclePositionItem } from "../../../types/vehicle";

export type FleetRouteSource = "real";
export type FleetRouteRequestMode = "full" | "incremental";

export type FleetRouteLoader = (params: {
  vehicleId: string;
  fromTs: number;
  toTs: number;
  pageSize: number;
  maxPages: number;
  mode: FleetRouteRequestMode;
}) => Promise<VehiclePositionItem[]>;

export type FleetRouteSyncMetrics = {
  fullRouteRequests: number;
  incrementalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  sharedRequests: number;
  hiddenPageFetchesAvoided: number;
  newPointsReceived: number;
  estimatedReadsAvoided: number;
  peakConcurrentRequestsPerVehicle: number;
};

type FleetRouteCacheEntry = {
  key: string;
  points: VehiclePositionItem[];
  lastTimestamp: number;
  loadedAt: number;
  touchedAt: number;
  expiresAt: number;
};

type ActiveRouteRequest = {
  requestKey: string;
  promise: Promise<VehiclePositionItem[]>;
};

export type FleetRouteSyncController = {
  start: () => Promise<void>;
  refresh: (forceFull?: boolean) => Promise<void>;
  stop: () => void;
};

export type FleetRouteSyncOptions = {
  scopeKey: string;
  vehicleId: string;
  source?: FleetRouteSource;
  fromTs: number;
  toTs: number;
  refreshMs: number;
  refreshMode?: FleetRouteRequestMode;
  pageSize: number;
  maxPages: number;
  maxPoints?: number;
  overlapMs?: number;
  cacheTtlMs?: number;
  loader: FleetRouteLoader;
  onData: (points: VehiclePositionItem[]) => void;
  onLoading?: (loading: boolean) => void;
  onError?: (error: unknown) => void;
  visibilityDocument?: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  now?: () => number;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_OVERLAP_MS = 12_000;
const MAX_CACHE_ENTRIES = 30;
const MAX_CACHED_POINTS = 180_000;
const routeCache = new Map<string, FleetRouteCacheEntry>();
const activeRequests = new Map<string, ActiveRouteRequest>();
const activeRequestCounts = new Map<string, number>();

const metrics: FleetRouteSyncMetrics = {
  fullRouteRequests: 0,
  incrementalRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  sharedRequests: 0,
  hiddenPageFetchesAvoided: 0,
  newPointsReceived: 0,
  estimatedReadsAvoided: 0,
  peakConcurrentRequestsPerVehicle: 0,
};

function pointIdentity(point: VehiclePositionItem) {
  return point.id || `${point.gpsTimestamp}:${point.lat}:${point.lng}`;
}

export function mergeFleetRoutePoints(
  current: VehiclePositionItem[],
  incoming: VehiclePositionItem[]
) {
  const deduped = new Map<string, VehiclePositionItem>();
  for (const point of [...current, ...incoming]) {
    if (!Number.isFinite(point.gpsTimestamp)) continue;
    deduped.set(pointIdentity(point), point);
  }

  return [...deduped.values()].sort((a, b) => {
    const timestampDiff = a.gpsTimestamp - b.gpsTimestamp;
    return timestampDiff !== 0 ? timestampDiff : pointIdentity(a).localeCompare(pointIdentity(b));
  });
}

function buildCacheKey(options: FleetRouteSyncOptions) {
  return [
    options.scopeKey,
    options.vehicleId,
    options.source ?? "real",
    options.fromTs,
    options.toTs,
    options.maxPoints ?? "all",
  ].join(":");
}

function buildLockKey(options: FleetRouteSyncOptions) {
  return [options.scopeKey, options.vehicleId, options.source ?? "real"].join(":");
}

function pruneCache(now: number) {
  for (const [key, entry] of routeCache) {
    if (entry.expiresAt <= now) routeCache.delete(key);
  }

  const sorted = [...routeCache.values()].sort((a, b) => a.touchedAt - b.touchedAt);
  let totalPoints = sorted.reduce((sum, entry) => sum + entry.points.length, 0);
  while (sorted.length > MAX_CACHE_ENTRIES || totalPoints > MAX_CACHED_POINTS) {
    const oldest = sorted.shift();
    if (!oldest) break;
    routeCache.delete(oldest.key);
    totalPoints -= oldest.points.length;
  }
}

function getCachedRoute(key: string, ttlMs: number, now: number) {
  const cached = routeCache.get(key);
  if (!cached) return null;
  if (now - cached.loadedAt > ttlMs) {
    routeCache.delete(key);
    return null;
  }
  cached.touchedAt = now;
  return cached;
}

function setCachedRoute(
  key: string,
  points: VehiclePositionItem[],
  now: number,
  ttlMs = DEFAULT_CACHE_TTL_MS
) {
  const lastTimestamp = points[points.length - 1]?.gpsTimestamp ?? 0;
  routeCache.set(key, {
    key,
    points,
    lastTimestamp,
    loadedAt: now,
    touchedAt: now,
    expiresAt: now + ttlMs,
  });
  pruneCache(now);
}

async function runSharedRequest(
  lockKey: string,
  requestKey: string,
  load: () => Promise<VehiclePositionItem[]>
) {
  const active = activeRequests.get(lockKey);
  if (active?.requestKey === requestKey) {
    metrics.sharedRequests += 1;
    return active.promise;
  }
  if (active) {
    metrics.sharedRequests += 1;
    await active.promise.catch(() => undefined);
  }

  const promise = load();
  activeRequests.set(lockKey, { requestKey, promise });
  const activeCount = (activeRequestCounts.get(lockKey) ?? 0) + 1;
  activeRequestCounts.set(lockKey, activeCount);
  metrics.peakConcurrentRequestsPerVehicle = Math.max(
    metrics.peakConcurrentRequestsPerVehicle,
    activeCount
  );

  try {
    return await promise;
  } finally {
    activeRequestCounts.set(lockKey, Math.max(0, activeCount - 1));
    if (activeRequests.get(lockKey)?.promise === promise) activeRequests.delete(lockKey);
  }
}

export function createFleetRouteSync(options: FleetRouteSyncOptions): FleetRouteSyncController {
  const cacheKey = buildCacheKey(options);
  const lockKey = buildLockKey(options);
  const overlapMs = Math.max(0, options.overlapMs ?? DEFAULT_OVERLAP_MS);
  const cacheTtlMs = Math.max(60_000, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const visibilityDocument =
    options.visibilityDocument ?? (typeof document !== "undefined" ? document : undefined);
  const now = options.now ?? Date.now;
  const refreshMode = options.refreshMode ?? "incremental";
  let stopped = false;
  let started = false;
  let timer: number | null = null;
  let currentPoints: VehiclePositionItem[] = [];
  let lastTimestamp = options.fromTs;
  let lastLoadedAt = 0;
  let requestGeneration = 0;

  const clearTimer = () => {
    if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
    timer = null;
  };

  const isHidden = () => visibilityDocument?.visibilityState === "hidden";

  const schedule = (delayMs = options.refreshMs) => {
    clearTimer();
    if (stopped || typeof window === "undefined") return;
    timer = window.setTimeout(
      () => {
        void runRefresh();
      },
      Math.max(1_000, delayMs)
    );
  };

  const applyIncoming = (incoming: VehiclePositionItem[], generation: number) => {
    if (stopped || generation !== requestGeneration) return;
    const beforeCount = currentPoints.length;
    const merged = mergeFleetRoutePoints(currentPoints, incoming);
    const maxPoints = Math.max(1, Math.round(options.maxPoints ?? Number.MAX_SAFE_INTEGER));
    currentPoints = merged.slice(-maxPoints);
    lastTimestamp = currentPoints[currentPoints.length - 1]?.gpsTimestamp ?? lastTimestamp;
    lastLoadedAt = now();
    metrics.newPointsReceived += Math.max(0, currentPoints.length - beforeCount);
    setCachedRoute(cacheKey, currentPoints, now(), cacheTtlMs);
    options.onData(currentPoints);
  };

  const runFull = async () => {
    if (stopped) return;
    if (isHidden()) {
      metrics.hiddenPageFetchesAvoided += 1;
      return;
    }

    const generation = ++requestGeneration;
    const effectiveToTs = Math.min(options.toTs, now());
    const requestKey = `${cacheKey}:full`;
    options.onLoading?.(true);
    try {
      const incoming = await runSharedRequest(lockKey, requestKey, () => {
        metrics.fullRouteRequests += 1;
        return options.loader({
          vehicleId: options.vehicleId,
          fromTs: options.fromTs,
          toTs: effectiveToTs,
          pageSize: options.pageSize,
          maxPages: options.maxPages,
          mode: "full",
        });
      });
      if (generation === requestGeneration) {
        currentPoints = [];
        lastTimestamp = options.fromTs;
      }
      applyIncoming(incoming, generation);
    } catch (error) {
      if (!stopped && generation === requestGeneration) options.onError?.(error);
    } finally {
      if (!stopped && generation === requestGeneration) options.onLoading?.(false);
    }
  };

  const runIncremental = async () => {
    clearTimer();
    if (stopped) return;
    if (isHidden()) {
      metrics.hiddenPageFetchesAvoided += 1;
      return;
    }

    const generation = ++requestGeneration;
    const effectiveToTs = Math.min(options.toTs, now());
    const incrementalFromTs = Math.max(options.fromTs, lastTimestamp - overlapMs);
    if (incrementalFromTs > effectiveToTs) {
      schedule();
      return;
    }

    const requestKey = `${cacheKey}:incremental`;

    try {
      const incoming = await runSharedRequest(lockKey, requestKey, () => {
        metrics.incrementalRequests += 1;
        metrics.estimatedReadsAvoided += currentPoints.length;
        return options.loader({
          vehicleId: options.vehicleId,
          fromTs: incrementalFromTs,
          toTs: effectiveToTs,
          pageSize: options.pageSize,
          maxPages: options.maxPages,
          mode: "incremental",
        });
      });
      applyIncoming(incoming, generation);
    } catch (error) {
      if (!stopped && generation === requestGeneration) options.onError?.(error);
    } finally {
      if (!stopped) schedule();
    }
  };

  async function runRefresh() {
    if (refreshMode === "full") {
      clearTimer();
      await runFull();
      if (!stopped && !isHidden()) schedule();
      return;
    }
    await runIncremental();
  }

  const handleVisibilityChange = () => {
    if (stopped) return;
    if (isHidden()) {
      clearTimer();
      return;
    }
    const elapsed = Math.max(0, now() - lastLoadedAt);
    if (!lastLoadedAt || elapsed >= options.refreshMs) {
      void runRefresh();
      return;
    }
    schedule(options.refreshMs - elapsed);
  };

  return {
    async start() {
      if (started || stopped) return;
      started = true;
      visibilityDocument?.addEventListener("visibilitychange", handleVisibilityChange);

      const cached = getCachedRoute(cacheKey, cacheTtlMs, now());
      if (cached) {
        metrics.cacheHits += 1;
        currentPoints = cached.points;
        lastTimestamp = cached.lastTimestamp || options.fromTs;
        lastLoadedAt = cached.loadedAt;
        options.onData(currentPoints);
        await runRefresh();
        return;
      }

      metrics.cacheMisses += 1;
      await runFull();
      schedule();
    },
    async refresh(forceFull = false) {
      if (stopped) return;
      clearTimer();
      if (forceFull || refreshMode === "full") {
        routeCache.delete(cacheKey);
        await runFull();
        if (!stopped && !isHidden()) schedule();
        return;
      }
      await runIncremental();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      requestGeneration += 1;
      clearTimer();
      visibilityDocument?.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}

export function clearFleetRouteSessionCache(scopeKey?: string) {
  for (const key of routeCache.keys()) {
    if (!scopeKey || key.startsWith(`${scopeKey}:`)) routeCache.delete(key);
  }
}

export function getFleetRouteSyncMetrics(): FleetRouteSyncMetrics {
  return { ...metrics };
}

export function resetFleetRouteSyncForTests() {
  routeCache.clear();
  activeRequests.clear();
  activeRequestCounts.clear();
  for (const key of Object.keys(metrics) as Array<keyof FleetRouteSyncMetrics>) metrics[key] = 0;
}
