import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleDocumentIngestionJob, VehicleDocumentItem } from "../../../types/vehicle";
import VehicleDocumentsPanel from "./VehicleDocumentsPanel";

const serviceMocks = vi.hoisted(() => ({
  apply: vi.fn(),
  get: vi.fn(),
  reject: vi.fn(),
  retry: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("../services/vehiclesService", () => ({
  applyVehicleDocumentIngestionJob: serviceMocks.apply,
  getVehicleDocumentIngestionJob: serviceMocks.get,
  rejectVehicleDocumentIngestionJob: serviceMocks.reject,
  retryVehicleDocumentIngestionJob: serviceMocks.retry,
  rollbackVehicleDocumentIngestionJob: serviceMocks.rollback,
}));

vi.mock("../../../lib/files/downloadFile", () => ({
  downloadFileFromUrl: vi.fn(),
}));

const document: VehicleDocumentItem = {
  id: "document-1",
  name: "itp.pdf",
  url: "https://example.test/itp.pdf",
  path: "vehicles/vehicle-1/documents/itp.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  extension: "pdf",
  category: "itp",
  intelligenceJobId: "job-1",
  intelligenceStatus: "queued",
  createdAt: 1,
};

const reviewJob: VehicleDocumentIngestionJob = {
  jobId: "job-1",
  status: "needs_review",
  result: {
    documentType: { value: "itp", confidence: 0.98 },
    expiryDate: { value: "2027-07-14", confidence: 0.94 },
    issueDate: { value: "2026-07-14", confidence: 0.9 },
    policyNumber: { value: "ITP-123", confidence: 0.88 },
    providerName: { value: "RAR", confidence: 0.87 },
    vehiclePlateNumber: { value: "B33LGR", confidence: 0.96 },
    notes: "Verifica data inainte de aplicare.",
  },
  attempts: 1,
  createdAt: 1,
  updatedAt: 2,
};

describe("VehicleDocumentsPanel document intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.get.mockResolvedValue(reviewJob);
    serviceMocks.apply.mockResolvedValue(undefined);
  });

  it("shows extracted fields but applies them only after explicit confirmation", async () => {
    const user = userEvent.setup();
    render(<VehicleDocumentsPanel vehicleId="vehicle-1" documents={[document]} isOwner />);

    expect(serviceMocks.apply).not.toHaveBeenCalled();
    expect(await screen.findByText("2027-07-14")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(serviceMocks.apply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /aplic. datele/i }));

    await waitFor(() =>
      expect(serviceMocks.apply).toHaveBeenCalledWith(
        { vehicleId: "vehicle-1", documentId: "document-1", jobId: "job-1" },
        ["documentType", "expiryDate"]
      )
    );
    expect(await screen.findByText(/confirmate .i salvate/i)).toBeInTheDocument();
  });

  it("does not expose review actions to a read-only viewer", async () => {
    render(<VehicleDocumentsPanel vehicleId="vehicle-1" documents={[document]} isOwner={false} />);

    await waitFor(() => expect(serviceMocks.get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /aplic. datele/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /respinge/i })).not.toBeInTheDocument();
  });
});
