import { describe, expect, it } from "vitest";
import {
  buildLocalAssistantHelpContract,
  buildLocalNamedEntityUpdateContract,
  buildLocalNotificationSettingsContract,
  buildLocalPersonalSettingsContract,
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
    "la ce te pot folosi",
    "cum trebuie sa iti vorbesc",
    "da-mi niste exemple",
    "ajuta-ma cu comenzile",
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

describe("local named entity updates", () => {
  it.each([
    [
      "schimba functia lui Ionut in tehnician lifturi",
      "user",
      "ionut",
      "users.update",
      { roleTitle: "tehnician lifturi" },
    ],
    [
      "pune departamentul lui Mihai la interventii",
      "user",
      "mihai",
      "users.update",
      { department: "interventii" },
    ],
    [
      "schimba starea sculei Bosch in defecta",
      "tool",
      "bosch",
      "tools.update",
      { status: "defecta" },
    ],
    [
      "pune statusul proiectului Service Lifturi in finalizat",
      "project",
      "service lifturi",
      "timesheets.projects.update",
      { status: "finalizat" },
    ],
    [
      "schimba ITP-ul masinii Toyota pe 20 august 2026",
      "vehicle",
      "toyota",
      "vehicles.update",
      { nextItpDate: "20 august 2026" },
    ],
    [
      "schimba ITP la Toyota pe 20 august 2026",
      "vehicle",
      "toyota",
      "vehicles.update",
      { nextItpDate: "20 august 2026" },
    ],
    [
      "pune garantia la Bosch pe 1 decembrie 2026",
      "tool",
      "bosch",
      "tools.update",
      { warrantyUntil: "1 decembrie 2026" },
    ],
  ])("builds a controlled named update: %s", (command, type, query, toolId, fields) => {
    expect(buildLocalNamedEntityUpdateContract(command)).toMatchObject({
      commandType: "entity_update",
      entityReferences: [{ type, query }],
      toolCalls: [{ id: toolId, input: { entityQuery: query, fields } }],
      confirmationRequired: true,
      confidence: 0.97,
    });
  });

  it("does not guess a named entity when the value is missing", () => {
    expect(buildLocalNamedEntityUpdateContract("schimba functia lui Ionut")).toBeNull();
  });

  it("does not guess the entity type for an ambiguous field", () => {
    expect(buildLocalNamedEntityUpdateContract("schimba statusul la Bosch in defect")).toBeNull();
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
    ["deschide masina Toyota la tracker live", "toyota"],
    ["arata Toyota pe GPS", "toyota"],
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

  it.each([
    "Du-ma pe pagina masina mea si arata-mi cati kilometri curenti am",
    "arata-mi cati kilometri are masina mea",
    "intra la vehiculul meu si spune-mi kilometrajul",
    "du-ma la masina pe care o conduc si arata km curenti",
    "deschide masina asignata mie",
  ])("uses the authenticated user's vehicle without searching the fleet: %s", (command) => {
    expect(buildLocalVehicleTrackerContract(command)).toMatchObject({
      commandType: "navigation",
      intent: "open_my_vehicle",
      toolCalls: [{ id: "navigation.open", input: { path: "/my-vehicle", query: "" } }],
      targetPage: "/my-vehicle",
      entityReferences: [],
      confirmationRequired: false,
    });
  });

  it("keeps an explicitly named vehicle instead of treating it as the personal vehicle", () => {
    expect(
      buildLocalVehicleTrackerContract("du-ma la masina Toyota si arata-mi kilometrii curenti")
    ).toMatchObject({
      intent: "open_vehicle",
      toolCalls: [
        { id: "vehicles.open", input: { entityQuery: "toyota", destination: "details" } },
      ],
    });
  });
});

describe("local personal settings", () => {
  it.each([
    ["pune-mi functia electrician", { roleTitle: "electrician" }],
    [
      "vreau ca departamentul meu sa fie Service si Intretinere",
      { department: "service si intretinere" },
    ],
    ["schimba numele meu in Ionut Matura", { fullName: "ionut matura" }],
  ])("updates only the authenticated user's profile: %s", (command, fields) => {
    expect(buildLocalPersonalSettingsContract(command)).toMatchObject({
      commandType: "entity_update",
      intent: "update_user",
      toolCalls: [
        { id: "users.update", input: { entityQuery: "__current_user__", fields } },
      ],
      confirmationRequired: true,
      confidence: 0.98,
    });
  });

  it("does not steal a command that targets another user", () => {
    expect(buildLocalPersonalSettingsContract("schimba functia lui Razvan in sofer")).toBeNull();
  });
});

describe("local notification settings", () => {
  it.each([
    ["opreste regula Pontaj dimineata", "pontaj dimineata", { enabled: false }],
    [
      "da drumul la sunet pentru regula Pontaj start",
      "pontaj start",
      { soundEnabled: true },
    ],
    ["pune ora regulii Pontaj dimineata la 7", "pontaj dimineata", { scheduleTime: "7" }],
    [
      "schimba ora de oprire la regula Pontaj interval la 18 30",
      "pontaj interval",
      { stopTime: "18 30" },
    ],
    [
      "schimba intervalul regulii Pontaj start la 30 minute",
      "pontaj start",
      { reminderRepeatMinutes: 30 },
    ],
  ])("builds a controlled rule update: %s", (command, ruleQuery, fields) => {
    expect(buildLocalNotificationSettingsContract(command)).toMatchObject({
      commandType: "entity_update",
      intent: "update_notification_rule",
      toolCalls: [{ id: "notifications.rules.update", input: { ruleQuery, fields } }],
      confirmationRequired: true,
      confidence: 0.98,
    });
  });

  it("requires a named notification rule", () => {
    expect(buildLocalNotificationSettingsContract("opreste regula")).toBeNull();
  });
});
