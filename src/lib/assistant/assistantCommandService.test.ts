import { describe, expect, it, vi } from "vitest";
import { interpretAssistantCommand } from "./assistantCommandService";

const mocks = vi.hoisted(() => ({ callable: vi.fn() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => mocks.callable),
}));

vi.mock("../firebase/firebase", () => ({ functions: {} }));

describe("assistant command service local routing", () => {
  it("answers help requests locally without calling the cloud interpreter", async () => {
    const result = await interpretAssistantCommand("ce sti sa faci");

    expect(result).toMatchObject({ intent: "assistant_help", commandType: "question" });
    expect(result?.response).toContain("GPS-ul Toyota");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("deduplicates speech and keeps Vali as the report client", async () => {
    const result = await interpretAssistantCommand(
      "genereaza raport revizie pentru Vali genereaza raport revizie pentru Vali"
    );

    expect(result).toMatchObject({
      intent: "open_maintenance_report",
      entityQuery: "Vali",
      reportType: "revizie",
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("routes a Toyota GPS command to the controlled vehicle tool", async () => {
    const result = await interpretAssistantCommand("Du-ma pe gps-ul Toyota");

    expect(result).toMatchObject({
      intent: "open_vehicle_tracker",
      entityQuery: "toyota",
      toolCalls: [
        { id: "vehicles.open", input: { entityQuery: "toyota", destination: "tracker" } },
      ],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("routes a Toyota vehicle page command without the cloud interpreter", async () => {
    const result = await interpretAssistantCommand("Du mă pe pagina mașinii Toyota");

    expect(result).toMatchObject({
      intent: "open_vehicle",
      entityQuery: "toyota",
      toolCalls: [
        { id: "vehicles.open", input: { entityQuery: "toyota", destination: "details" } },
      ],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });
});
