import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WorkflowStepper from "./WorkflowStepper";

describe("WorkflowStepper", () => {
  it("exposes the current step without submitting or changing a form", () => {
    render(
      <WorkflowStepper
        activeStep={1}
        steps={[
          { id: "upload", label: "Încarcă" },
          { id: "ocr", label: "OCR" },
          { id: "save", label: "Salvează" },
        ]}
      />
    );

    expect(screen.getByText("OCR").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Încarcă").closest("li")).toHaveClass("wc-workflow-step--complete");
    expect(screen.getByText("Salvează").closest("li")).toHaveClass("wc-workflow-step--pending");
  });
});
