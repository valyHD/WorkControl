import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantCommandInterpretationV3 } from "../lib/assistant/assistantCommandService";
import { registerAssistantFormDraftAdapter } from "../lib/assistant/adapters/assistantFormDraftChannel";
import { ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT } from "../lib/assistant/runtime/assistantFormFill";
import type { VehicleFormValues } from "../types/vehicle";
import VehicleForm from "../modules/vehicles/components/VehicleForm";
import VoiceCommandAssistant from "./VoiceCommandAssistant";

const mocks = vi.hoisted(() => ({
  interpret: vi.fn(),
  audit: vi.fn(),
  updateVehicle: vi.fn(),
  vehicles: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock("../lib/firebase/firebase", () => ({ db: { project: "test" } }));
vi.mock("../providers/AuthProvider", () => ({
  useAuth: () => ({
    role: "admin",
    loading: false,
    user: {
      uid: "assistant-admin-test",
      email: "admin@example.test",
      displayName: "Admin Test",
      themeKey: null,
    },
  }),
}));
vi.mock("../lib/assistant/assistantCommandService", () => ({
  interpretAssistantCommand: mocks.interpret,
}));
vi.mock("../lib/assistant/runtime/assistantAudit", () => ({
  logAssistantAudit: mocks.audit,
}));
vi.mock("../modules/vehicles/services/vehiclesService", () => ({
  getMyVehicleForUser: vi.fn(),
  getVehicleById: vi.fn().mockResolvedValue({
    id: "vehicle-1",
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
    status: "activa",
    currentKm: 6000,
    initialRecordedKm: 5900,
  }),
  getVehiclesList: mocks.vehicles,
  updateVehicle: mocks.updateVehicle,
}));
vi.mock("../modules/tools/services/toolsService", () => ({
  getToolById: vi.fn(),
  getToolsList: vi.fn().mockResolvedValue([]),
  updateTool: vi.fn(),
}));
vi.mock("../modules/timesheets/services/timesheetsService", () => ({
  createProject: vi.fn(),
  getActiveTimesheetForUser: vi.fn(),
  getProjectsList: vi.fn().mockResolvedValue([]),
  getProjectById: vi.fn(),
  saveUserTimesheetProjectPreference: vi.fn(),
  startTimesheet: vi.fn(),
  stopTimesheet: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("../modules/timesheets/services/geocodingService", () => ({ reverseGeocode: vi.fn() }));
vi.mock("../modules/users/services/usersService", () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
  updateUserProfile: vi.fn(),
  updateUserWorkDetails: vi.fn(),
}));
vi.mock("../modules/vehicles/components/VehicleImageUploader", () => ({
  default: () => <div data-testid="vehicle-image-uploader" />,
}));
vi.mock("../modules/vehicles/components/VehicleDocumentUploader", () => ({
  default: () => <div data-testid="vehicle-document-uploader" />,
}));

function contract(
  overrides: Partial<AssistantCommandInterpretationV3>
): AssistantCommandInterpretationV3 {
  return {
    version: "3",
    commandType: "navigation",
    intent: "open_page",
    toolCalls: [{ id: "navigation.open", input: { path: "/dashboard", query: "dashboard" } }],
    targetPage: "/dashboard",
    entityReferences: [{ type: "page", query: "dashboard", id: "" }],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: false,
    response: "Deschid pagina.",
    entityType: "page",
    entityQuery: "dashboard",
    fieldsToUpdate: {},
    targetText: "",
    pageHint: "",
    buttonHint: "",
    missingFields: [],
    risk: "low",
    needsConfirmation: false,
    spokenSummary: "Deschid pagina.",
    reportType: "",
    startDate: "",
    endDate: "",
    ...overrides,
  };
}

function navigationContract(path: string) {
  return contract({
    targetPage: path,
    toolCalls: [{ id: "navigation.open", input: { path, query: path } }],
  });
}

function updateVehicleContract(query = "B33LGR") {
  return contract({
    commandType: "entity_update",
    intent: "update_vehicle",
    toolCalls: [
      { id: "vehicles.update", input: { entityQuery: query, fields: { currentKm: 6616 } } },
    ],
    targetPage: "",
    entityReferences: [{ type: "vehicle", query, id: "" }],
    confirmationRequired: true,
    response: "Schimb kilometrii masinii.",
    entityType: "vehicle",
    entityQuery: query,
    fieldsToUpdate: { currentKm: 6616 },
    risk: "medium",
    needsConfirmation: true,
    spokenSummary: "Schimb kilometrii masinii.",
  });
}

function maintenanceReportContract(mode: "prepare" | "send") {
  const fields = {
    clientQuery: "Isomat",
    reportType: mode === "send" ? ("revizie" as const) : ("interventie" as const),
    observations: mode === "send" ? "" : "usa nu se inchide",
    submitMode: mode,
    waitForPhotos: mode === "prepare",
  };
  return contract({
    commandType: "form_fill",
    intent: "open_maintenance_report",
    toolCalls: [{ id: `maintenance.report.${mode}`, input: { fields } }],
    targetPage: "/maintenance?tab=report&assistant=report",
    entityReferences: [{ type: "maintenanceClient", query: "Isomat", id: "" }],
    confirmationRequired: true,
    response:
      mode === "send"
        ? "Confirma generarea si trimiterea raportului."
        : "Confirma pregatirea raportului si asteptarea pozelor.",
    entityType: "maintenanceClient",
    entityQuery: "Isomat",
    fieldsToUpdate: fields,
    risk: mode === "send" ? "high" : "medium",
    needsConfirmation: true,
    spokenSummary: "Pregatesc raportul.",
    reportType: fields.reportType,
  });
}

function vehicleValues(): VehicleFormValues {
  return {
    plateNumber: "B33LGR",
    brand: "Dacia",
    model: "Logan",
    year: "2020",
    vin: "",
    fuelType: "benzina",
    status: "activa",
    currentKm: 6000,
    initialRecordedKm: 5900,
    ownerUserId: "",
    ownerUserName: "",
    currentDriverUserId: "",
    currentDriverUserName: "",
    maintenanceNotes: "",
    serviceStrategy: "interval",
    serviceIntervalKm: 15000,
    nextServiceKm: 21000,
    nextItpDate: "",
    nextRcaDate: "",
    nextCascoDate: "",
    nextRovinietaDate: "",
    nextOilServiceKm: 10000,
    coverImageUrl: "",
    coverThumbUrl: "",
    images: [],
    documents: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function AssistantTestSurface({ withVehicleForm = false }: { withVehicleForm?: boolean }) {
  return (
    <>
      {withVehicleForm ? (
        <VehicleForm
          initialValues={vehicleValues()}
          users={[]}
          onSubmit={vi.fn()}
          submitting={false}
        />
      ) : (
        <input data-assistant-field="test-field" defaultValue="Valoare initiala" />
      )}
      <VoiceCommandAssistant />
      <LocationProbe />
    </>
  );
}

function renderAssistant(initialPath: string, withVehicleForm = false) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<AssistantTestSurface withVehicleForm={withVehicleForm} />} />
      </Routes>
    </MemoryRouter>
  );
}

async function sendCommand(command: string) {
  fireEvent.click(screen.getByRole("button", { name: "Deschide asistentul vocal" }));
  const input = await screen.findByPlaceholderText("Sau scrie comanda...");
  const user = userEvent.setup();
  await user.type(input, command);
  await user.click(screen.getByRole("button", { name: "Trimite comanda" }));
}

describe("VoiceCommandAssistant V3 controlled behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vehicles.mockResolvedValue([
      {
        id: "vehicle-1",
        plateNumber: "B33LGR",
        brand: "Dacia",
        model: "Logan",
        status: "activa",
        currentKm: 6000,
        initialRecordedKm: 5900,
      },
    ]);
    mocks.interpret.mockImplementation(async (command: string) => {
      const normalized = command.toLowerCase();
      if (normalized.includes("raport") && normalized.includes("trimite")) {
        return maintenanceReportContract("send");
      }
      if (normalized.includes("raport") && normalized.includes("poze")) {
        return maintenanceReportContract("prepare");
      }
      if (normalized.includes("conced")) return navigationContract("/my-leave");
      if (normalized.includes("mentenanta")) return navigationContract("/maintenance");
      if (normalized.includes("dashboard")) return navigationContract("/dashboard");
      if (normalized.includes("schimba data")) {
        return contract({
          commandType: "unknown",
          intent: "unknown",
          toolCalls: [],
          entityReferences: [],
          targetPage: "",
          missingInformation: ["campul exact"],
          confidence: 0.4,
          confirmationRequired: false,
          response: "Ce data vrei sa modific?",
          entityType: "none",
          entityQuery: "",
        });
      }
      return updateVehicleContract();
    });
  });

  it("navigates from a vehicle form without changing any field", async () => {
    renderAssistant("/vehicles/vehicle-1/edit", true);
    const plateInput = screen.getByDisplayValue("B33LGR");
    const inputSpy = vi.fn();
    const fillSpy = vi.fn();
    plateInput.addEventListener("input", inputSpy);
    const unregisterDraft = registerAssistantFormDraftAdapter(
      "workcontrol:assistant-fill-vehicle-form",
      fillSpy
    );

    await sendCommand("Du-te pe pagina concedii.");

    await waitFor(() => expect(screen.getByTestId("current-path")).toHaveTextContent("/my-leave"));
    expect(plateInput).toHaveValue("B33LGR");
    expect(inputSpy).not.toHaveBeenCalled();
    expect(fillSpy).not.toHaveBeenCalled();
    unregisterDraft();
  });

  it.each([
    ["/my-leave", "Deschide mentenanta", "/maintenance"],
    ["/maintenance?tab=clients", "Arata dashboard", "/dashboard"],
  ])("navigates from %s without altering the visible input", async (from, command, expected) => {
    renderAssistant(from);
    const input = screen.getByDisplayValue("Valoare initiala");
    await sendCommand(command);
    await waitFor(() => expect(screen.getByTestId("current-path")).toHaveTextContent(expected));
    expect(input).toHaveValue("Valoare initiala");
  });

  it("asks one clarification for an ambiguous command and executes nothing", async () => {
    renderAssistant("/vehicles/vehicle-1/edit");
    await sendCommand("schimba data");
    expect(await screen.findAllByText(/am nevoie de: campul exact/i)).not.toHaveLength(0);
    expect(mocks.updateVehicle).not.toHaveBeenCalled();
  });

  it("shows old and new values and updates only after confirmation", async () => {
    renderAssistant("/vehicles/vehicle-1/edit");
    await sendCommand("schimba kilometrii B33LGR la 6616");
    expect(await screen.findByText("Confirmă modificările")).toBeInTheDocument();
    expect(screen.getByText("6000")).toBeInTheDocument();
    expect(screen.getByText("6616")).toBeInTheDocument();
    expect(mocks.updateVehicle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirmă" }));
    await waitFor(() => expect(mocks.updateVehicle).toHaveBeenCalledTimes(1));
  });

  it("renders controlled choices when entity resolution is ambiguous", async () => {
    mocks.vehicles.mockResolvedValue([
      { id: "vehicle-1", plateNumber: "B33LGR", brand: "Dacia", model: "Logan", currentKm: 6000 },
      { id: "vehicle-2", plateNumber: "B44ABC", brand: "Dacia", model: "Logan", currentKm: 7000 },
    ]);
    mocks.interpret.mockResolvedValue(updateVehicleContract("Logan"));
    renderAssistant("/vehicles");
    await sendCommand("schimba kilometrii Loganului la 6616");
    expect(await screen.findByRole("radio", { name: /B33LGR Dacia Logan/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /B44ABC Dacia Logan/ })).toBeInTheDocument();
  });

  it("prefills a maintenance report only after confirmation and waits for photos", async () => {
    const reportDraft = vi.fn();
    const unregister = registerAssistantFormDraftAdapter(
      ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
      reportDraft
    );
    renderAssistant("/dashboard");

    await sendCommand(
      "Genereaza raport interventie pentru Isomat cu observatia usa nu se inchide si asteapta sa atasez pozele"
    );
    expect(reportDraft).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Confirmă" }));

    await waitFor(() => expect(reportDraft).toHaveBeenCalledTimes(1));
    expect(reportDraft).toHaveBeenCalledWith({
      clientQuery: "Isomat",
      reportType: "interventie",
      observations: "usa nu se inchide",
      submitMode: "prepare",
      waitForPhotos: true,
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/maintenance");
    unregister();
  });

  it("does not send a maintenance report before explicit confirmation", async () => {
    const reportSend = vi.fn();
    const unregister = registerAssistantFormDraftAdapter(
      ASSISTANT_FILL_MAINTENANCE_REPORT_EVENT,
      reportSend
    );
    renderAssistant("/dashboard");

    await sendCommand("Genereaza raport revizie pentru Isomat si trimite-l");
    expect(reportSend).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Confirmă" }));

    await waitFor(() => expect(reportSend).toHaveBeenCalledTimes(1));
    expect(reportSend).toHaveBeenCalledWith(
      expect.objectContaining({ submitMode: "send", reportType: "revizie" })
    );
    unregister();
  });
});
