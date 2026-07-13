export type FirestoreCostControlConfig = {
  emergencyMode: boolean;
  fleetRoutesOnDemandOnly: boolean;
  disableBackgroundRouteSync: boolean;
  maxFleetSnapshotRefreshSeconds: number;
  maxRoutePointsPerRequest: number;
  disableHiddenPageListeners: boolean;
  billingRefreshMinutes: number;
};

export const DEFAULT_FIRESTORE_COST_CONTROL: FirestoreCostControlConfig = {
  emergencyMode: true,
  fleetRoutesOnDemandOnly: true,
  disableBackgroundRouteSync: true,
  maxFleetSnapshotRefreshSeconds: 60,
  maxRoutePointsPerRequest: 2000,
  disableHiddenPageListeners: true,
  billingRefreshMinutes: 30,
};

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

export function normalizeFirestoreCostControl(value: unknown): FirestoreCostControlConfig {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    emergencyMode: data.emergencyMode !== false,
    fleetRoutesOnDemandOnly: data.fleetRoutesOnDemandOnly !== false,
    disableBackgroundRouteSync: data.disableBackgroundRouteSync !== false,
    maxFleetSnapshotRefreshSeconds: finiteInteger(
      data.maxFleetSnapshotRefreshSeconds,
      DEFAULT_FIRESTORE_COST_CONTROL.maxFleetSnapshotRefreshSeconds,
      30,
      300
    ),
    maxRoutePointsPerRequest: finiteInteger(
      data.maxRoutePointsPerRequest,
      DEFAULT_FIRESTORE_COST_CONTROL.maxRoutePointsPerRequest,
      200,
      2000
    ),
    disableHiddenPageListeners: data.disableHiddenPageListeners !== false,
    billingRefreshMinutes: finiteInteger(
      data.billingRefreshMinutes,
      DEFAULT_FIRESTORE_COST_CONTROL.billingRefreshMinutes,
      15,
      180
    ),
  };
}
