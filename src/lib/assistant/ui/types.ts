import type { ReactNode } from "react";

export type AssistantUiState =
  "idle" | "listening" | "thinking" | "confirming" | "executing" | "error";

export type AssistantRisk = "low" | "medium" | "high";

export type AssistantConfirmationRow = {
  id: string;
  label: string;
  oldValue: ReactNode;
  newValue: ReactNode;
};

export type AssistantChoice<TId extends string = string> = {
  id: TId;
  label: string;
  description?: string;
  meta?: string;
  disabled?: boolean;
};

export type AssistantExecutionStepStatus =
  "pending" | "active" | "completed" | "failed" | "blocked";

export type AssistantExecutionStep = {
  id: string;
  label: string;
  description?: string;
  status: AssistantExecutionStepStatus;
  requiresConfirmation?: boolean;
};

export type AssistantDebugEntry = {
  id: string;
  label: string;
  value: unknown;
  sensitive?: boolean;
};
