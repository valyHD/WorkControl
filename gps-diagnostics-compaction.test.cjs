const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DIAGNOSTIC_MAX_EVENT_WRITES_PER_FLUSH,
  DIAGNOSTIC_MAX_SAMPLE_WRITES_PER_FLUSH,
  buildDiagnosticPreview,
  compactDiagnosticEvents,
  compactDiagnosticSamples,
} = require("./gps-diagnostics-compaction.cjs");

test("keeps only the newest sample in each ten-minute bucket", () => {
  const base = Date.UTC(2026, 6, 22, 8, 0, 0);
  const documents = compactDiagnosticSamples([
    { timestamp: base + 10_000, speedKmh: 20 },
    { timestamp: base + 50_000, speedKmh: 30 },
    { timestamp: base + 11 * 60_000, speedKmh: 40 },
  ]);

  assert.equal(documents.length, 2);
  assert.equal(documents[0].payload.speedKmh, 30);
  assert.equal(documents[1].payload.speedKmh, 40);
});

test("caps each diagnostic flush below the Firestore transaction write limit", () => {
  const base = Date.UTC(2026, 6, 22, 8, 0, 0);
  const samples = Array.from({ length: 80 }, (_, index) => ({
    timestamp: base + index * 10 * 60_000,
    speedKmh: index,
  }));
  const events = Array.from({ length: 300 }, (_, index) => ({
    key: `event:${index}`,
    timestamp: base + index * 60_000,
  }));

  assert.equal(compactDiagnosticSamples(samples).length, DIAGNOSTIC_MAX_SAMPLE_WRITES_PER_FLUSH);
  assert.equal(compactDiagnosticEvents(events).length, DIAGNOSTIC_MAX_EVENT_WRITES_PER_FLUSH);
});

test("uses deterministic event documents and a small recent preview", () => {
  const base = Date.UTC(2026, 6, 22, 8, 0, 0);
  const events = Array.from({ length: 20 }, (_, index) => ({
    id: `high_load:${index}`,
    key: `high_load:${index}`,
    timestamp: base + index * 60_000,
    label: "Sarcina motor mare",
  }));
  const documents = compactDiagnosticEvents([...events, events[0]]);
  const preview = buildDiagnosticPreview(events, []);

  assert.equal(documents.length, 20);
  assert.equal(preview.recentEvents.length, 12);
  assert.equal(preview.recentEvents[0].key, "high_load:19");
});
