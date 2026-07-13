import { describe, expect, it, vi } from "vitest";
import {
  loadSelectedDayRouteWithRecovery,
  shouldRecoverSelectedDayRoute,
} from "./vehicleRouteRecovery";

const fromTs = 1_000_000;
const toTs = 2_000_000;

describe("vehicle route recovery", () => {
  it("retries a missing real route in chunks when the live snapshot is in range", async () => {
    const recovered = [{ gpsTimestamp: 1_900_000 }];
    const loadRecovery = vi.fn().mockResolvedValue(recovered);

    await expect(
      loadSelectedDayRouteWithRecovery({
        fromTs,
        toTs,
        snapshotTimestamp: 1_950_000,
        loadPrimary: vi.fn().mockResolvedValue([]),
        loadRecovery,
      })
    ).resolves.toEqual(recovered);
    expect(loadRecovery).toHaveBeenCalledOnce();
  });

  it("recovers when the loaded route is stale compared with the live snapshot", () => {
    expect(
      shouldRecoverSelectedDayRoute([{ gpsTimestamp: 1_100_000 }], 1_950_000, fromTs, toTs, 300_000)
    ).toBe(true);
  });

  it("keeps a fresh route and avoids the recovery query", async () => {
    const primary = [{ gpsTimestamp: 1_900_000 }];
    const loadRecovery = vi.fn().mockResolvedValue([{ gpsTimestamp: 1_950_000 }]);

    await expect(
      loadSelectedDayRouteWithRecovery({
        fromTs,
        toTs,
        snapshotTimestamp: 1_950_000,
        staleToleranceMs: 100_000,
        loadPrimary: vi.fn().mockResolvedValue(primary),
        loadRecovery,
      })
    ).resolves.toEqual(primary);
    expect(loadRecovery).not.toHaveBeenCalled();
  });

  it("prefers the authoritative daily route when sparse fresh points hide a real route", async () => {
    const primary = [{ gpsTimestamp: 1_950_000 }];
    const recovered = [
      { gpsTimestamp: 1_700_000 },
      { gpsTimestamp: 1_800_000 },
      { gpsTimestamp: 1_900_000 },
    ];
    const loadPrimary = vi.fn().mockResolvedValue(primary);
    const loadRecovery = vi.fn().mockResolvedValue(recovered);

    await expect(
      loadSelectedDayRouteWithRecovery({
        fromTs,
        toTs,
        snapshotTimestamp: 1_950_000,
        preferRecovery: true,
        loadPrimary,
        loadRecovery,
      })
    ).resolves.toEqual(recovered);
    expect(loadRecovery).toHaveBeenCalledOnce();
    expect(loadPrimary).not.toHaveBeenCalled();
  });

  it("does not retry when the snapshot is outside the selected day", () => {
    expect(shouldRecoverSelectedDayRoute([], toTs + 1, fromTs, toTs)).toBe(false);
  });
});
