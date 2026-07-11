import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn((...parts: unknown[]) => ({ parts })),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock("firebase/functions", () => ({ httpsCallable: vi.fn() }));
vi.mock("firebase/storage", () => storageMocks);
vi.mock("../../../lib/firebase/firebase", () => ({
  db: { project: "test" },
  functions: { project: "test" },
  storage: { project: "test" },
}));
vi.mock("../../notifications/services/notificationsService", () => ({
  dispatchNotificationEvent: vi.fn(),
}));
vi.mock("../../timesheets/services/timesheetsService", () => ({
  getActiveProjectsList: vi.fn().mockResolvedValue([]),
}));

import { uploadExpenseFile } from "./expensesService";

describe("expense upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    storageMocks.getDownloadURL.mockResolvedValue("https://example.test/receipt.jpg");
    storageMocks.uploadBytes.mockResolvedValue(undefined);
  });

  it("uploads the selected receipt to the test user's isolated storage path", async () => {
    const file = new File(["receipt"], "bon test.jpg", { type: "image/jpeg" });

    const result = await uploadExpenseFile({
      file,
      user: { id: "expense-user-test", fullName: "Utilizator Test" },
    });

    expect(storageMocks.ref).toHaveBeenCalledWith(
      expect.anything(),
      "expenses/expense-user-test/1750000000000_bon_test.jpg"
    );
    expect(storageMocks.uploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("expense-user-test") }),
      file,
      expect.objectContaining({ contentType: "image/jpeg" })
    );
    expect(result).toMatchObject({
      fileName: "bon test.jpg",
      fileUrl: "https://example.test/receipt.jpg",
      extension: "jpg",
    });
  });
});
