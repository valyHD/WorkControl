import { describe, expect, it } from "vitest";
import { assertHistoryCleanupSelection } from "./historyCleanupPolicy";

describe("history cleanup policy", () => {
  it("allows cleanup when timesheets are excluded", () => {
    expect(() => assertHistoryCleanupSelection({ cleanTimesheets: false })).not.toThrow();
  });

  it("blocks every attempt to delete timesheet history", () => {
    expect(() => assertHistoryCleanupSelection({ cleanTimesheets: true })).toThrow(
      "Pontajele sunt excluse"
    );
  });
});
