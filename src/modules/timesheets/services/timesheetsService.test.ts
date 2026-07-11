import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn((...parts: unknown[]) => ({ parts })),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(),
  doc: vi.fn((...parts: unknown[]) => ({ parts })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: unknown) => ({ limit: value })),
  orderBy: vi.fn((...parts: unknown[]) => ({ orderBy: parts })),
  query: vi.fn((...parts: unknown[]) => ({ query: parts })),
  serverTimestamp: vi.fn(() => ({ serverTimestamp: true })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn((...parts: unknown[]) => ({ where: parts })),
}));

const notificationMocks = vi.hoisted(() => ({
  dispatchNotificationEvent: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("../../../lib/firebase/firebase", () => ({ db: { project: "test" } }));
vi.mock("../../notifications/services/notificationsService", () => notificationMocks);

import { computeTimesheetStats, startTimesheet, stopTimesheet } from "./timesheetsService";
import type { TimesheetItem } from "../../../types/timesheet";

function timesheet(overrides: Partial<TimesheetItem> = {}): TimesheetItem {
  return {
    id: "timesheet-1",
    userId: "user-test",
    userName: "Utilizator Test",
    projectId: "project-test",
    projectCode: "P-TEST",
    projectName: "Proiect Test",
    status: "inchis",
    explanation: "",
    startAt: Date.UTC(2026, 6, 10, 8),
    stopAt: Date.UTC(2026, 6, 10, 9, 30),
    workedMinutes: 90,
    startLocation: { lat: null, lng: null, label: "Test" },
    stopLocation: { lat: null, lng: null, label: "Test" },
    startSource: "web",
    stopSource: "web",
    workDate: "2026-07-10",
    yearMonth: "2026-07",
    weekKey: "2026-W28",
    createdAt: Date.UTC(2026, 6, 10, 8),
    updatedAt: Date.UTC(2026, 6, 10, 9, 30),
    ...overrides,
  };
}

describe("timesheetsService critical rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("calculates daily, weekly and monthly durations", () => {
    const now = Date.UTC(2026, 6, 10, 12);
    const stats = computeTimesheetStats(
      [timesheet(), timesheet({ id: "timesheet-2", workedMinutes: 30 })],
      now
    );

    expect(stats.todayMinutes).toBe(120);
    expect(stats.weekMinutes).toBe(120);
    expect(stats.monthMinutes).toBe(120);
    expect(stats.avgMinutesPerWorkedDayMonth).toBe(120);
  });

  it("does not start a second timesheet while one is active", async () => {
    firestoreMocks.getDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "active-timesheet",
          data: () => timesheet({ status: "activ", stopAt: null, workedMinutes: 0 }),
        },
      ],
    });

    await expect(
      startTimesheet({
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-test",
        projectCode: "P-TEST",
        projectName: "Proiect Test",
        startLocation: { lat: null, lng: null, label: "Test" },
      })
    ).rejects.toThrow(/pontaj activ/i);
    expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
  });

  it("stores the elapsed minutes when a timesheet is stopped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T09:35:00.000Z"));
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        ...timesheet(),
        startAt: Date.parse("2026-07-10T08:00:00.000Z"),
      }),
    });
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
    notificationMocks.dispatchNotificationEvent.mockResolvedValue(undefined);

    await stopTimesheet({
      timesheetId: "timesheet-1",
      explanation: "Test oprire",
      stopLocation: { lat: null, lng: null, label: "Test" },
    });

    expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workedMinutes: 95, stopAt: Date.parse("2026-07-10T09:35:00.000Z") })
    );
  });
});
