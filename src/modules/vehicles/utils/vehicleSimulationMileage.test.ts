import { describe, expect, it } from "vitest";
import {
  calculateSimulationMileageTotals,
  getSimulationMileageCheckpointElapsedMs,
} from "./vehicleSimulationMileage";

describe("simulation mileage checkpoints", () => {
  it("advances active simulation mileage only every 30 seconds", () => {
    expect(getSimulationMileageCheckpointElapsedMs(29_999, 120_000, false)).toBe(0);
    expect(getSimulationMileageCheckpointElapsedMs(30_001, 120_000, false)).toBe(30_000);
    expect(getSimulationMileageCheckpointElapsedMs(79_000, 120_000, false)).toBe(60_000);
  });

  it("uses the full elapsed distance when the simulation is complete", () => {
    expect(getSimulationMileageCheckpointElapsedMs(119_500, 120_000, true)).toBe(119_500);
    expect(getSimulationMileageCheckpointElapsedMs(130_000, 120_000, true)).toBe(120_000);
  });
});

describe("simulation mileage totals", () => {
  it("adds active simulation progress over the already consolidated vehicle mileage", () => {
    expect(
      calculateSimulationMileageTotals({
        historyTrackedKm: 40,
        monitoredFromOdometerKm: 190,
        absoluteCurrentKm: 7_390,
        initialRecordedKm: 7_200,
        mileageAdjustmentKm: 0,
        activeSimulationDistanceKm: 1.25,
      })
    ).toEqual({
      totalTrackedKm: 191.25,
      estimatedCurrentKm: 7_391.25,
    });
  });

  it("does not double the distance after stop consolidates it into currentKm", () => {
    expect(
      calculateSimulationMileageTotals({
        historyTrackedKm: 191.25,
        monitoredFromOdometerKm: 191.25,
        absoluteCurrentKm: 7_391.25,
        initialRecordedKm: 7_200,
        mileageAdjustmentKm: 0,
        activeSimulationDistanceKm: 0,
      })
    ).toEqual({
      totalTrackedKm: 191.25,
      estimatedCurrentKm: 7_391.25,
    });
  });
});
