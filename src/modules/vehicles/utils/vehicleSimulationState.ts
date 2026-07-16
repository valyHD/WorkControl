import type { VehicleItem } from "../../../types/vehicle";

export type VehicleSimulationStateData = {
  schemaVersion?: number;
  vehicleId?: string;
  gpsSim?: VehicleItem["gpsSim"];
  gpsSimHistory?: VehicleItem["gpsSimHistory"];
  updatedAt?: number;
};

export function mergeVehicleSimulationState(
  vehicle: VehicleItem,
  simulation: VehicleSimulationStateData | null | undefined
): VehicleItem {
  if (!simulation || simulation.vehicleId && simulation.vehicleId !== vehicle.id) return vehicle;

  return {
    ...vehicle,
    ...(Object.hasOwn(simulation, "gpsSim") ? { gpsSim: simulation.gpsSim ?? null } : {}),
    ...(Object.hasOwn(simulation, "gpsSimHistory")
      ? { gpsSimHistory: simulation.gpsSimHistory ?? [] }
      : {}),
  };
}
