import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));
vi.mock("../../../lib/firebase/firebase", () => ({ db: {} }));

import { classifyInboxPriority } from "./operationalInboxService";

const base = {
  title: "Informare",
  message: "Mesaj general",
  module: "general",
  eventType: "notice",
  read: false,
  createdAt: Date.now(),
};

describe("operational inbox priority", () => {
  it("puts critical failures before normal information", () => {
    expect(classifyInboxPriority({ ...base, title: "Eroare critica" }).priority).toBe("critical");
    expect(classifyInboxPriority(base).priority).toBe("info");
  });

  it("recognizes events that require action", () => {
    expect(classifyInboxPriority({ ...base, message: "Verifica pontajul neinchis" }).priority).toBe("action");
  });
});
