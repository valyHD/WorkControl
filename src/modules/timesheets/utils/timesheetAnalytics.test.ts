import { describe, expect, it } from "vitest";
import type { TimesheetItem } from "../../../types/timesheet";
import {
  getActiveUsersNow,
  getTimesheetMinutesForDay,
  sumTimesheetMinutesForDay,
} from "./timesheetAnalytics";

function timesheet(overrides: Partial<TimesheetItem>): TimesheetItem {
  return {
    id: "timesheet-test",
    userId: "user-test",
    userName: "Utilizator Test",
    projectId: "project-test",
    projectCode: "",
    projectName: "Service",
    status: "inchis",
    explanation: "",
    startAt: new Date("2026-07-14T08:00:00+03:00").getTime(),
    stopAt: new Date("2026-07-14T09:30:00+03:00").getTime(),
    workedMinutes: 90,
    startLocation: { lat: null, lng: null, label: "" },
    stopLocation: { lat: null, lng: null, label: "" },
    startSource: "web",
    stopSource: "web",
    workDate: "2026-07-14",
    yearMonth: "2026-07",
    weekKey: "2026-W29",
    createdAt: new Date("2026-07-14T08:00:00+03:00").getTime(),
    updatedAt: new Date("2026-07-14T09:30:00+03:00").getTime(),
    ...overrides,
  };
}

describe("timesheet operational analytics", () => {
  it("counts a cross-day active timesheet as active now", () => {
    const active = timesheet({
      id: "active-yesterday",
      userId: "user-cross-day",
      status: "activ",
      startAt: new Date("2026-07-13T18:00:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-13",
    });

    expect(getActiveUsersNow([active])).toEqual(new Set(["user-cross-day"]));
  });

  it("counts only today's portion of a cross-day active timesheet", () => {
    const now = new Date("2026-07-14T10:00:00+03:00").getTime();
    const active = timesheet({
      status: "activ",
      startAt: new Date("2026-07-13T18:00:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-13",
    });

    expect(getTimesheetMinutesForDay(active, "2026-07-14", now)).toBe(600);
    expect(
      sumTimesheetMinutesForDay(
        [active, timesheet({ id: "closed-today", workedMinutes: 90 })],
        "2026-07-14",
        now
      )
    ).toBe(690);
  });

  it("does not move a closed timesheet into another calendar day", () => {
    const closed = timesheet({
      workDate: "2026-07-13",
      startAt: new Date("2026-07-13T08:00:00+03:00").getTime(),
      stopAt: new Date("2026-07-13T16:00:00+03:00").getTime(),
      workedMinutes: 480,
    });
    expect(getTimesheetMinutesForDay(closed, "2026-07-14")).toBe(0);
  });

  it("keeps today's portion after a cross-day timesheet is stopped", () => {
    const closed = timesheet({
      workDate: "2026-07-13",
      startAt: new Date("2026-07-13T23:00:00+03:00").getTime(),
      stopAt: new Date("2026-07-14T02:30:00+03:00").getTime(),
      workedMinutes: 210,
    });

    expect(getTimesheetMinutesForDay(closed, "2026-07-14")).toBe(150);
  });
});
