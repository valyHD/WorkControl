import { describe, expect, it } from "vitest";
import {
  buildFleetRouteSamplingPlan,
  buildFleetRouteSamplingWindows,
} from "./fleetRouteSampling";

describe("fleet route sampling", () => {
  it("spreads a 50-read budget across the entire elapsed interval", () => {
    const fromTs = Date.UTC(2026, 6, 13, 0, 0, 0);
    const toTs = Date.UTC(2026, 6, 13, 12, 0, 0);
    const windows = buildFleetRouteSamplingWindows(fromTs, toTs, 50);

    expect(windows).toHaveLength(25);
    expect(windows[0]?.fromTs).toBe(fromTs);
    expect(windows.at(-1)?.toTs).toBe(toTs);
    expect(windows.reduce((reads, window) => reads + 1 + Number(window.includeLastPoint), 0)).toBe(
      50
    );
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]?.fromTs).toBe((windows[index - 1]?.toTs ?? 0) + 1);
    }
  });

  it("shares the bounded read budget across both UTC day partitions of a local day", () => {
    const plan = buildFleetRouteSamplingPlan(
      [
        {
          dayKey: "2026-07-12",
          fromTs: Date.UTC(2026, 6, 12, 21, 0, 0),
          toTs: Date.UTC(2026, 6, 12, 23, 59, 59, 999),
        },
        {
          dayKey: "2026-07-13",
          fromTs: Date.UTC(2026, 6, 13, 0, 0, 0),
          toTs: Date.UTC(2026, 6, 13, 6, 0, 0),
        },
      ],
      50
    );

    expect(plan.map((segment) => segment.maxReads)).toEqual([17, 33]);
    expect(plan.flatMap((segment) => segment.windows)).toHaveLength(26);
    expect(
      plan.reduce(
        (total, segment) =>
          total +
          segment.windows.reduce(
            (reads, window) => reads + 1 + Number(window.includeLastPoint),
            0
          ),
        0
      )
    ).toBe(50);
  });

  it("never exceeds the requested budget for short ranges", () => {
    const windows = buildFleetRouteSamplingWindows(1_000, 1_002, 50);
    const reads = windows.reduce(
      (total, window) => total + 1 + Number(window.includeLastPoint),
      0
    );

    expect(windows).toHaveLength(3);
    expect(reads).toBeLessThanOrEqual(50);
    expect(windows.at(-1)?.toTs).toBe(1_002);
  });
});
