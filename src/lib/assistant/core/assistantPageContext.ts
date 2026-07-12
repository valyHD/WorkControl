import { getPageExperience } from "../../../config/pageExperience";
import { getAssistantPageActions } from "../runtime/assistantPageActionRegistry";
import type { AssistantConversationMemorySnapshot } from "../runtime/assistantTypes";
import type { AssistantV3EntityType, AssistantV3PageContext } from "./assistantV3Types";

function selectedEntityFromPath(pathname: string) {
  const match = pathname.match(/^\/(vehicles|tools|users|projects)\/([^/?#]+)/);
  if (!match || ["new", "gps-map", "scan"].includes(match[2])) return null;
  const typeBySegment: Record<string, AssistantV3EntityType> = {
    vehicles: "vehicle",
    tools: "tool",
    users: "user",
    projects: "project",
  };
  return { type: typeBySegment[match[1]], id: match[2], label: match[2] };
}

export function buildAssistantV3PageContext(params: {
  pathname: string;
  search?: string;
  hash?: string;
  role: string;
  memory: AssistantConversationMemorySnapshot;
}): AssistantV3PageContext {
  const experience = getPageExperience(params.pathname);
  const actions = getAssistantPageActions(params.pathname);
  const openForm = params.pathname.endsWith("/new")
    ? { id: experience?.id || "form", mode: "create" as const }
    : params.pathname.endsWith("/edit")
      ? { id: experience?.id || "form", mode: "edit" as const }
      : null;
  return {
    route: `${params.pathname}${params.search || ""}${params.hash || ""}`,
    page: experience?.id || params.pathname,
    selectedEntity: selectedEntityFromPath(params.pathname),
    openForm,
    availableActions: actions.map((action) => action.id),
    allowedFields: actions
      .filter((action) => action.actionType === "field")
      .map((action) => action.id),
    role: params.role,
    memory: {
      lastEntity: params.memory.lastEntity
        ? {
            type: params.memory.lastEntity.entityType as AssistantV3EntityType,
            id: params.memory.lastEntity.entityId,
            label: params.memory.lastEntity.label,
          }
        : undefined,
      lastPage: params.memory.lastPage,
      lastCommand: params.memory.lastCommand,
    },
  };
}
