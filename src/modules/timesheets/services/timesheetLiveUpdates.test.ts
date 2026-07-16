import { describe, expect, it, vi } from "vitest";
import { notifyTimesheetsChanged, subscribeTimesheetsChanged } from "./timesheetLiveUpdates";

describe("timesheet live updates", () => {
  it("notifies the current application immediately after a mutation", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimesheetsChanged(listener);

    notifyTimesheetsChanged({ userId: "user-1", reason: "start" });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", reason: "start" })
    );
    unsubscribe();
  });
});
