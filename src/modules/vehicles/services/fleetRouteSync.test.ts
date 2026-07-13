import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VehiclePositionItem } from "../../../types/vehicle";
import {
  createFleetRouteSync,
  getFleetRouteSyncMetrics,
  resetFleetRouteSyncForTests,
  type FleetRouteRequestMode,
} from "./fleetRouteSync";

function point(vehicleId: string, timestamp: number): VehiclePositionItem {
  return {
    id: `${vehicleId}-${timestamp}`,
    vehicleId,
    lat: 44 + timestamp / 100_000_000,
    lng: 26 + timestamp / 100_000_000,
    speedKmh: 30,
    gpsTimestamp: timestamp,
    serverTimestamp: timestamp,
  };
}

class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(value: DocumentVisibilityState) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("fleetRouteSync", () => {
  beforeEach(() => {
    resetFleetRouteSyncForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads 10 complete routes once and uses only incremental reads for later refreshes", async () => {
    const visibility = new VisibilityDocument();
    let currentTime = 6_500;
    const requests: Array<{ vehicleId: string; mode: FleetRouteRequestMode }> = [];
    const finalRoutes = new Map<string, VehiclePositionItem[]>();
    const controllers = Array.from({ length: 10 }, (_, index) => {
      const vehicleId = `vehicle-${index + 1}`;
      return createFleetRouteSync({
        scopeKey: "test-user",
        vehicleId,
        fromTs: 0,
        toTs: 1_000_000,
        refreshMs: 60_000,
        pageSize: 1_800,
        maxPages: 18,
        visibilityDocument: visibility as unknown as Document,
        now: () => currentTime,
        loader: async ({ mode, toTs }) => {
          requests.push({ vehicleId, mode });
          return mode === "full"
            ? Array.from({ length: 6_500 }, (_, pointIndex) => point(vehicleId, pointIndex + 1))
            : [point(vehicleId, toTs)];
        },
        onData: (items) => finalRoutes.set(vehicleId, items),
      });
    });

    await Promise.all(controllers.map((controller) => controller.start()));
    for (let cycle = 0; cycle < 30; cycle += 1) {
      currentTime += 10_000;
      await Promise.all(controllers.map((controller) => controller.refresh()));
    }

    const fullRequests = requests.filter((request) => request.mode === "full");
    const incrementalRequests = requests.filter((request) => request.mode === "incremental");
    const legacyReads = 10 * 6_500 * 31;
    const optimizedReads = 10 * 6_500 + incrementalRequests.length;
    const reduction = 1 - optimizedReads / legacyReads;

    expect(fullRequests).toHaveLength(10);
    expect(incrementalRequests).toHaveLength(300);
    expect(reduction).toBeGreaterThan(0.96);
    expect(getFleetRouteSyncMetrics().peakConcurrentRequestsPerVehicle).toBe(1);
    for (const route of finalRoutes.values()) {
      expect(route).toHaveLength(6_530);
      expect(new Set(route.map((item) => item.id)).size).toBe(route.length);
    }

    controllers.forEach((controller) => controller.stop());
  });

  it("does not fetch while hidden and recovers only the missing gap when visible", async () => {
    const visibility = new VisibilityDocument();
    let currentTime = 100;
    const modes: FleetRouteRequestMode[] = [];
    const controller = createFleetRouteSync({
      scopeKey: "test-user",
      vehicleId: "vehicle-hidden",
      fromTs: 0,
      toTs: 10_000,
      refreshMs: 10_000,
      pageSize: 100,
      maxPages: 2,
      visibilityDocument: visibility as unknown as Document,
      now: () => currentTime,
      loader: async ({ mode, toTs }) => {
        modes.push(mode);
        return [point("vehicle-hidden", toTs)];
      },
      onData: () => undefined,
    });

    await controller.start();
    visibility.setVisibility("hidden");
    currentTime = 20_000;
    await controller.refresh();
    expect(modes).toEqual(["full"]);

    visibility.setVisibility("visible");
    await vi.waitFor(() => expect(modes).toEqual(["full", "incremental"]));
    expect(getFleetRouteSyncMetrics().hiddenPageFetchesAvoided).toBe(1);
    controller.stop();
  });

  it("shares duplicate in-flight requests instead of starting concurrent queries", async () => {
    let currentTime = 100;
    let resolveIncremental: ((items: VehiclePositionItem[]) => void) | null = null;
    let activeRequests = 0;
    let peakActiveRequests = 0;
    let loaderCalls = 0;
    const controller = createFleetRouteSync({
      scopeKey: "test-user",
      vehicleId: "vehicle-shared",
      fromTs: 0,
      toTs: 10_000,
      refreshMs: 10_000,
      pageSize: 100,
      maxPages: 2,
      now: () => currentTime,
      loader: ({ mode, toTs }) => {
        loaderCalls += 1;
        activeRequests += 1;
        peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
        if (mode === "full") {
          activeRequests -= 1;
          return Promise.resolve([point("vehicle-shared", toTs)]);
        }
        return new Promise<VehiclePositionItem[]>((resolve) => {
          resolveIncremental = (items) => {
            activeRequests -= 1;
            resolve(items);
          };
        });
      },
      onData: () => undefined,
    });

    await controller.start();
    currentTime = 200;
    const first = controller.refresh();
    const second = controller.refresh();
    await vi.waitFor(() => expect(resolveIncremental).not.toBeNull());
    const resolvePending = resolveIncremental as ((items: VehiclePositionItem[]) => void) | null;
    resolvePending?.([point("vehicle-shared", currentTime)]);
    await Promise.all([first, second]);

    expect(loaderCalls).toBe(2);
    expect(peakActiveRequests).toBe(1);
    expect(getFleetRouteSyncMetrics().sharedRequests).toBe(1);
    controller.stop();
  });

  it("reuses the session cache after a Strict Mode style remount", async () => {
    let currentTime = 1_000;
    const modes: FleetRouteRequestMode[] = [];
    const makeController = () =>
      createFleetRouteSync({
        scopeKey: "strict-user",
        vehicleId: "strict-vehicle",
        fromTs: 0,
        toTs: 10_000,
        refreshMs: 10_000,
        pageSize: 100,
        maxPages: 2,
        now: () => currentTime,
        loader: async ({ mode, toTs }) => {
          modes.push(mode);
          return [point("strict-vehicle", toTs)];
        },
        onData: () => undefined,
      });

    const first = makeController();
    await first.start();
    first.stop();
    currentTime = 1_100;

    const remounted = makeController();
    await remounted.start();
    expect(modes).toEqual(["full", "incremental"]);
    expect(getFleetRouteSyncMetrics().cacheHits).toBe(1);
    expect(getFleetRouteSyncMetrics().fullRouteRequests).toBe(1);
    remounted.stop();
  });

  it("keeps only the newest compact route points", async () => {
    const received: VehiclePositionItem[][] = [];
    const controller = createFleetRouteSync({
      scopeKey: "compact-user",
      vehicleId: "compact-vehicle",
      fromTs: 0,
      toTs: 10_000,
      refreshMs: 30 * 60_000,
      pageSize: 50,
      maxPages: 1,
      maxPoints: 50,
      now: () => 1_000,
      loader: async () =>
        Array.from({ length: 80 }, (_, index) => point("compact-vehicle", index + 1)),
      onData: (items) => received.push(items),
    });

    await controller.start();

    expect(received.at(-1)).toHaveLength(50);
    expect(received.at(-1)?.[0]?.gpsTimestamp).toBe(31);
    controller.stop();
  });

  it("does not refresh early when a visible tab returns before the interval", async () => {
    const visibility = new VisibilityDocument();
    let currentTime = 1_000;
    const modes: FleetRouteRequestMode[] = [];
    const controller = createFleetRouteSync({
      scopeKey: "visibility-user",
      vehicleId: "visibility-vehicle",
      fromTs: 0,
      toTs: 10_000_000,
      refreshMs: 30 * 60_000,
      pageSize: 50,
      maxPages: 1,
      visibilityDocument: visibility as unknown as Document,
      now: () => currentTime,
      loader: async ({ mode, toTs }) => {
        modes.push(mode);
        return [point("visibility-vehicle", toTs)];
      },
      onData: () => undefined,
    });

    await controller.start();
    visibility.setVisibility("hidden");
    currentTime += 5 * 60_000;
    visibility.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(24 * 60_000);
    expect(modes).toEqual(["full"]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(modes).toEqual(["full", "incremental"]);
    controller.stop();
  });
});
