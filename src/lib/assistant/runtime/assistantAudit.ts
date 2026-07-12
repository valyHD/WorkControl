import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/firebase";
import type { AssistantAuditParams, AssistantAuditStatus } from "./assistantTypes";

function sanitizeAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(sanitizeAuditValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>)
      .slice(0, 80)
      .forEach(([key, item]) => {
        if (typeof item === "function" || item === undefined) return;
        result[key] = sanitizeAuditValue(item);
      });
    return result;
  }
  return String(value);
}

function callableOutcomeStatus(status: AssistantAuditStatus) {
  return status === "success" ? "executed" : status;
}

function traceIdFromParsedIntent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const traceId = (value as Record<string, unknown>).traceId;
  return typeof traceId === "string" ? traceId.slice(0, 128) : "";
}

export async function logAssistantAudit(params: AssistantAuditParams) {
  const recordOutcome = httpsCallable(functions, "recordAssistantTraceOutcome");
  await recordOutcome({
    traceId: traceIdFromParsedIntent(params.parsedIntent),
    transcript: params.transcript.slice(0, 600),
    status: callableOutcomeStatus(params.status),
    outcome: {
      parsedIntent: sanitizeAuditValue(params.parsedIntent || null),
      resolvedEntity: sanitizeAuditValue(params.resolvedEntity || null),
      fieldsToUpdate: sanitizeAuditValue(params.fieldsToUpdate || null),
      result: params.result || "",
      errorMessage: params.errorMessage || "",
    },
  });
}
