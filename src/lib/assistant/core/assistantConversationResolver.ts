import type {
  AssistantCommandContext,
  AssistantCommandFieldValue,
} from "../assistantCommandService";
import type {
  AssistantV3Contract,
  AssistantV3EntityType,
  AssistantV3ToolCall,
} from "./assistantV3Types";
import { normalizeAssistantCommandText } from "./assistantCommandText";

const REPEATABLE_TOOL_TYPES: Record<string, AssistantV3EntityType> = {
  "vehicles.update": "vehicle",
  "tools.update": "tool",
  "timesheets.projects.update": "project",
  "users.update": "user",
  "maintenance.report.prepare": "maintenanceClient",
  "maintenance.report.send": "maintenanceClient",
};

function normalizeForConversation(value: string) {
  return normalizeAssistantCommandText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatedActionTarget(command: string) {
  const normalized = normalizeForConversation(command);
  const patterns = [
    /\b(?:fa|faci|aplica|repeta|pune)\s+(?:si\s+)?(?:la\s+fel|acelasi\s+lucru|aceeasi\s+modificare|tot\s+asa)\s+(?:si\s+)?(?:pentru|la|pe)\s+(.+)$/,
    /\b(?:la\s+fel|acelasi\s+lucru|aceeasi\s+modificare|tot\s+asa)\s+(?:si\s+)?(?:pentru|la|pe)\s+(.+)$/,
    /\b(?:fa|faci|aplica|repeta|pune)\s+si\s+(?:pentru|la|pe)\s+(.+)$/,
  ];
  const target =
    patterns.map((pattern) => normalized.match(pattern)?.[1] || "").find(Boolean) || "";
  return target
    .replace(/\b(?:te\s+rog|acum|si\s+gata)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function copiedFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, fieldValue]) =>
        ["string", "number", "boolean"].includes(typeof fieldValue) || fieldValue === null
    )
  ) as Record<string, AssistantCommandFieldValue>;
}

/**
 * Repeats only the last completed, controlled action for a newly named entity.
 * Start/stop, create, delete and navigation actions are deliberately not replayed.
 */
export function buildLocalRepeatedActionContract(
  command: string,
  context?: AssistantCommandContext
): AssistantV3Contract | null {
  const target = repeatedActionTarget(command);
  const previous = context?.memory?.lastCompletedAction;
  if (!target || !previous?.toolId) return null;

  const entityType = REPEATABLE_TOOL_TYPES[previous.toolId];
  const fields = copiedFields(previous.fields);
  if (!entityType || Object.keys(fields).length === 0) return null;
  if (/^(?:asta|acesta|aceasta|ala|aia|acolo|aici|el|ea)$/.test(target)) return null;

  if (previous.toolId.startsWith("maintenance.report.")) {
    fields.clientQuery = target;
  }

  let input: AssistantV3ToolCall["input"];
  if (previous.toolId.startsWith("maintenance.report.")) input = { fields };
  else input = { entityQuery: target, fields };
  const actionLabel =
    previous.toolId === "maintenance.report.send"
      ? "Generez si trimit acelasi tip de raport"
      : previous.toolId === "maintenance.report.prepare"
        ? "Pregatesc acelasi tip de raport"
        : "Aplic aceeasi modificare";

  return {
    version: "3",
    commandType: previous.commandType || "entity_update",
    intent: previous.intent || "unknown",
    toolCalls: [{ id: previous.toolId, input }],
    targetPage: previous.targetPage || "",
    entityReferences: [{ type: entityType, query: target, id: "" }],
    missingInformation: [],
    confidence: 0.96,
    confirmationRequired: true,
    response: `${actionLabel} pentru ${target}. Verifica si confirma.`,
  };
}
