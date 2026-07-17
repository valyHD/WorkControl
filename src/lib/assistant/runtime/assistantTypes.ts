import type { AiCommandRisk, AiEntityType, AiFieldValue } from "../aiCommandRegistry";
import type { AssistantCommandInterpretation } from "../assistantCommandService";

export type AssistantRuntimeEntityType =
  Exclude<AiEntityType, "notification" | "report" | "unknown"> | "none";

export type AssistantRuntimeUser = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  themeKey?: string | null;
  role: string;
};

export type AssistantRuntimeContext = {
  user: AssistantRuntimeUser | null;
  currentPathname: string;
  memory?: AssistantConversationMemorySnapshot;
};

export type AssistantConversationMemorySnapshot = {
  lastEntity?: AssistantResolvedEntitySummary;
  lastVehicleId?: string;
  lastToolId?: string;
  lastProjectId?: string;
  lastUserId?: string;
  lastPage?: string;
  previousPage?: string;
  lastCommand?: string;
  lastCompletedAction?: AssistantConversationActionSummary;
};

export type AssistantConversationActionSummary = {
  command: string;
  commandType: NonNullable<AssistantCommandInterpretation["commandType"]>;
  intent: AssistantCommandInterpretation["intent"];
  toolId: string;
  entityType: AssistantRuntimeEntityType;
  entityQuery: string;
  fields: Record<string, string | number | boolean | null>;
  targetPage: string;
};

export type AssistantResolvedEntitySummary = {
  entityType: AssistantRuntimeEntityType;
  entityId: string;
  label: string;
  query?: string;
};

export type AssistantResolvedEntity<TData = unknown> = AssistantResolvedEntitySummary & {
  score: number;
  data: TData;
};

export type AssistantEntityResolution<TData = unknown> = {
  status: "resolved" | "ambiguous" | "not_found";
  entity?: AssistantResolvedEntity<TData>;
  options: AssistantResolvedEntity<TData>[];
  message?: string;
};

export type AssistantFieldChange = {
  naturalName: string;
  fieldKey: string;
  label: string;
  oldValue: unknown;
  newValue: string | number | boolean | null;
  displayOldValue: string;
  displayNewValue: string;
  requiresSpecialConfirmation?: boolean;
};

export type AssistantValidationResult = {
  ok: boolean;
  risk?: AiCommandRisk;
  needsConfirmation?: boolean;
  message?: string;
  missingFields?: string[];
};

export type AssistantExecutionPlanStep = {
  id: string;
  type:
    | "navigate"
    | "resolve_entity"
    | "validate_fields"
    | "service_update"
    | "form_event"
    | "highlight"
    | "confirm"
    | "audit";
  label: string;
  target?: string;
  fields?: string[];
  requiresConfirmation?: boolean;
};

export type AssistantRuntimePlan = {
  intent: AssistantCommandInterpretation["intent"];
  entityType: AssistantRuntimeEntityType;
  parsedIntent: AssistantCommandInterpretation;
  resolvedEntity?: AssistantResolvedEntity;
  options?: AssistantResolvedEntity[];
  fieldsToUpdate: Record<string, AiFieldValue>;
  changes: AssistantFieldChange[];
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  risk: AiCommandRisk;
  confidence: number;
  needsConfirmation: boolean;
  spokenSummary: string;
  status: "ready" | "needs_clarification" | "not_supported";
  message: string;
  executionPlan?: AssistantExecutionPlanStep[];
  run?: () => Promise<{ result: string; afterData?: Record<string, unknown> | null }>;
};

export type AssistantAuditStatus =
  "success" | "failed" | "cancelled" | "executed" | "needs_clarification";

export type AssistantAuditParams = {
  userId: string;
  userName: string;
  transcript: string;
  parsedIntent?: unknown;
  resolvedEntity?: unknown;
  fieldsToUpdate?: unknown;
  beforeData?: unknown;
  afterData?: unknown;
  status: AssistantAuditStatus;
  errorMessage?: string;
  result?: string;
};
