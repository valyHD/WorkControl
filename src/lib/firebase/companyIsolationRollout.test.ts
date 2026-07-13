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

  it("keeps legacy collections until the migration flag is explicitly enabled", () => {
    expect(areCompanyIsolationReadsEnabled()).toBe(false);
    expect(getUserDirectoryCollectionName()).toBe("users");
    expect(getVehicleDirectoryCollectionName()).toBe("vehicles");
  });

  it("uses operational views only after explicit activation", () => {
    vi.stubEnv("VITE_COMPANY_ISOLATION_READS", "true");

    expect(areCompanyIsolationReadsEnabled()).toBe(true);
    expect(getUserDirectoryCollectionName()).toBe("userOperationalViews");
    expect(getVehicleDirectoryCollectionName()).toBe("vehicleOperationalViews");
  });
});
