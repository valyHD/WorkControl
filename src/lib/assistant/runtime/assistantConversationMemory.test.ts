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
});
