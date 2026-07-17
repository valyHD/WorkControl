import type {
  AssistantConversationMemorySnapshot,
  AssistantResolvedEntitySummary,
} from "./assistantTypes";

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
