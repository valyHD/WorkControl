import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantCommandInterpretation } from "../lib/assistant/assistantCommandService";
import type { AssistantRuntimePlan } from "../lib/assistant/runtime/assistantTypes";
import type { VehicleFormValues } from "../types/vehicle";
import VehicleForm from "../modules/vehicles/components/VehicleForm";
import VoiceCommandAssistant from "./VoiceCommandAssistant";

const assistantMocks = vi.hoisted(() => ({
  interpretAssistantCommand: vi.fn(),
  buildAssistantRuntimePlan: vi.fn(),
  logAssistantAudit: vi.fn(),
  scheduleAssistantNextStepHighlight: vi.fn(),
  updateRun: vi.fn(),
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
  interpretAssistantCommand: assistantMocks.interpretAssistantCommand,
}));
vi.mock("../lib/assistant/runtime/assistantExecutor", () => ({
  buildAssistantRuntimePlan: assistantMocks.buildAssistantRuntimePlan,
}));
vi.mock("../lib/assistant/runtime/assistantAudit", () => ({
  logAssistantAudit: assistantMocks.logAssistantAudit,
}));
vi.mock("../lib/assistant/runtime/assistantButtonHighlighter", () => ({
  scheduleAssistantNextStepHighlight: assistantMocks.scheduleAssistantNextStepHighlight,
}));
vi.mock("../modules/vehicles/services/vehiclesService", () => ({
  getMyVehicleForUser: vi.fn(),
  getVehicleById: vi.fn(),
  getVehiclesList: vi.fn().mockResolvedValue([]),
  updateVehicle: vi.fn(),
}));
vi.mock("../modules/maintenance/services/maintenanceService", () => ({
  getMaintenanceClients: vi.fn().mockResolvedValue([]),
}));
vi.mock("../modules/timesheets/services/timesheetsService", () => ({
  createProject: vi.fn(),
  getActiveProjectsList: vi.fn().mockResolvedValue([]),
  getActiveTimesheetForUser: vi.fn(),
  getLatestTimesheetProjectForUser: vi.fn(),
  getProjectById: vi.fn(),
  getUserTimesheetProjectPreference: vi.fn(),
  saveUserTimesheetProjectPreference: vi.fn(),
  startTimesheet: vi.fn(),
  stopTimesheet: vi.fn(),
}));
vi.mock("../modules/timesheets/services/geocodingService", () => ({
  reverseGeocode: vi.fn(),
}));
vi.mock("../modules/users/services/usersService", () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
  updateUserWorkDetails: vi.fn(),
}));
vi.mock("../modules/tools/services/toolsService", () => ({
  getToolsList: vi.fn().mockResolvedValue([]),
  updateTool: vi.fn(),
}));
vi.mock("../modules/vehicles/components/VehicleImageUploader", () => ({
  default: () => <div data-testid="vehicle-image-uploader" />,
}));
vi.mock("../modules/vehicles/components/VehicleDocumentUploader", () => ({
  default: () => <div data-testid="vehicle-document-uploader" />,
}));

function interpretation(
  overrides: Partial<AssistantCommandInterpretation>
): AssistantCommandInterpretation {
  return {
    intent: "open_page",
    entityType: "page",
    entityQuery: "",
    fieldsToUpdate: {},
    targetText: "",
    targetPage: "",
    pageHint: "",
    buttonHint: "",
    missingFields: [],
    risk: "low",
    needsConfirmation: false,
    spokenSummary: "Deschid pagina.",
    reportType: "",
    startDate: "",
    endDate: "",
    confidence: 0.98,
    ...overrides,
  };
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
          onSubmit={vi.fn().mockResolvedValue(undefined)}
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
  fireEvent.pointerDown(screen.getByRole("button", { name: "Tine apasat pentru comanda vocala" }), {
    pointerId: 1,
  });
  const input = await screen.findByPlaceholderText("Sau scrie comanda...");
  const user = userEvent.setup();
  await user.type(input, command);
  await user.click(screen.getByRole("button", { name: "Trimite comanda" }));
}

function readyVehiclePlan(): AssistantRuntimePlan {
  return {
    intent: "update_vehicle",
    entityType: "vehicle",
    parsedIntent: interpretation({
      commandType: "entity_update",
      intent: "update_vehicle",
      entityType: "vehicle",
      entityQuery: "B33LGR",
      fieldsToUpdate: { currentKm: 6616 },
      risk: "medium",
      needsConfirmation: true,
      spokenSummary: "Schimb kilometrii masinii.",
    }),
    resolvedEntity: {
      entityType: "vehicle",
      entityId: "vehicle-1",
      label: "Dacia Logan B33LGR",
      query: "B33LGR",
      score: 1,
      data: { currentKm: 6000 },
    },
    fieldsToUpdate: { currentKm: 6616 },
    changes: [
      {
        naturalName: "kilometri",
        fieldKey: "currentKm",
        label: "Km curenti",
        oldValue: 6000,
        newValue: 6616,
        displayOldValue: "6000",
        displayNewValue: "6616",
      },
    ],
    beforeData: { currentKm: 6000 },
    afterData: { currentKm: 6616 },
    risk: "medium",
    confidence: 0.97,
    needsConfirmation: true,
    spokenSummary: "Schimb kilometrii masinii.",
    status: "ready",
    message: "Schimb Km curenti de la 6000 la 6616.",
    executionPlan: [
      { id: "confirm", type: "confirm", label: "Astept confirmarea.", requiresConfirmation: true },
      { id: "update", type: "service_update", label: "Actualizez masina." },
    ],
    run: assistantMocks.updateRun,
  };
}

describe("VoiceCommandAssistant critical behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assistantMocks.updateRun.mockResolvedValue({
      result: "Kilometrii au fost actualizati.",
      afterData: { currentKm: 6616 },
    });
    assistantMocks.interpretAssistantCommand.mockImplementation(async (command: string) => {
      const normalized = command.toLowerCase();
      if (normalized.includes("conced")) {
        return interpretation({ commandType: "navigation", targetPage: "/my-leave" });
      }
      if (normalized.includes("mentenanta")) {
        return interpretation({ commandType: "navigation", targetPage: "/maintenance" });
      }
      if (normalized.includes("dashboard")) {
        return interpretation({ commandType: "navigation", targetPage: "/dashboard" });
      }
      if (normalized.includes("schimba data")) {
        return interpretation({
          commandType: "entity_update",
          intent: "unknown",
          entityType: "none",
          confidence: 0.4,
          needsConfirmation: true,
        });
      }
      return interpretation({
        commandType: "entity_update",
        intent: "update_vehicle",
        entityType: "vehicle",
        entityQuery: "Logan",
        fieldsToUpdate: { currentKm: 6616 },
        risk: "medium",
        needsConfirmation: true,
      });
    });
    assistantMocks.buildAssistantRuntimePlan.mockResolvedValue(readyVehiclePlan());
  });

  it("navigates from the vehicle form without changing the plate or dispatching form-fill", async () => {
    renderAssistant("/vehicles/vehicle-1/edit", true);
    const plateInput = screen.getByDisplayValue("B33LGR");
    const inputEventSpy = vi.fn();
    const fillEventSpy = vi.fn();
    plateInput.addEventListener("input", inputEventSpy);
    window.addEventListener("workcontrol:assistant-fill-vehicle-form", fillEventSpy);

    await sendCommand("Du-te pe pagina concedii.");

    await waitFor(() => expect(screen.getByTestId("current-path")).toHaveTextContent("/my-leave"));
    expect(plateInput).toHaveValue("B33LGR");
    expect(inputEventSpy).not.toHaveBeenCalled();
    expect(fillEventSpy).not.toHaveBeenCalled();
    window.removeEventListener("workcontrol:assistant-fill-vehicle-form", fillEventSpy);
  });

  it.each([
    ["/my-leave", "Deschide mentenanta", "/maintenance"],
    ["/maintenance?tab=clients", "Arata dashboard", "/dashboard"],
  ])(
    "navigates from %s without altering the visible form field",
    async (from, command, expected) => {
      renderAssistant(from);
      const input = screen.getByDisplayValue("Valoare initiala");

      await sendCommand(command);

      await waitFor(() => expect(screen.getByTestId("current-path")).toHaveTextContent(expected));
      expect(input).toHaveValue("Valoare initiala");
    }
  );

  it("asks for clarification for the ambiguous command schimba data", async () => {
    renderAssistant("/vehicles/vehicle-1/edit");
    const input = screen.getByDisplayValue("Valoare initiala");

    await sendCommand("schimba data");

    expect(await screen.findAllByText(/nu exista un plan valid confirmat/i)).not.toHaveLength(0);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/vehicles/vehicle-1/edit");
    expect(input).toHaveValue("Valoare initiala");
    expect(assistantMocks.updateRun).not.toHaveBeenCalled();
  });

  it("shows old and new values and executes only after confirmation", async () => {
    renderAssistant("/vehicles/vehicle-1/edit");

    await sendCommand("schimba kilometrii Loganului la 6616");

    expect(await screen.findByText("Confirmare actiune")).toBeInTheDocument();
    expect(screen.getByText(/Km curenti: 6000 -> 6616/)).toBeInTheDocument();
    expect(assistantMocks.updateRun).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Confirma" }));
    await waitFor(() => expect(assistantMocks.updateRun).toHaveBeenCalledTimes(1));
  });

  it("renders a controlled selector when entity resolution is ambiguous", async () => {
    assistantMocks.buildAssistantRuntimePlan.mockResolvedValue({
      ...readyVehiclePlan(),
      status: "needs_clarification",
      run: undefined,
      message: "Am gasit doua masini Logan. Pe care o alegi?",
      options: [
        {
          entityType: "vehicle",
          entityId: "vehicle-1",
          label: "Dacia Logan B33LGR",
          score: 0.9,
          data: {},
        },
        {
          entityType: "vehicle",
          entityId: "vehicle-2",
          label: "Dacia Logan B44ABC",
          score: 0.88,
          data: {},
        },
      ],
    });
    renderAssistant("/vehicles");

    await sendCommand("schimba kilometrii Loganului la 6616");

    expect(await screen.findByRole("button", { name: /Dacia Logan B33LGR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dacia Logan B44ABC/ })).toBeInTheDocument();
  });
});
