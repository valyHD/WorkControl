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

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("../../../lib/firebase/firebase", () => ({ db: {}, auth: { currentUser: { uid: "user-1" } } }));
vi.mock("../../../lib/firebase/companyAccess", () => ({
  buildCompanyScopeConstraints: () => [{ kind: "where", field: "companyId", operator: "==", value: "company-test" }],
  getCurrentCompanyAccessContext: vi.fn().mockResolvedValue({
    uid: "user-1",
    role: "admin",
    primaryCompanyId: "company-test",
    companyIds: ["company-test"],
    globalAdmin: false,
  }),
}));

describe("dashboardService cost bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.getDocs.mockResolvedValue({ docs: [] });
  });

  it("loads only the selected day and limits recent notifications", async () => {
    const { getDashboardData } = await import("./dashboardService");

    await getDashboardData("user-1", "2026-07-12");

    expect(firestoreMocks.where).toHaveBeenCalledWith("workDate", "==", "2026-07-12");
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
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "users")).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "tools")).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "vehicles")).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "projects")).toHaveLength(1);
    expect(firestoreMocks.query.mock.calls.filter(([base]) => base === "timesheets")).toHaveLength(
      2
    );
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
});
