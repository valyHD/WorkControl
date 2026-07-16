import { describe, expect, it } from "vitest";
import type { VehicleDocumentItem } from "../../../types/vehicle";
import {
  buildVehicleDocumentSummary,
  isSupportedVehicleDocumentFile,
  VEHICLE_DOCUMENT_MAX_BYTES,
} from "./vehicleDocumentSummary";

function document(overrides: Partial<VehicleDocumentItem>): VehicleDocumentItem {
  return {
    id: "doc-1",
    name: "document.pdf",
    url: "https://example.test/document.pdf",
    path: "vehicles/vehicle-1/documents/itp/document.pdf",
    contentType: "application/pdf",
    sizeBytes: 100,
    extension: "pdf",
    category: "itp",
    createdAt: 1,
    ...overrides,
  };
}

describe("vehicleDocumentSummary", () => {
  it("builds a compact summary without exposing document arrays", () => {
    const summary = buildVehicleDocumentSummary(
      [
        document({ id: "expired", expiryDate: "2026-07-01" }),
        document({ id: "next", expiryDate: "2026-07-20" }),
        document({ id: "later", expiryDate: "2026-08-01", intelligenceStatus: "needs_review" }),
        document({ id: "invalid", expiryDate: "2026-02-31" }),
      ],
      new Date("2026-07-15T09:00:00.000Z")
    );

    expect(summary).toMatchObject({
      count: 4,
      nextExpiryAt: "2026-07-20",
      expiredCount: 1,
      needsReviewCount: 1,
    });
  });

  it("validates vehicle document upload file limits and types", () => {
    expect(isSupportedVehicleDocumentFile({ type: "application/pdf", size: 1024 } as File)).toBe(true);
    expect(isSupportedVehicleDocumentFile({ type: "image/jpeg", size: VEHICLE_DOCUMENT_MAX_BYTES } as File)).toBe(true);
    expect(isSupportedVehicleDocumentFile({ type: "text/plain", size: 1024 } as File)).toBe(false);
    expect(isSupportedVehicleDocumentFile({ type: "application/pdf", size: VEHICLE_DOCUMENT_MAX_BYTES + 1 } as File)).toBe(false);
  });
});
