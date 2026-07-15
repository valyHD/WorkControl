import { describe, expect, it } from "vitest";
import { getUserDirectorySourceName } from "./usersService";
import type { CompanyAccessContext } from "../../../lib/firebase/companyAccess";

const scopedContext: CompanyAccessContext = {
  uid: "user-a",
  role: "admin",
  globalAdmin: false,
  primaryCompanyId: "company-a",
  companyIds: ["company-a"],
};

describe("usersService directory source", () => {
  it("uses company operational views for company-scoped admins", () => {
    expect(getUserDirectorySourceName(scopedContext)).toBe("userOperationalViews");
  });

  it("uses root users collection for global admins so legacy users remain visible", () => {
    expect(getUserDirectorySourceName({ ...scopedContext, globalAdmin: true })).toBe("users");
  });
});
