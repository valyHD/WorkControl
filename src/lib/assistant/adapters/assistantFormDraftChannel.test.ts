import { describe, expect, it, vi } from "vitest";
import {
  dispatchAssistantFormDraft,
  hasAssistantFormDraftAdapter,
  registerAssistantFormDraftAdapter,
} from "./assistantFormDraftChannel";

describe("assistant form draft channel", () => {
  it("waits for the page adapter and sends a frozen draft", async () => {
    const adapterId = "test:delayed-form";
    const handler = vi.fn();
    const pending = dispatchAssistantFormDraft(adapterId, { name: "Isomat" }, 100);
    const unregister = registerAssistantFormDraftAdapter(adapterId, handler);

    await expect(pending).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ name: "Isomat" });
    expect(Object.isFrozen(handler.mock.calls[0][0])).toBe(true);

    unregister();
    expect(hasAssistantFormDraftAdapter(adapterId)).toBe(false);
  });

  it("does not guess a destination when no page adapter is registered", async () => {
    await expect(
      dispatchAssistantFormDraft("test:missing-form", { name: "Nu completa" }, 1)
    ).resolves.toBe(false);
  });
});
