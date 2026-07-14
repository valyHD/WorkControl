import { describe, expect, it } from "vitest";
import type { VehicleItem } from "../../../types/vehicle";
import { mergeVehicleRuntimeLive } from "./vehicleRuntimeLive";

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

describe("vehicle runtime live adapter", () => {
  it("uses the runtime snapshot when it is newer", () => {
    const merged = mergeVehicleRuntimeLive(
      vehicle({ gpsSnapshot: { lat: 44, lng: 26, gpsTimestamp: 100, serverTimestamp: 100 } }),
      {
        vehicleId: "vehicle-a",
        updatedAt: 200,
        gpsSnapshot: { lat: 44.1, lng: 26.1, gpsTimestamp: 200, serverTimestamp: 200 },
      }
    );
    expect(merged.gpsSnapshot?.lat).toBe(44.1);
  });

  it("keeps the legacy snapshot when runtime is stale", () => {
    const legacy = vehicle({
      gpsSnapshot: { lat: 44, lng: 26, gpsTimestamp: 300, serverTimestamp: 300 },
    });
    const merged = mergeVehicleRuntimeLive(legacy, {
      vehicleId: "vehicle-a",
      updatedAt: 200,
      gpsSnapshot: { lat: 44.1, lng: 26.1, gpsTimestamp: 200, serverTimestamp: 200 },
    });
    expect(merged.gpsSnapshot?.lat).toBe(44);
  });

  it("exposes durable pending mileage without double counting root consolidation", () => {
    const pending = mergeVehicleRuntimeLive(vehicle({ currentKm: 6200 }), {
      vehicleId: "vehicle-a",
      mileageBaseKm: 6200,
      pendingCurrentKm: 1.25,
    });
    expect(pending.currentKm).toBe(6201.25);

    const consolidated = mergeVehicleRuntimeLive(vehicle({ currentKm: 6201.25 }), {
      vehicleId: "vehicle-a",
      mileageBaseKm: 6201.25,
      pendingCurrentKm: 0,
    });
    expect(consolidated.currentKm).toBe(6201.25);
  });

  it("falls back unchanged when the runtime document is absent", () => {
    const legacy = vehicle({
      gpsSnapshot: { lat: 44, lng: 26, gpsTimestamp: 100, serverTimestamp: 100 },
    });
    expect(mergeVehicleRuntimeLive(legacy, null)).toBe(legacy);
  });
});
