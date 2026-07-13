import { describe, expect, it } from "vitest";
import type { VehiclePositionItem } from "../../../types/vehicle";
import { splitVisibleRealGpsSegments } from "./vehicleRouteVisibility";

function point(id: string, gpsTimestamp: number, lat: number): VehiclePositionItem {
  return {
    id,
    vehicleId: "vehicle-1",
    imei: "test-imei",
    lat,
    lng: 26.12,
    speedKmh: 30,
    altitude: 0,
    angle: 0,
    satellites: 10,
    gpsTimestamp,
    serverTimestamp: gpsTimestamp,
    ignitionOn: true,
    eventIoId: 0,
  };
}

function stoppedPoint(id: string, gpsTimestamp: number, lat: number): VehiclePositionItem {
  return {
    ...point(id, gpsTimestamp, lat),
    speedKmh: 0,
    ignitionOn: false,
  };
}

describe("vehicle route visibility", () => {
  it("filters jitter independently after each hidden route interval", () => {
    const baseTs = 1_783_940_000_000;
    const positions = [
      point("before-1", baseTs, 44.4),
      point("before-2", baseTs + 60_000, 44.401),
      point("hidden", baseTs + 120_000, 44.402),
      point("after-1", baseTs + 240_000, 44.41),
      point("after-2", baseTs + 300_000, 44.411),
      point("after-3", baseTs + 360_000, 44.412),
    ];

    const segments = splitVisibleRealGpsSegments(positions, [
      { startTs: baseTs + 100_000, endTs: baseTs + 200_000 },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].map((item) => item.id)).toEqual(["before-1", "before-2"]);
    expect(segments[1].map((item) => item.id)).toEqual(["after-1", "after-2", "after-3"]);
  });

  it("does not let stationary filtering merge real points across a hidden interval", () => {
    const baseTs = 1_783_940_000_000;
    const positions = [
      stoppedPoint("before-1", baseTs, 44.394),
      stoppedPoint("before-2", baseTs + 60_000, 44.401),
      stoppedPoint("hidden", baseTs + 120_000, 44.402),
      stoppedPoint("after-1", baseTs + 240_000, 44.4012),
      stoppedPoint("after-2", baseTs + 300_000, 44.4075),
    ];

    const segments = splitVisibleRealGpsSegments(positions, [
      { startTs: baseTs + 100_000, endTs: baseTs + 200_000 },
    ]);

    expect(segments.map((segment) => segment.map((item) => item.id))).toEqual([
      ["before-1", "before-2"],
      ["after-1", "after-2"],
    ]);
  });
});
