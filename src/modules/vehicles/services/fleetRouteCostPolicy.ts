import type { FirestoreCostControlConfig } from "../../../config/firestoreCostControl";

export type FleetRouteDisplayMode = "legacy-all" | "compact-all" | "on-demand";

export function getFleetRouteDisplayMode(
  config: FirestoreCostControlConfig
): FleetRouteDisplayMode {
  if (!config.emergencyMode) return "legacy-all";
  if (config.fleetRoutesCompactAll) return "compact-all";
  if (config.fleetRoutesOnDemandOnly) return "on-demand";
  return "legacy-all";
}

export function getFleetRouteRuntimePolicy(config: FirestoreCostControlConfig) {
  const mode = getFleetRouteDisplayMode(config);
  return {
    mode,
    usesLeanOverview: mode !== "legacy-all",
    boundedRoute: mode !== "legacy-all",
    showRouteToggle: mode === "on-demand",
    refreshMs:
      mode === "compact-all"
        ? config.fleetRouteRefreshMinutes * 60_000
        : config.maxFleetSnapshotRefreshSeconds * 1000,
    maxRoutePoints:
      mode === "compact-all" ? config.fleetRoutePointsPerVehicle : config.maxRoutePointsPerRequest,
  };
}

export function shouldLoadFleetRoute(
  config: FirestoreCostControlConfig,
  vehicleId: string,
  selectedVehicleId: string
) {
  const mode = getFleetRouteDisplayMode(config);
  if (mode === "legacy-all" || mode === "compact-all") return true;
  return Boolean(selectedVehicleId) && vehicleId === selectedVehicleId;
}

export function estimateFleetScenarioReads(params: {
  vehicleCount: number;
  visibleMinutes: number;
  hiddenMinutes: number;
  snapshotRefreshSeconds: number;
  selectedRoutePointCounts: number[];
  compactRoutePointsPerVehicle?: number;
  compactRouteRefreshMinutes?: number;
}) {
  const vehicleCount = Math.max(0, Math.round(params.vehicleCount));
  const visibleRefreshes = Math.max(
    1,
    Math.ceil((Math.max(0, params.visibleMinutes) * 60) / params.snapshotRefreshSeconds)
  );
  const overviewReads = vehicleCount * visibleRefreshes;
  const compactRoutePoints = Math.max(
    0,
    Math.min(100, Math.round(params.compactRoutePointsPerVehicle ?? 0))
  );
  const compactRefreshes = compactRoutePoints
    ? Math.max(
        1,
        Math.ceil(
          Math.max(0, params.visibleMinutes) / Math.max(15, params.compactRouteRefreshMinutes ?? 30)
        )
      )
    : 0;
  const routeReads = compactRoutePoints
    ? vehicleCount * compactRoutePoints * compactRefreshes
    : params.selectedRoutePointCounts.reduce(
        (sum, count) => sum + Math.max(0, Math.min(2000, Math.round(count))),
        0
      );
  return {
    overviewReads,
    routeReads,
    hiddenRouteReads: 0,
    totalReads: overviewReads + routeReads,
    maxActiveRouteControllers: compactRoutePoints
      ? vehicleCount
      : params.selectedRoutePointCounts.length
        ? 1
        : 0,
  };
}
