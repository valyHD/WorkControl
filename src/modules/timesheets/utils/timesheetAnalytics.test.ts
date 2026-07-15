import { describe, expect, it } from "vitest";
import type { TimesheetItem } from "../../../types/timesheet";
import {
  buildDayMinuteBuckets,
  buildProjectMinuteBuckets,
  getActiveUsersNow,
  getTimesheetMinutesForDay,
  getTimesheetMinutesForRange,
  getTimesheetPeriodRange,
  isStaleActiveTimesheet,
  isTimesheetInRange,
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

  it("uses only the selected day slice for active cross-day timesheets", () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const active = timesheet({
      status: "activ",
      startAt: new Date("2026-07-14T07:18:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
    });
    const todayRange = getTimesheetPeriodRange("today", undefined, undefined, now);

    expect(getTimesheetMinutesForRange(active, todayRange, now)).toBe(756);
    expect(isTimesheetInRange(active, todayRange, now)).toBe(true);
  });

  it("splits active cross-day chart buckets by calendar day", () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const active = timesheet({
      status: "activ",
      startAt: new Date("2026-07-14T07:18:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
    });

    expect(buildDayMinuteBuckets([active], now)).toEqual([
      { label: "07-14", value: 1002, displayValue: "16h 42m" },
      { label: "07-15", value: 756, displayValue: "12h 36m" },
    ]);
  });

  it("uses selected range minutes for project totals", () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const active = timesheet({
      status: "activ",
      startAt: new Date("2026-07-14T07:18:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
      projectName: "Service si Mentenanta",
    });
    const todayRange = getTimesheetPeriodRange("today", undefined, undefined, now);

    expect(buildProjectMinuteBuckets([active], now, 6, todayRange)).toEqual([
      { label: "Service si Mentenanta", value: 756, displayValue: "12h 36m" },
    ]);
  });

  it("detects stale active timesheets without blocking legitimate overnight work", () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const stale = timesheet({
      status: "activ",
      startAt: new Date("2026-07-14T07:18:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
    });
    const overnight = timesheet({
      status: "activ",
      startAt: new Date("2026-07-14T23:00:00+03:00").getTime(),
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
    });

    expect(isStaleActiveTimesheet(stale, now)).toBe(true);
    expect(isStaleActiveTimesheet(overnight, new Date("2026-07-15T06:00:00+03:00").getTime())).toBe(
      false
    );
  });

  it("detects legacy stale active timesheets using workDate when startAt is missing", () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const legacyStale = timesheet({
      status: "activ",
      startAt: 0,
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-14",
    });
    const todayLegacy = timesheet({
      status: "activ",
      startAt: 0,
      stopAt: null,
      workedMinutes: 0,
      workDate: "2026-07-15",
    });

    expect(isStaleActiveTimesheet(legacyStale, now)).toBe(true);
    expect(isStaleActiveTimesheet(todayLegacy, now)).toBe(false);
  });
});
