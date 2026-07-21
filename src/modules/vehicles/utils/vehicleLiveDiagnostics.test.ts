import { describe, expect, it } from "vitest";
import type { VehicleDailyDiagnosticEvent, VehicleLiveDiagnostics } from "../../../types/vehicle";
import {
  getActionableDiagnosticEvents,
  hasStoredObdValues,
  readLatestDiagnosticNumber,
} from "./vehicleLiveDiagnostics";

const event = (type: string): VehicleDailyDiagnosticEvent => ({
  id: type,
  type,
  label: type,
  timestamp: 1,
  severity: "info",
});

describe("vehicle live diagnostics", () => {
  it("does not present calculated engine load alone as an unusual event", () => {
    expect(
      getActionableDiagnosticEvents([
        event("high_engine_load"),
        { ...event("high_coolant_temp"), severity: "warning" },
      ]).map((item) => item.type)
    ).toEqual(["high_coolant_temp"]);
  });

  it("keeps the newest stored OBD value visible when the live packet expires", () => {
    const diagnostics: VehicleLiveDiagnostics = { obd: { engineRpm: 3175 } };

    expect(readLatestDiagnosticNumber(diagnostics, { engineRpm: 2800 }, "engineRpm")).toBe(3175);
    expect(readLatestDiagnosticNumber(null, { engineRpm: 2800 }, "engineRpm")).toBe(2800);
    expect(hasStoredObdValues(null, { engineRpm: 2800 })).toBe(true);
  });

  it("ignores invalid diagnostic values", () => {
    expect(
      readLatestDiagnosticNumber({ obd: { engineRpm: "invalid" } }, null, "engineRpm")
    ).toBeNull();
    expect(hasStoredObdValues(null, null)).toBe(false);
  });
});
