import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_COST_CONTROL } from "../../../config/firestoreCostControl";
import {
  estimateFleetScenarioReads,
  getFleetRouteRange,
  getFleetRouteRuntimePolicy,
  shouldLoadFleetRoute,
} from "./fleetRouteCostPolicy";

describe("fleet route emergency cost policy", () => {
  it("activates compact routes for every vehicle by default", () => {
    const active = Array.from({ length: 11 }, (_, index) =>
      shouldLoadFleetRoute(DEFAULT_FIRESTORE_COST_CONTROL, `vehicle-${index + 1}`, "vehicle-4")
    );
    expect(active.filter(Boolean)).toHaveLength(11);
    expect(getFleetRouteRuntimePolicy(DEFAULT_FIRESTORE_COST_CONTROL)).toMatchObject({
      mode: "compact-all",
      refreshMs: 30 * 60_000,
      maxRoutePoints: 50,
      showRouteToggle: false,
    });
  });

  it("keeps one visible fleet session below 2000 reads per steady-state hour", () => {
    const result = estimateFleetScenarioReads({
      vehicleCount: 11,
      visibleMinutes: 60,
      hiddenMinutes: 10,
      snapshotRefreshSeconds: 60,
      selectedRoutePointCounts: [],
      compactRoutePointsPerVehicle: 50,
      compactRouteRefreshMinutes: 30,
    });

    expect(result.overviewReads).toBe(660);
    expect(result.routeReads).toBe(1100);
    expect(result.hiddenRouteReads).toBe(0);
    expect(result.maxActiveRouteControllers).toBe(11);
    expect(result.totalReads).toBeLessThan(2000);
  });

  it("retains the one-route fallback when compact mode is disabled", () => {
    const config = {
      ...DEFAULT_FIRESTORE_COST_CONTROL,
      fleetRoutesCompactAll: false,
    };

    expect(shouldLoadFleetRoute(config, "vehicle-1", "vehicle-2")).toBe(false);
    expect(shouldLoadFleetRoute(config, "vehicle-2", "vehicle-2")).toBe(true);
    expect(getFleetRouteRuntimePolicy(config).mode).toBe("on-demand");
  });

  it("loads the whole current day for compact fleet routes", () => {
    const anchor = new Date(2026, 6, 13, 14, 35, 0, 0);
    const expectedStart = new Date(anchor);
    expectedStart.setHours(0, 0, 0, 0);
    const expectedEnd = new Date(anchor);
    expectedEnd.setHours(23, 59, 59, 999);

    expect(getFleetRouteRange(anchor.getTime(), 2, "compact-all")).toEqual({
      fromTs: expectedStart.getTime(),
      toTs: expectedEnd.getTime(),
    });
  });

  it("keeps the selected route window bounded in on-demand mode", () => {
    const anchorTs = new Date(2026, 6, 13, 14, 35, 0, 0).getTime();

    expect(getFleetRouteRange(anchorTs, 2, "on-demand").fromTs).toBe(
      anchorTs - 2 * 60 * 60 * 1000
    );
  });
});
