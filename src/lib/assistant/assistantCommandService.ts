import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import type { AssistantCommandType } from "./runtime/assistantClassifier";
import { buildLocalMaintenanceReportContract } from "./core/assistantMaintenanceReportCommand";
import {
  cleanAssistantCommandTranscript,
  normalizeAssistantCommandText,
} from "./core/assistantCommandText";
import {
  buildAssistantLanguageHints,
  buildLocalContextualFormContract,
  buildLocalContextualNavigationContract,
  buildSafeAssistantClarificationContract,
} from "./core/assistantHumanLanguage";
import { buildLocalRepeatedActionContract } from "./core/assistantConversationResolver";
import {
  buildLocalAssistantHelpContract,
  buildLocalCurrentEntityUpdateContract,
  buildLocalNamedEntityUpdateContract,
  buildLocalNotificationSettingsContract,
  buildLocalPageNavigationContract,
  buildLocalPersonalSettingsContract,
  buildLocalSiteSettingsContract,
  buildLocalTimesheetContract,
  buildLocalVehicleMileageContract,
  buildLocalVehicleTrackerContract,
} from "./core/assistantLocalCommands";
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
  | "update_notification_rule"
  | "update_site_settings"
  | "update_current_page_field"
  | "open_user_activity"
  | "create_manual_notification"
  | "assistant_help";

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
    previousPage?: string;
    lastCommand?: string;
    lastCompletedAction?: {
      command?: string;
      commandType?: AssistantCommandType;
      intent?: AssistantCommandIntent;
      toolId?: string;
      entityType?: string;
      entityQuery?: string;
      fields?: Record<string, AssistantCommandFieldValue>;
      targetPage?: string;
    };
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

function buildLocalInterpretation(
  contract: AssistantV3Contract,
  overrides: {
    entityType?: AssistantCommandEntityType;
    entityQuery?: string;
    fields?: Record<string, AssistantCommandFieldValue>;
    buttonHint?: string;
    reportType?: "revizie" | "interventie" | "";
  } = {}
): AssistantCommandInterpretationV3 {
  const fields = overrides.fields || {};
  return {
    ...contract,
    entityType: overrides.entityType || "none",
    entityQuery: overrides.entityQuery || "",
    fields,
    fieldsToUpdate: fields,
    shouldNavigate: contract.commandType === "navigation" || Boolean(contract.targetPage),
    shouldFillForm: contract.commandType === "form_fill",
    shouldUpdateFirestore: false,
    targetText: overrides.entityQuery || "",
    pageHint: contract.targetPage,
    buttonHint: overrides.buttonHint || "",
    missingFields: contract.missingInformation,
    risk: contract.confirmationRequired ? "medium" : "low",
    needsConfirmation: contract.confirmationRequired,
    spokenSummary: contract.response,
    reportType: overrides.reportType || "",
    startDate: "",
    endDate: "",
  };
}

export async function interpretAssistantCommand(
  command: string,
  context?: AssistantCommandContext
): Promise<AssistantCommandInterpretationV3 | null> {
  const originalCommand = cleanAssistantCommandTranscript(command);
  const cleanCommand = normalizeAssistantCommandText(command);
  if (!cleanCommand) return null;

  const localHelp = buildLocalAssistantHelpContract(cleanCommand);
  if (localHelp) return buildLocalInterpretation(localHelp);

  const localNotificationSettings = buildLocalNotificationSettingsContract(cleanCommand);
  if (localNotificationSettings) {
    const fields = localNotificationSettings.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localNotificationSettings, {
      entityType: "none",
      entityQuery: "",
      fields: fields || {},
    });
  }

  const localSiteSettings = buildLocalSiteSettingsContract(cleanCommand);
  if (localSiteSettings) {
    const fields = localSiteSettings.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localSiteSettings, {
      entityType: "none",
      entityQuery: "",
      fields: fields || {},
    });
  }

  const localVehicleMileage = buildLocalVehicleMileageContract(cleanCommand);
  if (localVehicleMileage) {
    const entityQuery = localVehicleMileage.entityReferences[0]?.query || "";
    const fields = localVehicleMileage.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localVehicleMileage, {
      entityType: "vehicle",
      entityQuery,
      fields: fields || {},
    });
  }

  const localNamedEntityUpdate = buildLocalNamedEntityUpdateContract(cleanCommand);
  if (localNamedEntityUpdate) {
    const entity = localNamedEntityUpdate.entityReferences[0];
    const fields = localNamedEntityUpdate.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localNamedEntityUpdate, {
      entityType: entity?.type || "none",
      entityQuery: entity?.query || "",
      fields: fields || {},
    });
  }

  const localVehicleTracker = buildLocalVehicleTrackerContract(cleanCommand);
  if (localVehicleTracker) {
    const entityQuery = localVehicleTracker.entityReferences[0]?.query || "";
    return buildLocalInterpretation(localVehicleTracker, {
      entityType: entityQuery ? "vehicle" : "none",
      entityQuery,
    });
  }

  const localMaintenanceReport = buildLocalMaintenanceReportContract(cleanCommand, context);
  if (localMaintenanceReport) {
    const localFields =
      localMaintenanceReport.toolCalls[0]?.input.fields &&
      typeof localMaintenanceReport.toolCalls[0].input.fields === "object" &&
      !Array.isArray(localMaintenanceReport.toolCalls[0].input.fields)
        ? (localMaintenanceReport.toolCalls[0].input.fields as Record<
            string,
            AssistantCommandFieldValue
          >)
        : {};
    const clientQuery = String(localFields.clientQuery || "");
    const reportType =
      localFields.reportType === "interventie"
        ? "interventie"
        : localFields.reportType === "revizie"
          ? "revizie"
          : "";

    return {
      ...localMaintenanceReport,
      entityType: clientQuery ? "maintenanceClient" : "none",
      entityQuery: clientQuery,
      fields: localFields,
      fieldsToUpdate: localFields,
      shouldNavigate: true,
      shouldFillForm: true,
      shouldUpdateFirestore: false,
      targetText: clientQuery,
      pageHint: localMaintenanceReport.targetPage,
      buttonHint: "maintenance-generate-selected-report",
      missingFields: localMaintenanceReport.missingInformation,
      risk:
        localFields.submitMode === "send"
          ? "high"
          : localMaintenanceReport.confirmationRequired
            ? "medium"
            : "low",
      needsConfirmation: localMaintenanceReport.confirmationRequired,
      spokenSummary: localMaintenanceReport.response,
      reportType,
      startDate: "",
      endDate: "",
    };
  }

  const localTimesheet = buildLocalTimesheetContract(cleanCommand, context);
  if (localTimesheet) {
    const projectQuery = localTimesheet.entityReferences[0]?.query || "";
    return buildLocalInterpretation(localTimesheet, {
      entityType: projectQuery ? "project" : "none",
      entityQuery: projectQuery,
    });
  }

  const localCurrentEntityUpdate = buildLocalCurrentEntityUpdateContract(cleanCommand, context);
  if (localCurrentEntityUpdate) {
    const entity = localCurrentEntityUpdate.entityReferences[0];
    const fields = localCurrentEntityUpdate.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localCurrentEntityUpdate, {
      entityType: entity?.type || "none",
      entityQuery: entity?.query || "",
      fields: fields || {},
    });
  }

  const localPersonalSettings = buildLocalPersonalSettingsContract(cleanCommand);
  if (localPersonalSettings) {
    const fields = localPersonalSettings.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localPersonalSettings, {
      entityType: "user",
      entityQuery: "__current_user__",
      fields: fields || {},
    });
  }

  const localRepeatedAction = buildLocalRepeatedActionContract(cleanCommand, context);
  if (localRepeatedAction) {
    const entity = localRepeatedAction.entityReferences[0];
    const fields = localRepeatedAction.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localRepeatedAction, {
      entityType: entity?.type || "none",
      entityQuery: entity?.query || "",
      fields: fields || {},
    });
  }

  const localContextualForm = buildLocalContextualFormContract(cleanCommand, context);
  if (localContextualForm) {
    const fields = localContextualForm.toolCalls[0]?.input.fields as
      Record<string, AssistantCommandFieldValue> | undefined;
    return buildLocalInterpretation(localContextualForm, {
      entityType: localContextualForm.entityReferences[0]?.type || "currentPage",
      entityQuery: localContextualForm.entityReferences[0]?.query || "",
      fields: fields || {},
    });
  }

  const localContextualNavigation = buildLocalContextualNavigationContract(cleanCommand, context);
  if (localContextualNavigation) return buildLocalInterpretation(localContextualNavigation);

  const localNavigation = buildLocalPageNavigationContract(
    cleanCommand,
    context?.role || context?.userRole || "angajat"
  );
  if (localNavigation) return buildLocalInterpretation(localNavigation);

  const safeContext = sanitizeAssistantV3PageContext(context);
  const interpretCommand = httpsCallable<
    {
      command: string;
      originalCommand: string;
      context: AssistantV3PageContext;
      languageHints: ReturnType<typeof buildAssistantLanguageHints>;
    },
    unknown
  >(functions, "interpretAssistantCommand");
  let result;
  try {
    result = await interpretCommand({
      command: cleanCommand,
      originalCommand,
      context: safeContext,
      languageHints: buildAssistantLanguageHints(cleanCommand, context),
    });
  } catch {
    return buildLocalInterpretation(
      buildSafeAssistantClarificationContract(cleanCommand, safeContext)
    );
  }
  if (!result.data) {
    return buildLocalInterpretation(
      buildSafeAssistantClarificationContract(cleanCommand, safeContext)
    );
  }

  const validated = normalizeAndValidateAssistantV3Contract(cleanCommand, result.data);
  if (!validated.ok) {
    return buildLocalInterpretation(
      buildSafeAssistantClarificationContract(cleanCommand, safeContext)
    );
  }

  return {
    ...(result.data as AssistantCommandInterpretation),
    ...validated.value,
  };
}
