import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateWaitingWorkControlUpdate,
  hasWaitingWorkControlUpdate,
} from "./serviceWorkerUpdates";

class FakeServiceWorkerContainer extends EventTarget {
  registrations: ServiceWorkerRegistration[] = [];

  async getRegistrations() {
    return this.registrations;
  }
}

const originalServiceWorker = navigator.serviceWorker;

afterEach(() => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: originalServiceWorker,
  });
  vi.restoreAllMocks();
});

describe("serviceWorkerUpdates", () => {
  it("ignores unrelated waiting workers", () => {
    const registration = {
      waiting: { scriptURL: "https://example.test/other-worker.js" },
    } as ServiceWorkerRegistration;

    expect(hasWaitingWorkControlUpdate(registration)).toBe(false);
  });

  it("waits for controllerchange after requesting activation", async () => {
    const container = new FakeServiceWorkerContainer();
    const postMessage = vi.fn(() => {
      queueMicrotask(() => container.dispatchEvent(new Event("controllerchange")));
    });
    const waiting = {
      scriptURL: "https://example.test/notification-sw.js",
      postMessage,
    } as unknown as ServiceWorker;
    container.registrations = [{ waiting } as ServiceWorkerRegistration];
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });

    await expect(activateWaitingWorkControlUpdate()).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
});
