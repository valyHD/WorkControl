import { describe, expect, it } from "vitest";
import { getVehicleIdFromAssistantPath } from "./assistantConversationMemory";

describe("assistant vehicle route context", () => {
  it.each([
    ["/vehicles/vehicle-1", "vehicle-1"],
    ["/vehicles/vehicle-1?view=my-vehicle", "vehicle-1"],
    ["/vehicles/vehicle-1?tab=gps#vehicle-tracker-live-section", "vehicle-1"],
    ["/vehicles/vehicle-1/edit?assistantField=currentKm", "vehicle-1"],
  ])("resolves the current vehicle from %s", (path, expected) => {
    expect(getVehicleIdFromAssistantPath(path)).toBe(expected);
  });
});
