import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => name),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getCountFromServer: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  where: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("../../../lib/firebase/firebase", () => ({ db: {} }));
vi.mock("../../notifications/services/notificationsService", () => ({
  dispatchNotificationEvent: vi.fn(),
}));

describe("control panel Firestore counters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 7 }) });
  });

  it("uses count aggregations and never downloads entire collections", async () => {
    const { getCollectionCounters } = await import("./controlPanelService");
    const result = await getCollectionCounters();

    expect(Object.keys(result).length).toBeGreaterThan(5);
    expect(Object.values(result).every((value) => value === 7)).toBe(true);
    expect(firestoreMocks.getCountFromServer).toHaveBeenCalledTimes(Object.keys(result).length);
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
  });
});
