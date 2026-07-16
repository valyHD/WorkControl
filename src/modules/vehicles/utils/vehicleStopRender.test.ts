import { describe, expect, it } from "vitest";
import type { VehicleStopItem } from "../../../types/vehicle";
import { selectStopItemsForRender } from "./vehicleStopRender";

function stop(id: string, gpsTimestamp: number): VehicleStopItem {
  return {
    id,
    start: {
      id: `${id}-start`,
      vehicleId: "vehicle-1",
      imei: "test-imei",
      lat: 44 + gpsTimestamp / 10_000_000,
      lng: 26,
      gpsTimestamp: gpsTimestamp - 60_000,
      serverTimestamp: gpsTimestamp - 60_000,
      speedKmh: 0,
      ignitionOn: false,
    },
    end: {
      id: `${id}-end`,
      vehicleId: "vehicle-1",
      imei: "test-imei",
      lat: 44 + gpsTimestamp / 10_000_000,
      lng: 26,
      gpsTimestamp,
      serverTimestamp: gpsTimestamp,
      speedKmh: 0,
      ignitionOn: false,
    },
    durationMs: 60_000,
    lat: 44 + gpsTimestamp / 10_000_000,
    lng: 26,
  };
}

describe("selectStopItemsForRender", () => {
  it("keeps simulation stop markers even when the mobile render limit samples other stops", () => {
    const stops = [
      stop("real-history-contact-off-0", 1_000),
      stop("history-sim-0-terminal-stop-2", 2_000),
      stop("real-history-contact-off-1", 3_000),
      stop("real-history-contact-off-2", 4_000),
      stop("real-history-contact-off-3", 5_000),
      stop("history-sim-1-terminal-stop-6", 6_000),
      stop("real-history-contact-off-4", 7_000),
      stop("real-history-contact-off-5", 8_000),
      stop("real-history-contact-off-6", 9_000),
      stop("real-history-contact-off-7", 10_000),
    ];

    const rendered = selectStopItemsForRender(stops, 5).map((item) => item.id);

    expect(rendered).toContain("history-sim-0-terminal-stop-2");
    expect(rendered).toContain("history-sim-1-terminal-stop-6");
    expect(rendered).toContain("real-history-contact-off-0");
    expect(rendered).toContain("real-history-contact-off-7");
    expect(rendered.length).toBeLessThanOrEqual(5);
  });

  it("keeps the live real stop when simulation has handed back to real GPS", () => {
    const stops = [
      stop("real-history-contact-off-0", 1_000),
      stop("real-history-contact-off-1", 2_000),
      stop("real-history-contact-off-2", 3_000),
      stop("real-contact-off-current-snapshot", 4_000),
      stop("real-history-contact-off-3", 5_000),
      stop("real-history-contact-off-4", 6_000),
    ];

    const rendered = selectStopItemsForRender(stops, 4).map((item) => item.id);

    expect(rendered).toContain("real-contact-off-current-snapshot");
  });
});
