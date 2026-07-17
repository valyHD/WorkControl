import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantV3Orchestrator } from "../core/assistantOrchestrator";
import type { AssistantV3Contract, AssistantV3PageContext } from "../core/assistantV3Types";
import { AssistantToolRegistry } from "../tools/assistantToolRegistry";
import { createVehicleTrackerTool } from "./entityAdapters";

const mocks = vi.hoisted(() => ({ resolveEntity: vi.fn() }));

vi.mock("../runtime/assistantEntityResolver", () => ({
  resolveAssistantEntity: mocks.resolveEntity,
}));

const pageContext: AssistantV3PageContext = {
  route: "/dashboard",
  page: "Dashboard",
  selectedEntity: null,
  openForm: null,
  availableActions: [],
  allowedFields: [],
  role: "admin",
  memory: {},
};

const contract: AssistantV3Contract = {
  version: "3",
  commandType: "navigation",
  intent: "open_vehicle_tracker",
  toolCalls: [{ id: "vehicles.openTracker", input: { entityQuery: "toyota" } }],
  targetPage: "",
  entityReferences: [{ type: "vehicle", query: "toyota", id: "" }],
  missingInformation: [],
  confidence: 0.98,
  confirmationRequired: false,
  response: "Deschid GPS-ul masinii toyota.",
};

describe("vehicle tracker assistant adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the vehicle and navigates directly to its GPS tab", async () => {
    mocks.resolveEntity.mockResolvedValue({
      status: "resolved",
      entity: {
        entityType: "vehicle",
        entityId: "toyota-1",
        label: "Toyota Corolla B04YRA",
        query: "toyota",
        score: 1,
        data: {},
      },
      options: [],
    });
    const navigate = vi.fn();
    const orchestrator = new AssistantV3Orchestrator(
      async () => contract,
      new AssistantToolRegistry().register(createVehicleTrackerTool())
    );

    const result = await orchestrator.run({
      command: "du-ma pe gps-ul toyota",
      pageContext,
      actor: { uid: "admin-1", role: "admin" },
      runtime: { navigate, dispatchFormDraft: () => true },
    });

    expect(result.status).toBe("executed");
    expect(navigate).toHaveBeenCalledWith(
      "/vehicles/toyota-1?tab=gps#vehicle-tracker-live-section"
    );
  });

  it("asks the user to choose when multiple vehicles match", async () => {
    mocks.resolveEntity.mockResolvedValue({
      status: "ambiguous",
      message: "Am gasit mai multe masini Toyota.",
      options: [
        { entityType: "vehicle", entityId: "v1", label: "Toyota Corolla B04YRA", score: 0.9 },
        { entityType: "vehicle", entityId: "v2", label: "Toyota Yaris B05ABC", score: 0.88 },
      ],
    });
    const navigate = vi.fn();
    const orchestrator = new AssistantV3Orchestrator(
      async () => contract,
      new AssistantToolRegistry().register(createVehicleTrackerTool())
    );

    const result = await orchestrator.run({
      command: "du-ma pe gps-ul toyota",
      pageContext,
      actor: { uid: "admin-1", role: "admin" },
      runtime: { navigate, dispatchFormDraft: () => true },
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.choices).toEqual([
      { id: "v1", label: "Toyota Corolla B04YRA" },
      { id: "v2", label: "Toyota Yaris B05ABC" },
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
