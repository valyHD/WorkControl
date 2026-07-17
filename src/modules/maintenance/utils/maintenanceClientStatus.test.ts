import { describe, expect, it } from "vitest";
import type { MaintenanceClient } from "../../../types/maintenance";
import {
  filterActiveMaintenanceClients,
  isMaintenanceClientActive,
  normalizeMaintenanceClientStatus,
} from "./maintenanceClientStatus";

function client(id: string, status?: MaintenanceClient["status"]): MaintenanceClient {
  return {
    id,
    status,
    name: id,
    email: "",
    emails: [],
    address: "",
    liftNumber: "",
    liftNumbers: [],
    expiryDate: "",
    maintenanceCompany: "",
    contactPerson: "",
    contactPhone: "",
    createdAt: 0,
    updatedAt: 0,
    addresses: [],
  };
}

describe("maintenance client status", () => {
  it("treats legacy clients without a status as active", () => {
    expect(normalizeMaintenanceClientStatus(undefined)).toBe("active");
    expect(isMaintenanceClientActive(client("legacy"))).toBe(true);
  });

  it("excludes only explicitly inactive clients from operational lists", () => {
    const legacy = client("legacy");
    const active = client("active", "active");
    const inactive = client("inactive", "inactive");

    expect(filterActiveMaintenanceClients([legacy, active, inactive])).toEqual([
      legacy,
      active,
    ]);
  });
});
