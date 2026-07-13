import { describe, expect, it } from "vitest";
import { getAssistantV3ToolRegistry } from "../adapters";
import { buildAssistantExecutionSteps } from "./assistantPlanner";
import type { AssistantV3Contract } from "./assistantV3Types";

describe("assistant execution plan", () => {
  it("uses registered tool metadata for a multi-step plan", () => {
    const contract: AssistantV3Contract = {
      version: "3",
      commandType: "timesheet_action",
      intent: "start_timesheet",
      toolCalls: [
        { id: "timesheets.projects.create", input: { projectName: "Service 2" } },
        { id: "timesheets.start", input: { projectQuery: "Service 2" } },
      ],
      targetPage: "/my-timesheet",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.96,
      confirmationRequired: true,
      response: "Creez proiectul si pornesc pontajul.",
    };

    const steps = buildAssistantExecutionSteps(contract, true, getAssistantV3ToolRegistry());

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ status: "active", requiresConfirmation: true });
    expect(steps[1]).toMatchObject({ status: "pending", requiresConfirmation: true });
    expect(steps.every((step) => !step.label.includes("timesheets."))).toBe(true);
  });
});
