import { dispatchAssistantFormDraft } from "../adapters/assistantFormDraftChannel";

export const ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT =
  "workcontrol:assistant-fill-maintenance-client";
export const ASSISTANT_FILL_LEAVE_EVENT = "workcontrol:assistant-fill-leave";
export const ASSISTANT_FILL_VEHICLE_FORM_EVENT = "workcontrol:assistant-fill-vehicle-form";
export const ASSISTANT_FILL_TOOL_FORM_EVENT = "workcontrol:assistant-fill-tool-form";
export const ASSISTANT_FILL_USER_FORM_EVENT = "workcontrol:assistant-fill-user-form";
export const ASSISTANT_FILL_PROJECT_FORM_EVENT = "workcontrol:assistant-fill-project-form";
export const ASSISTANT_FILL_EXPENSE_FORM_EVENT = "workcontrol:assistant-fill-expense-form";

export type AssistantFormFields = Record<string, unknown>;

export function dispatchAssistantFormFill(eventName: string, payload: AssistantFormFields) {
  return dispatchAssistantFormDraft(eventName, payload);
}

export async function fillMaintenanceClientForm(fields: AssistantFormFields) {
  return dispatchAssistantFormFill(ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT, fields);
}

export async function fillLeaveForm(fields: AssistantFormFields) {
  return dispatchAssistantFormFill(ASSISTANT_FILL_LEAVE_EVENT, fields);
}

export async function fillVehicleForm(fields: AssistantFormFields) {
  return dispatchAssistantFormFill(ASSISTANT_FILL_VEHICLE_FORM_EVENT, fields);
}

export async function fillToolForm(fields: AssistantFormFields) {
  return dispatchAssistantFormFill(ASSISTANT_FILL_TOOL_FORM_EVENT, fields);
}

export async function dispatchAssistantFormDraftWhenReady(
  eventName: string,
  fields: AssistantFormFields
) {
  return dispatchAssistantFormFill(eventName, fields);
}
