import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import type { AssistantCommandType } from "./runtime/assistantClassifier";

export type AssistantCommandIntent =
  | "update_vehicle"
  | "update_tool"
  | "update_project"
  | "update_user"
  | "start_timesheet"
  | "stop_timesheet"
  | "create_project"
  | "create_vehicle"
  | "create_tool"
  | "create_maintenance_client"
  | "fill_maintenance_client_form"
  | "schedule_leave"
  | "fill_leave_form"
  | "open_vehicle"
  | "open_tool"
  | "open_project"
  | "open_page"
  | "click_button"
  | "fill_current_page"
  | "submit_current_form"
  | "unknown"
  | "open_dashboard"
  | "open_my_vehicle"
  | "open_my_timesheets"
  | "open_vehicle_tracker"
  | "open_vehicle_live"
  | "open_gps_maps"
  | "open_leave"
  | "open_expense_scan"
  | "open_expense_invoices"
  | "open_maintenance_report"
  | "update_vehicle_field"
  | "update_profile_field"
  | "update_current_page_field"
  | "open_user_activity"
  | "create_manual_notification";

export type AssistantCommandEntityType =
  | "vehicle"
  | "tool"
  | "project"
  | "user"
  | "maintenanceClient"
  | "page"
  | "currentPage"
  | "none";

export type AssistantCommandFieldValue = string | number | boolean | null | string[] | number[];

export type AssistantCommandInterpretation = {
  commandType?: AssistantCommandType;
  intent: AssistantCommandIntent;
  entityType: AssistantCommandEntityType;
  entityQuery: string;
  fieldsToUpdate: Record<string, AssistantCommandFieldValue>;
  dateRange?: {
    startDate: string;
    endDate: string;
  };
  shouldNavigate?: boolean;
  shouldFillForm?: boolean;
  shouldUpdateFirestore?: boolean;
  targetText: string;
  targetPage: string;
  pageHint: string;
  buttonHint: string;
  missingFields: string[];
  risk: "low" | "medium" | "high";
  needsConfirmation: boolean;
  spokenSummary: string;
  reportType: "revizie" | "interventie" | "";
  editField?: string;
  editValue?: string;
  startDate: string;
  endDate: string;
  confidence: number;
  response?: string;
};

export async function interpretAssistantCommand(command: string): Promise<AssistantCommandInterpretation | null> {
  const cleanCommand = command.trim();
  if (!cleanCommand) return null;

  const interpretCommand = httpsCallable<{ command: string }, AssistantCommandInterpretation>(
    functions,
    "interpretAssistantCommand"
  );
  const result = await interpretCommand({ command: cleanCommand });
  return result.data || null;
}
