import { describe, expect, it } from "vitest";
import { evaluateInternalAccessProfile } from "./internalAccessPolicy";

describe("evaluateInternalAccessProfile", () => {
  it("refuza contul necunoscut", () => {
    expect(evaluateInternalAccessProfile(null)).toMatchObject({
      allowed: false,
      status: "unknown",
    });
  });

  it("refuza utilizatorii disabled si pending", () => {
    expect(
      evaluateInternalAccessProfile({ active: false, role: "angajat" })
    ).toMatchObject({ allowed: false, status: "disabled" });
    expect(
      evaluateInternalAccessProfile({
        active: false,
        accessStatus: "pending",
        role: "angajat",
      })
    ).toMatchObject({ allowed: false, status: "pending" });
  });

  it("permite utilizatorii interni activi creati de admin", () => {
    for (const role of ["admin", "manager", "angajat"]) {
      expect(
        evaluateInternalAccessProfile({ active: true, accessStatus: "active", role })
      ).toEqual({ allowed: true, status: "active", message: "" });
    }
  });

  it("refuza un profil legacy fara accessStatus explicit", () => {
    expect(
      evaluateInternalAccessProfile({ active: true, role: "angajat" })
    ).toMatchObject({ allowed: false, status: "unknown" });
  });

  it("refuza un profil activ fara rol intern valid", () => {
    expect(
      evaluateInternalAccessProfile({ active: true, role: "external" })
    ).toMatchObject({ allowed: false, status: "unknown" });
  });
});
