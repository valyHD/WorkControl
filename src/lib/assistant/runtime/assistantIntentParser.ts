import type { AssistantCommandInterpretation } from "../assistantCommandService";
import type { AssistantCommandType } from "./assistantClassifier";

function inferCommandType(intent: AssistantCommandInterpretation["intent"]): AssistantCommandType {
  if (["open_vehicle", "open_tool", "open_project", "open_page"].includes(intent)) return "navigation";
  if (["create_project", "create_vehicle", "create_tool", "create_maintenance_client"].includes(intent)) return "create_entity";
  if (["schedule_leave", "fill_leave_form", "fill_maintenance_client_form", "fill_current_page"].includes(intent)) return "form_fill";
  if (["update_vehicle", "update_tool", "update_project", "update_user"].includes(intent)) return "entity_update";
  if (["start_timesheet", "stop_timesheet"].includes(intent)) return "timesheet_action";
  return "unknown";
}

export function normalizeAssistantInterpretation(command: string, input: Partial<AssistantCommandInterpretation> | null): AssistantCommandInterpretation {
  const intent = input?.intent || "unknown";
  const navigationPath = input?.navigation?.path || "";
  const fieldsToUpdate = input?.fields || input?.fieldsToUpdate || {};
  const dateRange = input?.dateRange || {
    startDate: input?.startDate || "",
    endDate: input?.endDate || input?.startDate || "",
  };

  return {
    commandType: input?.commandType || inferCommandType(intent),
    intent,
    targetModule: input?.targetModule || "",
    entityType: input?.entityType || "none",
    entityQuery: input?.entityQuery || input?.targetText || "",
    fields: input?.fields || fieldsToUpdate,
    fieldsToUpdate,
    formSchemaId: input?.formSchemaId || "",
    navigation: input?.navigation || {
      shouldNavigate: input?.shouldNavigate ?? Boolean(input?.targetPage || input?.pageHint),
      path: input?.targetPage || input?.pageHint || "",
    },
    confirmation: input?.confirmation || {
      required: input?.needsConfirmation,
      risk: input?.risk,
      reason: "",
    },
    reasoning: input?.reasoning || "",
    executionPlan: input?.executionPlan || [],
    dateRange,
    shouldNavigate: input?.shouldNavigate ?? input?.navigation?.shouldNavigate ?? Boolean(navigationPath || input?.targetPage || inferCommandType(intent) === "navigation"),
    shouldFillForm: input?.shouldFillForm ?? ["form_fill", "create_entity"].includes(input?.commandType || inferCommandType(intent)),
    shouldUpdateFirestore: input?.shouldUpdateFirestore ?? inferCommandType(intent) === "entity_update",
    targetText: input?.targetText || "",
    targetPage: input?.targetPage || navigationPath || input?.pageHint || "",
    pageHint: input?.pageHint || navigationPath || "",
    buttonHint: input?.buttonHint || "",
    missingFields: Array.isArray(input?.missingFields) ? input.missingFields : [],
    risk: input?.risk || "low",
    needsConfirmation: input?.needsConfirmation ?? input?.confirmation?.required ?? (input?.risk === "medium" || input?.risk === "high"),
    spokenSummary: input?.spokenSummary || input?.response || `Am inteles comanda: ${command}.`,
    reportType: input?.reportType || "",
    editField: input?.editField || "",
    editValue: input?.editValue || "",
    startDate: input?.startDate || dateRange.startDate || "",
    endDate: input?.endDate || dateRange.endDate || dateRange.startDate || "",
    confidence: typeof input?.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : 0,
    response: input?.response || input?.spokenSummary || "",
  };
}

export function isStructuredAssistantEdit(input: AssistantCommandInterpretation | null | undefined) {
  if (!input) return false;
  return ["update_vehicle", "update_tool", "update_project", "update_user"].includes(input.intent);
}
