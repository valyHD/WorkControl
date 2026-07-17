import { describe, expect, it } from "vitest";
import type { MaintenanceClient } from "../../../types/maintenance";
import {
  findMaintenanceClientsForAssistant,
  isExactMaintenanceClientAssistantMatch,
  normalizeMaintenanceAssistantText,
  tokenizeMaintenanceAssistantText,
} from "./maintenanceClientAssistantMatcher";

function client(id: string, name: string, address = "Oltenita"): MaintenanceClient {
  return {
    id,
    name,
    email: "",
    emails: [],
    address,
    liftNumber: "",
    liftNumbers: [],
    expiryDate: "",
    maintenanceCompany: "",
    contactPerson: "",
    contactPhone: "",
    createdAt: 0,
    updatedAt: 0,
    addresses: [],
  };
}

describe("maintenance client assistant matcher", () => {
  const clients = [
    client("c1", "Asociatia de proprietari Oltenita C1"),
    client("c2", "Asociatia de proprietari Oltenita C2"),
    client("central", "Asociatia Centrala Bucuresti", "Bucuresti"),
  ];

  it.each([
    ["Oltenita bloc C unu", "oltenita c1"],
    ["blocul ce doi de la Oltenita", "c2 de la oltenita"],
  ])("normalizes spoken block identifiers: %s", (query, expected) => {
    expect(normalizeMaintenanceAssistantText(query)).toBe(expected);
  });

  it("ignores natural descriptors and prepositions while matching", () => {
    expect(tokenizeMaintenanceAssistantText("blocul C unu de la Oltenita")).toEqual([
      "c1",
      "oltenita",
    ]);
    expect(findMaintenanceClientsForAssistant(clients, "blocul C unu de la Oltenita")).toEqual([
      clients[0],
    ]);
    expect(isExactMaintenanceClientAssistantMatch(clients[0], "blocul C unu de la Oltenita")).toBe(
      true
    );
  });

  it("finds a typo but does not approve an automatic send as exact", () => {
    expect(findMaintenanceClientsForAssistant(clients, "oltenitza c1")).toEqual([clients[0]]);
    expect(isExactMaintenanceClientAssistantMatch(clients[0], "oltenitza c1")).toBe(false);
  });

  it("keeps two matching blocks ambiguous when the block number is omitted", () => {
    expect(findMaintenanceClientsForAssistant(clients, "Oltenita")).toEqual([
      clients[0],
      clients[1],
    ]);
  });
});
