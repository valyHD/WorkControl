import { describe, expect, it } from "vitest";
import type { VehicleItem } from "../../../types/vehicle";
import { mergeVehicleSimulationState } from "./vehicleSimulationState";

function vehicle(overrides: Partial<VehicleItem> = {}): VehicleItem {
  return {
    id: "vehicle-a",
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
    year: "2020",
    vin: "",
    fuelType: "benzina",
    status: "activa",
    currentKm: 6200,
    initialRecordedKm: 6000,
    ownerUserId: "",
    ownerUserName: "",
    currentDriverUserId: "",
    currentDriverUserName: "",
    pendingDriverUserId: "",
    pendingDriverUserName: "",
    maintenanceNotes: "",
    serviceStrategy: "interval",
    serviceIntervalKm: 0,
    nextServiceKm: 0,
    nextItpDate: "",
    nextRcaDate: "",
    nextCascoDate: "",
    nextRovinietaDate: "",
    nextOilServiceKm: 0,
    images: [],
    documents: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as VehicleItem;
}

function simulation(id: string, startedAt = 100): NonNullable<VehicleItem["gpsSim"]> {
  return {
    id,
    active: false,
    startedAt,
    totalDistanceKm: 0,
    points: [],
  };
}

describe("vehicle simulation state adapter", () => {
  it("keeps legacy simulation data until the child document exists", () => {
    const legacy = vehicle({
      gpsSim: { ...simulation("active-route"), active: true },
      gpsSimHistory: [simulation("legacy-route")],
    });

    expect(mergeVehicleSimulationState(legacy, null)).toBe(legacy);
  });

  it("overrides legacy simulation data with the dedicated child state", () => {
    const childHistory = [simulation("child-route", 200)];
    const merged = mergeVehicleSimulationState(
      vehicle({ gpsSimHistory: [simulation("legacy-route")] }),
      {
        schemaVersion: 1,
        vehicleId: "vehicle-a",
        gpsSim: { ...simulation("active-route", 200), active: true },
        gpsSimHistory: childHistory,
      }
    );

    expect(merged.gpsSim?.startedAt).toBe(200);
    expect(merged.gpsSimHistory).toBe(childHistory);
  });

  it("represents a stopped simulation without falling back to the legacy route", () => {
    const merged = mergeVehicleSimulationState(
      vehicle({ gpsSim: { ...simulation("active-route"), active: true } }),
      { vehicleId: "vehicle-a", gpsSim: null, gpsSimHistory: [] }
    );

    expect(merged.gpsSim).toBeNull();
    expect(merged.gpsSimHistory).toEqual([]);
  });

  it("ignores a child state belonging to another vehicle", () => {
    const legacy = vehicle({ gpsSimHistory: [simulation("legacy-route")] });
    expect(mergeVehicleSimulationState(legacy, {
      vehicleId: "vehicle-b",
      gpsSimHistory: [],
    })).toBe(legacy);
  });
});
