import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders children and tone class", () => {
    render(<StatusBadge tone="green">Activ</StatusBadge>);

    const badge = screen.getByText("Activ");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("wc-status-badge", "wc-status-badge--green");
  });
});
