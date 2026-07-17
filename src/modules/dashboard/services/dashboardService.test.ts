import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => name),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: "limit", value })),
  orderBy: vi.fn((field: string, direction?: string) => ({ kind: "orderBy", field, direction })),
  query: vi.fn((base: string, ...constraints: unknown[]) => ({ base, constraints })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    kind: "where",
    field,
    operator,
    value,
  })),
}));

const companyAccessMocks = vi.hoisted(() => ({
  getCurrentCompanyAccessContext: vi.fn().mockResolvedValue({
    uid: "user-1",
    role: "admin",
    primaryCompanyId: "company-test",
    companyIds: ["company-test"],
    globalAdmin: false,
  }),
}));

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("../../../lib/firebase/firebase", () => ({ db: {}, auth: { currentUser: { uid: "user-1" } } }));
vi.mock("../../../lib/firebase/companyAccess", () => ({
  buildCompanyScopeConstraints: () => [{ kind: "where", field: "companyId", operator: "==", value: "company-test" }],
  getCurrentCompanyAccessContext: companyAccessMocks.getCurrentCompanyAccessContext,
}));

describe("dashboardService cost bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyAccessMocks.getCurrentCompanyAccessContext.mockResolvedValue({
      uid: "user-1",
      role: "admin",
      primaryCompanyId: "company-test",
      companyIds: ["company-test"],
      globalAdmin: false,
    });
    firestoreMocks.getDocs.mockResolvedValue({ docs: [] });
  });

  it("loads the complete users directory for global admins", async () => {
    companyAccessMocks.getCurrentCompanyAccessContext.mockResolvedValueOnce({
      uid: "global-admin",
      role: "admin",
      primaryCompanyId: "",
      companyIds: [],
      globalAdmin: true,
    });
    const { getDashboardData } = await import("./dashboardService");

    await getDashboardData("global-admin", "2026-07-17", "admin");

    expect(firestoreMocks.query.mock.calls.some(([base]) => base === "users")).toBe(true);
    expect(
      firestoreMocks.query.mock.calls.some(([base]) => base === "userOperationalViews")
    ).toBe(false);
  });

  it("loads only the selected day and limits recent notifications", async () => {
    const { getDashboardData } = await import("./dashboardService");

    await getDashboardData("user-1", "2026-07-12");

    expect(firestoreMocks.where).toHaveBeenCalledWith("workDate", "==", "2026-07-12");
    expect(firestoreMocks.where).toHaveBeenCalledWith(
      "stopAt",
      ">=",
      new Date("2026-07-12T00:00:00").getTime()
    );
    expect(firestoreMocks.where).toHaveBeenCalledWith(
      "stopAt",
      "<=",
      new Date("2026-07-12T23:59:59.999").getTime()
    );
    expect(firestoreMocks.where).toHaveBeenCalledWith("periodEnd", ">=", "2026-07-12");
    expect(firestoreMocks.where).toHaveBeenCalledWith("userId", "==", "user-1");
    expect(firestoreMocks.limit).toHaveBeenCalledWith(10);
    expect(firestoreMocks.limit).toHaveBeenCalledWith(100);
    expect(firestoreMocks.limit).toHaveBeenCalledWith(80);
    expect(firestoreMocks.limit).toHaveBeenCalledWith(50);

    const timesheetQuery = firestoreMocks.query.mock.calls.find(([base]) => base === "timesheets");
    const notificationQuery = firestoreMocks.query.mock.calls.find(
      ([base]) => base === "notifications"
    );

    expect(timesheetQuery?.some((constraint) => (
      constraint as { kind?: string; field?: string }
    )?.kind === "where" && (
      constraint as { field?: string }
    ).field === "workDate")).toBe(true);
    expect(notificationQuery?.at(-1)).toMatchObject({ kind: "limit", value: 10 });

    await getDashboardData("user-1", "2026-07-12");
    expect(
      firestoreMocks.query.mock.calls.filter(([base]) => base === "userOperationalViews")
    ).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "tools")).toHaveLength(1);
    expect(
      firestoreMocks.query.mock.calls.filter(([base]) => base === "vehicleOperationalViews")
    ).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "projects")).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "timesheets")).toHaveLength(6);
    expect(
      firestoreMocks.query.mock.calls.filter(([base]) => base === "notifications")
    ).toHaveLength(2);
  });

  it("uses a personal data scope for employees and skips global inventory reads", async () => {
    const { getDashboardData } = await import("./dashboardService");

    const result = await getDashboardData("employee-1", "2026-07-12", "angajat");

    expect(result.scope).toBe("personal");
    expect(firestoreMocks.query.mock.calls.some(([base]) => base === "tools")).toBe(false);
    expect(firestoreMocks.query.mock.calls.some(([base]) => base === "vehicles")).toBe(false);
    expect(firestoreMocks.query.mock.calls.some(([base]) => base === "maintenanceClients")).toBe(
      false
    );

    const timesheetQuery = firestoreMocks.query.mock.calls.find(([base]) => base === "timesheets");
    expect(timesheetQuery).toBeDefined();
    expect(timesheetQuery?.some((constraint) => {
      const item = constraint as { kind?: string; field?: string; value?: unknown };
      return item?.kind === "where" && item.field === "userId" && item.value === "employee-1";
    })).toBe(true);
    expect(timesheetQuery?.at(-1)).toMatchObject({ kind: "limit", value: 20 });
  });

  it("keeps an active timesheet visible after it crosses midnight", async () => {
    firestoreMocks.getDocs.mockImplementation(async (request: {
      base?: string;
      constraints?: Array<{ kind?: string; field?: string; value?: unknown }>;
    }) => {
      if (request?.base !== "timesheets") return { docs: [], size: 0 };

      const isActiveQuery = request.constraints?.some(
        (constraint) =>
          constraint.kind === "where" &&
          constraint.field === "status" &&
          constraint.value === "activ"
      );
      const docItem = isActiveQuery
        ? {
            id: "active-from-yesterday",
            data: () => ({
              userId: "user-1",
              status: "activ",
              workDate: "2026-07-13",
              startAt: 100,
            }),
          }
        : {
            id: "closed-today",
            data: () => ({
              userId: "user-1",
              status: "inchis",
              workDate: "2026-07-14",
              startAt: 200,
            }),
          };
      return { docs: [docItem], size: 1 };
    });

    const { getDashboardData } = await import("./dashboardService");
    const result = await getDashboardData("user-1", "2026-07-14", "admin");

    expect(result.timesheets.map((item) => item.id)).toEqual([
      "closed-today",
      "active-from-yesterday",
    ]);
    expect(result.stats.activeTimesheets).toBe(1);
    expect(firestoreMocks.where).toHaveBeenCalledWith("status", "==", "activ");
  });

  it("summarizes scheduled, active and pending leave without a full collection scan", async () => {
    firestoreMocks.getDocs.mockImplementation(async (request: { base?: string }) => {
      if (request?.base !== "leaveRequests") return { docs: [], size: 0 };
      const docs = [
        {
          id: "active-approved",
          data: () => ({
            status: "aprobat",
            periodStart: "2026-08-09",
            periodEnd: "2026-08-12",
          }),
        },
        {
          id: "future-pending",
          data: () => ({
            status: "in_asteptare",
            periodStart: "2026-08-20",
            periodEnd: "2026-08-22",
          }),
        },
        {
          id: "rejected",
          data: () => ({
            status: "respins",
            periodStart: "2026-08-10",
            periodEnd: "2026-08-11",
          }),
        },
      ];
      return { docs, size: docs.length };
    });

    const { getDashboardData } = await import("./dashboardService");
    const result = await getDashboardData("user-1", "2026-08-10", "admin");

    expect(result.leave).toEqual({
      scheduled: 2,
      activeToday: 1,
      pending: 1,
      isPartial: false,
    });
    const leaveQuery = firestoreMocks.query.mock.calls.find(([base]) => base === "leaveRequests");
    expect(leaveQuery?.at(-1)).toMatchObject({ kind: "limit", value: 100 });
  });

  it("keeps a personal cross-day active timesheet visible", async () => {
    firestoreMocks.getDocs.mockImplementation(async (request: { base?: string }) => {
      if (request?.base !== "timesheets") return { docs: [], size: 0 };
      return {
        docs: [
          {
            id: "personal-active-yesterday",
            data: () => ({
              userId: "employee-1",
              status: "activ",
              workDate: "2026-08-31",
              startAt: new Date("2026-08-31T22:00:00+03:00").getTime(),
            }),
          },
        ],
        size: 1,
      };
    });

    const { getDashboardData } = await import("./dashboardService");
    const result = await getDashboardData("employee-1", "2026-09-01", "angajat");

    expect(result.timesheets.map((item) => item.id)).toContain("personal-active-yesterday");
    expect(result.stats.activeTimesheets).toBe(1);
  });
});
