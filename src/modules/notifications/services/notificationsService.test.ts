import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
}));
vi.mock("../../../lib/firebase/firebase", () => ({ db: {} }));
vi.mock("../../audit/services/auditLogService", () => ({ createAuditLog: vi.fn() }));

import { getNotificationIdsToPrune } from "./notificationsService";

describe("notification retention", () => {
  it("keeps the ten newest notification ids and prunes only older ids", () => {
    const ids = Array.from({ length: 14 }, (_, index) => `notification-${index + 1}`);

    expect(getNotificationIdsToPrune(ids, 10)).toEqual([
      "notification-11",
      "notification-12",
      "notification-13",
      "notification-14",
    ]);
    expect(getNotificationIdsToPrune(ids.slice(0, 10), 10)).toEqual([]);
  });
});
