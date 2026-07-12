import type {
  AssistantCommandInterpretation,
  AssistantCommandIntent,
} from "../assistantCommandService";
import {
  ASSISTANT_V3_VERSION,
  type AssistantV3CommandType,
  type AssistantV3Contract,
  type AssistantV3EntityReference,
  type AssistantV3EntityType,
  type AssistantV3PageContext,
  type AssistantV3ToolCall,
} from "./assistantV3Types";

const COMMAND_TYPES = new Set<AssistantV3CommandType>([
  "navigation",
  "form_fill",
  "entity_update",
  "create_entity",
  "timesheet_action",
  "question",
  "unknown",
]);

const ENTITY_TYPES = new Set<AssistantV3EntityType>([
  "vehicle",
  "tool",
  "project",
  "user",
  "maintenanceClient",
  "page",
  "currentPage",
  "none",
]);

const INTENTS = new Set<AssistantCommandIntent>([
  "update_vehicle",
  "update_tool",
  "update_project",
  "update_user",
  "start_timesheet",
  "stop_timesheet",
  "create_project",
  "create_vehicle",
  "create_tool",
  "create_maintenance_client",
  "fill_maintenance_client_form",
  "schedule_leave",
  "fill_leave_form",
  "open_vehicle",
  "open_tool",
  "open_project",
  "open_page",
  "click_button",
  "fill_current_page",
  "submit_current_form",
  "unknown",
  "open_dashboard",
  "open_my_vehicle",
  "open_my_timesheets",
  "open_vehicle_tracker",
  "open_vehicle_live",
  "open_gps_maps",
  "open_leave",
  "open_expense_scan",
  "open_expense_invoices",
  "open_maintenance_report",
  "update_vehicle_field",
  "update_profile_field",
  "update_current_page_field",
  "open_user_activity",
  "create_manual_notification",
]);

const LEGACY_TOOL_BY_INTENT: Partial<Record<AssistantCommandIntent, string>> = {
  update_vehicle: "vehicles.update",
  update_vehicle_field: "vehicles.update",
  update_tool: "tools.update",
  update_project: "timesheets.projects.update",
  update_user: "users.update",
  update_profile_field: "users.update",
  start_timesheet: "timesheets.start",
  stop_timesheet: "timesheets.stop",
  create_project: "timesheets.projects.create",
  create_vehicle: "vehicles.draft",
  create_tool: "tools.draft",
  create_maintenance_client: "maintenance.draft",
  fill_maintenance_client_form: "maintenance.draft",
  schedule_leave: "leave.draft",
  fill_leave_form: "leave.draft",
};

const NAVIGATION_INTENTS = new Set<AssistantCommandIntent>([
  "open_vehicle",
  "open_tool",
  "open_project",
  "open_page",
  "open_dashboard",
  "open_my_vehicle",
  "open_my_timesheets",
  "open_vehicle_tracker",
  "open_vehicle_live",
  "open_gps_maps",
  "open_leave",
  "open_expense_scan",
  "open_expense_invoices",
  "open_maintenance_report",
  "open_user_activity",
]);

type ContractValidation =
  { ok: true; value: AssistantV3Contract } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeStringArray(value: unknown, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeString(item, 120))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeToolInput(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30));
}

function parseToolCalls(value: unknown): AssistantV3ToolCall[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const calls: AssistantV3ToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = safeString(item.id, 100);
    if (!id || !isRecord(item.input)) return null;
    calls.push({ id, input: safeToolInput(item.input) as AssistantV3ToolCall["input"] });
  }
  return calls;
}

function parseEntityReferences(value: unknown): AssistantV3EntityReference[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const references: AssistantV3EntityReference[] = [];
  for (const item of value) {
    if (!isRecord(item) || !ENTITY_TYPES.has(item.type as AssistantV3EntityType)) return null;
    references.push({
      type: item.type as AssistantV3EntityType,
      query: safeString(item.query, 200),
      id: safeString(item.id, 160),
    });
  }
  return references;
}

export function validateAssistantV3Contract(input: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Contractul nu este un obiect."] };
  if (input.version !== ASSISTANT_V3_VERSION) errors.push("version trebuie sa fie '3'.");
  if (!COMMAND_TYPES.has(input.commandType as AssistantV3CommandType))
    errors.push("commandType este invalid.");
  if (!INTENTS.has(input.intent as AssistantCommandIntent)) errors.push("intent este invalid.");

  const toolCalls = parseToolCalls(input.toolCalls);
  if (!toolCalls) errors.push("toolCalls este invalid.");
  const entityReferences = parseEntityReferences(input.entityReferences);
  if (!entityReferences) errors.push("entityReferences este invalid.");
  if (!Array.isArray(input.missingInformation)) errors.push("missingInformation este invalid.");
  if (
    typeof input.confidence !== "number" ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    errors.push("confidence trebuie sa fie intre 0 si 1.");
  }
  if (typeof input.confirmationRequired !== "boolean")
    errors.push("confirmationRequired este invalid.");
  if (typeof input.targetPage !== "string") errors.push("targetPage este invalid.");
  if (typeof input.response !== "string") errors.push("response este invalid.");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      version: ASSISTANT_V3_VERSION,
      commandType: input.commandType as AssistantV3CommandType,
      intent: input.intent as AssistantCommandIntent,
      toolCalls: toolCalls!,
      targetPage: safeString(input.targetPage, 300),
      entityReferences: entityReferences!,
      missingInformation: safeStringArray(input.missingInformation),
      confidence: input.confidence as number,
      confirmationRequired: input.confirmationRequired as boolean,
      response: safeString(input.response, 1_000),
    },
  };
}

function inferLegacyToolCalls(
  input: Partial<AssistantCommandInterpretation>
): AssistantV3ToolCall[] {
  const intent = input.intent || "unknown";
  if (NAVIGATION_INTENTS.has(intent)) {
    return [
      {
        id: "navigation.open",
        input: {
          path: input.targetPage || input.navigation?.path || input.pageHint || "",
          query: input.entityQuery || input.targetText || "",
        },
      },
    ];
  }

  const id = LEGACY_TOOL_BY_INTENT[intent];
  if (!id) return [];
  const fields = input.fields || input.fieldsToUpdate || {};
  return [
    {
      id,
      input: {
        entityQuery: input.entityQuery || input.targetText || "",
        fields,
        projectQuery: String(fields.project || input.entityQuery || input.targetText || ""),
        createProjectIfMissing: Boolean(fields.createProjectIfMissing),
      },
    },
  ];
}

export function normalizeLegacyAssistantInterpretation(
  command: string,
  input: Partial<AssistantCommandInterpretation>
): AssistantV3Contract {
  const intent = INTENTS.has(input.intent as AssistantCommandIntent) ? input.intent! : "unknown";
  const entityType = ENTITY_TYPES.has(input.entityType as AssistantV3EntityType)
    ? (input.entityType as AssistantV3EntityType)
    : "none";
  const targetPage = input.targetPage || input.navigation?.path || input.pageHint || "";
  const query = input.entityQuery || input.targetText || "";
  const missingInformation = input.missingInformation || input.missingFields || [];
  return {
    version: ASSISTANT_V3_VERSION,
    commandType: COMMAND_TYPES.has(input.commandType as AssistantV3CommandType)
      ? (input.commandType as AssistantV3CommandType)
      : "unknown",
    intent,
    toolCalls: inferLegacyToolCalls({ ...input, intent }),
    targetPage,
    entityReferences: entityType === "none" ? [] : [{ type: entityType, query, id: "" }],
    missingInformation: safeStringArray(missingInformation),
    confidence:
      typeof input.confidence === "number" && Number.isFinite(input.confidence)
        ? Math.max(0, Math.min(1, input.confidence))
        : 0,
    confirmationRequired:
      input.confirmationRequired ??
      input.needsConfirmation ??
      input.confirmation?.required ??
      false,
    response: input.response || input.spokenSummary || `Am inteles comanda: ${command}.`,
  };
}

export function normalizeAndValidateAssistantV3Contract(
  command: string,
  input: unknown
): ContractValidation {
  if (isRecord(input) && input.version === ASSISTANT_V3_VERSION)
    return validateAssistantV3Contract(input);
  if (!isRecord(input)) return { ok: false, errors: ["Interpretarea lipseste sau este invalida."] };
  return validateAssistantV3Contract(normalizeLegacyAssistantInterpretation(command, input));
}

export function sanitizeAssistantV3PageContext(input: unknown): AssistantV3PageContext {
  const value = isRecord(input) ? input : {};
  const selected = isRecord(value.selectedEntity) ? value.selectedEntity : null;
  const openForm = isRecord(value.openForm) ? value.openForm : null;
  const memory = isRecord(value.memory) ? value.memory : {};
  const legacyLastEntity = isRecord(memory.lastEntity) ? memory.lastEntity : null;
  const selectedType =
    selected && ENTITY_TYPES.has(selected.type as AssistantV3EntityType)
      ? (selected.type as AssistantV3EntityType)
      : "none";
  const lastEntityType =
    legacyLastEntity && ENTITY_TYPES.has(legacyLastEntity.entityType as AssistantV3EntityType)
      ? (legacyLastEntity.entityType as AssistantV3EntityType)
      : legacyLastEntity && ENTITY_TYPES.has(legacyLastEntity.type as AssistantV3EntityType)
        ? (legacyLastEntity.type as AssistantV3EntityType)
        : "none";

  return {
    route: safeString(value.route || value.currentPathname, 300),
    page: safeString(value.page, 120),
    selectedEntity:
      selected && selectedType !== "none"
        ? {
            type: selectedType,
            id: safeString(selected.id || selected.entityId, 160),
            label: safeString(selected.label, 200),
          }
        : null,
    openForm: openForm
      ? {
          id: safeString(openForm.id, 120),
          mode: ["create", "edit", "view"].includes(String(openForm.mode))
            ? (openForm.mode as "create" | "edit" | "view")
            : "",
        }
      : null,
    availableActions: safeStringArray(value.availableActions, 50),
    allowedFields: safeStringArray(value.allowedFields, 100),
    role: safeString(value.role || value.userRole, 60),
    memory: {
      lastEntity:
        legacyLastEntity && lastEntityType !== "none"
          ? {
              type: lastEntityType,
              id: safeString(legacyLastEntity.id || legacyLastEntity.entityId, 160),
              label: safeString(legacyLastEntity.label, 200),
            }
          : undefined,
      lastPage: safeString(memory.lastPage, 300) || undefined,
      lastCommand: safeString(memory.lastCommand, 600) || undefined,
    },
  };
}
