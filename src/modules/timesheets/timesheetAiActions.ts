import { AI_COMMAND_REGISTRY, AI_FIELD_REGISTRY } from "../../lib/assistant/aiCommandRegistry";

export const timesheetAiActions = AI_COMMAND_REGISTRY.filter((action) => action.module === "timesheets");
export const timesheetAiFields = AI_FIELD_REGISTRY.timesheet;
