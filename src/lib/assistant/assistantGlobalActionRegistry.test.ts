import { describe, expect, it } from "vitest";
import {
  getAssistantGlobalActions,
  getAssistantGlobalNavigationActions,
  getAssistantGlobalPageActions,
} from "./assistantGlobalActionRegistry";

describe("assistant global action registry", () => {
  it("serves navigation and declared page actions through one facade", () => {
    const actions = getAssistantGlobalActions({ pathname: "/maintenance", role: "admin" });

    expect(actions.some((action) => action.kind === "navigation")).toBe(true);
    expect(actions.some((action) => action.kind === "page")).toBe(true);
    expect(getAssistantGlobalNavigationActions("admin").length).toBeGreaterThan(0);
    expect(getAssistantGlobalPageActions("/maintenance").length).toBeGreaterThan(0);
  });

  it("keeps role filtering on global navigation actions", () => {
    const employeeIds = new Set(
      getAssistantGlobalNavigationActions("angajat").map((action) => action.id)
    );
    const adminIds = new Set(
      getAssistantGlobalNavigationActions("admin").map((action) => action.id)
    );

    expect(adminIds.size).toBeGreaterThanOrEqual(employeeIds.size);
  });
});
