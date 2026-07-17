import { describe, expect, it } from "vitest";
import { resolveAssistantField, resolveAssistantFieldChanges } from "./assistantFieldResolver";
import type { AssistantRuntimeEntityType } from "./assistantTypes";

describe("assistant field resolver", () => {
  it.each(["kilometri", "km", "kilometraj"])("maps %s to currentKm", (alias) => {
    expect(resolveAssistantField("vehicle", alias)?.key).toBe("currentKm");
  });

  it.each([
    ["vehicle", "cati km", "currentKm"],
    ["vehicle", "bord", "currentKm"],
    ["vehicle", "cine conduce", "driver"],
    ["vehicle", "cine raspunde", "owner"],
    ["tool", "cine o are", "holder"],
    ["user", "ce lucreaza", "roleTitle"],
    ["user", "unde lucreaza", "department"],
    ["vehicle", "odometru", "currentKm"],
    ["vehicle", "inspectie tehnica", "nextItpDate"],
    ["vehicle", "cine merge cu ea", "driver"],
    ["tool", "unde se afla", "locationLabel"],
    ["tool", "cine tine scula", "holder"],
    ["user", "ce meserie are", "roleTitle"],
    ["user", "in ce echipa", "department"],
  ])("maps rough field wording for %s: %s", (entityType, alias, expected) => {
    expect(resolveAssistantField(entityType as AssistantRuntimeEntityType, alias)?.key).toBe(
      expected
    );
  });

  it("normalizes plate updates without spaces", () => {
    const result = resolveAssistantFieldChanges(
      "vehicle",
      { "numar inmatriculare": "B 33 LGR" },
      { plateNumber: "B01AAA" }
    );

    expect(result.missingFields).toEqual([]);
    expect(result.changes[0]).toMatchObject({
      fieldKey: "plateNumber",
      newValue: "B33LGR",
    });
  });
});
