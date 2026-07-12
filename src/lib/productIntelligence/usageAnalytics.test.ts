import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/analytics", () => ({
  getAnalytics: vi.fn(),
  isSupported: vi.fn(),
  logEvent: vi.fn(),
  setAnalyticsCollectionEnabled: vi.fn(),
}));
vi.mock("../firebase/firebase", () => ({ default: {} }));

import { sanitizeAnalyticsPath } from "./usageAnalytics";

describe("usage analytics privacy", () => {
  it("removes entity identifiers from tracked paths", () => {
    expect(sanitizeAnalyticsPath("/vehicles/vehicle-secret/live?tab=gps")).toBe("/vehicles/:id/live");
    expect(sanitizeAnalyticsPath("/users/user-secret/edit")).toBe("/users/:id/edit");
    expect(sanitizeAnalyticsPath("/maintenance/client-secret")).toBe("/maintenance/:id");
  });

  it("keeps known static routes", () => {
    expect(sanitizeAnalyticsPath("/vehicles/gps-map")).toBe("/vehicles/gps-map");
    expect(sanitizeAnalyticsPath("/maintenance/parts")).toBe("/maintenance/parts");
  });
});
