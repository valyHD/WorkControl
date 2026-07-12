import { describe, expect, it, vi } from "vitest";
import { AssistantV3Orchestrator } from "../core/assistantOrchestrator";
import type { AssistantV3Contract, AssistantV3PageContext } from "../core/assistantV3Types";
import { AssistantToolRegistry } from "../tools/assistantToolRegistry";
import { createNavigationTool, isAssistantNavigationPathAllowed } from "./navigationAdapter";

const baseContext: AssistantV3PageContext = {
  route: "/dashboard",
  page: "Dashboard",
  selectedEntity: null,
  openForm: null,
  availableActions: [],
  allowedFields: [],
  role: "angajat",
  memory: {},
};

function navigationContract(path: string): AssistantV3Contract {
  return {
    version: "3",
    commandType: "navigation",
    intent: "open_page",
    toolCalls: [{ id: "navigation.open", input: { path, query: "" } }],
    targetPage: path,
    entityReferences: [],
    missingInformation: [],
    confidence: 0.95,
    confirmationRequired: false,
    response: "Deschid pagina.",
  };
}

describe("Assistant V3 navigation adapter", () => {
  it("uses the role-filtered catalog as the target allowlist", () => {
    expect(isAssistantNavigationPathAllowed("/vehicles/vehicle-1", "angajat")).toBe(true);
    expect(isAssistantNavigationPathAllowed("/control-panel", "angajat")).toBe(false);
    expect(isAssistantNavigationPathAllowed("/control-panel", "admin")).toBe(true);
  });

  it.each(["", "/not-a-workcontrol-route", "//external.example/path"])(
    "does not execute invalid target %s",
    async (path) => {
      const navigate = vi.fn();
      const registry = new AssistantToolRegistry().register(createNavigationTool());
      const orchestrator = new AssistantV3Orchestrator(
        async () => navigationContract(path),
        registry
      );

      const result = await orchestrator.run({
        command: "deschide pagina",
        pageContext: baseContext,
        actor: { uid: "employee-1", role: "angajat" },
        runtime: { navigate, dispatchFormDraft: () => true },
      });

      expect(result.status).toBe("needs_clarification");
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});
