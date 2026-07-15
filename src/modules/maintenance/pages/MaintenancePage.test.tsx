import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { dispatchAssistantFormDraft } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import MaintenancePage from "./MaintenancePage";

const maintenanceMocks = vi.hoisted(() => ({
  createMaintenanceClient: vi.fn(),
  deleteMaintenanceClient: vi.fn(),
  saveMaintenanceCompanyBranding: vi.fn(),
  saveMaintenanceReportHistory: vi.fn(),
  subscribeMaintenanceClients: vi.fn((onData: (items: never[]) => void) => {
    onData([]);
    return vi.fn();
  }),
  subscribeMaintenanceCompanyBranding: vi.fn((onData: (items: never[]) => void) => {
    onData([]);
    return vi.fn();
  }),
  subscribeMaintenanceReportHistory: vi.fn(() => vi.fn()),
  subscribeMaintenanceReportsOverview: vi.fn((onData: (items: never[]) => void) => {
    onData([]);
    return vi.fn();
  }),
  uploadMaintenanceBrandingAsset: vi.fn(),
}));

const highlighterMocks = vi.hoisted(() => ({
  highlightAssistantElement: vi.fn(),
}));

const usersMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../providers/AuthProvider", () => ({
  useAuth: () => ({
    role: "admin",
    loading: false,
    user: {
      uid: "maintenance-admin-test",
      email: "admin@example.test",
      displayName: "Admin Test",
      themeKey: null,
    },
  }),
}));
vi.mock("../services/maintenanceService", () => maintenanceMocks);
vi.mock("../../users/services/usersService", () => usersMocks);
vi.mock("../services/gmailDraftService", () => ({
  requestGmailAccessToken: vi.fn(),
  sendGmailMessageWithPdfAttachment: vi.fn(),
}));
vi.mock("../services/maintenancePdf", () => ({
  buildMaintenancePdfBlob: vi.fn(),
  resolveBrandingForCompany: vi.fn(() => null),
}));
vi.mock("../../../lib/files/downloadFile", () => ({ downloadFileFromUrl: vi.fn() }));
vi.mock("../../../lib/assistant/runtime/assistantButtonHighlighter", () => highlighterMocks);

describe("MaintenancePage client form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([]);
      return vi.fn();
    });
    maintenanceMocks.subscribeMaintenanceCompanyBranding.mockImplementation((onData) => {
      onData([]);
      return vi.fn();
    });
    maintenanceMocks.subscribeMaintenanceReportsOverview.mockImplementation((onData) => {
      onData([]);
      return vi.fn();
    });
    usersMocks.getAllUsers.mockResolvedValue([]);
  });

  it("uses one bounded overview subscription instead of one listener per client", async () => {
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=dashboard"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(maintenanceMocks.subscribeMaintenanceReportsOverview).toHaveBeenCalledTimes(1);
    });
    expect(maintenanceMocks.subscribeMaintenanceReportHistory).not.toHaveBeenCalled();
  });

  it("fills the controlled client form and waits for Save", async () => {
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=clients&assistant=client"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT, {
        name: "Client Test",
        email: "client@example.test",
        address: "Strada Test 10",
        liftNumbers: ["LIFT-210869"],
      });
    });

    expect(await screen.findByDisplayValue("Client Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("client@example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Strada Test 10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("LIFT-210869")).toBeInTheDocument();
    expect(maintenanceMocks.createMaintenanceClient).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(highlighterMocks.highlightAssistantElement).toHaveBeenCalledWith(
        "[data-assistant-action='maintenance-save-client']"
      )
    );
  });

  it("defaults the report technician to the signed-in user", async () => {
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue("Admin Test")).toBeInTheDocument();
    expect(usersMocks.getAllUsers).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual technician for the current report and restores the default on return", async () => {
    usersMocks.getAllUsers.mockResolvedValue([
      {
        id: "technician-secondary",
        uid: "technician-secondary",
        fullName: "Maria Tehnician",
        email: "maria@example.test",
        active: true,
        role: "angajat",
      },
    ]);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    const technicianInput = await screen.findByDisplayValue("Admin Test");
    await user.clear(technicianInput);
    await user.type(technicianInput, "Maria");

    const suggestions = await screen.findByRole("listbox", { name: "Sugestii tehnician" });
    expect(suggestions.closest(".maintenance-step-card")).toHaveClass("maintenance-step-card--overlay-open");
    await user.click(screen.getByRole("option", { name: /Maria Tehnician/ }));
    expect(screen.getByDisplayValue("Maria Tehnician")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Dashboard/ }));
    await user.click(screen.getAllByRole("button", { name: /Genereaza raport/ })[0]);

    expect(await screen.findByDisplayValue("Admin Test")).toBeInTheDocument();
  });
});
