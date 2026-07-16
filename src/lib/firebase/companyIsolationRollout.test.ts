import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areCompanyIsolationReadsEnabled,
  getUserDirectoryCollectionName,
  getVehicleDirectoryCollectionName,
} from "./companyIsolationRollout";

describe("companyIsolationRollout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses company-safe operational collections by default", () => {
    expect(areCompanyIsolationReadsEnabled()).toBe(true);
    expect(getUserDirectoryCollectionName()).toBe("userOperationalViews");
    expect(getVehicleDirectoryCollectionName()).toBe("vehicleOperationalViews");
  });

  it("can temporarily fall back only when explicitly disabled", () => {
    vi.stubEnv("VITE_COMPANY_ISOLATION_READS", "false");

    expect(areCompanyIsolationReadsEnabled()).toBe(false);
    expect(getUserDirectoryCollectionName()).toBe("users");
    expect(getVehicleDirectoryCollectionName()).toBe("vehicles");
  });
});
