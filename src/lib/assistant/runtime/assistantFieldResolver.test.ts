import { describe, expect, it } from "vitest";
import { resolveAssistantField, resolveAssistantFieldChanges } from "./assistantFieldResolver";

describe("assistant field resolver", () => {
  it.each(["kilometri", "km", "kilometraj"])("maps %s to currentKm", (alias) => {
    expect(resolveAssistantField("vehicle", alias)?.key).toBe("currentKm");
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
