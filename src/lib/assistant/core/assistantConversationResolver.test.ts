import { describe, expect, it } from "vitest";
import { buildLocalRepeatedActionContract } from "./assistantConversationResolver";

describe("assistant conversational action resolver", () => {
  it("repeats a completed controlled update for a newly named vehicle", () => {
    const result = buildLocalRepeatedActionContract("fa la fel si pentru Logan", {
      memory: {
        lastCompletedAction: {
          command: "schimba kilometrii Toyotei la 7200",
          commandType: "entity_update",
          intent: "update_vehicle",
          toolId: "vehicles.update",
          entityType: "vehicle",
          entityQuery: "Toyota",
          fields: { currentKm: 7200 },
          targetPage: "/vehicles",
        },
      },
    });

    expect(result).toMatchObject({
      commandType: "entity_update",
      intent: "update_vehicle",
      entityReferences: [{ type: "vehicle", query: "logan" }],
      toolCalls: [
        {
          id: "vehicles.update",
          input: { entityQuery: "logan", fields: { currentKm: 7200 } },
        },
      ],
      confirmationRequired: true,
    });
  });

  it("reuses report details but replaces the maintenance client", () => {
    const result = buildLocalRepeatedActionContract("tot asa pentru Oltenita C2", {
      memory: {
        lastCompletedAction: {
          command: "trimite raport revizie pentru Oltenita C1",
          commandType: "form_fill",
          intent: "open_maintenance_report",
          toolId: "maintenance.report.send",
          entityType: "maintenanceClient",
          entityQuery: "Oltenita C1",
          fields: { clientQuery: "Oltenita C1", reportType: "revizie", observations: "" },
          targetPage: "/maintenance?tab=report",
        },
      },
    });

    expect(result).toMatchObject({
      toolCalls: [
        {
          id: "maintenance.report.send",
          input: {
            fields: {
              clientQuery: "oltenita c2",
              reportType: "revizie",
              observations: "",
            },
          },
        },
      ],
      confirmationRequired: true,
    });
  });

  it("never repeats start, stop, create or delete actions", () => {
    expect(
      buildLocalRepeatedActionContract("fa la fel si pentru Hotel Balada", {
        memory: {
          lastCompletedAction: {
            command: "porneste pontajul pe Service",
            commandType: "timesheet_action",
            intent: "start_timesheet",
            toolId: "timesheets.start",
            entityType: "project",
            entityQuery: "Service",
            fields: { projectQuery: "Service" },
            targetPage: "/my-timesheet",
          },
        },
      })
    ).toBeNull();
  });

  it("asks for a real target instead of guessing a pronoun", () => {
    expect(
      buildLocalRepeatedActionContract("fa la fel si pentru asta", {
        memory: {
          lastCompletedAction: {
            command: "schimba statusul Bosch in defecta",
            commandType: "entity_update",
            intent: "update_tool",
            toolId: "tools.update",
            entityType: "tool",
            entityQuery: "Bosch",
            fields: { status: "defecta" },
            targetPage: "/tools",
          },
        },
      })
    ).toBeNull();
  });
});
