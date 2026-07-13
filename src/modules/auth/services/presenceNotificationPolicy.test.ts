import { describe, expect, it } from "vitest";
import { shouldDispatchSiteEnteredNotification } from "./presenceNotificationPolicy";

describe("shouldDispatchSiteEnteredNotification", () => {
  it("skips company-scoped notifications for a global admin without a company", () => {
    expect(
      shouldDispatchSiteEnteredNotification({
        globalAdmin: true,
        primaryCompanyId: "",
        companyIds: [],
      })
    ).toBe(false);
  });

  it("keeps notifications enabled when the global admin has a company", () => {
    expect(
      shouldDispatchSiteEnteredNotification({
        globalAdmin: true,
        companyIds: ["company-1"],
      })
    ).toBe(true);
  });

  it("keeps notifications enabled for regular company users", () => {
    expect(
      shouldDispatchSiteEnteredNotification({
        globalAdmin: false,
        primaryCompanyId: "company-1",
      })
    ).toBe(true);
  });
});
