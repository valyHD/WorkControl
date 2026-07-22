import { describe, expect, it, vi } from "vitest";
import { createVisibilityAwareSubscription } from "./visibilityAwareSubscription";

function createVisibilityDocument(initial: DocumentVisibilityState) {
  let visibilityState = initial;
  const listeners = new Set<EventListener>();
  return {
    documentRef: {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") listeners.delete(listener);
      },
    } as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
    setVisibility(next: DocumentVisibilityState) {
      visibilityState = next;
      listeners.forEach((listener) => listener(new Event("visibilitychange")));
    },
  };
}

describe("createVisibilityAwareSubscription", () => {
  it("pauses while hidden and restarts once when visible", () => {
    const visibility = createVisibilityDocument("visible");
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const dispose = createVisibilityAwareSubscription(start, {
      documentRef: visibility.documentRef,
    });

    expect(start).toHaveBeenCalledTimes(1);
    visibility.setVisibility("hidden");
    expect(stop).toHaveBeenCalledTimes(1);
    visibility.setVisibility("visible");
    visibility.setVisibility("visible");
    expect(start).toHaveBeenCalledTimes(2);

    dispose();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
