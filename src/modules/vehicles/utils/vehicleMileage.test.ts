import { describe, expect, it } from "vitest";
import {
  applyVehicleMileageAdjustment,
  getTrustedVehicleOdometerKm,
  toVehicleMileageAdjustmentKm,
} from "./vehicleMileage";

describe("vehicle mileage reconciliation", () => {
  it("keeps legacy vehicles unchanged when no adjustment exists", () => {
    expect(applyVehicleMileageAdjustment(7460.067, undefined)).toBe(7460.067);
  });

  it("applies a manual downward correction to the physical odometer", () => {
    expect(applyVehicleMileageAdjustment(7460.067, -260.067)).toBe(7200);
  });

  it("keeps future distance on top of the corrected mileage", () => {
    expect(applyVehicleMileageAdjustment(7465.067, -260.067)).toBe(7205);
  });

  it("rejects an adjusted odometer below the registration baseline", () => {
    expect(getTrustedVehicleOdometerKm(6000, 6044, -10)).toBe(0);
  });

  it("normalizes invalid adjustments", () => {
    expect(toVehicleMileageAdjustmentKm("invalid")).toBe(0);
  });
});
