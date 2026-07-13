export type FirestoreQueryTelemetryItem = {
  module: string;
  operation: string;
  queries: number;
  documents: number;
  durationMs: number;
  reason: string;
};

export type FirestoreQueryTelemetrySnapshot = {
  startedAt: number;
  activeListeners: number;
  queries: number;
  documents: number;
  averageDocumentsPerQuery: number;
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
}) {
  const key = keyFor(params.module, params.operation);
  const current = items.get(key) ?? {
    module: params.module,
    operation: params.operation,
    queries: 0,
    documents: 0,
    durationMs: 0,
    reason: params.reason,
  };
  current.queries += 1;
  current.documents += Math.max(0, Math.round(params.documents));
  current.durationMs += Math.max(0, Math.round(params.durationMs ?? 0));
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

export function registerFirestoreListener() {
  activeListeners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeListeners = Math.max(0, activeListeners - 1);
  };
}

export function getFirestoreQueryTelemetry(): FirestoreQueryTelemetrySnapshot {
  const allItems = [...items.values()].map((item) => ({ ...item }));
  const topConsumers = allItems
    .sort((a, b) => b.documents - a.documents || b.queries - a.queries)
    .slice(0, 10);
  const queries = allItems.reduce((sum, item) => sum + item.queries, 0);
  const documents = allItems.reduce((sum, item) => sum + item.documents, 0);
  return {
    startedAt,
    activeListeners,
    queries,
    documents,
    averageDocumentsPerQuery: queries > 0 ? documents / queries : 0,
    topConsumers,
  };
}

export function resetFirestoreQueryTelemetryForTests() {
  items.clear();
  activeListeners = 0;
}
