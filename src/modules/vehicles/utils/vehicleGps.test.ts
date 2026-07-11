import { describe, expect, it } from "vitest";
import type { VehiclePositionItem } from "../../../types/vehicle";
import {
  calculateRouteDistanceKm,
  filterRouteRenderJitter,
  filterStationaryGpsJitter,
  formatDuration,
  sanitizePositions,
} from "./vehicleGps";

function position(overrides: Partial<VehiclePositionItem>): VehiclePositionItem {
  return {
    id: "point",
    vehicleId: "vehicle-1",
    imei: "123456789",
    lat: 44.4268,
    lng: 26.1025,
    speedKmh: 0,
    gpsTimestamp: Date.UTC(2026, 0, 1, 8, 0, 0),
    serverTimestamp: Date.UTC(2026, 0, 1, 8, 0, 1),
    ...overrides,
  };
}

describe("vehicleGps helpers", () => {
  it("formats durations in minutes and hours", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(5 * 60 * 1000)).toBe("5 min");
    expect(formatDuration(90 * 60 * 1000)).toBe("1h 30m");
  });

  it("sanitizes positions by removing invalid coordinates and sorting by GPS time", () => {
    const first = position({ id: "first", gpsTimestamp: Date.UTC(2026, 0, 1, 8, 0, 0) });
    const second = position({ id: "second", gpsTimestamp: Date.UTC(2026, 0, 1, 8, 1, 0) });
    const invalid = position({ id: "invalid", lat: 0, lng: 0 });

    expect(sanitizePositions([second, invalid, first]).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not draw a chaotic route for stationary sub-20-meter GPS jitter", () => {
    const baseTs = Date.UTC(2026, 6, 10, 8, 0, 0);
    const points = [
      position({
        id: "p1",
        gpsTimestamp: baseTs,
        lat: 44.4268,
        lng: 26.1025,
        speedKmh: 0,
        ignitionOn: false,
      }),
      position({
        id: "p2",
        gpsTimestamp: baseTs + 10_000,
        lat: 44.42684,
        lng: 26.10255,
        speedKmh: 0,
        ignitionOn: false,
      }),
      position({
        id: "p3",
        gpsTimestamp: baseTs + 20_000,
        lat: 44.42675,
        lng: 26.10245,
        speedKmh: 0,
        ignitionOn: false,
      }),
      position({
        id: "p4",
        gpsTimestamp: baseTs + 30_000,
        lat: 44.42682,
        lng: 26.10258,
        speedKmh: 0,
        ignitionOn: false,
      }),
    ];

    expect(filterStationaryGpsJitter(points)).toHaveLength(1);
    expect(filterRouteRenderJitter(points)).toHaveLength(1);
    expect(calculateRouteDistanceKm(filterRouteRenderJitter(points))).toBe(0);
  });
});
