import { describe, expect, it } from "vitest";
import {
  normalizeAndValidateAssistantV3Contract,
  normalizeLegacyAssistantInterpretation,
  sanitizeAssistantV3PageContext,
  validateAssistantV3Contract,
} from "./assistantV3Contract";

describe("Assistant V3 contract", () => {
  it("accepts and sanitizes the strict version 3 fields", () => {
    const result = validateAssistantV3Contract({
      version: "3",
      commandType: "navigation",
      intent: "open_page",
      toolCalls: [{ id: "navigation.open", input: { path: "/vehicles", query: "" } }],
      targetPage: "/vehicles",
      entityReferences: [{ type: "page", query: "vehicule", id: "" }],
      missingInformation: [],
      confidence: 0.97,
      confirmationRequired: false,
      response: "Deschid vehiculele.",
    });

    expect(result).toMatchObject({ ok: true, value: { version: "3", targetPage: "/vehicles" } });
  });

  it("rejects malformed tool calls and out-of-range confidence", () => {
    const result = validateAssistantV3Contract({
      version: "3",
      commandType: "navigation",
      intent: "open_page",
      toolCalls: [{ id: "navigation.open", input: "unsafe" }],
      targetPage: "/vehicles",
      entityReferences: [],
      missingInformation: [],
      confidence: 2,
      confirmationRequired: false,
      response: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "toolCalls este invalid.",
          "confidence trebuie sa fie intre 0 si 1.",
        ])
      );
  });

  it("normalizes the current interpretation into a V3 tool call", () => {
    const normalized = normalizeLegacyAssistantInterpretation("schimba km", {
      commandType: "entity_update",
      intent: "update_vehicle",
      entityType: "vehicle",
      entityQuery: "B33LGR",
      fieldsToUpdate: { kilometri: 6200 },
      missingFields: [],
      confidence: 0.94,
      needsConfirmation: true,
      targetText: "",
      targetPage: "",
      pageHint: "",
      buttonHint: "",
      risk: "medium",
      spokenSummary: "Schimb kilometrii.",
      reportType: "",
      startDate: "",
      endDate: "",
    });

    expect(normalized).toMatchObject({
      version: "3",
      confirmationRequired: true,
      toolCalls: [
        { id: "vehicles.update", input: { entityQuery: "B33LGR", fields: { kilometri: 6200 } } },
      ],
    });
    expect(normalizeAndValidateAssistantV3Contract("schimba km", normalized).ok).toBe(true);
  });

  it("limits page context to the controlled fields", () => {
    const context = sanitizeAssistantV3PageContext({
      currentPathname: "/tools",
      currentSearch: "?secret=1",
      token: "do-not-forward",
      userRole: "manager",
      availableActions: ["tools.update"],
      memory: { lastVehicleId: "legacy-hidden", lastPage: "/vehicles" },
    });

    expect(context).toEqual({
      route: "/tools",
      page: "",
      selectedEntity: null,
      openForm: null,
      availableActions: ["tools.update"],
      allowedFields: [],
      role: "manager",
      memory: { lastEntity: undefined, lastPage: "/vehicles", lastCommand: undefined },
    });
    expect(context).not.toHaveProperty("token");
    expect(context).not.toHaveProperty("currentSearch");
  });
});
