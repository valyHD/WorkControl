export type FirestoreQueryTelemetryItem = {
  module: string;
  operation: string;
  queries: number;
  documents: number;
  durationMs: number;
  reason: string;
  estimatedBytes?: number;
  avoidedBytes?: number;
  cacheHits?: number;
  avoidedQueries?: number;
  avoidedDocuments?: number;
};

export type FirestoreQueryTelemetrySnapshot = {
  startedAt: number;
  activeListeners: number;
  queries: number;
  documents: number;
  averageDocumentsPerQuery: number;
  estimatedBytes?: number;
  avoidedBytes?: number;
  cacheHits?: number;
  avoidedQueries?: number;
  avoidedDocuments?: number;
  topConsumers: FirestoreQueryTelemetryItem[];
};

type MutableTelemetryItem = FirestoreQueryTelemetryItem;

const startedAt = Date.now();
const items = new Map<string, MutableTelemetryItem>();
let activeListeners = 0;

function keyFor(module: string, operation: string) {
  return `${module}:${operation}`;
}

export function recordFirestoreQuery(params: {
  module: string;
  operation: string;
  documents: number;
  durationMs?: number;
  reason: string;
  estimatedBytes?: number;
}) {
  const key = keyFor(params.module, params.operation);
  const current = items.get(key) ?? {
    module: params.module,
    operation: params.operation,
    queries: 0,
    documents: 0,
    durationMs: 0,
    reason: params.reason,
    estimatedBytes: 0,
    avoidedBytes: 0,
    cacheHits: 0,
    avoidedQueries: 0,
    avoidedDocuments: 0,
  };
  current.queries += 1;
  current.documents += Math.max(0, Math.round(params.documents));
  current.durationMs += Math.max(0, Math.round(params.durationMs ?? 0));
  current.estimatedBytes = (current.estimatedBytes ?? 0) +
    Math.max(0, Math.round(params.estimatedBytes ?? 0));
  current.reason = params.reason;
  items.set(key, current);

  if (import.meta.env.DEV && current.queries <= 3) {
    console.debug("[Firestore query]", { ...params });
  }
}

export async function trackedFirestoreQuery<T>(params: {
  module: string;
  operation: string;
  reason: string;
  run: () => Promise<T>;
  countDocuments: (value: T) => number;
}): Promise<T> {
  const started = performance.now();
  const value = await params.run();
  recordFirestoreQuery({
    module: params.module,
    operation: params.operation,
    documents: params.countDocuments(value),
    durationMs: performance.now() - started,
    reason: params.reason,
  });
  return value;
}

function getOrCreateItem(module: string, operation: string, reason: string) {
  const key = keyFor(module, operation);
  const current = items.get(key) ?? {
    module,
    operation,
    queries: 0,
    documents: 0,
    durationMs: 0,
    reason,
    estimatedBytes: 0,
    avoidedBytes: 0,
    cacheHits: 0,
    avoidedQueries: 0,
    avoidedDocuments: 0,
  };
  current.reason = reason;
  items.set(key, current);
  return current;
}

export function recordFirestoreCacheHit(params: {
  module: string;
  operation: string;
  avoidedDocuments?: number;
  estimatedBytes?: number;
}) {
  const current = getOrCreateItem(params.module, params.operation, "cache local");
  current.cacheHits = (current.cacheHits ?? 0) + 1;
  current.avoidedQueries = (current.avoidedQueries ?? 0) + 1;
  current.avoidedDocuments = (current.avoidedDocuments ?? 0) +
    Math.max(0, Math.round(params.avoidedDocuments ?? 0));
  current.avoidedBytes = (current.avoidedBytes ?? 0) +
    Math.max(0, Math.round(params.estimatedBytes ?? 0));
}

export function recordFirestoreAvoidedQuery(params: {
  module: string;
  operation: string;
  documents?: number;
  estimatedBytes?: number;
  reason: string;
}) {
  const current = getOrCreateItem(params.module, params.operation, params.reason);
  current.avoidedQueries = (current.avoidedQueries ?? 0) + 1;
  current.avoidedDocuments = (current.avoidedDocuments ?? 0) +
    Math.max(0, Math.round(params.documents ?? 0));
  current.avoidedBytes = (current.avoidedBytes ?? 0) +
    Math.max(0, Math.round(params.estimatedBytes ?? 0));
}

export function estimateFirestorePayloadBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function registerFirestoreListener(count = 1) {
  const safeCount = Math.max(1, Math.round(count));
  activeListeners += safeCount;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeListeners = Math.max(0, activeListeners - safeCount);
  };
}

export function getFirestoreQueryTelemetry(): FirestoreQueryTelemetrySnapshot {
  const allItems = [...items.values()].map((item) => ({ ...item }));
  const topConsumers = allItems
    .sort((a, b) => b.documents - a.documents || b.queries - a.queries)
    .slice(0, 10);
  const queries = allItems.reduce((sum, item) => sum + item.queries, 0);
  const documents = allItems.reduce((sum, item) => sum + item.documents, 0);
  const estimatedBytes = allItems.reduce((sum, item) => sum + Math.max(0, item.estimatedBytes ?? 0), 0);
  const avoidedBytes = allItems.reduce((sum, item) => sum + Math.max(0, item.avoidedBytes ?? 0), 0);
  const cacheHits = allItems.reduce((sum, item) => sum + (item.cacheHits ?? 0), 0);
  const avoidedQueries = allItems.reduce((sum, item) => sum + (item.avoidedQueries ?? 0), 0);
  const avoidedDocuments = allItems.reduce((sum, item) => sum + (item.avoidedDocuments ?? 0), 0);
  return {
    startedAt,
    activeListeners,
    queries,
    documents,
    averageDocumentsPerQuery: queries > 0 ? documents / queries : 0,
    estimatedBytes,
    avoidedBytes,
    cacheHits,
    avoidedQueries,
    avoidedDocuments,
    topConsumers,
  };
}

export function resetFirestoreQueryTelemetryForTests() {
  items.clear();
  activeListeners = 0;
}
