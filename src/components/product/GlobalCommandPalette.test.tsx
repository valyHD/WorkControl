import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalCommandPalette from "./GlobalCommandPalette";

vi.mock("../../providers/AuthProvider", () => ({
  useAuth: () => ({ role: "angajat", user: { uid: "user-1" } }),
}));

vi.mock("../../lib/search/globalSearchService", () => ({
  searchWorkControlEntities: vi.fn(async () => []),
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{`${location.pathname}${location.search}`}</output>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <GlobalCommandPalette />
      <Routes>
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("GlobalCommandPalette", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens with Ctrl+K and navigates using the shared action catalog", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Cautare globala" });
    expect(dialog).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Cauta" });
    await user.type(input, "pontajul meu");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("current-path")).toHaveTextContent("/my-timesheets");
    expect(screen.queryByRole("dialog", { name: "Cautare globala" })).not.toBeInTheDocument();
  });

  it("does not expose admin commands to an employee", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "wc_command_palette_recent:v1",
      JSON.stringify([
        {
          id: "page:control-panel",
          actionId: "control-panel",
          type: "page",
          title: "Control Panel",
          subtitle: "Administrare",
          path: "/control-panel",
        },
      ])
    );
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Cauta in WorkControl" }));
    expect(screen.queryByRole("option", { name: /Control Panel/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Cauta" }), "control panel");
    expect(screen.queryByRole("option", { name: /Control Panel/i })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderPalette();
    const trigger = screen.getByRole("button", { name: "Cauta in WorkControl" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the desktop backdrop is clicked", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Cauta in WorkControl" }));

    const dialog = screen.getByRole("dialog", { name: "Cautare globala" });
    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass("wc-command-overlay");
    await user.click(backdrop!);

    expect(screen.queryByRole("dialog", { name: "Cautare globala" })).not.toBeInTheDocument();
  });
});
