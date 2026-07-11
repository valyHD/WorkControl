import { describe, expect, it } from "vitest";
import type { AppUserItem } from "../../../types/user";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import {
  compactVehiclePlate,
  normalizeAssistantText,
  rankAssistantMatches,
} from "./assistantFuzzy";

describe("assistant fuzzy matching", () => {
  it("normalizes diacritics, casing and vehicle plates", () => {
    expect(normalizeAssistantText("  BOȘ Bosch  ")).toBe("bos bosch");
    expect(compactVehiclePlate("B 33 LGR")).toBe("B33LGR");
  });

  it("finds vehicles by partial registration and human description", () => {
    const vehicles = [
      { id: "logan", plateNumber: "B33LGR", brand: "Dacia", model: "Logan" },
      { id: "transit", plateNumber: "B04YRA", brand: "Ford", model: "Transit" },
    ] as VehicleItem[];

    const matches = rankAssistantMatches(
      vehicles,
      "duba cu 04",
      (vehicle) => `${vehicle.brand} ${vehicle.model} ${vehicle.plateNumber}`
    );

    expect(matches[0]?.item.id).toBe("transit");
  });

  it("tolerates common spelling differences for tools and user names", () => {
    const tools = [
      { id: "bosch", name: "Bosch GSB 18V", internalCode: "SC-01" },
      { id: "makita", name: "Makita DHP", internalCode: "SC-02" },
    ] as ToolItem[];
    const users = [
      { id: "razvan", fullName: "Răzvan Popescu", email: "razvan@example.test" },
      { id: "mihai", fullName: "Mihai Ionescu", email: "mihai@example.test" },
    ] as AppUserItem[];

    expect(rankAssistantMatches(tools, "Bosh", (tool) => tool.name)[0]?.item.id).toBe("bosch");
    expect(rankAssistantMatches(users, "Razvan", (user) => user.fullName)[0]?.item.id).toBe(
      "razvan"
    );
  });
});
