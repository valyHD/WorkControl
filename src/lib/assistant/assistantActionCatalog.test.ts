import { describe, expect, it } from "vitest";
import { getAssistantNavigationActions, resolveAssistantNavigationAction } from "./assistantActionCatalog";
import { resolveAssistantKnownPageNavigation } from "./runtime/assistantNavigation";

describe("assistant action catalog", () => {
  it("uses the shared navigation metadata for natural language routes", () => {
    expect(resolveAssistantNavigationAction("du-ma la harta cu toate gpsurile", "angajat")?.path).toBe(
      "/vehicles/gps-map"
    );
    expect(resolveAssistantKnownPageNavigation("deschide pontajul meu")?.path).toBe("/my-timesheets");
  });

  it("prefers specific maintenance workflows before the generic page", () => {
    expect(resolveAssistantNavigationAction("deschide istoricul rapoartelor", "manager")?.path).toBe(
      "/maintenance?tab=history"
    );
    expect(resolveAssistantNavigationAction("genereaza raport revizie", "manager")?.path).toContain(
      "tab=report"
    );
  });

  it("does not expose admin destinations to employees", () => {
    const employeeActions = getAssistantNavigationActions("angajat");
    expect(employeeActions.some((action) => action.id === "control-panel")).toBe(false);
    expect(resolveAssistantNavigationAction("deschide control panel", "angajat")).toBeNull();
  });

  it.each([
    ["duma la scanare bon", "/expenses/scan"],
    ["aratami notficarile", "/notifications"],
    ["hai pe masni", "/vehicles"],
    ["unde gasesc sculele", "/tools"],
    ["vreau pontaju meu", "/my-timesheets"],
  ])("ranks rough Romanian navigation by intent: %s", (command, path) => {
    expect(resolveAssistantNavigationAction(command, "angajat")?.path).toBe(path);
  });

  it("prefers an exact registered alias over a related workflow keyword", () => {
    expect(resolveAssistantNavigationAction("deschide piese", "manager")?.path).toBe(
      "/maintenance/orders"
    );
  });
});
