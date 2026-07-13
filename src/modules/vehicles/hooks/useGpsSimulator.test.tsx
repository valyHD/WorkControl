import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleItem } from "../../../types/vehicle";
import { stopGpsSimOnFirestore } from "../services/gpsSimulatorService";
import { useGpsSimulator } from "./useGpsSimulator";

vi.mock("../services/gpsSimulatorService", () => ({
  buildSimulationConfig: vi.fn(),
  fetchRouteFromOSRM: vi.fn(),
  geocodeAddress: vi.fn(),
  pauseGpsSimOnFirestore: vi.fn(),
  resumeGpsSimOnFirestore: vi.fn(),
  startGpsSimOnFirestore: vi.fn(),
  stopGpsSimOnFirestore: vi.fn(),
}));

vi.mock("../services/vehiclesService", () => ({
  getLatestVehiclePosition: vi.fn(),
}));

function makeVehicle(hasSimulation: boolean): VehicleItem {
  return {
    id: "vehicle-1",
    plateNumber: "B 092194",
    gpsSim: hasSimulation
      ? {
          active: true,
          status: "running",
          startedAt: 1_000,
          totalDurationMs: 60_000,
          points: [
            { lat: 44.43, lng: 26.13, ts: 1_000 },
            { lat: 44.44, lng: 26.14, ts: 61_000 },
          ],
        }
      : null,
  } as VehicleItem;
}

describe("useGpsSimulator real GPS handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears local simulation before the Firestore stop acknowledgement returns", async () => {
    let releaseStop: (() => void) | undefined;
    vi.mocked(stopGpsSimOnFirestore).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        })
    );

    const { result } = renderHook(() => useGpsSimulator(makeVehicle(true)));
    act(() => {
      result.current.set({ status: "running", localStartedAt: 1_000 });
    });

    let stopPromise: Promise<void> | undefined;
    act(() => {
      stopPromise = result.current.stopSimulation();
    });

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.localStartedAt).toBeNull();

    await act(async () => {
      releaseStop?.();
      await stopPromise;
    });
  });

  it("returns to real mode when the persisted simulation disappears", async () => {
    const { result, rerender } = renderHook(({ vehicle }) => useGpsSimulator(vehicle), {
      initialProps: { vehicle: makeVehicle(true) },
    });

    act(() => {
      result.current.set({ status: "done", localStartedAt: 1_000 });
    });
    rerender({ vehicle: makeVehicle(false) });

    await waitFor(() => {
      expect(result.current.state.status).toBe("idle");
      expect(result.current.state.localStartedAt).toBeNull();
    });
  });
});
