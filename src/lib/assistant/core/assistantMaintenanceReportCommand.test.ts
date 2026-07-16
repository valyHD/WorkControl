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
    const { contract, fields } = reportFields(
      "Genereaza raport revizie pentru clientul Isomat si trimite-l"
    );

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

  it("prefills an intervention report and waits for photos without sending", () => {
    const { contract, fields } = reportFields(
      "Genereaza raport interventie pentru clientu Vali cu observatia usa nu se inchide si asteapta sa atasez pozele"
    );

    expect(contract).toMatchObject({
      confirmationRequired: true,
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

  it("does not intercept unrelated navigation commands", () => {
    expect(buildLocalMaintenanceReportContract("Deschide pagina mentenanta")).toBeNull();
  });
});
