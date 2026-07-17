import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantV3Orchestrator } from "../core/assistantOrchestrator";
import type { AssistantV3Contract, AssistantV3PageContext } from "../core/assistantV3Types";
import { AssistantToolRegistry } from "../tools/assistantToolRegistry";
import { createEntityReadTool } from "./entityReadAdapter";

const mocks = vi.hoisted(() => ({ resolveEntity: vi.fn() }));

vi.mock("../runtime/assistantEntityResolver", () => ({
  resolveAssistantEntity: mocks.resolveEntity,
}));

const pageContext: AssistantV3PageContext = {
  route: "/my-vehicle",
  page: "Masina mea",
  selectedEntity: null,
  openForm: null,
  availableActions: [],
  allowedFields: [],
  role: "admin",
  memory: {},
};

const contract: AssistantV3Contract = {
  version: "3",
  commandType: "question",
  intent: "read_entity",
  toolCalls: [
    {
      id: "entities.read",
      input: {
        entityQuery: "__current_vehicle__",
        fields: { currentKm: true, driver: true },
      },
    },
  ],
  targetPage: "",
  entityReferences: [{ type: "vehicle", query: "__current_vehicle__", id: "" }],
  missingInformation: [],
  confidence: 0.99,
  confirmationRequired: false,
  response: "Citesc datele cerute.",
};

describe("entity read assistant adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only approved fields without modifying the entity", async () => {
    mocks.resolveEntity.mockResolvedValue({
      status: "resolved",
      entity: {
        entityType: "vehicle",
        entityId: "vehicle-1",
        label: "B092194 Dacia Logan",
        score: 1,
        data: {
          currentKm: 7460.07,
          currentDriverUserName: "Matura Ionut",
          vin: "secret",
        },
      },
      options: [],
    });
    const orchestrator = new AssistantV3Orchestrator(
      async () => contract,
      new AssistantToolRegistry().register(createEntityReadTool())
    );

    const result = await orchestrator.run({
      command: "cati km am si cine conduce?",
      pageContext,
      actor: { uid: "admin-1", role: "admin" },
      runtime: { navigate: vi.fn(), dispatchFormDraft: vi.fn() },
    });

    expect(result.status).toBe("executed");
    expect(result.message).toContain("Km curenti: 7.460,07 km");
    expect(result.message).toContain("Sofer: Matura Ionut");
    expect(result.message).not.toContain("secret");
  });

  it("asks for a choice instead of guessing among multiple entities", async () => {
    mocks.resolveEntity.mockResolvedValue({
      status: "ambiguous",
      message: "Am gasit doua masini.",
      options: [
        { entityType: "vehicle", entityId: "v1", label: "Dacia Logan B33LGR", score: 0.9 },
        { entityType: "vehicle", entityId: "v2", label: "Dacia Logan B44ABC", score: 0.88 },
      ],
    });
    const orchestrator = new AssistantV3Orchestrator(
      async () => contract,
      new AssistantToolRegistry().register(createEntityReadTool())
    );

    const result = await orchestrator.run({
      command: "cati km are Loganul?",
      pageContext,
      actor: { uid: "admin-1", role: "admin" },
      runtime: { navigate: vi.fn(), dispatchFormDraft: vi.fn() },
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.choices).toHaveLength(2);
  });
});
