import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase/firebase";
import type { AssistantAuditParams } from "./assistantTypes";

function sanitizeAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(sanitizeAuditValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, item]) => {
      if (typeof item === "function" || item === undefined) return;
      result[key] = sanitizeAuditValue(item);
    });
    return result;
  }
  return String(value);
}

export async function logAssistantAudit(params: AssistantAuditParams) {
  await addDoc(collection(db, "aiCommandLogs"), {
    userId: params.userId,
    userName: params.userName,
    transcript: params.transcript,
    parsedIntent: sanitizeAuditValue(params.parsedIntent || null),
    resolvedEntity: sanitizeAuditValue(params.resolvedEntity || null),
    entityResolved: sanitizeAuditValue(params.resolvedEntity || null),
    fieldsToUpdate: sanitizeAuditValue(params.fieldsToUpdate || null),
    beforeData: sanitizeAuditValue(params.beforeData || null),
    afterData: sanitizeAuditValue(params.afterData || null),
    status: params.status,
    result: params.result || "",
    errorMessage: params.errorMessage || "",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}
