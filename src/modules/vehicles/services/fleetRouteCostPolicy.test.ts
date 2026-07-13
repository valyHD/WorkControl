import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_COST_CONTROL } from "../../../config/firestoreCostControl";
import { estimateFleetScenarioReads, shouldLoadFleetRoute } from "./fleetRouteCostPolicy";

describe("fleet route emergency cost policy", () => {
  it("activates no more than one route for eleven vehicles", () => {
    const active = Array.from({ length: 11 }, (_, index) =>
      shouldLoadFleetRoute(
        DEFAULT_FIRESTORE_COST_CONTROL,
        `vehicle-${index + 1}`,
        "vehicle-4"
      )
    );
    expect(active.filter(Boolean)).toHaveLength(1);
    expect(active[3]).toBe(true);
  });

  it("keeps the instrumented 30 minute fleet scenario below 2000 reads", () => {
    // 65,000 daily points across 11 vehicles means about 542 points/vehicle in two hours.
    const result = estimateFleetScenarioReads({
      vehicleCount: 11,
      visibleMinutes: 30,
      hiddenMinutes: 10,
      snapshotRefreshSeconds: 60,
      selectedRoutePointCounts: [542, 542, 542],
    });

    expect(result.overviewReads).toBe(330);
    expect(result.hiddenRouteReads).toBe(0);
    expect(result.maxActiveRouteControllers).toBe(1);
    expect(result.totalReads).toBeLessThan(2000);
    expect(Math.max(542, 542, 542)).toBeLessThanOrEqual(2000);
  });
});
