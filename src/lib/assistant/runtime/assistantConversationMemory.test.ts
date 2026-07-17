import { describe, expect, it } from "vitest";
import {
  createAssistantConversationMemory,
  getVehicleIdFromAssistantPath,
} from "./assistantConversationMemory";

describe("assistant vehicle route context", () => {
  it.each([
    ["/vehicles/vehicle-1", "vehicle-1"],
    ["/vehicles/vehicle-1?view=my-vehicle", "vehicle-1"],
    ["/vehicles/vehicle-1?tab=gps#vehicle-tracker-live-section", "vehicle-1"],
    ["/vehicles/vehicle-1/edit?assistantField=currentKm", "vehicle-1"],
  ])("resolves the current vehicle from %s", (path, expected) => {
    expect(getVehicleIdFromAssistantPath(path)).toBe(expected);
  });

  it("keeps the previous page when navigation changes", () => {
    const memory = createAssistantConversationMemory();

    memory.syncPath("/dashboard");
    memory.syncPath("/vehicles");

    expect(memory.getSnapshot()).toMatchObject({
      lastPage: "/vehicles",
      previousPage: "/dashboard",
    });
  });

  it("does not replace the previous page when the same route is synchronized twice", () => {
    const memory = createAssistantConversationMemory({
      lastPage: "/vehicles",
      previousPage: "/dashboard",
    });

    memory.syncPath("/vehicles");

    expect(memory.getSnapshot().previousPage).toBe("/dashboard");
  });

  it("remembers only a completed controlled action and primitive fields", () => {
    const memory = createAssistantConversationMemory();

    memory.rememberCompletedAction("schimba kilometrii Toyotei la 7200", {
      version: "3",
      commandType: "entity_update",
      intent: "update_vehicle",
      toolCalls: [
        {
          id: "vehicles.update",
          input: {
            entityQuery: "Toyota",
            fields: { currentKm: 7200, nested: { unsafe: true } } as never,
          },
        },
      ],
      targetPage: "/vehicles",
      entityReferences: [{ type: "vehicle", query: "Toyota", id: "vehicle-1" }],
      missingInformation: [],
      confidence: 0.99,
      confirmationRequired: true,
      response: "Schimb kilometrii.",
    });

    expect(memory.getSnapshot().lastCompletedAction).toEqual({
      command: "schimba kilometrii Toyotei la 7200",
      commandType: "entity_update",
      intent: "update_vehicle",
      toolId: "vehicles.update",
      entityType: "vehicle",
      entityQuery: "Toyota",
      fields: { currentKm: 7200 },
      targetPage: "/vehicles",
    });
  });

  it("does not remember questions as actions that can be replayed", () => {
    const memory = createAssistantConversationMemory();

    memory.rememberCompletedAction("ce stii sa faci", {
      version: "3",
      commandType: "question",
      intent: "assistant_help",
      toolCalls: [],
      targetPage: "",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.99,
      confirmationRequired: false,
      response: "Te pot ajuta.",
    });

    expect(memory.getSnapshot().lastCompletedAction).toBeUndefined();
  });
});
