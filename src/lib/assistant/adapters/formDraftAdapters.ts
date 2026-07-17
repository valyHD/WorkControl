import {
  ASSISTANT_FILL_LEAVE_EVENT,
  ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT,
  ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
  ASSISTANT_FILL_PROJECT_FORM_EVENT,
  ASSISTANT_FILL_TOOL_FORM_EVENT,
  ASSISTANT_FILL_USER_FORM_EVENT,
  ASSISTANT_FILL_VEHICLE_FORM_EVENT,
  ASSISTANT_FILL_EXPENSE_FORM_EVENT,
} from "../runtime/assistantFormFill";
import { formatAssistantReportObservation } from "../core/assistantReportText";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  authenticatedPermission,
  type AssistantToolDefinition,
  type AssistantToolModule,
} from "../tools/assistantToolRegistry";

export const ASSISTANT_FILL_EXPENSE_EVENT = ASSISTANT_FILL_EXPENSE_FORM_EVENT;

type DraftInput = { fields: Record<string, unknown> };

type MaintenanceReportDraftFields = {
  clientQuery: string;
  reportType: "revizie" | "interventie";
  observations: string;
  submitMode: "prepare" | "send";
  waitForPhotos: boolean;
};

type MaintenanceReportDraftInput = { fields: MaintenanceReportDraftFields };

function readDraftInput(value: unknown): DraftInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields =
    input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? (input.fields as Record<string, unknown>)
      : {};
  return { fields };
}

export function createFormDraftTool(params: {
  id: string;
  aliases: readonly string[];
  description: string;
  module: AssistantToolModule;
  eventName: string;
  knownFields: readonly string[];
}): AssistantToolDefinition<unknown, DraftInput> {
  const definition: AssistantToolDefinition<unknown, DraftInput> = {
    id: params.id,
    description: params.description,
    aliases: params.aliases,
    module: params.module,
    inputSchema: {
      type: "object",
      properties: { fields: { type: "object" } },
      required: ["fields"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: authenticatedPermission,
    resolve: readDraftInput,
    validate: (input, context) => {
      const fieldNames = Object.keys(input.fields);
      if (fieldNames.length === 0)
        return {
          ok: false,
          reason: "Lipsesc campurile formularului.",
          missingInformation: ["fields"],
        };
      const allowedByAdapter = fieldNames.filter((field) => !params.knownFields.includes(field));
      if (allowedByAdapter.length > 0)
        return { ok: false, reason: `Campuri nepermise: ${allowedByAdapter.join(", ")}.` };
      if (context.pageContext.allowedFields.length > 0) {
        const unavailable = fieldNames.filter(
          (field) => !context.pageContext.allowedFields.includes(field)
        );
        if (unavailable.length > 0)
          return {
            ok: false,
            reason: `Campuri indisponibile pe pagina curenta: ${unavailable.join(", ")}.`,
          };
      }
      return { ok: true };
    },
    preview: (input) =>
      `Pregatesc draftul cu ${Object.keys(input.fields).join(", ")}. Nu il salvez automat.`,
    execute: async (input, context) => {
      const dispatched = await context.runtime.dispatchFormDraft(params.eventName, input.fields);
      if (!dispatched) throw new Error("Formularul nu este disponibil pentru draft.");
      return {
        message: "Am trimis datele catre formular. Verifica draftul inainte de salvare.",
        afterData: input.fields,
      };
    },
    audit: (input, outcome, context) => auditAssistantTool(definition, input, outcome, context),
  };
  return definition;
}

export function createMaintenanceDraftTool() {
  return createFormDraftTool({
    id: "maintenance.draft",
    aliases: ["create_maintenance_client", "fill_maintenance_client_form"],
    description:
      "Trimite un draft validat formularului de client mentenanta, fara salvare automata.",
    module: "maintenance",
    eventName: ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT,
    knownFields: [
      "name",
      "email",
      "maintenanceCompany",
      "address",
      "city",
      "street",
      "contactPerson",
      "contactPhone",
      "liftNumbers",
      "expiryDate",
      "revisionType",
    ],
  });
}

function readMaintenanceReportDraftInput(value: unknown): MaintenanceReportDraftInput {
  const draft = readDraftInput(value).fields;
  return {
    fields: {
      clientQuery: String(draft.clientQuery || "")
        .replace(/\s+/g, " ")
        .trim(),
      reportType: draft.reportType === "interventie" ? "interventie" : "revizie",
      observations: formatAssistantReportObservation(String(draft.observations || "")),
      submitMode: draft.submitMode === "send" ? "send" : "prepare",
      waitForPhotos: draft.waitForPhotos === true,
    },
  };
}

function createMaintenanceReportTool(mode: "prepare" | "send") {
  const definition: AssistantToolDefinition<unknown, MaintenanceReportDraftInput> = {
    id: `maintenance.report.${mode}`,
    aliases:
      mode === "send" ? ["generate_and_send_maintenance_report"] : ["prepare_maintenance_report"],
    description:
      mode === "send"
        ? "Completeaza raportul de mentenanta si il trimite numai dupa confirmare explicita."
        : "Deschide si completeaza controlat raportul de mentenanta, fara trimitere.",
    module: "maintenance",
    inputSchema: {
      type: "object",
      properties: { fields: { type: "object" } },
      required: ["fields"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: mode === "send" ? "high" : "low",
    permission: authenticatedPermission,
    resolve: readMaintenanceReportDraftInput,
    validate: (input) => {
      if (!input.fields.clientQuery) {
        return {
          ok: false,
          reason: "Lipseste clientul raportului.",
          missingInformation: ["clientul de mentenanta"],
        };
      }
      if (input.fields.submitMode !== mode) {
        return { ok: false, reason: "Modul de trimitere nu corespunde actiunii aprobate." };
      }
      if (mode === "send" && input.fields.waitForPhotos) {
        return {
          ok: false,
          reason: "Raportul trebuie pregatit si asteptate pozele inainte de trimitere.",
        };
      }
      return { ok: true };
    },
    preview: (input) =>
      mode === "send"
        ? `Generez si trimit raportul de ${input.fields.reportType} pentru ${input.fields.clientQuery}.`
        : `Deschid raportul de ${input.fields.reportType} pentru ${input.fields.clientQuery} si completez draftul.`,
    execute: async (input, context) => {
      await context.runtime.navigate("/maintenance?tab=report&assistant=report");
      const dispatched = await context.runtime.dispatchFormDraft(
        ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
        input.fields
      );
      if (!dispatched) throw new Error("Generatorul de rapoarte nu este disponibil.");
      return {
        message:
          mode === "send"
            ? "Raportul a fost trimis generatorului pentru expediere controlata."
            : input.fields.waitForPhotos
              ? "Raportul este completat. Ataseaza pozele, apoi trimite-l."
              : "Raportul este completat si asteapta verificarea ta.",
        afterData: input.fields,
      };
    },
    audit: (input, outcome, context) => auditAssistantTool(definition, input, outcome, context),
  };
  return definition;
}

export function createMaintenanceReportPrepareTool() {
  return createMaintenanceReportTool("prepare");
}

export function createMaintenanceReportSendTool() {
  return createMaintenanceReportTool("send");
}

export function createLeaveDraftTool() {
  return createFormDraftTool({
    id: "leave.draft",
    aliases: ["schedule_leave", "fill_leave_form"],
    description: "Trimite un draft validat formularului de concediu, fara trimitere automata.",
    module: "leave",
    eventName: ASSISTANT_FILL_LEAVE_EVENT,
    knownFields: ["startDate", "endDate", "reason", "requestType"],
  });
}

export function createExpenseDraftTool() {
  return createFormDraftTool({
    id: "expenses.draft",
    aliases: ["fill_expense_form"],
    description: "Trimite campuri aprobate catre formularul de cheltuiala, fara salvare automata.",
    module: "expenses",
    eventName: ASSISTANT_FILL_EXPENSE_EVENT,
    knownFields: ["projectId", "companyName"],
  });
}

export function createVehicleDraftTool() {
  return createFormDraftTool({
    id: "vehicles.draft",
    aliases: ["create_vehicle"],
    description: "Completeaza draftul unei masini noi, fara salvare automata.",
    module: "vehicles",
    eventName: ASSISTANT_FILL_VEHICLE_FORM_EVENT,
    knownFields: [
      "plateNumber",
      "brand",
      "model",
      "year",
      "vin",
      "fuelType",
      "status",
      "currentKm",
    ],
  });
}

export function createToolDraftTool() {
  return createFormDraftTool({
    id: "tools.draft",
    aliases: ["create_tool"],
    description: "Completeaza draftul unei scule noi, fara salvare automata.",
    module: "tools",
    eventName: ASSISTANT_FILL_TOOL_FORM_EVENT,
    knownFields: [
      "name",
      "internalCode",
      "status",
      "locationType",
      "locationLabel",
      "description",
      "warrantyUntil",
    ],
  });
}

export function createUserDraftTool() {
  return createFormDraftTool({
    id: "users.draft",
    aliases: ["create_user"],
    description: "Completeaza draftul unui utilizator nou, fara salvare automata.",
    module: "users",
    eventName: ASSISTANT_FILL_USER_FORM_EVENT,
    knownFields: ["fullName", "email", "role", "roleTitle", "department", "active"],
  });
}

export function createProjectDraftTool() {
  return createFormDraftTool({
    id: "timesheets.projects.draft",
    aliases: ["create_project_draft"],
    description: "Completeaza draftul unui proiect, fara salvare automata.",
    module: "timesheets",
    eventName: ASSISTANT_FILL_PROJECT_FORM_EVENT,
    knownFields: ["name", "status"],
  });
}
