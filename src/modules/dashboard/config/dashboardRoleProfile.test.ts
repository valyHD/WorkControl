import { describe, expect, it } from "vitest";
import { getDashboardRoleProfile } from "./dashboardRoleProfile";

describe("dashboard role profile", () => {
  it("shows company and billing context only to admins", () => {
    expect(getDashboardRoleProfile("admin").description).toContain("costuri");
    expect(getDashboardRoleProfile("manager").description).not.toContain("costuri");
  });

  it("uses a personal command center for employees", () => {
    const profile = getDashboardRoleProfile("angajat");
    expect(profile.title).toContain("mea");
    expect(profile.description).toContain("tale");
  });
});
