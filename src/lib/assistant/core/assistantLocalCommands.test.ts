import { describe, expect, it } from "vitest";
import {
  buildLocalAssistantHelpContract,
  buildLocalVehicleTrackerContract,
} from "./assistantLocalCommands";

describe("local assistant help commands", () => {
  it.each([
    "fa-mi o lista cu ce comenzi pot sa-ti dau",
    "ce comenzi pot sa iti dau",
    "ce comenzi sti sa faci",
    "ce sti sa faci",
    "ce poti sa faci",
    "ce comezni cunosti",
    "cu ce ma poti ajuta",
    "spune-mi ce comenzi pot folosi",
    "ce fel de comenzi executi",
    "care sunt capabilitatile tale",
  ])("answers capability request: %s", (command) => {
    const contract = buildLocalAssistantHelpContract(command);

    expect(contract).toMatchObject({
      commandType: "question",
      intent: "assistant_help",
      toolCalls: [],
      confirmationRequired: false,
      confidence: 0.99,
    });
    expect(contract?.response).toContain("genereaza raport revizie pentru Vali");
    expect(contract?.response).toContain("GPS-ul Toyota");
  });
});

describe("local vehicle tracker commands", () => {
  it.each([
    ["Du-ma pe gps-ul toyota", "toyota"],
    ["deschide trackerul pentru B 33 LGR", "b 33 lgr"],
    ["arata-mi GPS-ul lui Dacia Spring", "dacia spring"],
    ["du-ma la GPS-ul Toyotei", "toyota"],
    ["GPS Fordului", "ford"],
    ["du-ma pe harta masinii Toyota", "toyota"],
    ["du-ma la gps-ul dubei cu 04 in numarul de inmatriculare", "04"],
  ])("builds a controlled tracker command: %s", (command, query) => {
    expect(buildLocalVehicleTrackerContract(command)).toMatchObject({
      commandType: "navigation",
      intent: "open_vehicle_tracker",
      toolCalls: [{ id: "vehicles.openTracker", input: { entityQuery: query } }],
      entityReferences: [{ type: "vehicle", query }],
      confirmationRequired: false,
    });
  });

  it("opens the fleet map for all GPS units", () => {
    expect(buildLocalVehicleTrackerContract("arata-mi toate gpsurile")).toMatchObject({
      intent: "open_gps_maps",
      targetPage: "/vehicles/gps-map",
    });
  });

  it("opens the personal vehicle for my GPS", () => {
    expect(buildLocalVehicleTrackerContract("du-ma la gps-ul meu")).toMatchObject({
      intent: "open_my_vehicle",
      targetPage: "/my-vehicle",
    });
  });
});
