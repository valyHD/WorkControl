import type {
  AssistantConversationMemorySnapshot,
  AssistantResolvedEntitySummary,
} from "./assistantTypes";
import type { AssistantV3Contract } from "../core/assistantV3Types";

function primitiveFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([, fieldValue]) =>
          ["string", "number", "boolean"].includes(typeof fieldValue) || fieldValue === null
      )
      .slice(0, 20)
  ) as Record<string, string | number | boolean | null>;
}

function actionSummary(command: string, contract?: AssistantV3Contract | null) {
  if (!contract || contract.commandType === "unknown" || contract.commandType === "question") {
    return null;
  }
  const call =
    [...contract.toolCalls].reverse().find((candidate) => candidate.id !== "navigation.open") ||
    contract.toolCalls.at(-1);
  const reference = contract.entityReferences[0];
  const input = call?.input || {};
  const type = reference?.type;
  return {
    command: command.slice(0, 600),
    commandType: contract.commandType,
    intent: contract.intent,
    toolId: call?.id || "",
    entityType:
      type === "vehicle" ||
      type === "tool" ||
      type === "project" ||
      type === "user" ||
      type === "maintenanceClient"
        ? type
        : "none",
    entityQuery: String(reference?.query || input.entityQuery || "").slice(0, 200),
    fields: primitiveFields(input.fields),
    targetPage: contract.targetPage.slice(0, 300),
  } as const;
}

export function getVehicleIdFromAssistantPath(pathname?: string) {
  const match = String(pathname || "").match(
    /^\/vehicles\/([^/?#]+)(?:\/(?:edit|live))?\/?(?:[?#].*)?$/
  );
  const vehicleId = match?.[1] || "";
  if (!vehicleId || vehicleId === "new" || vehicleId === "gps-map") return "";
  return vehicleId;
}

export function getToolIdFromAssistantPath(pathname?: string) {
  const match = String(pathname || "").match(/^\/tools\/([^/?#]+)(?:\/edit)?\/?$/);
  const toolId = match?.[1] || "";
  if (!toolId || toolId === "new" || toolId === "scan") return "";
  return toolId;
}

export function createAssistantConversationMemory(initial?: AssistantConversationMemorySnapshot) {
  let snapshot: AssistantConversationMemorySnapshot = { ...(initial || {}) };

  return {
    getSnapshot() {
      return { ...snapshot };
    },
    rememberEntity(entity?: AssistantResolvedEntitySummary) {
      if (!entity?.entityId) return;
      snapshot = { ...snapshot, lastEntity: entity };
      if (entity.entityType === "vehicle") snapshot.lastVehicleId = entity.entityId;
      if (entity.entityType === "tool") snapshot.lastToolId = entity.entityId;
      if (entity.entityType === "project") snapshot.lastProjectId = entity.entityId;
      if (entity.entityType === "user") snapshot.lastUserId = entity.entityId;
    },
    rememberPage(pathname: string) {
      snapshot = {
        ...snapshot,
        previousPage:
          snapshot.lastPage && snapshot.lastPage !== pathname
            ? snapshot.lastPage
            : snapshot.previousPage,
        lastPage: pathname,
      };
    },
    rememberCommand(command: string) {
      snapshot = { ...snapshot, lastCommand: command };
    },
    rememberCompletedAction(command: string, contract?: AssistantV3Contract | null) {
      const completedAction = actionSummary(command, contract);
      if (!completedAction) return;
      snapshot = { ...snapshot, lastCompletedAction: completedAction };
    },
    syncPath(pathname: string) {
      const vehicleId = getVehicleIdFromAssistantPath(pathname);
      const toolId = getToolIdFromAssistantPath(pathname);
      snapshot = {
        ...snapshot,
        previousPage:
          snapshot.lastPage && snapshot.lastPage !== pathname
            ? snapshot.lastPage
            : snapshot.previousPage,
        lastPage: pathname,
        ...(vehicleId ? { lastVehicleId: vehicleId } : {}),
        ...(toolId ? { lastToolId: toolId } : {}),
      };
    },
  };
}
