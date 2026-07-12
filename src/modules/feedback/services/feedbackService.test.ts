import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock("../../../lib/firebase/firebase", () => ({ db: {} }));

import { validateFeedbackInput } from "./feedbackService";

describe("feedback validation", () => {
  it("normalizes a valid privacy-safe feedback payload", () => {
    expect(validateFeedbackInput({
      ownerUserId: "user-1",
      category: "idea",
      message: "  Un flux mai simplu  ",
      path: "/dashboard",
    })).toMatchObject({ message: "Un flux mai simplu", category: "idea" });
  });

  it("rejects invalid categories and short messages", () => {
    expect(() => validateFeedbackInput({ ownerUserId: "user-1", category: "unsafe", message: "mesaj", path: "/" })).toThrow(/categoria/i);
    expect(() => validateFeedbackInput({ ownerUserId: "user-1", category: "idea", message: "nu", path: "/" })).toThrow(/5 caractere/i);
  });
});
