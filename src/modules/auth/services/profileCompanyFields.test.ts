import { describe, expect, it, vi } from "vitest";
import {
  getProfileCompanyFields,
  getResolvedProfileCompanyFields,
} from "./profileCompanyFields";

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn((...parts: unknown[]) => ({ parts })),
  getDoc: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMocks);
vi.mock("../../../lib/firebase/firebase", () => ({ db: { project: "test" } }));

describe("profile company fields", () => {
  it("normalizes legacy profiles that only have primaryCompanyId", () => {
    expect(getProfileCompanyFields({ primaryCompanyId: "company-a" })).toEqual({
      companyIds: ["company-a"],
      companyNames: [],
      primaryCompanyId: "company-a",
      primaryCompanyName: "",
    });
  });

  it("resolves the company name from the company registry when profile names are missing", async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ companyName: "Company A" }),
    });

    await expect(getResolvedProfileCompanyFields({ primaryCompanyId: "company-a" })).resolves.toEqual({
      companyIds: ["company-a"],
      companyNames: ["Company A"],
      primaryCompanyId: "company-a",
      primaryCompanyName: "Company A",
    });
    expect(firestoreMocks.doc).toHaveBeenCalledWith({ project: "test" }, "firmeMentenanta", "company-a");
  });
});
