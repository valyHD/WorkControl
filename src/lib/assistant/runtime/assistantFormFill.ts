export const ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT =
  "workcontrol:assistant-fill-maintenance-client";
export const ASSISTANT_FILL_LEAVE_EVENT = "workcontrol:assistant-fill-leave";
export const ASSISTANT_FILL_VEHICLE_FORM_EVENT = "workcontrol:assistant-fill-vehicle-form";
export const ASSISTANT_FILL_TOOL_FORM_EVENT = "workcontrol:assistant-fill-tool-form";
export const ASSISTANT_FILL_USER_FORM_EVENT = "workcontrol:assistant-fill-user-form";
export const ASSISTANT_FILL_PROJECT_FORM_EVENT = "workcontrol:assistant-fill-project-form";
export const ASSISTANT_FILL_EXPENSE_FORM_EVENT = "workcontrol:assistant-fill-expense-form";

export type AssistantFormFields = Record<string, unknown>;

function waitForSelector(selector: string, timeoutMs = 2_500): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.resolve(false);
  if (document.querySelector(selector)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (document.querySelector(selector)) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 80);
  });
}

export function dispatchAssistantFormFill(eventName: string, payload: AssistantFormFields) {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  return true;
}

export async function fillMaintenanceClientForm(fields: AssistantFormFields) {
  await waitForSelector(
    "[data-assistant-action='maintenance-add-client'], [data-assistant-section='maintenance-clients']"
  );
  return dispatchAssistantFormFill(ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT, fields);
}

export async function fillLeaveForm(fields: AssistantFormFields) {
  await waitForSelector("[data-assistant-section='leave-form'], #leave-form");
  return dispatchAssistantFormFill(ASSISTANT_FILL_LEAVE_EVENT, fields);
}

export async function fillVehicleForm(fields: AssistantFormFields) {
  await waitForSelector("[data-assistant-field='plateNumber'], [data-assistant-field='currentKm']");
  return dispatchAssistantFormFill(ASSISTANT_FILL_VEHICLE_FORM_EVENT, fields);
}

export async function fillToolForm(fields: AssistantFormFields) {
  await waitForSelector("[data-assistant-field='name'], [data-assistant-field='internalCode']");
  return dispatchAssistantFormFill(ASSISTANT_FILL_TOOL_FORM_EVENT, fields);
}

export async function dispatchAssistantFormDraftWhenReady(
  eventName: string,
  fields: AssistantFormFields
) {
  const selectorByEvent: Record<string, string> = {
    [ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT]:
      "[data-assistant-section='maintenance-clients'], [data-assistant-section='maintenance-client-form']",
    [ASSISTANT_FILL_LEAVE_EVENT]: "[data-assistant-section='leave-form'], #leave-form",
    [ASSISTANT_FILL_VEHICLE_FORM_EVENT]: "[data-assistant-field='plateNumber']",
    [ASSISTANT_FILL_TOOL_FORM_EVENT]: "[data-assistant-field='name']",
    [ASSISTANT_FILL_USER_FORM_EVENT]:
      "[data-assistant-field='fullName'], [data-assistant-field='roleTitle']",
    [ASSISTANT_FILL_PROJECT_FORM_EVENT]:
      "[data-assistant-field='projectName'], [data-assistant-section='project-form']",
    [ASSISTANT_FILL_EXPENSE_FORM_EVENT]:
      "[data-assistant-section='expense-form'], [data-assistant-field='projectId']",
  };
  const selector = selectorByEvent[eventName];
  if (selector) await waitForSelector(selector);
  return dispatchAssistantFormFill(eventName, fields);
}
