import { describe, expect, it } from "vitest";
import { buildLocalEntityReadContract } from "./assistantEntityReadCommand";

describe("assistant entity read commands", () => {
  it("reads the authenticated user's vehicle mileage", () => {
    const result = buildLocalEntityReadContract("spune-mi cati km am la masina mea");

    expect(result).toMatchObject({
      commandType: "question",
      intent: "read_entity",
      entityReferences: [{ type: "vehicle", query: "__current_vehicle__" }],
      toolCalls: [
        {
          id: "entities.read",
          input: { entityQuery: "__current_vehicle__", fields: { currentKm: true } },
        },
      ],
    });
  });

  it("can navigate to my vehicle and answer in the same controlled plan", () => {
    const result = buildLocalEntityReadContract(
      "Du-ma pe pagina masina mea si arata-mi cati kilometri curenti am"
    );

    expect(result?.toolCalls).toEqual([
      { id: "navigation.open", input: { path: "/my-vehicle", query: "" } },
      {
        id: "entities.read",
        input: { entityQuery: "__current_vehicle__", fields: { currentKm: true } },
      },
    ]);
  });

  it("reads multiple fields for a named vehicle", () => {
    const result = buildLocalEntityReadContract("cine conduce Toyota si cati km are?");

    expect(result?.entityReferences[0]).toMatchObject({ type: "vehicle", query: "toyota" });
    expect(result?.toolCalls[0]).toMatchObject({
      id: "entities.read",
      input: { fields: { driver: true, currentKm: true } },
    });
  });

  it("understands colloquial location questions for tools", () => {
    const result = buildLocalEntityReadContract("unde e scula Bosch?");

    expect(result?.entityReferences[0]).toMatchObject({ type: "tool", query: "bosch" });
    expect(result?.toolCalls[0]).toMatchObject({
      id: "entities.read",
      input: { fields: { locationLabel: true } },
    });
  });

  it("reads a user's role title", () => {
    const result = buildLocalEntityReadContract("ce functie are Mihai?");

    expect(result?.entityReferences[0]).toMatchObject({ type: "user", query: "mihai" });
    expect(result?.toolCalls[0]).toMatchObject({
      id: "entities.read",
      input: { fields: { roleTitle: true } },
    });
  });

  it("uses the entity selected by the current page for pronoun questions", () => {
    const result = buildLocalEntityReadContract("ce status are?", {
      selectedEntity: { type: "project", id: "p1", label: "Service 2" },
    });

    expect(result?.entityReferences[0]).toMatchObject({ type: "project", query: "" });
    expect(result?.toolCalls[0]).toMatchObject({
      id: "entities.read",
      input: { fields: { status: true } },
    });
  });

  it("never turns mutation commands into reads", () => {
    expect(buildLocalEntityReadContract("schimba kilometrii masinii la 7200")).toBeNull();
  });
});
