import { describe, expect, it } from "vitest";
import { assertValidVehicleKm, isValidVehicleKm, normalizeVehiclePlate } from "./vehicleValidation";

describe("vehicle validation", () => {
  it("normalizes registration numbers", () => {
    expect(normalizeVehiclePlate("B 33 LGR")).toBe("B33LGR");
    expect(normalizeVehiclePlate(" b 04 yra ")).toBe("B04YRA");
  });

  it("rejects negative or non-numeric mileage", () => {
    expect(isValidVehicleKm(0)).toBe(true);
    expect(isValidVehicleKm(6616)).toBe(true);
    expect(isValidVehicleKm(-1)).toBe(false);
    expect(() => assertValidVehicleKm(-1)).toThrow(/pozitiv sau zero/i);
  });
});
