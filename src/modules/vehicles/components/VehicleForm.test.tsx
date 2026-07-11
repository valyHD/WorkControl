import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VehicleFormValues } from "../../../types/vehicle";
import VehicleForm from "./VehicleForm";

vi.mock("./VehicleImageUploader", () => ({
  default: () => <div data-testid="vehicle-image-uploader" />,
}));

vi.mock("./VehicleDocumentUploader", () => ({
  default: () => <div data-testid="vehicle-document-uploader" />,
}));

function values(overrides: Partial<VehicleFormValues> = {}): VehicleFormValues {
  return {
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
    year: "2020",
    vin: "",
    fuelType: "benzina",
    status: "activa",
    currentKm: 6000,
    initialRecordedKm: 5900,
    ownerUserId: "",
    ownerUserName: "",
    currentDriverUserId: "",
    currentDriverUserName: "",
    maintenanceNotes: "",
    serviceStrategy: "interval",
    serviceIntervalKm: 15000,
    nextServiceKm: 21000,
    nextItpDate: "",
    nextRcaDate: "",
    nextCascoDate: "",
    nextRovinietaDate: "",
    nextOilServiceKm: 10000,
    coverImageUrl: "",
    coverThumbUrl: "",
    images: [],
    documents: [],
    ...overrides,
  };
}

describe("VehicleForm", () => {
  it("keeps edited values in local state and submits only after Save", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = render(
      <VehicleForm initialValues={values()} users={[]} onSubmit={onSubmit} submitting={false} />
    );

    const kmInput = container.querySelector<HTMLInputElement>("[data-assistant-field='currentKm']");
    const plateInput = container.querySelector<HTMLInputElement>(
      "[data-assistant-field='plateNumber']"
    );
    expect(kmInput).not.toBeNull();
    expect(plateInput).not.toBeNull();

    fireEvent.change(kmInput!, { target: { value: "6616" } });
    fireEvent.change(plateInput!, { target: { value: "b 33 lgr" } });
    expect(onSubmit).not.toHaveBeenCalled();

    const saveButton = screen.getByRole("button", { name: "Salveaza masina" });
    expect(saveButton).toHaveAttribute("data-assistant-action", "save-vehicle");
    await user.click(saveButton);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ currentKm: 6616, plateNumber: "B 33 LGR" }),
        [],
        []
      )
    );
  });

  it("does not allow a negative mileage to be submitted", () => {
    const { container } = render(
      <VehicleForm
        initialValues={values({ currentKm: -1 })}
        users={[]}
        onSubmit={vi.fn()}
        submitting={false}
      />
    );

    expect(container.querySelector("[data-assistant-field='currentKm']")).toHaveAttribute(
      "min",
      "0"
    );
    expect(screen.getByRole("button", { name: "Salveaza masina" })).toBeDisabled();
  });
});
