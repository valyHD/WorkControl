import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  interpretAssistantCommand,
  type AssistantCommandContext,
} from "./assistantCommandService";

const mocks = vi.hoisted(() => ({ callable: vi.fn() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => mocks.callable),
}));

vi.mock("../firebase/firebase", () => ({ functions: {} }));

describe("assistant command service local routing", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
  });

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

  it("routes a current vehicle mileage update locally without OpenAI", async () => {
    const result = await interpretAssistantCommand("modifică kilometri curenți la 7200");

    expect(result).toMatchObject({
      commandType: "entity_update",
      intent: "update_vehicle",
      entityType: "vehicle",
      entityQuery: "",
      fieldsToUpdate: { currentKm: 7200 },
      toolCalls: [
        { id: "vehicles.update", input: { entityQuery: "", fields: { currentKm: 7200 } } },
      ],
      confirmationRequired: true,
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it.each([
    ["duma la concedii", "open_leave", "/my-leave"],
    ["du-te la dashboard", "open_dashboard", "/dashboard"],
    ["vreau la bonuri", "open_expense_scan", "/expenses/scan"],
    ["hai sa merg la scule", "open_page", "/tools"],
    ["ia vezi pe proiecte", "open_page", "/projects"],
    ["uita-te la notificari", "open_page", "/notifications"],
    ["vreau sa vad masinile", "open_page", "/vehicles"],
    ["aratami notificarile", "open_page", "/notifications"],
  ])("routes colloquial page navigation locally: %s", async (command, intent, path) => {
    const result = await interpretAssistantCommand(command);

    expect(result).toMatchObject({
      commandType: "navigation",
      intent,
      toolCalls: [{ id: "navigation.open", input: { path, query: "" } }],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("answers an informal help request without requiring exact wording", async () => {
    const result = await interpretAssistantCommand("zi-mi ce poti face");

    expect(result).toMatchObject({ intent: "assistant_help", commandType: "question" });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("does not turn a navigation request into a timesheet start", async () => {
    const result = await interpretAssistantCommand("duma la pontajul meu");

    expect(result).toMatchObject({
      commandType: "navigation",
      intent: "open_my_timesheets",
      toolCalls: [{ id: "navigation.open" }],
    });
    expect(result?.toolCalls).not.toContainEqual(expect.objectContaining({ id: "timesheets.start" }));
  });

  it("understands a colloquial timesheet start and keeps confirmation", async () => {
    const result = await interpretAssistantCommand(
      "da-i drumu la pontaju pe proiectu Service si Mentenanta"
    );

    expect(result).toMatchObject({
      commandType: "timesheet_action",
      intent: "start_timesheet",
      entityQuery: "service si mentenanta",
      confirmationRequired: true,
      toolCalls: [
        {
          id: "timesheets.start",
          input: {
            projectId: "",
            projectQuery: "service si mentenanta",
            createProjectIfMissing: false,
          },
        },
      ],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("understands create project plus start as one controlled plan", async () => {
    const result = await interpretAssistantCommand("fa proiect Service 2 si baga pontaju");

    expect(result).toMatchObject({
      intent: "start_timesheet",
      entityQuery: "service 2",
      confirmationRequired: true,
      toolCalls: [
        {
          id: "timesheets.start",
          input: { projectQuery: "service 2", createProjectIfMissing: true },
        },
      ],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("asks for a project instead of guessing when colloquial start lacks context", async () => {
    const result = await interpretAssistantCommand("baga pontaju");

    expect(result).toMatchObject({
      intent: "start_timesheet",
      confidence: 0.6,
      missingInformation: ["proiectul pentru pontaj"],
      toolCalls: [],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("understands colloquial stop without a cloud call", async () => {
    const result = await interpretAssistantCommand("gata pe azi");

    expect(result).toMatchObject({
      intent: "stop_timesheet",
      confirmationRequired: true,
      toolCalls: [{ id: "timesheets.stop", input: { explanation: "" } }],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it.each([
    ["ponteaza-ma pe Hotel Balada", "hotel balada"],
    ["incep munca pe Service Lifturi", "service lifturi"],
  ])("understands a rough timesheet start: %s", async (command, projectQuery) => {
    const result = await interpretAssistantCommand(command);

    expect(result).toMatchObject({
      intent: "start_timesheet",
      entityQuery: projectQuery,
      confirmationRequired: true,
      toolCalls: [{ id: "timesheets.start", input: { projectQuery } }],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it.each(["am plecat", "am terminat pe azi", "inchide ziua"])(
    "understands a rough timesheet stop: %s",
    async (command) => {
      const result = await interpretAssistantCommand(command);
      expect(result).toMatchObject({
        intent: "stop_timesheet",
        confirmationRequired: true,
        toolCalls: [{ id: "timesheets.stop" }],
      });
      expect(mocks.callable).not.toHaveBeenCalled();
    }
  );

  it("updates a field on the vehicle already selected in page context", async () => {
    const result = await interpretAssistantCommand("schimba data ITP in 20 august 2026", {
      selectedEntity: { type: "vehicle", id: "vehicle-1", label: "B092194 Dacia Logan" },
    });

    expect(result).toMatchObject({
      commandType: "entity_update",
      intent: "update_vehicle",
      entityQuery: "B092194 Dacia Logan",
      fieldsToUpdate: { nextItpDate: "20 august 2026" },
      confirmationRequired: true,
      toolCalls: [
        {
          id: "vehicles.update",
          input: {
            entityQuery: "B092194 Dacia Logan",
            fields: { nextItpDate: "20 august 2026" },
          },
        },
      ],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("updates a short field phrase on the user already selected", async () => {
    const result = await interpretAssistantCommand("pune departamentul interventii", {
      selectedEntity: { type: "user", id: "user-1", label: "Mihai Popescu" },
    });

    expect(result).toMatchObject({
      intent: "update_user",
      entityQuery: "Mihai Popescu",
      fieldsToUpdate: { department: "interventii" },
      confirmationRequired: true,
      toolCalls: [{ id: "users.update" }],
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it.each([
    [
      "itp 20 august 2026",
      { type: "vehicle", id: "vehicle-1", label: "B092194 Dacia Logan" },
      "vehicles.update",
      { nextItpDate: "20 august 2026" },
    ],
    [
      "departament interventii",
      { type: "user", id: "user-1", label: "Mihai Popescu" },
      "users.update",
      { department: "interventii" },
    ],
    [
      "stare defecta",
      { type: "tool", id: "tool-1", label: "Flex Bosch F12" },
      "tools.update",
      { status: "defecta" },
    ],
  ])(
    "uses the selected page entity when the user only says field and value: %s",
    async (command, selectedEntity, toolId, fields) => {
      const result = await interpretAssistantCommand(command, {
        selectedEntity: selectedEntity as AssistantCommandContext["selectedEntity"],
      });

      expect(result).toMatchObject({
        confirmationRequired: true,
        fieldsToUpdate: fields,
        toolCalls: [{ id: toolId, input: { fields } }],
      });
      expect(mocks.callable).not.toHaveBeenCalled();
    }
  );

  it("removes a repeated speech prefix before routing a report", async () => {
    const result = await interpretAssistantCommand(
      "genereaza raport genereaza raport interventie pentru Vali"
    );

    expect(result).toMatchObject({
      intent: "open_maintenance_report",
      entityQuery: "Vali",
      reportType: "interventie",
    });
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("resolves a named-user update instead of applying it to the user currently open", async () => {
    const result = await interpretAssistantCommand("schimba rolul lui Razvan in manager", {
      selectedEntity: { type: "user", id: "user-1", label: "Mihai Popescu" },
    });

    expect(mocks.callable).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      entityReferences: [{ type: "user", query: "razvan" }],
      toolCalls: [
        {
          id: "users.update",
          input: { entityQuery: "razvan", fields: { role: "manager" } },
        },
      ],
      confirmationRequired: true,
    });
  });

  it("sends both original and canonical command to the cloud fallback", async () => {
    mocks.callable.mockResolvedValue({
      data: {
        version: "3",
        commandType: "unknown",
        intent: "unknown",
        toolCalls: [],
        targetPage: "",
        entityReferences: [],
        missingInformation: ["intent"],
        confidence: 0.2,
        confirmationRequired: false,
        response: "Am nevoie de mai multe detalii.",
      },
    });

    await interpretAssistantCommand("fami ceva cu asta");

    expect(mocks.callable).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "fa-mi ceva cu asta",
        originalCommand: "fami ceva cu asta",
      })
    );
  });
});
