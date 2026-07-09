import { AI_COMMAND_REGISTRY, AI_FIELD_REGISTRY } from "../../lib/assistant/aiCommandRegistry";

export const vehicleAiActions = AI_COMMAND_REGISTRY.filter((action) => action.module === "vehicles");
export const vehicleAiFields = AI_FIELD_REGISTRY.vehicle;
