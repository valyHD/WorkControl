import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCompanyScopeConstraints,
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("aplica filtre company-aware implicit si permite dezactivarea explicita", () => {
    expect(buildCompanyScopeConstraints(scopedContext)).toHaveLength(1);

    vi.stubEnv("VITE_COMPANY_ISOLATION_READS", "false");
    expect(buildCompanyScopeConstraints(scopedContext)).toEqual([]);
  });
});
