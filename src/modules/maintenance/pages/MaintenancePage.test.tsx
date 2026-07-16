import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { dispatchAssistantFormDraft } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import type { MaintenanceClient } from "../../../types/maintenance";
import MaintenancePage from "./MaintenancePage";

const maintenanceMocks = vi.hoisted(() => ({
  createMaintenanceClient: vi.fn(),
  deleteMaintenanceClient: vi.fn(),
  saveMaintenanceCompanyBranding: vi.fn(),
  saveMaintenanceReportHistory: vi.fn(),
  subscribeMaintenanceClients: vi.fn((onData: (items: MaintenanceClient[]) => void) => {
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

const gmailMocks = vi.hoisted(() => ({
  consumeGmailRedirectAuthorization: vi.fn(() => null),
  createGmailDraftWithPdfAttachment: vi.fn(),
  openGmailDraft: vi.fn(),
  preloadGmailAuthorization: vi.fn().mockResolvedValue(undefined),
  requestGmailAccessToken: vi.fn().mockResolvedValue("gmail-token"),
  startGmailRedirectAuthorization: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?test=1"),
}));

const pdfMocks = vi.hoisted(() => ({
  buildMaintenancePdfBlob: vi.fn(),
  resolveBrandingForCompany: vi.fn(() => null),
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
vi.mock("../services/gmailDraftService", () => gmailMocks);
vi.mock("../services/maintenancePdf", () => pdfMocks);
vi.mock("../../../lib/files/downloadFile", () => ({ downloadFileFromUrl: vi.fn() }));
vi.mock("../../../lib/assistant/runtime/assistantButtonHighlighter", () => highlighterMocks);

function createMaintenanceClientTest(id: string, name: string): MaintenanceClient {
  return {
    id,
    name,
    email: "client@example.test",
    emails: ["client@example.test"],
    maintenanceCompany: "Firma Test",
    address: "Strada Test 10",
    liftNumber: "LIFT-10",
    liftNumbers: ["LIFT-10"],
    expiryDate: "",
    contactPerson: "",
    contactPhone: "",
    createdAt: 0,
    updatedAt: 0,
    addresses: [],
  };
}

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
    gmailMocks.consumeGmailRedirectAuthorization.mockReturnValue(null);
    gmailMocks.preloadGmailAuthorization.mockResolvedValue(undefined);
    gmailMocks.requestGmailAccessToken.mockResolvedValue("gmail-token");
    gmailMocks.createGmailDraftWithPdfAttachment.mockResolvedValue({
      draftId: "gmail-draft-test",
      gmailUrl: "https://mail.google.com/mail/?authuser=liftultau%40gmail.com#drafts/message-test",
    });
    gmailMocks.startGmailRedirectAuthorization.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?test=1"
    );
    maintenanceMocks.saveMaintenanceReportHistory.mockResolvedValue({ pdfUrl: "https://storage.example.test/report.pdf" });
    pdfMocks.buildMaintenancePdfBlob.mockResolvedValue(new Blob(["test-pdf"], { type: "application/pdf" }));
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

    expect(await screen.findByRole("combobox", { name: "Tehnician" })).toHaveValue("maintenance-admin-test");
    expect(usersMocks.getAllUsers).toHaveBeenCalledTimes(1);
    expect(gmailMocks.preloadGmailAuthorization).toHaveBeenCalledTimes(1);
  });

  it("authorizes Gmail from an explicit report action", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Autorizeaza Gmail" }));

    expect(gmailMocks.requestGmailAccessToken).toHaveBeenCalledWith("liftultau@gmail.com");
    expect(await screen.findByText("Gmail autorizat pentru liftultau@gmail.com.")).toBeInTheDocument();
  });

  it("offers explicit same-window Gmail authorization for mobile browsers", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Autentificare mobil" }));

    expect(gmailMocks.startGmailRedirectAuthorization).toHaveBeenCalledWith("liftultau@gmail.com");
    expect(await screen.findByRole("link", { name: "Deschide Google" })).toHaveAttribute(
      "href",
      "https://accounts.google.com/o/oauth2/v2/auth?test=1"
    );
    expect(gmailMocks.requestGmailAccessToken).not.toHaveBeenCalled();
  });

  it("shows a clear setup error when Gmail OAuth client id is missing", async () => {
    gmailMocks.startGmailRedirectAuthorization.mockImplementation(() => {
      throw new Error("Lipseste VITE_GOOGLE_CLIENT_ID din .env.");
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Autentificare mobil" }));

    expect(await screen.findByText(/Lipseste VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByText("Se deschide autorizarea Gmail in aceeasi fereastra...")).not.toBeInTheDocument();
  });

  it("shows a mobile redirect action when Gmail popup authorization is blocked", async () => {
    gmailMocks.requestGmailAccessToken.mockRejectedValue(new Error("popup blocked"));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Autorizeaza Gmail" }));
    const mobileButton = await screen.findByRole("button", { name: "Autentificare Gmail pe mobil" });
    await user.click(mobileButton);

    expect(gmailMocks.startGmailRedirectAuthorization).toHaveBeenCalledWith("liftultau@gmail.com");
  });

  it("uses a mobile-safe technician selector and restores the signed-in user on return", async () => {
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

    const technicianSelect = await screen.findByRole("combobox", { name: "Tehnician" });
    await user.selectOptions(technicianSelect, "technician-secondary");
    expect(technicianSelect).toHaveValue("technician-secondary");

    await user.click(screen.getByRole("button", { name: /Dashboard/ }));
    await user.click(screen.getAllByRole("button", { name: /Genereaza raport/ })[0]);

    expect(await screen.findByRole("combobox", { name: "Tehnician" })).toHaveValue("maintenance-admin-test");
  });

  it("selects the signed-in technician before the user directory finishes loading", async () => {
    usersMocks.getAllUsers.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    const technicianSelect = await screen.findByRole("combobox", { name: "Tehnician" });
    expect(technicianSelect).toHaveValue("maintenance-admin-test");
    expect(screen.getByRole("option", { name: "Admin Test - admin@example.test" })).toBeInTheDocument();
  });

  it("closes client suggestions immediately after the client is selected", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-report-test", "Client Raport Test")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    await user.type(await screen.findByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"), "Client Raport");
    await user.click(await screen.findByRole("option", { name: /Client Raport Test/ }));

    expect(screen.queryByRole("listbox", { name: "Sugestii client" })).not.toBeInTheDocument();
  });

  it("creates a Gmail draft with the generated PDF attached before opening Gmail", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-gmail-test", "Client Gmail Test")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Autorizeaza Gmail" }));
    await user.type(screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"), "Client Gmail");
    await user.click(await screen.findByRole("option", { name: /Client Gmail Test/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tehnician" })).toHaveValue("maintenance-admin-test");
      expect(screen.getByDisplayValue("Strada Test 10")).toBeInTheDocument();
      expect(screen.getByDisplayValue("LIFT-10")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Genereaza raport revizie" }));

    await waitFor(() => {
      expect(gmailMocks.createGmailDraftWithPdfAttachment).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: "gmail-token",
        senderEmail: "liftultau@gmail.com",
        recipientEmail: "client@example.test",
        pdfBlob: expect.any(Blob),
      }));
      expect(gmailMocks.openGmailDraft).toHaveBeenCalledWith("https://mail.google.com/mail/?authuser=liftultau%40gmail.com#drafts/message-test");
    });
  });
});
