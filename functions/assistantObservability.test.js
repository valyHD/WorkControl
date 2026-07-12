const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildAssistantTraceDocument,
  estimateModelCostUsd,
  extractModelTokenUsage,
  isAssistantOutcomeTransitionAllowed,
  normalizeAssistantOutcomePayload,
  redactText,
} = require("./assistantObservability");

test("redacts transcript identifiers and never adds raw audio to a trace", () => {
  const transcript =
    "Scrie utilizatorului Ion Popescu la ionut@example.com si 0722 123 456 despre B 123 ABC, CNP 1960523123456 si sk-test_secret_123456789.";
  const redacted = redactText(transcript);
  assert.doesNotMatch(
    redacted,
    /Ion Popescu|ionut@example\.com|0722 123 456|B 123 ABC|1960523123456|sk-test_secret/
  );
  assert.match(redacted, /\[PERSON\]|\[EMAIL\]|\[PHONE\]|\[PLATE\]|\[CNP\]|\[SECRET\]/);

  const trace = buildAssistantTraceDocument({
    ownerUserId: "user-1",
    transcript,
    interpreted: { intent: "open_page", confidence: 0.95, toolCalls: [] },
    model: "gpt-4.1-mini",
    openAiResponse: {},
    latencyMs: 42,
    nowMs: Date.UTC(2026, 6, 12),
    rawAudio: Buffer.from("must-not-be-stored"),
  });
  assert.equal(Object.hasOwn(trace, "rawAudio"), false);
  assert.equal(trace.expiresAt.toISOString(), "2026-08-11T00:00:00.000Z");

  const failedTrace = buildAssistantTraceDocument({
    ownerUserId: "user-1",
    transcript: "Comanda",
    interpreted: null,
    model: "gpt-4.1-mini",
    openAiResponse: null,
    latencyMs: 42,
    failureCategory: "network_error",
  });
  assert.equal(failedTrace.outcome.status, "interpretation_failed");
  assert.equal(failedTrace.clarification.required, false);
});

test("summarizes tool calls without persisting tool input values", () => {
  const trace = buildAssistantTraceDocument({
    ownerUserId: "user-1",
    transcript: "Actualizeaza masina",
    interpreted: {
      version: "3",
      intent: "update_vehicle",
      confidence: 0.96,
      toolCalls: [
        {
          id: "vehicles.update",
          input: {
            entityQuery: "Ion Popescu",
            fields: { ownerName: "Ion Popescu", currentKm: 12345 },
          },
        },
      ],
    },
    model: "gpt-4.1-mini",
    openAiResponse: {},
    latencyMs: 12,
  });
  const serialized = JSON.stringify(trace.interpretation);
  assert.match(serialized, /vehicles\.update|ownerName|currentKm/);
  assert.doesNotMatch(serialized, /Ion Popescu|12345/);
});

test("extracts Responses API usage and estimates known model cost", () => {
  const usage = extractModelTokenUsage({
    usage: {
      input_tokens: 1_000,
      output_tokens: 200,
      total_tokens: 1_200,
      input_tokens_details: { cached_tokens: 400 },
    },
  });
  assert.deepEqual(usage, {
    inputTokens: 1_000,
    cachedInputTokens: 400,
    outputTokens: 200,
    totalTokens: 1_200,
  });
  assert.equal(estimateModelCostUsd("gpt-4.1-mini", usage), 0.0006);
  assert.equal(estimateModelCostUsd("unknown-model", usage), null);
});

test("validates client outcomes and terminal status transitions", () => {
  const normalized = normalizeAssistantOutcomePayload({
    transcript: "Actualizeaza masina B 123 ABC",
    status: "executed",
    outcome: {
      parsedIntent: { toolId: "vehicles.update", module: "vehicles", risk: "medium" },
      fieldsToUpdate: { currentKm: 12345 },
      beforeData: { currentKm: 12000 },
      afterData: { currentKm: 12345 },
      result: "Actualizat pentru ionut@example.com",
    },
  });
  assert.deepEqual(normalized.details.fieldNames, ["currentKm"]);
  assert.doesNotMatch(JSON.stringify(normalized), /12000|12345|ionut@example\.com/);
  assert.equal(isAssistantOutcomeTransitionAllowed("interpreted", "executed"), true);
  assert.equal(isAssistantOutcomeTransitionAllowed("executed", "failed"), true);
  assert.equal(isAssistantOutcomeTransitionAllowed("failed", "executed"), false);
  assert.throws(
    () => normalizeAssistantOutcomePayload({ transcript: "x", status: "pending" }),
    /invalid_status/
  );
});

test("integration keeps Firestore writes server-owned and OpenAI bodies out of logs", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const rules = fs.readFileSync(path.resolve(__dirname, "..", "firestore.rules"), "utf8");
  const indexes = fs.readFileSync(path.resolve(__dirname, "..", "firestore.indexes.json"), "utf8");

  assert.match(indexSource, /exports\.recordAssistantTraceOutcome = onCall/);
  assert.match(indexSource, /trace\.get\('ownerUserId'\) !== request\.auth\.uid/);
  assert.doesNotMatch(
    indexSource,
    /logger\.error\('\[interpretAssistantCommand\]\[openai\]', responseText\)/
  );
  assert.match(
    rules,
    /match \/aiCommandLogs\/\{traceId\}[\s\S]*allow read: if isAdminUser\(\);[\s\S]*allow write: if false;/
  );
  assert.match(
    indexes,
    /"collectionGroup": "aiCommandLogs"[\s\S]*"fieldPath": "expiresAt"[\s\S]*"ttl": true/
  );

  for (const toolId of [
    "navigation.open",
    "vehicles.update",
    "vehicles.draft",
    "tools.update",
    "tools.draft",
    "timesheets.projects.update",
    "timesheets.projects.create",
    "timesheets.projects.draft",
    "users.update",
    "users.draft",
    "timesheets.start",
    "timesheets.stop",
    "maintenance.draft",
    "leave.draft",
    "expenses.draft",
  ]) {
    assert.match(indexSource, new RegExp(toolId.replaceAll(".", "\\.")));
  }
});
