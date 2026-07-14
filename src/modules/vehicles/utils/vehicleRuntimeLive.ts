import type { VehicleItem } from "../../../types/vehicle";

export type VehicleRuntimeLiveData = {
  schemaVersion?: number;
  vehicleId?: string;
  gpsSnapshot?: VehicleItem["gpsSnapshot"];
  liveDiagnostics?: VehicleItem["liveDiagnostics"];
  gpsDataUsage?: VehicleItem["gpsDataUsage"];
  tracker?: VehicleItem["tracker"];
  mileageBaseKm?: number;
  pendingCurrentKm?: number;
  updatedAt?: number;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getSnapshotTimestamp(snapshot: VehicleItem["gpsSnapshot"] | undefined | null): number {
  return Math.max(
    finiteNumber(snapshot?.serverTimestamp),
    finiteNumber(snapshot?.gpsTimestamp)
  );
}

export function mergeVehicleRuntimeLive(
  vehicle: VehicleItem,
  runtime: VehicleRuntimeLiveData | null | undefined
): VehicleItem {
  if (!runtime || runtime.vehicleId && runtime.vehicleId !== vehicle.id) return vehicle;

  const runtimeTimestamp = Math.max(
    finiteNumber(runtime.updatedAt),
    getSnapshotTimestamp(runtime.gpsSnapshot)
  );
  const legacyTimestamp = Math.max(
    finiteNumber(vehicle.tracker?.lastSeenAt),
    getSnapshotTimestamp(vehicle.gpsSnapshot)
  );
  const useRuntimeLive = Boolean(runtime.gpsSnapshot) && runtimeTimestamp >= legacyTimestamp;
  const runtimeKm = finiteNumber(runtime.mileageBaseKm) + finiteNumber(runtime.pendingCurrentKm);
  const currentKm = runtimeKm > 0
    ? Math.max(finiteNumber(vehicle.currentKm), runtimeKm)
    : vehicle.currentKm;

  return {
    ...vehicle,
    currentKm,
    ...(useRuntimeLive
      ? {
          gpsSnapshot: runtime.gpsSnapshot ?? vehicle.gpsSnapshot,
          liveDiagnostics: runtime.liveDiagnostics ?? vehicle.liveDiagnostics,
          gpsDataUsage: runtime.gpsDataUsage ?? vehicle.gpsDataUsage,
          tracker: {
            ...(vehicle.tracker ?? {}),
            ...(runtime.tracker ?? {}),
          },
        }
      : {}),
  };
}
