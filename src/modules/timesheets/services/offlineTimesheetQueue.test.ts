import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getActiveTimesheetForUser: vi.fn(),
  startTimesheetDetailed: vi.fn(),
  stopTimesheet: vi.fn(),
}));

vi.mock("./timesheetsService", () => serviceMocks);

import {
  flushOfflineTimesheetQueue,
  getOfflineTimesheetQueue,
  queueOfflineTimesheetStart,
  queueOfflineTimesheetStop,
} from "./offlineTimesheetQueue";

const startPayload = {
  userId: "user-1",
  userName: "User Test",
  projectId: "project-1",
  projectCode: "",
  projectName: "Service",
  startLocation: { lat: null, lng: null, label: "Offline" },
};

describe("offline timesheet queue", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    serviceMocks.startTimesheetDetailed.mockResolvedValue({
      timesheetId: "timesheet-1",
      duplicate: false,
    });
    serviceMocks.stopTimesheet.mockResolvedValue(undefined);
  });

  it("keeps start and stop in chronological order", () => {
    queueOfflineTimesheetStart(startPayload);
    queueOfflineTimesheetStop({
      userId: "user-1",
      explanation: "",
      stopLocation: { lat: null, lng: null, label: "Offline" },
    });
    expect(getOfflineTimesheetQueue("user-1").map((item) => item.type)).toEqual(["start", "stop"]);
  });

  it("flushes sequentially and removes processed actions", async () => {
    const startAction = queueOfflineTimesheetStart(startPayload);
    queueOfflineTimesheetStop({
      userId: "user-1",
      timesheetId: `offline:${startAction.id}`,
      explanation: "Final",
      stopLocation: { lat: null, lng: null, label: "Offline" },
    });
    serviceMocks.getActiveTimesheetForUser.mockResolvedValue({ id: "unrelated-active" });

    await expect(flushOfflineTimesheetQueue("user-1")).resolves.toBe(2);
    expect(serviceMocks.startTimesheetDetailed).toHaveBeenCalledTimes(1);
    expect(serviceMocks.stopTimesheet).toHaveBeenCalledWith(expect.objectContaining({ timesheetId: "timesheet-1" }));
    expect(serviceMocks.getActiveTimesheetForUser).not.toHaveBeenCalled();
    expect(getOfflineTimesheetQueue("user-1")).toEqual([]);
  });

  it("does not stop an unrelated active timesheet for a stale offline start", async () => {
    const startAction = queueOfflineTimesheetStart(startPayload);
    queueOfflineTimesheetStop({
      userId: "user-1",
      timesheetId: `offline:${startAction.id}`,
      explanation: "",
      stopLocation: { lat: null, lng: null, label: "Offline" },
    });
    serviceMocks.startTimesheetDetailed.mockResolvedValue({
      timesheetId: "unrelated-active",
      duplicate: true,
    });
    serviceMocks.getActiveTimesheetForUser.mockResolvedValue({
      id: "unrelated-active",
      startAt: startAction.occurredAt + 60 * 60_000,
    });

    await expect(flushOfflineTimesheetQueue("user-1")).rejects.toThrow(
      "pontaj activ diferit"
    );
    expect(serviceMocks.stopTimesheet).not.toHaveBeenCalled();
    expect(getOfflineTimesheetQueue("user-1")).toHaveLength(2);
  });
});
