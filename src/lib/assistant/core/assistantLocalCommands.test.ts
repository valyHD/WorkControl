import { describe, expect, it } from "vitest";
import {
  buildLocalAssistantHelpContract,
  buildLocalVehicleMileageContract,
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

describe("local vehicle mileage commands", () => {
  it.each([
    ["modifica kilometri curenti la 7200", "", 7200],
    ["schimba kilometrii Loganului la 6200", "logan", 6200],
    ["la Toyota pune km 7.200", "toyota", 7200],
    ["seteaza kilometrajul la sase mii doua sute", "", 6200],
  ])("builds a controlled mileage update: %s", (command, query, value) => {
    expect(buildLocalVehicleMileageContract(command)).toMatchObject({
      commandType: "entity_update",
      intent: "update_vehicle",
      toolCalls: [
        { id: "vehicles.update", input: { entityQuery: query, fields: { currentKm: value } } },
      ],
      confirmationRequired: true,
      confidence: 0.99,
    });
  });

  it("does not turn a mileage question into an update", () => {
    expect(buildLocalVehicleMileageContract("arata-mi kilometrii masinii")).toBeNull();
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
      toolCalls: [{ id: "vehicles.open", input: { entityQuery: query, destination: "tracker" } }],
      entityReferences: [{ type: "vehicle", query }],
      confirmationRequired: false,
    });
  });

  it.each([
    ["Du-ma pe pagina masinii Toyota", "toyota"],
    ["deschide masina Toyota Corolla", "toyota corolla"],
    ["intra la detaliile vehiculului IF 82 GDY", "if 82 gdy"],
    ["arata-mi pagina Toyotei", "toyota"],
  ])("builds a controlled vehicle details command: %s", (command, query) => {
    expect(buildLocalVehicleTrackerContract(command)).toMatchObject({
      commandType: "navigation",
      intent: "open_vehicle",
      toolCalls: [{ id: "vehicles.open", input: { entityQuery: query, destination: "details" } }],
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
