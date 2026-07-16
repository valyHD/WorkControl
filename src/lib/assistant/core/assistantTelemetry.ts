import { logAssistantAudit } from "../runtime/assistantAudit";
import type { AssistantToolAuditRecord } from "../tools/assistantToolRegistry";

export function createAssistantTelemetry(params: { userId: string; userName: string }) {
  return async (record: AssistantToolAuditRecord) => {
    try {
      await logAssistantAudit({
        userId: params.userId,
        userName: params.userName,
        transcript: record.command,
        parsedIntent: {
          traceId: record.traceId,
          toolId: record.toolId,
          module: record.module,
          risk: record.risk,
        },
        fieldsToUpdate: record.input,
        beforeData: record.output?.beforeData,
        afterData: record.output?.afterData,
        resolvedEntity: record.output?.entityId ? { entityId: record.output.entityId } : null,
        status:
          record.status === "success"
            ? "executed"
            : record.status === "blocked"
              ? "needs_clarification"
              : "failed",
        result: record.output?.message || "",
        errorMessage: record.error || "",
      });
    } catch (error) {
      console.warn("[assistantTelemetry] Auditul nu a putut fi inregistrat.", error);
    }
  };
}
