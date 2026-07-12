import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getActiveTimesheetForUser: vi.fn(),
  startTimesheet: vi.fn(),
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
    serviceMocks.startTimesheet.mockResolvedValue("timesheet-1");
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
    queueOfflineTimesheetStart(startPayload);
    queueOfflineTimesheetStop({
      userId: "user-1",
      explanation: "Final",
      stopLocation: { lat: null, lng: null, label: "Offline" },
    });
    serviceMocks.getActiveTimesheetForUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "timesheet-1" });

    await expect(flushOfflineTimesheetQueue("user-1")).resolves.toBe(2);
    expect(serviceMocks.startTimesheet).toHaveBeenCalledTimes(1);
    expect(serviceMocks.stopTimesheet).toHaveBeenCalledWith(expect.objectContaining({ timesheetId: "timesheet-1" }));
    expect(getOfflineTimesheetQueue("user-1")).toEqual([]);
  });
});
