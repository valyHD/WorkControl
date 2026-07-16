import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const sharedGmailMocks = vi.hoisted(() => ({
  sendSharedMaintenanceReportEmail: vi.fn(),
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
vi.mock("../services/sharedGmailService", () => ({
  SHARED_GMAIL_SENDER_EMAIL: "liftultau@gmail.com",
  sendSharedMaintenanceReportEmail: sharedGmailMocks.sendSharedMaintenanceReportEmail,
}));
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
    sharedGmailMocks.sendSharedMaintenanceReportEmail.mockResolvedValue({
      status: "sent",
      senderEmail: "liftultau@gmail.com",
      messageId: "message-test",
    });
    maintenanceMocks.saveMaintenanceReportHistory.mockResolvedValue({
      id: "report-test",
      pdfUrl: "https://storage.example.test/report.pdf",
    });
    pdfMocks.buildMaintenancePdfBlob.mockResolvedValue(new Blob(["test-pdf"], { type: "application/pdf" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
  });

  it("shows the fixed shared sender without per-user Gmail authorization", async () => {
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    expect(await screen.findByDisplayValue("liftultau@gmail.com")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Autorizeaza Gmail/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("option", { name: "Admin Test" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /admin@example\.test/ })).not.toBeInTheDocument();
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

  it("saves the generated PDF and sends it through the shared Gmail function", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-gmail-test", "Client Gmail Test")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    await user.type(screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"), "Client Gmail");
    await user.click(await screen.findByRole("option", { name: /Client Gmail Test/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tehnician" })).toHaveValue("maintenance-admin-test");
      expect(screen.getByDisplayValue("Strada Test 10")).toBeInTheDocument();
      expect(screen.getByDisplayValue("LIFT-10")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Genereaza si trimite revizia" }));

    await waitFor(() => {
      expect(maintenanceMocks.saveMaintenanceReportHistory).toHaveBeenCalledWith(expect.objectContaining({
        pdfBlob: expect.any(Blob),
      }));
      expect(sharedGmailMocks.sendSharedMaintenanceReportEmail).toHaveBeenCalledWith({
        clientId: "client-gmail-test",
        reportId: "report-test",
      });
      expect(screen.getByText(/a fost trimis din liftultau@gmail\.com/)).toBeInTheDocument();
    });
  });

  it("uses the approved intervention wording in the generated PDF", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-intervention-test", "Client Interventie")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    await user.type(screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"), "Client Interventie");
    await user.click(await screen.findByRole("option", { name: /Client Interventie/ }));
    await user.click(screen.getByRole("button", { name: "Genereaza si trimite interventia" }));

    await waitFor(() => {
      expect(pdfMocks.buildMaintenancePdfBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          report: expect.objectContaining({
            continutRaport:
              "S-a efectuat interventia conform sesizarii clientului. Instalatia a fost verificata si s-au constatat urmatoarele:",
          }),
        })
      );
    });
  });

  it("shows sending progress instead of a false email failure", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-progress-test", "Client Progres")]);
      return vi.fn();
    });
    let resolveSend: ((value: { status: "sent"; senderEmail: string; messageId: string }) => void) | undefined;
    sharedGmailMocks.sendSharedMaintenanceReportEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/maintenance?tab=report"]}><MaintenancePage /></MemoryRouter>);

    await user.type(screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"), "Client Progres");
    await user.click(await screen.findByRole("option", { name: /Client Progres/ }));
    await user.click(screen.getByRole("button", { name: "Genereaza si trimite revizia" }));

    expect(await screen.findByText(/Raport salvat, trimitere in curs/)).toBeInTheDocument();
    expect(screen.queryByText(/email netrimis/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progres trimitere raport" })).toHaveAttribute(
      "aria-valuenow",
      "76"
    );

    await act(async () => {
      resolveSend?.({ status: "sent", senderEmail: "liftultau@gmail.com", messageId: "progress-message" });
    });
    expect(await screen.findByText(/Raport trimis pentru Client Progres/)).toBeInTheDocument();
  });
});
