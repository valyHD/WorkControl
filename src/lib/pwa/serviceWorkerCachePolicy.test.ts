import { describe, expect, it } from "vitest";
import serviceWorkerSource from "../../../public/notification-sw.js?raw";

describe("notification service worker cache policy", () => {
  it("revalidates executable assets before using the offline cache", () => {
    const executablePolicyStart = serviceWorkerSource.indexOf(
      "['script', 'style', 'worker'].includes(request.destination)"
    );
    const fontPolicyStart = serviceWorkerSource.indexOf(
      "request.destination === 'font'",
      executablePolicyStart
    );
    const executablePolicy = serviceWorkerSource.slice(
      executablePolicyStart,
      fontPolicyStart
    );

    expect(executablePolicyStart).toBeGreaterThan(-1);
    expect(executablePolicy).toContain("fetch(request, { cache: 'no-cache' })");
    expect(executablePolicy.indexOf("fetch(request")).toBeLessThan(
      executablePolicy.indexOf("cache.match(request)")
    );
  });

  it("uses a new static cache generation", () => {
    expect(serviceWorkerSource).toContain(
      "const STATIC_CACHE_NAME = 'workcontrol-static-v2'"
    );
  });
});
