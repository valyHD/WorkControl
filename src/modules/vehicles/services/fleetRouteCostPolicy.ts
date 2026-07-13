import type { FirestoreCostControlConfig } from "../../../config/firestoreCostControl";

export function shouldLoadFleetRoute(
  config: FirestoreCostControlConfig,
  vehicleId: string,
  selectedVehicleId: string
) {
  if (!config.emergencyMode || !config.fleetRoutesOnDemandOnly) return true;
  return Boolean(selectedVehicleId) && vehicleId === selectedVehicleId;
}

export function estimateFleetScenarioReads(params: {
  vehicleCount: number;
  visibleMinutes: number;
  hiddenMinutes: number;
  snapshotRefreshSeconds: number;
  selectedRoutePointCounts: number[];
}) {
  const vehicleCount = Math.max(0, Math.round(params.vehicleCount));
  const visibleRefreshes = Math.max(
    1,
    Math.ceil((Math.max(0, params.visibleMinutes) * 60) / params.snapshotRefreshSeconds)
  );
  const overviewReads = vehicleCount * visibleRefreshes;
  const routeReads = params.selectedRoutePointCounts.reduce(
    (sum, count) => sum + Math.max(0, Math.min(2000, Math.round(count))),
    0
  );
  return {
    overviewReads,
    routeReads,
    hiddenRouteReads: 0,
    totalReads: overviewReads + routeReads,
    maxActiveRouteControllers: params.selectedRoutePointCounts.length ? 1 : 0,
  };
}
