import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIRESTORE_COST_CONTROL,
  normalizeFirestoreCostControl,
} from "./firestoreCostControl";

describe("firestoreCostControl", () => {
  it("defaults to compact fleet routes refreshed every 30 minutes", () => {
    expect(normalizeFirestoreCostControl(null)).toEqual(DEFAULT_FIRESTORE_COST_CONTROL);
    expect(DEFAULT_FIRESTORE_COST_CONTROL).toMatchObject({
      fleetRoutesCompactAll: true,
      fleetRouteRefreshMinutes: 30,
      fleetRoutePointsPerVehicle: 50,
    });
  });

  it("clamps compact fleet route cost limits", () => {
    expect(
      normalizeFirestoreCostControl({
        fleetRouteRefreshMinutes: 2,
        fleetRoutePointsPerVehicle: 2_000,
      })
    ).toMatchObject({
      fleetRouteRefreshMinutes: 15,
      fleetRoutePointsPerVehicle: 100,
    });
  });
});
