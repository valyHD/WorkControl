import { describe, expect, it } from "vitest";
import {
  getMaintenancePartOrderStatusLabel,
  MAINTENANCE_PART_ORDER_STATUS_OPTIONS,
  normalizeMaintenancePartOrderStatus,
} from "./partOrderStatus";

describe("maintenance part order statuses", () => {
  it("supports the paid workflow state", () => {
    expect(normalizeMaintenancePartOrderStatus("paid")).toBe("paid");
    expect(getMaintenancePartOrderStatusLabel("paid")).toBe("Platita");
    expect(MAINTENANCE_PART_ORDER_STATUS_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining(["ordered", "paid", "installed"])
    );
  });

  it("falls back safely for legacy invalid values", () => {
    expect(normalizeMaintenancePartOrderStatus("unknown-status")).toBe("requested");
    expect(normalizeMaintenancePartOrderStatus(null)).toBe("requested");
  });
});
