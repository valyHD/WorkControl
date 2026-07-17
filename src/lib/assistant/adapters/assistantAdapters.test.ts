import { describe, expect, it } from "vitest";
import { getAssistantV3ToolRegistry } from "./assistantAdapters";

describe("Assistant V3 tool registry", () => {
  it("uses one initialized registry for the production runtime", () => {
    const first = getAssistantV3ToolRegistry();
    const second = getAssistantV3ToolRegistry();

    expect(second).toBe(first);
    expect(first.list().length).toBeGreaterThan(0);
    expect(new Set(first.list().map((tool) => tool.id)).size).toBe(first.list().length);
    expect(first.get("vehicles.open")).not.toBeNull();
    expect(first.get("vehicles.openTracker")).not.toBeNull();
  });
});
