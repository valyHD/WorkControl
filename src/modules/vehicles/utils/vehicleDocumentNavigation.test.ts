import { describe, expect, it } from "vitest";
import { getVehicleDetailsPathAfterSave } from "./vehicleDocumentNavigation";

describe("getVehicleDetailsPathAfterSave", () => {
  it("returns to the document OCR area after uploading a vehicle receipt", () => {
    expect(getVehicleDetailsPathAfterSave("vehicle-1", 1)).toBe(
      "/vehicles/vehicle-1?tab=documents&focus=upload"
    );
  });

  it("keeps the normal overview destination when no document was uploaded", () => {
    expect(getVehicleDetailsPathAfterSave("vehicle-1", 0)).toBe("/vehicles/vehicle-1");
  });
});
