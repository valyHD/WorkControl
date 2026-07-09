import { AI_COMMAND_REGISTRY, AI_FIELD_REGISTRY } from "../../lib/assistant/aiCommandRegistry";

export const toolAiActions = AI_COMMAND_REGISTRY.filter((action) => action.module === "tools");
export const toolAiFields = AI_FIELD_REGISTRY.tool;
