import { describe, expect, it } from "vitest";
import type { VehicleItem } from "../../../types/vehicle";
import {
  getBucharestDateKey,
  getVehicleDocumentAttentionItems,
  getVehicleDocumentExpiryItems,
} from "./vehicleDocumentExpiry";

function vehicle(overrides: Partial<VehicleItem> = {}): VehicleItem {
  return {
    id: "vehicle-1",
    companyId: "company-a",
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
    year: "2020",
    fuelType: "benzina",
    status: "activa",
    currentKm: 6_000,
    initialRecordedKm: 6_000,
    ownerUserId: "owner-1",
    ownerUserName: "Owner",
    ownerThemeKey: null,
    currentDriverUserId: "driver-1",
    currentDriverUserName: "Driver",
    currentDriverThemeKey: null,
    pendingDriverUserId: "",
    pendingDriverUserName: "",
    pendingDriverThemeKey: null,
    pendingDriverRequestedAt: 0,
    maintenanceNotes: "",
    serviceStrategy: "interval",
    serviceIntervalKm: 0,
    nextServiceKm: 0,
    nextItpDate: "",
    nextRcaDate: "",
    nextCascoDate: "",
    nextRovinietaDate: "",
    nextOilServiceKm: 0,
    coverImageUrl: "",
    coverThumbUrl: "",
    documents: [],
    images: [],
    createdAt: 0,
    ...overrides,
  } as VehicleItem;
}

describe("vehicleDocumentExpiry", () => {
  it("uses the Bucharest calendar day across DST", () => {
    expect(getBucharestDateKey(new Date("2026-03-29T21:30:00.000Z"))).toBe("2026-03-30");
  });

  it("classifies expired, critical and soon documents", () => {
    const items = getVehicleDocumentExpiryItems(
      vehicle({
        nextItpDate: "2026-07-14",
        nextRcaDate: "2026-07-20",
        nextCascoDate: "2026-08-10",
      }),
      new Date("2026-07-15T09:00:00.000Z")
    );
    expect(items.find((item) => item.documentType === "itp")?.status).toBe("expired");
    expect(items.find((item) => item.documentType === "rca")?.status).toBe("critical");
    expect(items.find((item) => item.documentType === "casco")?.status).toBe("soon");
  });

  it("falls back to legacy document dates and rejects rollover dates", () => {
    const items = getVehicleDocumentExpiryItems(
      vehicle({
        documents: [
          {
            id: "doc-1",
            name: "RCA",
            category: "rca",
            expiryDate: "2026-07-30",
            createdAt: 1,
            url: "https://example.test/rca.pdf",
            path: "vehicles/vehicle-1/rca.pdf",
            contentType: "application/pdf",
            sizeBytes: 10,
            extension: "pdf",
          },
          {
            id: "doc-2",
            name: "ITP",
            category: "itp",
            expiryDate: "2026-02-31",
            createdAt: 2,
            url: "https://example.test/itp.pdf",
            path: "vehicles/vehicle-1/itp.pdf",
            contentType: "application/pdf",
            sizeBytes: 10,
            extension: "pdf",
          },
        ],
      }),
      new Date("2026-07-15T09:00:00.000Z")
    );
    expect(items.map((item) => item.documentType)).toEqual(["rca"]);
  });

  it("returns only attention items and orders the most urgent first", () => {
    const items = getVehicleDocumentAttentionItems([
      vehicle({ id: "v1", nextItpDate: "2026-07-25" }),
      vehicle({ id: "v2", plateNumber: "B44ABC", nextRcaDate: "2026-07-14" }),
      vehicle({ id: "v3", plateNumber: "B55XYZ", nextCascoDate: "2026-12-01" }),
    ], new Date("2026-07-15T09:00:00.000Z"));
    expect(items.map((item) => item.vehicleId)).toEqual(["v2", "v1"]);
  });
});
