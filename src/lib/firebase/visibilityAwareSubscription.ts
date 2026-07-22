import { registerFirestoreListener } from "./firestoreQueryTelemetry";

type VisibilityDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

export type VisibilityAwareSubscriptionOptions = {
  listenerCount?: number;
  documentRef?: VisibilityDocument | null;
};

export function createVisibilityAwareSubscription(
  start: () => () => void,
  options: VisibilityAwareSubscriptionOptions = {}
): () => void {
  const documentRef = options.documentRef === undefined
    ? (typeof document === "undefined" ? null : document)
    : options.documentRef;
  const listenerCount = Math.max(1, Math.round(options.listenerCount ?? 1));
  let disposed = false;
  let stopActive: (() => void) | null = null;

  const stop = () => {
    if (!stopActive) return;
    const current = stopActive;
    stopActive = null;
    current();
  };

  const startIfVisible = () => {
    if (disposed || stopActive || documentRef?.visibilityState === "hidden") return;
    const releaseTelemetry = registerFirestoreListener(listenerCount);
    try {
      const unsubscribe = start();
      stopActive = () => {
        unsubscribe();
        releaseTelemetry();
      };
    } catch (error) {
      releaseTelemetry();
      throw error;
    }
  };

  const handleVisibility = () => {
    if (documentRef?.visibilityState === "hidden") {
      stop();
      return;
    }
    startIfVisible();
  };

  documentRef?.addEventListener("visibilitychange", handleVisibility);
  startIfVisible();

  return () => {
    disposed = true;
    documentRef?.removeEventListener("visibilitychange", handleVisibility);
    stop();
  };
}
