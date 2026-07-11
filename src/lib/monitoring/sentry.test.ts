import type { ErrorEvent } from "@sentry/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

vi.mock("@sentry/react", () => sentryMocks);

import { initSentry, sanitizeSentryEvent } from "./sentry";

describe("Sentry privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("stays disabled without an explicit DSN", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");

    initSentry();

    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it("drops breadcrumbs and potentially personal event values", () => {
    const event = {
      breadcrumbs: [{ category: "navigation", data: { to: "/users/private-user" } }],
      exception: { values: [{ type: "Error", value: "private@example.test" }] },
      extra: { componentStack: "ComponentA > ComponentB", email: "private@example.test" },
      message: "private@example.test",
      request: { url: "/users/private-user" },
      transaction: "/users/private-user",
      type: undefined,
      user: { email: "private@example.test" },
    } as ErrorEvent;

    expect(sanitizeSentryEvent(event)).toEqual({
      exception: { values: [{ type: "Error" }] },
      extra: { componentStack: "ComponentA > ComponentB" },
      type: undefined,
    });
  });

  it("configures Sentry without automatic breadcrumbs", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");

    initSentry();

    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeBreadcrumb: () => null;
      beforeSend: (event: ErrorEvent) => ErrorEvent;
      sendDefaultPii: boolean;
      tracesSampleRate: number;
    };
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeBreadcrumb()).toBeNull();
    expect(options.beforeSend({ message: "private", type: undefined } as ErrorEvent)).toEqual({
      type: undefined,
    });
  });
});
