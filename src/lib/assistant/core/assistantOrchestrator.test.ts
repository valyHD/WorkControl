import { describe, expect, it, vi } from "vitest";
import { AssistantV3Orchestrator } from "./assistantOrchestrator";
import type { AssistantV3Contract, AssistantV3PageContext } from "./assistantV3Types";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  AssistantToolRegistry,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";

const pageContext: AssistantV3PageContext = {
  route: "/vehicles",
  page: "Vehicule",
  selectedEntity: null,
  openForm: null,
  availableActions: ["test.write"],
  allowedFields: [],
  role: "admin",
  memory: {},
};

function contract(overrides: Partial<AssistantV3Contract> = {}): AssistantV3Contract {
  return {
    version: "3",
    commandType: "entity_update",
    intent: "update_vehicle",
    toolCalls: [{ id: "test.write", input: { value: "ok" } }],
    targetPage: "",
    entityReferences: [],
    missingInformation: [],
    confidence: 0.95,
    confirmationRequired: true,
    response: "Confirmi actualizarea?",
    ...overrides,
  };
}

function setupTool(options: {
  permission?: boolean;
  validation?: AssistantToolDefinition<unknown, Record<string, unknown>>["validate"];
} = {}) {
  const execute = vi.fn(async () => ({ message: "Executat." }));
  const resolve = vi.fn((input: unknown) => input as Record<string, unknown>);
  const audit = vi.fn();
  const definition: AssistantToolDefinition<unknown, Record<string, unknown>> = {
    id: "test.write",
    description: "Tool de test controlat.",
    aliases: [],
    module: "vehicles",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: () =>
      options.permission === false ? { ok: false, reason: "Interzis." } : { ok: true },
    resolve,
    validate: options.validation || (() => ({ ok: true })),
    preview: () => "Actualizez valoarea.",
    execute,
    audit,
  };
  return { registry: new AssistantToolRegistry().register(definition), execute, resolve, audit };
}

const runtime = {
  navigate: vi.fn(),
  dispatchFormDraft: vi.fn(() => true),
};

const actor = { uid: "admin-1", role: "admin", displayName: "Admin" };

describe("Assistant V3 orchestrator", () => {
  it("does not execute a mutation before explicit confirmation", async () => {
    const tool = setupTool();
    const orchestrator = new AssistantV3Orchestrator(async () => contract(), tool.registry);

    const result = await orchestrator.run({ command: "actualizeaza", pageContext, actor, runtime });

    expect(result.status).toBe("confirmation_required");
    expect(result.previews).toEqual(["Actualizez valoarea."]);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("checks permission before resolving entities or data", async () => {
    const tool = setupTool({ permission: false });
    const orchestrator = new AssistantV3Orchestrator(async () => contract(), tool.registry);

    const result = await orchestrator.run({ command: "actualizeaza", pageContext, actor, runtime });

    expect(result).toMatchObject({ status: "permission_denied", message: "Interzis." });
    expect(tool.resolve).not.toHaveBeenCalled();
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("clarifies low-confidence commands without execution", async () => {
    const tool = setupTool();
    const orchestrator = new AssistantV3Orchestrator(
      async () => contract({ confidence: 0.8 }),
      tool.registry
    );

    const result = await orchestrator.run({
      command: "poate actualizeaza",
      pageContext,
      actor,
      runtime,
    });

    expect(result.status).toBe("needs_clarification");
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("returns entity choices instead of guessing an ambiguous match", async () => {
    const tool = setupTool({
      validation: () => ({
        ok: false,
        reason: "Am gasit doua masini.",
        missingInformation: ["vehicle"],
        choices: [
          { id: "v1", label: "Dacia Logan B33LGR" },
          { id: "v2", label: "Dacia Logan B44ABC" },
        ],
      }),
    });
    const orchestrator = new AssistantV3Orchestrator(async () => contract(), tool.registry);

    const result = await orchestrator.run({ command: "schimba Loganul", pageContext, actor, runtime });

    expect(result).toMatchObject({
      status: "needs_clarification",
      choices: [
        { id: "v1", label: "Dacia Logan B33LGR" },
        { id: "v2", label: "Dacia Logan B44ABC" },
      ],
    });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("validates a multi-step plan before executing it in order", async () => {
    const executionOrder: string[] = [];
    const first = setupTool();
    const secondExecute = vi.fn(async () => {
      executionOrder.push("second");
      return { message: "Pasul doi." };
    });
    const firstDefinition = first.registry.get("test.write")!;
    const registry = new AssistantToolRegistry()
      .register({
        ...firstDefinition,
        id: "test.first",
        aliases: [],
        execute: async () => {
          executionOrder.push("first");
          return { message: "Pasul unu." };
        },
      })
      .register({
        ...firstDefinition,
        id: "test.second",
        aliases: [],
        execute: secondExecute,
      });
    const multiStepContract = contract({
      toolCalls: [
        { id: "test.first", input: { value: "unu" } },
        { id: "test.second", input: { value: "doi" } },
      ],
    });
    const orchestrator = new AssistantV3Orchestrator(async () => multiStepContract, registry);

    const beforeConfirmation = await orchestrator.run({
      command: "executa ambii pasi",
      pageContext,
      actor,
      runtime,
    });
    expect(beforeConfirmation.status).toBe("confirmation_required");
    expect(executionOrder).toEqual([]);

    const result = await orchestrator.run({
      command: "executa ambii pasi",
      pageContext,
      actor,
      runtime,
      confirmedToolCallIds: ["test.first", "test.second"],
    });

    expect(result.status).toBe("executed");
    expect(executionOrder).toEqual(["first", "second"]);
    expect(secondExecute).toHaveBeenCalledTimes(1);
  });

  it("executes and audits after the matching tool call is confirmed", async () => {
    const tool = setupTool();
    const orchestrator = new AssistantV3Orchestrator(async () => contract(), tool.registry);

    const result = await orchestrator.run({
      command: "actualizeaza",
      pageContext,
      actor,
      runtime,
      confirmedToolCallIds: ["test.write"],
    });

    expect(result).toMatchObject({ status: "executed", message: "Executat." });
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(tool.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "success" }),
      expect.anything()
    );
  });
});
