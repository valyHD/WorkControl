import type {
  AssistantCommandFieldValue,
  AssistantCommandIntent,
} from "../assistantCommandService";

export const ASSISTANT_V3_VERSION = "3" as const;
export const ASSISTANT_V3_SAFE_CONFIDENCE = 0.85;

export type AssistantV3CommandType =
  | "navigation"
  | "form_fill"
  | "entity_update"
  | "create_entity"
  | "timesheet_action"
  | "question"
  | "unknown";

export type AssistantV3EntityType =
  "vehicle" | "tool" | "project" | "user" | "maintenanceClient" | "page" | "currentPage" | "none";

export type AssistantV3ToolCall = {
  id: string;
  input: Record<string, AssistantCommandFieldValue | Record<string, AssistantCommandFieldValue>>;
};

export type AssistantV3EntityReference = {
  type: AssistantV3EntityType;
  query: string;
  id: string;
};

export type AssistantV3Contract = {
  version: typeof ASSISTANT_V3_VERSION;
  traceId?: string;
  commandType: AssistantV3CommandType;
  intent: AssistantCommandIntent;
  toolCalls: AssistantV3ToolCall[];
  targetPage: string;
  entityReferences: AssistantV3EntityReference[];
  missingInformation: string[];
  confidence: number;
  confirmationRequired: boolean;
  response: string;
};

export type AssistantV3SelectedEntity = {
  type: AssistantV3EntityType;
  id: string;
  label: string;
};

export type AssistantV3OpenForm = {
  id: string;
  mode: "create" | "edit" | "view" | "";
};

export type AssistantV3Memory = {
  lastEntity?: AssistantV3SelectedEntity;
  lastPage?: string;
  lastCommand?: string;
};

export type AssistantV3PageContext = {
  route: string;
  page: string;
  selectedEntity: AssistantV3SelectedEntity | null;
  openForm: AssistantV3OpenForm | null;
  availableActions: string[];
  allowedFields: string[];
  role: string;
  memory: AssistantV3Memory;
};

export type AssistantV3Actor = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  themeKey?: string | null;
  role: string;
};
