import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";

export type AssistantObservabilityTrace = {
  id: string;
  transcript: string;
  intent: string;
  targetModule: string;
  toolCallIds: string[];
  confidence: number | null;
  latencyMs: number;
  outcome: string;
  clarificationRequired: boolean;
  missingInformation: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  createdAt: number | null;
  expiresAt: number | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalFiniteNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMillis(value: unknown) {
  if (!value || typeof value !== "object" || !("toMillis" in value)) return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  const parsed = Number(toMillis.call(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseTrace(id: string, raw: unknown): AssistantObservabilityTrace {
  const data = recordValue(raw);
  const interpretation = recordValue(data.interpretation);
  const outcome = recordValue(data.outcome);
  const clarification = recordValue(data.clarification);
  const tokenUsage = recordValue(data.tokenUsage);
  const toolCalls = Array.isArray(interpretation.toolCalls) ? interpretation.toolCalls : [];

  return {
    id,
    transcript: textValue(data.transcriptRedacted, "[redacted]"),
    intent: textValue(interpretation.intent, "unknown"),
    targetModule: textValue(interpretation.targetModule),
    toolCallIds: toolCalls.map((toolCall) => textValue(recordValue(toolCall).id)).filter(Boolean),
    confidence: optionalFiniteNumber(data.confidence),
    latencyMs: Math.max(0, finiteNumber(data.latencyMs)),
    outcome: textValue(outcome.status, "unknown"),
    clarificationRequired: Boolean(clarification.required),
    missingInformation: stringArray(clarification.missingInformation),
    model: textValue(data.model, "unknown"),
    inputTokens: Math.max(0, finiteNumber(tokenUsage.inputTokens)),
    outputTokens: Math.max(0, finiteNumber(tokenUsage.outputTokens)),
    totalTokens: Math.max(0, finiteNumber(tokenUsage.totalTokens)),
    estimatedCostUsd: optionalFiniteNumber(data.estimatedCostUsd),
    createdAt: timestampMillis(data.createdAtServer),
    expiresAt: timestampMillis(data.expiresAt),
  };
}

export async function getAssistantObservabilityTraces(maxItems = 100) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(maxItems)));
  const snapshot = await getDocs(
    query(collection(db, "aiCommandLogs"), orderBy("createdAtServer", "desc"), limit(boundedLimit))
  );
  return snapshot.docs.map((item) => parseTrace(item.id, item.data()));
}
