import { describe, expect, it } from "vitest";
import {
  canAccessCompany,
  requireCompanyScope,
  requirePrimaryCompanyId,
  type CompanyAccessContext,
} from "./companyAccess";

const scopedContext: CompanyAccessContext = {
  uid: "user-1",
  role: "manager",
  globalAdmin: false,
  primaryCompanyId: "company-a",
  companyIds: ["company-a", "company-b"],
};

describe("companyAccess", () => {
  it("foloseste firma principala pentru scrieri", () => {
    expect(requirePrimaryCompanyId(scopedContext)).toBe("company-a");
  });

  it("refuza un context ambiguu fara firma principala", () => {
    expect(() =>
      requirePrimaryCompanyId({
        ...scopedContext,
        primaryCompanyId: "",
        companyIds: ["company-a", "company-b"],
      })
    ).toThrow(/firma principala/i);
  });

  it("permite numai companiile asignate, exceptand adminul global", () => {
    expect(canAccessCompany(scopedContext, "company-a")).toBe(true);
    expect(canAccessCompany(scopedContext, "company-c")).toBe(false);
    expect(canAccessCompany({ ...scopedContext, globalAdmin: true }, "company-c")).toBe(true);
  });

  it("refuza interogarile fara firma si nu limiteaza adminul global", () => {
    expect(() =>
      requireCompanyScope({ ...scopedContext, primaryCompanyId: "", companyIds: [] })
    ).toThrow(/nicio firma/i);
    expect(requireCompanyScope({ ...scopedContext, globalAdmin: true })).toEqual([]);
  });
});
