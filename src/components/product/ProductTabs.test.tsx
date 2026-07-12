import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProductTabs from "./ProductTabs";

describe("ProductTabs", () => {
  it("marks the active tab and emits a controlled change", async () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <ProductTabs
          activeId="general"
          onChange={onChange}
          tabs={[
            { id: "general", label: "General" },
            { id: "gps", label: "GPS" },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "GPS" }));
    expect(onChange).toHaveBeenCalledWith("gps");
  });

  it("keeps route tabs as links", () => {
    render(
      <MemoryRouter>
        <ProductTabs activeId="map" tabs={[{ id: "map", label: "Hartă GPS", to: "/vehicles/gps-map" }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Hartă GPS" })).toHaveAttribute("href", "/vehicles/gps-map");
  });
});
