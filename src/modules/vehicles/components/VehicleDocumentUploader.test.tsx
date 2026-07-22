import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import VehicleDocumentUploader from "./VehicleDocumentUploader";

describe("VehicleDocumentUploader", () => {
  it("starts the document analysis immediately for an existing vehicle", async () => {
    const user = userEvent.setup();
    const onDocumentsChange = vi.fn();
    const onUploadImmediately = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <VehicleDocumentUploader
        selectedDocuments={[]}
        onDocumentsChange={onDocumentsChange}
        onUploadImmediately={onUploadImmediately}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const receipt = new File(["rovinieta"], "bon-rovinieta.jpg", { type: "image/jpeg" });

    await user.upload(input!, receipt);

    expect(onUploadImmediately).toHaveBeenCalledTimes(1);
    expect(onUploadImmediately).toHaveBeenCalledWith([
      expect.objectContaining({ file: receipt, category: "other", expiryDate: "" }),
    ]);
    expect(onDocumentsChange).not.toHaveBeenCalled();
  });
});
