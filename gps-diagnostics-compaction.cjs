const DIAGNOSTIC_SAMPLE_BUCKET_MS = 10 * 60 * 1000;
const DIAGNOSTIC_SAMPLE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DIAGNOSTIC_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DIAGNOSTIC_RECENT_EVENT_LIMIT = 12;
const DIAGNOSTIC_RECENT_SAMPLE_LIMIT = 6;
const DIAGNOSTIC_MAX_EVENT_WRITES_PER_FLUSH = 200;
const DIAGNOSTIC_MAX_SAMPLE_WRITES_PER_FLUSH = 50;

function sanitizeDocumentId(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 240);
  return normalized || fallback;
}

function buildDiagnosticSampleDocument(sample) {
  const timestamp = Number(sample?.timestamp || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const bucket = Math.floor(timestamp / DIAGNOSTIC_SAMPLE_BUCKET_MS);
  return {
    id: String(bucket),
    payload: {
      ...sample,
      bucket,
      expiresAt: new Date(timestamp + DIAGNOSTIC_SAMPLE_RETENTION_MS),
    },
  };
}

function buildDiagnosticEventDocument(event) {
  const timestamp = Number(event?.timestamp || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const fallbackId = `event_${timestamp}`;
  return {
    id: sanitizeDocumentId(event?.key || event?.id, fallbackId),
    payload: {
      ...event,
      expiresAt: new Date(timestamp + DIAGNOSTIC_EVENT_RETENTION_MS),
    },
  };
}

function compactDiagnosticSamples(samples, maxDocuments = DIAGNOSTIC_MAX_SAMPLE_WRITES_PER_FLUSH) {
  const buckets = new Map();
  for (const sample of samples || []) {
    const document = buildDiagnosticSampleDocument(sample);
    if (!document) continue;
    const existing = buckets.get(document.id);
    if (!existing || Number(document.payload.timestamp) >= Number(existing.payload.timestamp)) {
      buckets.set(document.id, document);
    }
  }
  return [...buckets.values()]
    .sort((left, right) => Number(left.payload.timestamp) - Number(right.payload.timestamp))
    .slice(-Math.max(0, maxDocuments));
}

function compactDiagnosticEvents(events, maxDocuments = DIAGNOSTIC_MAX_EVENT_WRITES_PER_FLUSH) {
  const documents = new Map();
  for (const event of events || []) {
    const document = buildDiagnosticEventDocument(event);
    if (!document) continue;
    documents.set(document.id, document);
  }
  return [...documents.values()]
    .sort((left, right) => Number(left.payload.timestamp) - Number(right.payload.timestamp))
    .slice(-Math.max(0, maxDocuments));
}

function getRecentPayloads(documents, limit) {
  return documents
    .slice(-Math.max(0, limit))
    .map((document) => {
      const { expiresAt: _expiresAt, ...payload } = document.payload;
      return payload;
    })
    .reverse();
}

function buildDiagnosticPreview(events, samples) {
  const eventDocuments = compactDiagnosticEvents(events);
  const sampleDocuments = compactDiagnosticSamples(samples);
  return {
    eventDocuments,
    sampleDocuments,
    recentEvents: getRecentPayloads(eventDocuments, DIAGNOSTIC_RECENT_EVENT_LIMIT),
    recentSamples: getRecentPayloads(sampleDocuments, DIAGNOSTIC_RECENT_SAMPLE_LIMIT),
  };
}

module.exports = {
  DIAGNOSTIC_MAX_EVENT_WRITES_PER_FLUSH,
  DIAGNOSTIC_MAX_SAMPLE_WRITES_PER_FLUSH,
  DIAGNOSTIC_SAMPLE_BUCKET_MS,
  buildDiagnosticEventDocument,
  buildDiagnosticPreview,
  buildDiagnosticSampleDocument,
  compactDiagnosticEvents,
  compactDiagnosticSamples,
};
