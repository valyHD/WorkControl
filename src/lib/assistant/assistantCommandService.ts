import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import type { AssistantCommandType } from "./runtime/assistantClassifier";
import {
  normalizeAndValidateAssistantV3Contract,
  sanitizeAssistantV3PageContext,
} from "./core/assistantV3Contract";
import type {
  AssistantV3Contract,
  AssistantV3EntityReference,
  AssistantV3OpenForm,
  AssistantV3PageContext,
  AssistantV3SelectedEntity,
  AssistantV3ToolCall,
} from "./core/assistantV3Types";

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
  "vehicle" | "tool" | "project" | "user" | "maintenanceClient" | "page" | "currentPage" | "none";

export type AssistantCommandFieldValue = string | number | boolean | null | string[] | number[];

export type AssistantCommandContext = {
  route?: string;
  page?: string;
  selectedEntity?: AssistantV3SelectedEntity | null;
  openForm?: AssistantV3OpenForm | null;
  availableActions?: string[];
  allowedFields?: string[];
  role?: string;
  currentPathname?: string;
  currentSearch?: string;
  currentHash?: string;
  userRole?: string;
  memory?: {
    lastEntity?: {
      entityType?: string;
      entityId?: string;
      label?: string;
      query?: string;
    };
    lastVehicleId?: string;
    lastToolId?: string;
    lastProjectId?: string;
    lastUserId?: string;
    lastPage?: string;
    lastCommand?: string;
  };
};

export type AssistantCommandNavigation = {
  shouldNavigate?: boolean;
  path?: string;
  section?: string;
  params?: Record<string, string | number | boolean>;
};

export type AssistantCommandConfirmation = {
  required?: boolean;
  reason?: string;
  risk?: "low" | "medium" | "high";
};

export type AssistantCommandPlanStep = {
  id?: string;
  type: string;
  label: string;
  target?: string;
  fields?: string[];
  requiresConfirmation?: boolean;
};

export type AssistantCommandInterpretation = {
  version?: "3";
  traceId?: string;
  commandType?: AssistantCommandType;
  intent: AssistantCommandIntent;
  targetModule?: string;
  entityType: AssistantCommandEntityType;
  entityQuery: string;
  fields?: Record<string, AssistantCommandFieldValue>;
  fieldsToUpdate: Record<string, AssistantCommandFieldValue>;
  formSchemaId?: string;
  navigation?: AssistantCommandNavigation;
  confirmation?: AssistantCommandConfirmation;
  reasoning?: string;
  executionPlan?: AssistantCommandPlanStep[];
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
  toolCalls?: AssistantV3ToolCall[];
  entityReferences?: AssistantV3EntityReference[];
  missingInformation?: string[];
  confirmationRequired?: boolean;
};

export type AssistantCommandInterpretationV3 = AssistantCommandInterpretation & AssistantV3Contract;

export async function interpretAssistantCommand(
  command: string,
  context?: AssistantCommandContext
): Promise<AssistantCommandInterpretationV3 | null> {
  const cleanCommand = command.trim();
  if (!cleanCommand) return null;

  const safeContext = sanitizeAssistantV3PageContext(context);
  const interpretCommand = httpsCallable<
    { command: string; context: AssistantV3PageContext },
    unknown
  >(functions, "interpretAssistantCommand");
  const result = await interpretCommand({ command: cleanCommand, context: safeContext });
  if (!result.data) return null;

  const validated = normalizeAndValidateAssistantV3Contract(cleanCommand, result.data);
  if (!validated.ok) {
    throw new Error(`Contract Assistant V3 invalid: ${validated.errors.join(" ")}`);
  }

  return {
    ...(result.data as AssistantCommandInterpretation),
    ...validated.value,
  };
}
