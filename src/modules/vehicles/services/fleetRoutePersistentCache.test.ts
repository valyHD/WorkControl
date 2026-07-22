import { describe, expect, it } from "vitest";
import type { VehiclePositionItem } from "../../../types/vehicle";
import {
  MAX_PERSISTED_FLEET_ROUTE_POINTS,
  prepareFleetRouteForStorage,
} from "./fleetRoutePersistentCache";

function point(timestamp: number): VehiclePositionItem {
  return {
    id: `point-${timestamp}`,
    vehicleId: "vehicle-1",
    lat: 44 + timestamp / 1_000_000,
    lng: 26 + timestamp / 1_000_000,
    speedKmh: 30,
    gpsTimestamp: timestamp,
    serverTimestamp: timestamp,
  };
}

describe("fleetRoutePersistentCache", () => {
  it("keeps the exact route when it fits the local cache", () => {
    const points = Array.from(
      { length: MAX_PERSISTED_FLEET_ROUTE_POINTS },
      (_, index) => point(index + 1)
    );

    const prepared = prepareFleetRouteForStorage(points);

    expect(prepared).toEqual(points);
  });

  it("skips oversized routes instead of changing their visual geometry", () => {
    const points = Array.from(
      { length: MAX_PERSISTED_FLEET_ROUTE_POINTS + 1 },
      (_, index) => point(index + 1)
    );

    expect(prepareFleetRouteForStorage(points)).toBeNull();
  });

  it("drops raw IO only from the local copy while preserving every route point", () => {
    const points = [
      { ...point(1), rawIo: { 16: 1234 } },
      { ...point(2), rawIo: { 239: 1 } },
    ];

    expect(prepareFleetRouteForStorage(points)).toEqual([
      point(1),
      point(2),
    ]);
  });
});
