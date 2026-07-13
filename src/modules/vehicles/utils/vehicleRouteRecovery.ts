type TimestampedRoutePoint = {
  gpsTimestamp: number;
};

type RouteRecoveryOptions<T extends TimestampedRoutePoint> = {
  fromTs: number;
  toTs: number;
  snapshotTimestamp?: number | null;
  staleToleranceMs?: number;
  loadPrimary: () => Promise<T[]>;
  loadRecovery: () => Promise<T[]>;
};

const DEFAULT_ROUTE_STALE_TOLERANCE_MS = 5 * 60 * 1000;

export function shouldRecoverSelectedDayRoute<T extends TimestampedRoutePoint>(
  points: T[],
  snapshotTimestamp: number | null | undefined,
  fromTs: number,
  toTs: number,
  staleToleranceMs = DEFAULT_ROUTE_STALE_TOLERANCE_MS
) {
  if (
    typeof snapshotTimestamp !== "number" ||
    !Number.isFinite(snapshotTimestamp) ||
    snapshotTimestamp < fromTs ||
    snapshotTimestamp > toTs
  ) {
    return false;
  }

  const latestLoadedTimestamp = points.reduce(
    (latest, point) => Math.max(latest, Number(point.gpsTimestamp) || 0),
    0
  );

  return (
    latestLoadedTimestamp === 0 || snapshotTimestamp - latestLoadedTimestamp > staleToleranceMs
  );
}

export async function loadSelectedDayRouteWithRecovery<T extends TimestampedRoutePoint>({
  fromTs,
  toTs,
  snapshotTimestamp,
  staleToleranceMs,
  loadPrimary,
  loadRecovery,
}: RouteRecoveryOptions<T>): Promise<T[]> {
  let primaryPoints: T[] = [];
  let primaryError: unknown = null;

  try {
    primaryPoints = await loadPrimary();
  } catch (error) {
    primaryError = error;
  }

  const shouldRecover = shouldRecoverSelectedDayRoute(
    primaryPoints,
    snapshotTimestamp,
    fromTs,
    toTs,
    staleToleranceMs
  );

  if (!shouldRecover) {
    if (primaryError) throw primaryError;
    return primaryPoints;
  }

  try {
    const recoveredPoints = await loadRecovery();
    if (recoveredPoints.length > 0) return recoveredPoints;
  } catch (recoveryError) {
    if (!primaryError) throw recoveryError;
  }

  if (primaryError) throw primaryError;
  return primaryPoints;
}
