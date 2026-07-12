import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVehiclesList: vi.fn(),
  getToolsList: vi.fn(),
  getProjectsList: vi.fn(),
  getAllUsers: vi.fn(),
  getMaintenanceClients: vi.fn(),
}));

vi.mock("../../modules/vehicles/services/vehiclesService", () => ({ getVehiclesList: mocks.getVehiclesList }));
vi.mock("../../modules/tools/services/toolsService", () => ({ getToolsList: mocks.getToolsList }));
vi.mock("../../modules/timesheets/services/timesheetsService", () => ({ getProjectsList: mocks.getProjectsList }));
vi.mock("../../modules/users/services/usersService", () => ({ getAllUsers: mocks.getAllUsers }));
vi.mock("../../modules/maintenance/services/maintenanceService", () => ({ getMaintenanceClients: mocks.getMaintenanceClients }));

describe("globalSearchService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getVehiclesList.mockResolvedValue([]);
    mocks.getToolsList.mockResolvedValue([]);
    mocks.getProjectsList.mockResolvedValue([]);
    mocks.getMaintenanceClients.mockResolvedValue([]);
  });

  it("does not reuse a privileged pending search for a non-privileged role", async () => {
    let resolveUsers: (value: Array<{ id: string; uid: string; fullName: string; email: string }>) => void = () => undefined;
    mocks.getAllUsers.mockReturnValue(new Promise((resolve) => {
      resolveUsers = resolve;
    }));

    const { searchWorkControlEntities } = await import("./globalSearchService");
    const adminSearch = searchWorkControlEntities("secret", "admin");
    const employeeSearch = searchWorkControlEntities("secret", "angajat");

    await expect(employeeSearch).resolves.toEqual([]);
    resolveUsers([{ id: "user-secret", uid: "user-secret", fullName: "Secret Admin", email: "secret@example.test" }]);
    await expect(adminSearch).resolves.toMatchObject([{ type: "user", title: "Secret Admin" }]);
  });
});
