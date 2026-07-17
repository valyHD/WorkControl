import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_FILL_MAINTENANCE_CLIENT_EVENT,
  ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
} from "../../../lib/assistant/runtime/assistantFormFill";
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
  sendSharedMaintenanceGmailReport: vi.fn(),
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

function createOltenitaBlockClient(): MaintenanceClient {
  return {
    ...createMaintenanceClientTest("client-oltenita-blocks", "Asociatia de proprietari Oltenita"),
    address: "Oltenita bloc C2",
    liftNumber: "C2-LIFT",
    liftNumbers: ["C1-LIFT", "C2-LIFT", "C3-LIFT"],
    addresses: [
      {
        id: "address-c1",
        label: "Oltenita bloc C1",
        city: "",
        street: "Oltenita bloc C1",
        postalCode: "",
        contactPerson: "",
        contactPhone: "",
        lifts: [
          {
            id: "lift-c1",
            label: "Lift C1",
            serialNumber: "C1-LIFT",
            manufacturer: "",
            installYear: "",
            maintenanceCompany: "",
            maintenanceEmail: "",
            inspectionExpiryDate: "",
            notes: "",
          },
        ],
      },
      {
        id: "address-c2",
        label: "Oltenita bloc C2",
        city: "",
        street: "Oltenita bloc C2",
        postalCode: "",
        contactPerson: "",
        contactPhone: "",
        lifts: [
          {
            id: "lift-c2",
            label: "Lift C2",
            serialNumber: "C2-LIFT",
            manufacturer: "",
            installYear: "",
            maintenanceCompany: "",
            maintenanceEmail: "",
            inspectionExpiryDate: "",
            notes: "",
          },
        ],
      },
    ],
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
    gmailMocks.sendSharedMaintenanceGmailReport.mockResolvedValue({
      messageId: "message-test",
      threadId: "thread-test",
      sent: true,
      senderEmail: "liftultau@gmail.com",
    });
    maintenanceMocks.saveMaintenanceReportHistory.mockResolvedValue({
      id: "report-test",
      companyId: "company-test",
      clientId: "client-gmail-test",
      clientName: "Client Gmail Test",
      reportType: "revizie",
      address: "Strada Test 10",
      lift: "LIFT-10",
      technicianName: "Admin Test",
      comments: "",
      pdfUrl: "https://storage.example.test/report.pdf",
      pdfPath: "maintenance-reports/client-gmail-test/report.pdf",
      images: [],
      fileName: "report.pdf",
      createdAt: 0,
      dateText: "16.07.2026",
      timeText: "09:00:00",
    });
    pdfMocks.buildMaintenancePdfBlob.mockResolvedValue(
      new Blob(["test-pdf"], { type: "application/pdf" })
    );
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

    expect(await screen.findByRole("combobox", { name: "Tehnician" })).toHaveValue(
      "maintenance-admin-test"
    );
    expect(usersMocks.getAllUsers).toHaveBeenCalledTimes(1);
  });

  it("uses the shared server-side Gmail sender without browser authorization", async () => {
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue("liftultau@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/Emailul este trimis automat de server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autorizeaza Gmail" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autentificare mobil" })).not.toBeInTheDocument();
  });

  it("keeps the selected report type as the first and primary send action", async () => {
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    const selectedTypeButton = await screen.findByRole("button", {
      name: "Genereaza tipul selectat",
    });
    const reviewButton = screen.getByRole("button", { name: "Genereaza raport revizie" });
    const interventionButton = screen.getByRole("button", { name: "Genereaza raport interventie" });
    const actionGroup = selectedTypeButton.parentElement;

    expect(actionGroup?.children[0]).toBe(selectedTypeButton);
    expect(actionGroup?.children[1]).toBe(reviewButton);
    expect(actionGroup?.children[2]).toBe(interventionButton);
    expect(selectedTypeButton).toHaveClass("primary-btn");
    expect(reviewButton).toHaveClass("secondary-btn");
    expect(interventionButton).toHaveClass("secondary-btn");
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

    expect(await screen.findByRole("combobox", { name: "Tehnician" })).toHaveValue(
      "maintenance-admin-test"
    );
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
  });

  it("closes client suggestions immediately after the client is selected", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-report-test", "Client Raport Test")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.type(
      await screen.findByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"),
      "Client Raport"
    );
    await user.click(await screen.findByRole("option", { name: /Client Raport Test/ }));

    expect(screen.queryByRole("listbox", { name: "Sugestii client" })).not.toBeInTheDocument();
  });

  it("fills a controlled intervention report and waits for photo upload", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-report-assistant", "Client Raport Asistent")]);
      return vi.fn();
    });
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT, {
        clientQuery: "Client Raport Asistent",
        reportType: "interventie",
        observations: "Usa nu se inchide",
        submitMode: "prepare",
        waitForPhotos: true,
      });
    });

    expect(await screen.findByDisplayValue("Client Raport Asistent")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        document.querySelector("[data-assistant-field='maintenance-report-type']")
      ).toHaveValue("interventie")
    );
    expect(await screen.findByDisplayValue("Usa nu se inchide")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Sugestii client" })).not.toBeInTheDocument();
    expect(gmailMocks.sendSharedMaintenanceGmailReport).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(highlighterMocks.highlightAssistantElement).toHaveBeenCalledWith(
        "[data-assistant-field='maintenance-report-photos']"
      )
    );
  });

  it("auto-sends a validated report request received after assistant confirmation", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-report-send", "Client Raport Send")]);
      return vi.fn();
    });
    maintenanceMocks.saveMaintenanceReportHistory.mockResolvedValue({
      id: "report-assistant-send",
      companyId: "company-test",
      clientId: "client-report-send",
      clientName: "Client Raport Send",
      reportType: "revizie",
      address: "Strada Test 10",
      lift: "LIFT-10",
      technicianName: "Admin Test",
      comments: "",
      pdfUrl: "https://storage.example.test/report.pdf",
      pdfPath: "maintenance-reports/client-report-send/report.pdf",
      images: [],
      fileName: "report.pdf",
      createdAt: 0,
      dateText: "16.07.2026",
      timeText: "09:00:00",
    });
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT, {
        clientQuery: "Client Raport Send",
        reportType: "revizie",
        observations: "",
        submitMode: "send",
        waitForPhotos: false,
      });
    });

    await waitFor(() =>
      expect(gmailMocks.sendSharedMaintenanceGmailReport).toHaveBeenCalledTimes(1)
    );
    expect(gmailMocks.sendSharedMaintenanceGmailReport).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-report-send",
        recipientEmail: "client@example.test",
      })
    );
  });

  it("auto-sends when the assistant query matches client name plus block address", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createOltenitaBlockClient()]);
      return vi.fn();
    });
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT, {
        clientQuery: "oltenita c1",
        reportType: "revizie",
        observations: "",
        submitMode: "send",
        waitForPhotos: false,
      });
    });

    await waitFor(() =>
      expect(maintenanceMocks.saveMaintenanceReportHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          client: expect.objectContaining({ id: "client-oltenita-blocks" }),
          address: "Oltenita bloc C1",
          lift: "C1-LIFT",
        })
      )
    );
    expect(gmailMocks.sendSharedMaintenanceGmailReport).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-oltenita-blocks",
      })
    );
  });

  it("never sends when the assistant client query matches multiple clients", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([
        createMaintenanceClientTest("client-vali-one", "Vali Service"),
        createMaintenanceClientTest("client-vali-two", "Vali Lift"),
      ]);
      return vi.fn();
    });
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT, {
        clientQuery: "Vali",
        reportType: "revizie",
        observations: "",
        submitMode: "send",
        waitForPhotos: false,
      });
    });

    expect(
      await screen.findByText(/Am gasit mai multi clienti.*raportul nu a fost trimis/i)
    ).toBeInTheDocument();
    expect(gmailMocks.sendSharedMaintenanceGmailReport).not.toHaveBeenCalled();
  });

  it("never auto-sends from only one approximate client match", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-vali-service", "Vali Service")]);
      return vi.fn();
    });
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await act(async () => {
      await dispatchAssistantFormDraft(ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT, {
        clientQuery: "Vali",
        reportType: "revizie",
        observations: "",
        submitMode: "send",
        waitForPhotos: false,
      });
    });

    expect(await screen.findByText(/Clientul nu a putut fi confirmat exact/i)).toBeInTheDocument();
    expect(gmailMocks.sendSharedMaintenanceGmailReport).not.toHaveBeenCalled();
  });

  it("sends the Gmail report directly with the generated PDF attached", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-gmail-test", "Client Gmail Test")]);
      return vi.fn();
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.type(
      screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"),
      "Client Gmail"
    );
    await user.click(await screen.findByRole("option", { name: /Client Gmail Test/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tehnician" })).toHaveValue(
        "maintenance-admin-test"
      );
      expect(screen.getByDisplayValue("Strada Test 10")).toBeInTheDocument();
      expect(screen.getByDisplayValue("LIFT-10")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Genereaza raport revizie" }));

    await waitFor(() => {
      expect(gmailMocks.sendSharedMaintenanceGmailReport).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "company-test",
          clientId: "client-gmail-test",
          recipientEmail: "client@example.test",
          pdfPath: "maintenance-reports/client-gmail-test/report.pdf",
          fileName: "report.pdf",
        })
      );
    });
    expect(
      await screen.findByText(/Raportul revizie a fost trimis catre client@example\.test/)
    ).toBeInTheDocument();
  });

  it("replaces the progress message with the Gmail error when direct sending fails", async () => {
    maintenanceMocks.subscribeMaintenanceClients.mockImplementation((onData) => {
      onData([createMaintenanceClientTest("client-gmail-error", "Client Gmail Error")]);
      return vi.fn();
    });
    gmailMocks.sendSharedMaintenanceGmailReport.mockRejectedValueOnce(
      new Error("Gmail indisponibil")
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/maintenance?tab=report"]}>
        <MaintenancePage />
      </MemoryRouter>
    );

    await user.type(
      screen.getByPlaceholderText("Ex: Razvan / Aurel Vlaicu / 210869"),
      "Client Gmail Error"
    );
    await user.click(await screen.findByRole("option", { name: /Client Gmail Error/ }));
    await user.click(screen.getByRole("button", { name: "Genereaza raport revizie" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Gmail indisponibil");
    expect(screen.queryByText(/PDF-ul este salvat\. Se trimite emailul/)).not.toBeInTheDocument();
  });
});
