import { describe, expect, it } from "vitest";
import { buildLocalMaintenanceReportContract } from "./assistantMaintenanceReportCommand";

function reportFields(command: string) {
  const contract = buildLocalMaintenanceReportContract(command);
  const fields = contract?.toolCalls[0]?.input.fields;
  return {
    contract,
    fields: fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {},
  };
}

describe("local maintenance report command contract", () => {
  it("requires confirmation before generating and sending a revision report", () => {
    const { contract, fields } = reportFields("Genereaza raport revizie pentru clientul Isomat");

    expect(contract).toMatchObject({
      commandType: "form_fill",
      intent: "open_maintenance_report",
      confirmationRequired: true,
      confidence: 0.98,
      toolCalls: [{ id: "maintenance.report.send" }],
    });
    expect(fields).toEqual({
      clientQuery: "Isomat",
      reportType: "revizie",
      observations: "",
      submitMode: "send",
      waitForPhotos: false,
    });
  });

  it("keeps the exact client from a short revision report command", () => {
    const { fields } = reportFields("Genereaza raport revizie pentru Vali");

    expect(fields).toMatchObject({ clientQuery: "Vali", reportType: "revizie" });
  });

  it("accepts the client directly after the report type", () => {
    const { fields } = reportFields("Genereaza raport revizie Vali");

    expect(fields).toMatchObject({ clientQuery: "Vali", reportType: "revizie" });
  });

  it("prefills an intervention report and waits for photos without sending", () => {
    const { contract, fields } = reportFields(
      "Genereaza raport interventie pentru clientu Vali cu observatia usa nu se inchide si asteapta sa atasez pozele"
    );

    expect(contract).toMatchObject({
      confirmationRequired: false,
      toolCalls: [{ id: "maintenance.report.prepare" }],
    });
    expect(fields).toEqual({
      clientQuery: "Vali",
      reportType: "interventie",
      observations: "usa nu se inchide",
      submitMode: "prepare",
      waitForPhotos: true,
    });
  });

  it("keeps explicit draft preparation separate from sending", () => {
    const { contract, fields } = reportFields("Pregateste raport de revizie pentru Vali");

    expect(contract).toMatchObject({
      confirmationRequired: false,
      toolCalls: [{ id: "maintenance.report.prepare" }],
    });
    expect(fields).toMatchObject({ clientQuery: "Vali", submitMode: "prepare" });
  });

  it("uses a lift number as the client lookup query", () => {
    const { fields } = reportFields("Pregateste raport de interventie pentru liftul 210869");

    expect(fields).toMatchObject({ clientQuery: "210869", reportType: "interventie" });
  });

  it("asks for the client instead of guessing", () => {
    const contract = buildLocalMaintenanceReportContract("Genereaza raportul de revizie");

    expect(contract).toMatchObject({
      toolCalls: [],
      confidence: 0.5,
      confirmationRequired: false,
      missingInformation: ["clientul de mentenanta"],
    });
  });

  it("keeps only the spoken technician observation when the selected client is in page context", () => {
    const contract = buildLocalMaintenanceReportContract(
      "Fa raport interventie cu observatia liftul functioneaza normal",
      {
        route: "/maintenance?tab=report",
        page: "maintenance",
        selectedEntity: { type: "maintenanceClient", id: "client-vali", label: "Vali" },
        openForm: null,
        availableActions: [],
        allowedFields: [],
        role: "admin",
        memory: {},
      }
    );
    const fields = contract?.toolCalls[0]?.input.fields;

    expect(fields).toMatchObject({
      clientQuery: "Vali",
      reportType: "interventie",
      observations: "liftul functioneaza normal",
      submitMode: "send",
    });
  });

  it("accepts common Romanian observation markers without copying the command", () => {
    const { fields } = reportFields(
      "Genereaza raport interventie pentru Vali cu observatii: usa functioneaza normal"
    );

    expect(fields).toMatchObject({ observations: "usa functioneaza normal" });
  });

  it("separates the client from a natural observation instruction", () => {
    const { fields } = reportFields(
      "Generează un raport de intervenție pentru Vali iar la observații trece așa liftul funcționează normal"
    );

    expect(fields).toMatchObject({
      clientQuery: "Vali",
      reportType: "interventie",
      observations: "liftul funcționează normal",
    });
  });

  it.each([
    "pune liftul functioneaza normal",
    "scrie ca liftul functioneaza normal",
    "noteaza asa liftul functioneaza normal",
  ])("removes the observation instruction from the saved value: %s", (instruction) => {
    const { fields } = reportFields(
      `Genereaza raport interventie pentru Vali la rubrica observatii ${instruction}`
    );

    expect(fields).toMatchObject({
      clientQuery: "Vali",
      observations: "liftul functioneaza normal",
    });
  });

  it("does not intercept unrelated navigation commands", () => {
    expect(buildLocalMaintenanceReportContract("Deschide pagina mentenanta")).toBeNull();
  });
});
