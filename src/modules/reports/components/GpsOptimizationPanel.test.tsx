import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GpsOptimizationPanel from "./GpsOptimizationPanel";
import {
  getBillingControlPanelData,
  saveFirestoreCostControl,
} from "../services/billingMetricsService";

vi.mock("../services/billingMetricsService", () => ({
  getBillingControlPanelData: vi.fn(),
  saveFirestoreCostControl: vi.fn(),
  getLocalGpsRouteCostMetrics: vi.fn(() => ({
    fullRouteRequests: 0,
    incrementalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    sharedRequests: 0,
    hiddenPageFetchesAvoided: 0,
    newPointsReceived: 0,
    estimatedReadsAvoided: 0,
    peakConcurrentRequestsPerVehicle: 0,
    estimatedBytesAvoided: 0,
    queryTelemetry: {
      activeListeners: 0,
      queries: 0,
      documents: 0,
      averageDocumentsPerQuery: 0,
      topConsumers: [],
    },
  })),
}));

const config = {
  emergencyMode: true,
  fleetRoutesOnDemandOnly: true,
  fleetRoutesCompactAll: true,
  disableBackgroundRouteSync: true,
  maxFleetSnapshotRefreshSeconds: 60,
  maxRoutePointsPerRequest: 2000,
  fleetRouteRefreshMinutes: 30,
  fleetRoutePointsPerVehicle: 50,
  disableHiddenPageListeners: true,
  billingRefreshMinutes: 30,
};

describe("GpsOptimizationPanel", () => {
  beforeEach(() => {
    vi.mocked(getBillingControlPanelData).mockResolvedValue({
      metrics: {} as never,
      settings: { budgetMonthlyEur: 50, warningPercent: 70, criticalPercent: 90 },
      canary: {
        enabled: true,
        canaryTrackerCount: 10,
        diagnosticFlushSeconds: 45,
        updatedAt: Date.now(),
      },
      firestoreCostControl: config,
    });
    vi.mocked(saveFirestoreCostControl).mockResolvedValue(config);
  });

  it("explains the active savings without changing GPS behavior", async () => {
    render(
      <MemoryRouter>
        <GpsOptimizationPanel isAdmin />
      </MemoryRouter>
    );

    expect(await screen.findByText("Mod economie activ")).toBeInTheDocument();
    expect(screen.getByText(/Nu schimbă pozițiile, traseele/)).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("50 puncte")).toBeInTheDocument();
  });

  it("keeps technical zero values collapsed and explains their session scope", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GpsOptimizationPanel isAdmin />
      </MemoryRouter>
    );

    await screen.findByText("Mod economie activ");
    await user.click(screen.getByText("Diagnostic tehnic și metrici pentru sesiunea curentă"));
    expect(screen.getByText(/Valorile zero înseamnă/)).toBeInTheDocument();
    expect(screen.getByText(/nu s-a produs de când ai deschis/)).toBeInTheDocument();
  });

  it("persists only after the administrator presses save", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GpsOptimizationPanel isAdmin />
      </MemoryRouter>
    );

    await screen.findByText("Mod economie activ");
    await user.click(screen.getByRole("checkbox", { name: /Trasee compacte/ }));
    expect(saveFirestoreCostControl).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Salvează setările" }));
    await waitFor(() => expect(saveFirestoreCostControl).toHaveBeenCalledTimes(1));
  });
});
