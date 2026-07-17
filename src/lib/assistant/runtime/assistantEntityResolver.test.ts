import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAssistantEntity } from "./assistantEntityResolver";

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  tools: vi.fn(),
  users: vi.fn(),
}));

vi.mock("../../../modules/vehicles/services/vehiclesService", () => ({
  getVehiclesList: mocks.vehicles,
  getVehicleById: vi.fn().mockResolvedValue({
    id: "vehicle-context",
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
  }),
}));
vi.mock("../../../modules/tools/services/toolsService", () => ({
  getToolsList: mocks.tools,
  getToolById: vi
    .fn()
    .mockResolvedValue({ id: "tool-context", name: "Bosch vechi", internalCode: "A1" }),
}));
vi.mock("../../../modules/timesheets/services/timesheetsService", () => ({
  getProjectsList: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../modules/users/services/usersService", () => ({
  getAllUsers: mocks.users,
}));

describe("resolveAssistantEntity context safety", () => {
  beforeEach(() => {
    mocks.vehicles.mockResolvedValue([
      { id: "vehicle-context", plateNumber: "B33LGR", brand: "Dacia", model: "Logan" },
      {
        id: "vehicle-requested",
        plateNumber: "B092194",
        brand: "Dacia",
        model: "Logan",
        vin: "VIN123",
        currentDriverUserName: "Matura Ionut",
      },
    ]);
    mocks.tools.mockResolvedValue([
      { id: "tool-context", name: "Bosch vechi", internalCode: "A1" },
      { id: "tool-requested", name: "Hilti nou", internalCode: "H2" },
    ]);
    mocks.users.mockResolvedValue([
      { id: "user-current", fullName: "Ionut Matura", email: "ionut@example.com" },
      { id: "user-other", fullName: "Razvan Frincu", email: "razvan@example.com" },
    ]);
  });

  it("does not replace an explicitly requested vehicle with the remembered vehicle", async () => {
    const result = await resolveAssistantEntity("vehicle", "B 092194", {
      user: null,
      currentPathname: "/vehicles/vehicle-context",
      memory: { lastVehicleId: "vehicle-context" },
    });

    expect(result.status).toBe("resolved");
    expect(result.entity?.entityId).toBe("vehicle-requested");
    expect(result.entity?.label).toBe("B092194 Dacia Logan");
  });

  it("does not replace an explicitly requested tool with the remembered tool", async () => {
    const result = await resolveAssistantEntity("tool", "Hilti H2", {
      user: null,
      currentPathname: "/tools/tool-context",
      memory: { lastToolId: "tool-context" },
    });

    expect(result.status).toBe("resolved");
    expect(result.entity?.entityId).toBe("tool-requested");
  });

  it("resolves the authenticated user's profile without guessing by name", async () => {
    const result = await resolveAssistantEntity("user", "__current_user__", {
      user: { uid: "user-current", role: "angajat" },
      currentPathname: "/my-profile",
    });

    expect(result.status).toBe("resolved");
    expect(result.entity?.entityId).toBe("user-current");
    expect(result.entity?.label).toBe("Ionut Matura");
  });
});
