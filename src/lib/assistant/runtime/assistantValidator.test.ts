import { describe, expect, it } from "vitest";
import type { AssistantRuntimePlan } from "./assistantTypes";
import { validateAssistantPlan } from "./assistantValidator";

function vehiclePlan(overrides: Partial<AssistantRuntimePlan> = {}): AssistantRuntimePlan {
  return {
    intent: "update_vehicle",
    entityType: "vehicle",
    parsedIntent: {
      intent: "update_vehicle",
      entityType: "vehicle",
      entityQuery: "B33LGR",
      fieldsToUpdate: { currentKm: 6616 },
      targetText: "",
      targetPage: "",
      pageHint: "",
      buttonHint: "",
      missingFields: [],
      risk: "medium",
      needsConfirmation: true,
      spokenSummary: "Schimb kilometrii.",
      reportType: "",
      startDate: "",
      endDate: "",
      confidence: 0.95,
    },
    fieldsToUpdate: { currentKm: 6616 },
    changes: [
      {
        naturalName: "kilometri",
        fieldKey: "currentKm",
        label: "Km curenti",
        oldValue: 6000,
        newValue: 6616,
        displayOldValue: "6000",
        displayNewValue: "6616",
      },
    ],
    risk: "medium",
    confidence: 0.95,
    needsConfirmation: true,
    spokenSummary: "Schimb kilometrii.",
    status: "ready",
    message: "Confirmi?",
    ...overrides,
  };
}

const adminContext = {
  intent: "update_vehicle",
  user: { uid: "admin-test", role: "admin" },
};

describe("assistant plan validation", () => {
  it("accepts a valid confirmed mileage update", () => {
    expect(validateAssistantPlan(vehiclePlan(), adminContext).ok).toBe(true);
  });

  it("rejects a negative mileage", () => {
    const plan = vehiclePlan({
      changes: [
        {
          ...vehiclePlan().changes[0],
          newValue: -1,
          displayNewValue: "-1",
        },
      ],
    });

    expect(validateAssistantPlan(plan, adminContext)).toMatchObject({ ok: false });
  });

  it("asks for clarification below the safe confidence threshold", () => {
    const plan = vehiclePlan({ confidence: 0.5 });
    expect(validateAssistantPlan(plan, adminContext)).toMatchObject({ ok: false });
  });
});
