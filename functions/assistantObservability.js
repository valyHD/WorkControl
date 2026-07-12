const crypto = require("node:crypto");

const ASSISTANT_TRACE_RETENTION_DAYS = 30;
const ASSISTANT_TRACE_MAX_TRANSCRIPT_LENGTH = 320;
const ASSISTANT_OUTCOME_STATUSES = new Set([
  "executed",
  "failed",
  "cancelled",
  "needs_clarification",
]);

const MODEL_RATES_USD_PER_MILLION = {
  "gpt-4.1-mini": {
    input: 0.4,
    cachedInput: 0.1,
    output: 1.6,
    source: "openai_api_standard_2026-07-12",
  },
};

function toBoundedString(value, maxLength = 200) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function redactText(value, maxLength = ASSISTANT_TRACE_MAX_TRANSCRIPT_LENGTH) {
  let result = toBoundedString(value, maxLength * 2);
  if (!result) return "";

  result = result
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/gi, "[IBAN]")
    .replace(/\b[1-9]\d{12}\b/g, "[CNP]")
    .replace(/\b(?:sk|rk|pk|sess)-[A-Za-z0-9_-]{12,}\b/g, "[SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, "Bearer [SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(?<!\w)(?:\+?40|0)[\s.-]?(?:\d[\s.-]?){8,9}(?!\w)/g, "[PHONE]")
    .replace(/\b[A-Z]{1,2}[\s-]?\d{2,3}[\s-]?[A-Z]{3}\b/gi, "[PLATE]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[ID]"
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[NUMBER]")
    .replace(
      /\b(lui|utilizatorul|utilizatorului|utilizatoarea|angajatul|angajatului|angajata)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+)?/giu,
      "$1 [PERSON]"
    );

  return result.slice(0, maxLength);
}

function fingerprintAssistantTranscript(transcript, ownerUserId = "") {
  const normalized = toBoundedString(transcript, 600).toLocaleLowerCase("ro-RO");
  return crypto.createHash("sha256").update(`${ownerUserId}\0${normalized}`).digest("hex");
}

function finiteNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function extractModelTokenUsage(response) {
  const usage =
    response && typeof response.usage === "object" && response.usage ? response.usage : {};
  const inputTokens = finiteNonNegativeInteger(usage.input_tokens);
  const outputTokens = finiteNonNegativeInteger(usage.output_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    finiteNonNegativeInteger(usage.input_tokens_details?.cached_tokens)
  );

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: finiteNonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens,
  };
}

function modelRateFor(model) {
  const normalized = toBoundedString(model, 100).toLowerCase();
  if (normalized === "gpt-4.1-mini" || normalized.startsWith("gpt-4.1-mini-")) {
    return MODEL_RATES_USD_PER_MILLION["gpt-4.1-mini"];
  }
  return null;
}

function estimateModelCostUsd(model, tokenUsage) {
  const rate = modelRateFor(model);
  if (!rate) return null;

  const inputTokens = finiteNonNegativeInteger(tokenUsage?.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    finiteNonNegativeInteger(tokenUsage?.cachedInputTokens)
  );
  const outputTokens = finiteNonNegativeInteger(tokenUsage?.outputTokens);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const cost =
    (uncachedInputTokens * rate.input +
      cachedInputTokens * rate.cachedInput +
      outputTokens * rate.output) /
    1_000_000;

  return Number(cost.toFixed(8));
}

function stringList(value, maxItems = 20, maxLength = 80) {
  return Array.isArray(value)
    ? value
        .slice(0, maxItems)
        .map((item) => toBoundedString(item, maxLength))
        .filter(Boolean)
    : [];
}

function summarizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((toolCall) => {
      const input =
        toolCall && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
          ? toolCall.input
          : {};
      const fields =
        input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
          ? input.fields
          : {};
      return {
        id: toBoundedString(toolCall?.id, 100),
        inputKeys: Object.keys(input).slice(0, 30),
        fieldNames: Object.keys(fields).slice(0, 40),
      };
    })
    .filter((toolCall) => toolCall.id);
}

function summarizeInterpretation(interpreted) {
  const value =
    interpreted && typeof interpreted === "object" && !Array.isArray(interpreted)
      ? interpreted
      : {};
  return {
    version: toBoundedString(value.version, 10) || "3",
    commandType: toBoundedString(value.commandType, 60) || "unknown",
    intent: toBoundedString(value.intent, 100) || "unknown",
    targetModule: toBoundedString(value.targetModule, 80),
    entityType: toBoundedString(value.entityType, 80) || "none",
    risk: ["low", "medium", "high"].includes(value.risk) ? value.risk : "low",
    toolCalls: summarizeToolCalls(value.toolCalls),
    executionSteps: Array.isArray(value.executionPlan)
      ? value.executionPlan.slice(0, 8).map((step) => ({
          type: toBoundedString(step?.type, 80),
          requiresConfirmation: Boolean(step?.requiresConfirmation),
        }))
      : [],
  };
}

function clarificationSummary(interpreted) {
  const missingInformation = stringList(
    interpreted?.missingInformation ?? interpreted?.missingFields,
    20,
    80
  );
  const confidence = Number(interpreted?.confidence);
  const lowConfidence = !Number.isFinite(confidence) || confidence < 0.85;
  const unknownIntent = toBoundedString(interpreted?.intent, 100) === "unknown";
  return {
    required: missingInformation.length > 0 || lowConfidence || unknownIntent,
    missingInformation,
    reasons: [
      ...(missingInformation.length ? ["missing_information"] : []),
      ...(lowConfidence ? ["low_confidence"] : []),
      ...(unknownIntent ? ["unknown_intent"] : []),
    ],
  };
}

function buildAssistantTraceDocument({
  ownerUserId,
  transcript,
  interpreted,
  model,
  openAiResponse,
  latencyMs,
  nowMs = Date.now(),
  failureCategory = "",
}) {
  const tokenUsage = extractModelTokenUsage(openAiResponse);
  const clarification = failureCategory
    ? { required: false, missingInformation: [], reasons: [] }
    : clarificationSummary(interpreted);
  const confidence = Number(interpreted?.confidence);
  const status = failureCategory
    ? "interpretation_failed"
    : clarification.required
      ? "needs_clarification"
      : "interpreted";

  return {
    schemaVersion: 1,
    ownerUserId: toBoundedString(ownerUserId, 128),
    transcriptRedacted: redactText(transcript),
    transcriptFingerprint: fingerprintAssistantTranscript(transcript, ownerUserId),
    interpretation: summarizeInterpretation(interpreted),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    latencyMs: Math.max(0, finiteNonNegativeInteger(latencyMs)),
    outcome: {
      status,
      source: "server",
      failureCategory: toBoundedString(failureCategory, 80),
    },
    clarification,
    model: toBoundedString(model, 100),
    tokenUsage,
    estimatedCostUsd: estimateModelCostUsd(model, tokenUsage),
    estimatedCostSource: modelRateFor(model)?.source || null,
    createdAtClientMs: nowMs,
    expiresAt: new Date(nowMs + ASSISTANT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

function normalizeAssistantOutcomePayload(data) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const traceId = toBoundedString(value.traceId, 128);
  const transcript = toBoundedString(value.transcript, 600);
  const status = toBoundedString(value.status, 40);
  if (!ASSISTANT_OUTCOME_STATUSES.has(status)) {
    throw new TypeError("invalid_status");
  }
  if (traceId && traceId.includes("/")) throw new TypeError("invalid_trace_id");
  if (!traceId && !transcript) throw new TypeError("missing_trace_reference");

  const outcome =
    value.outcome && typeof value.outcome === "object" && !Array.isArray(value.outcome)
      ? value.outcome
      : {};
  const parsedIntent =
    outcome.parsedIntent && typeof outcome.parsedIntent === "object" ? outcome.parsedIntent : {};
  const fieldsToUpdate =
    outcome.fieldsToUpdate && typeof outcome.fieldsToUpdate === "object"
      ? outcome.fieldsToUpdate
      : {};

  return {
    traceId,
    transcript,
    status,
    details: {
      toolId: toBoundedString(parsedIntent.toolId, 100),
      module: toBoundedString(parsedIntent.module, 80),
      risk: ["low", "medium", "high"].includes(parsedIntent.risk) ? parsedIntent.risk : "low",
      fieldNames: Object.keys(fieldsToUpdate).slice(0, 40),
      resultRedacted: redactText(outcome.result, 240),
      errorRedacted: redactText(outcome.errorMessage, 240),
    },
  };
}

function isAssistantOutcomeTransitionAllowed(currentStatus, nextStatus) {
  const current = toBoundedString(currentStatus, 40);
  if (!ASSISTANT_OUTCOME_STATUSES.has(nextStatus)) return false;
  if (current === "interpretation_failed" || current === "cancelled" || current === "failed") {
    return current === nextStatus;
  }
  if (current === "executed") return nextStatus === "executed" || nextStatus === "failed";
  return current === "interpreted" || current === "needs_clarification";
}

module.exports = {
  ASSISTANT_TRACE_RETENTION_DAYS,
  buildAssistantTraceDocument,
  estimateModelCostUsd,
  extractModelTokenUsage,
  fingerprintAssistantTranscript,
  isAssistantOutcomeTransitionAllowed,
  normalizeAssistantOutcomePayload,
  redactText,
  summarizeInterpretation,
};
