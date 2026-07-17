const COMPANY_ISOLATION_READS_FLAG = "VITE_COMPANY_ISOLATION_READS";

export function areCompanyIsolationReadsEnabled(): boolean {
  return import.meta.env.VITE_COMPANY_ISOLATION_READS !== "false";
}

export function getUserDirectoryCollectionName(): "users" | "userOperationalViews" {
  return areCompanyIsolationReadsEnabled() ? "userOperationalViews" : "users";
}

export function getUserDirectoryCollectionNameForAccess(
  globalAdmin: boolean
): "users" | "userOperationalViews" {
  return globalAdmin ? "users" : getUserDirectoryCollectionName();
}

export function getVehicleDirectoryCollectionName(): "vehicles" | "vehicleOperationalViews" {
  return areCompanyIsolationReadsEnabled() ? "vehicleOperationalViews" : "vehicles";
}

export function getCompanyIsolationReadsFlagName(): string {
  return COMPANY_ISOLATION_READS_FLAG;
}
