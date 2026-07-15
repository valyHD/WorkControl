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
const callableMocks = vi.hoisted(() => ({
  startTimesheetSecure: vi.fn(),
  stopTimesheetSecure: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: keyof typeof callableMocks) => callableMocks[name],
}));
vi.mock("../../../lib/firebase/firebase", () => ({
  db: { project: "test" },
  functions: { project: "test" },
}));
vi.mock("../../../lib/firebase/companyAccess", () => ({
  buildCompanyScopeConstraints: () => [{ where: ["companyId", "==", "company-test"] }],
  getCurrentCompanyAccessContext: vi.fn().mockResolvedValue({
    uid: "user-test",
    role: "angajat",
    primaryCompanyId: "company-test",
    companyIds: ["company-test"],
    globalAdmin: false,
  }),
  requirePrimaryCompanyId: () => "company-test",
}));
vi.mock("../../notifications/services/notificationsService", () => notificationMocks);

import {
  computeTimesheetStats,
  getTimesheetsList,
  getTimesheetsManagementList,
  startTimesheet,
  stopTimesheet,
} from "./timesheetsService";
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

  it("returns the existing active timesheet when the server reports a duplicate start", async () => {
    callableMocks.startTimesheetSecure.mockResolvedValue({
      data: { timesheetId: "active-timesheet", duplicate: true },
    });
    notificationMocks.dispatchNotificationEvent.mockResolvedValue(undefined);

    await expect(
      startTimesheet({
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-test",
        projectCode: "P-TEST",
        projectName: "Proiect Test",
        startLocation: { lat: null, lng: null, label: "Test" },
      })
    ).resolves.toBe("active-timesheet");
    expect(callableMocks.startTimesheetSecure).toHaveBeenCalledTimes(1);
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
    callableMocks.stopTimesheetSecure.mockResolvedValue({
      data: { duplicate: false, workedMinutes: 95, status: "inchis" },
    });
    notificationMocks.dispatchNotificationEvent.mockResolvedValue(undefined);

    await stopTimesheet({
      timesheetId: "timesheet-1",
      explanation: "Test oprire",
      stopLocation: { lat: null, lng: null, label: "Test" },
    });

    expect(callableMocks.stopTimesheetSecure).toHaveBeenCalledWith(
      expect.objectContaining({
        timesheetId: "timesheet-1",
        occurredAt: undefined,
        stopExplanation: "Test oprire",
      })
    );
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it("preserves valid offline start and stop timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T10:00:00.000Z"));
    callableMocks.startTimesheetSecure.mockResolvedValue({
      data: { timesheetId: "offline-timesheet", duplicate: false },
    });
    callableMocks.stopTimesheetSecure.mockResolvedValue({
      data: { duplicate: false, workedMinutes: 90, status: "inchis" },
    });
    notificationMocks.dispatchNotificationEvent.mockResolvedValue(undefined);

    const startedAt = Date.parse("2026-07-10T08:15:00.000Z");
    await startTimesheet({
      userId: "user-test",
      userName: "Utilizator Test",
      projectId: "project-test",
      projectCode: "",
      projectName: "Proiect Test",
      startLocation: { lat: null, lng: null, label: "Offline" },
      occurredAt: startedAt,
    });
    expect(callableMocks.startTimesheetSecure).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredAt: startedAt,
      })
    );

    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...timesheet(), startAt: startedAt }),
    });
    const stoppedAt = Date.parse("2026-07-10T09:45:00.000Z");
    await stopTimesheet({
      timesheetId: "offline-timesheet",
      explanation: "",
      stopLocation: { lat: null, lng: null, label: "Offline" },
      occurredAt: stoppedAt,
    });
    expect(callableMocks.stopTimesheetSecure).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredAt: stoppedAt,
      })
    );
  });

  it("bounds the manager list query", async () => {
    firestoreMocks.getDocs.mockResolvedValue({ docs: [] });

    await getTimesheetsManagementList(5000);

    expect(firestoreMocks.limit).toHaveBeenCalledWith(1500);
    expect(firestoreMocks.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ where: ["companyId", "==", "company-test"] }),
      expect.objectContaining({ orderBy: ["startAt", "desc"] }),
      expect.objectContaining({ limit: 1500 })
    );
  });

  it("maps Firestore timestamp fields without replacing missing startAt with current time", async () => {
    const createdAt = Date.parse("2026-07-14T07:18:00.000Z");
    firestoreMocks.getDocs.mockResolvedValue({
      docs: [
        {
          id: "legacy-active",
          data: () => ({
            userId: "user-test",
            userName: "Utilizator Test",
            projectId: "project-test",
            projectName: "Service",
            status: "activ",
            createdAt: { toMillis: () => createdAt },
            updatedAt: { _seconds: createdAt / 1000 },
            startAt: undefined,
            stopAt: null,
            workedMinutes: 0,
            workDate: "2026-07-14",
          }),
        },
      ],
    });

    const result = await getTimesheetsList();

    expect(result[0].startAt).toBe(createdAt);
    expect(result[0].createdAt).toBe(createdAt);
    expect(result[0].updatedAt).toBe(createdAt);
  });
});
