import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  DetailsDrawer,
  InlineError,
  PageBreadcrumbs,
  PageTabs,
  PermissionState,
} from ".";

describe("product experience primitives", () => {
  it("renders accessible breadcrumbs and tabs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <PageBreadcrumbs items={[{ label: "Masini", path: "/vehicles" }, { label: "Editare" }]} />
        <PageTabs
          activeId="overview"
          onChange={onChange}
          items={[{ id: "overview", label: "Prezentare" }, { id: "history", label: "Istoric" }]}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("navigation", { name: "Fir de navigare" })).toBeInTheDocument();
    expect(screen.getByText("Editare")).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("tab", { name: "Istoric" }));
    expect(onChange).toHaveBeenCalledWith("history");
  });

  it("closes drawers with Escape and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Declansator</button>
        <DetailsDrawer open title="Detalii" onClose={onClose}>
          <button type="button">Actiune drawer</button>
        </DetailsDrawer>
      </>
    );
    expect(screen.getByRole("dialog", { name: "Detalii" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exposes error and permission states to assistive technology", () => {
    render(
      <>
        <InlineError message="Nu s-au incarcat datele" />
        <PermissionState />
      </>
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Acces restrictionat")).toBeInTheDocument();
  });
});
