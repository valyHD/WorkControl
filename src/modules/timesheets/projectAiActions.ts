import { AI_COMMAND_REGISTRY, AI_FIELD_REGISTRY } from "../../lib/assistant/aiCommandRegistry";

export const projectAiActions = AI_COMMAND_REGISTRY.filter((action) => action.module === "projects");
export const projectAiFields = AI_FIELD_REGISTRY.project;
