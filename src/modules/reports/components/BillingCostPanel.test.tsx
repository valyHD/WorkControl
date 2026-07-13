import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingCostPanel from "./BillingCostPanel";
import {
  getBillingControlPanelData,
  getLiveFirebaseCostEstimate,
} from "../services/billingMetricsService";

vi.mock("../services/billingMetricsService", () => ({
  getBillingControlPanelData: vi.fn(),
  getLiveFirebaseCostEstimate: vi.fn(),
  getLocalGpsRouteCostMetrics: vi.fn(() => ({
    fullRouteRequests: 1,
    incrementalRequests: 10,
    cacheHits: 1,
    cacheMisses: 1,
    sharedRequests: 0,
    hiddenPageFetchesAvoided: 2,
    newPointsReceived: 12,
    estimatedReadsAvoided: 65_000,
    peakConcurrentRequestsPerVehicle: 1,
    estimatedBytesAvoided: 251_000_000,
    queryTelemetry: {
      startedAt: Date.now(),
      activeListeners: 1,
      queries: 2,
      documents: 11,
      averageDocumentsPerQuery: 5.5,
      topConsumers: [],
    },
  })),
  refreshBillingMetricsNow: vi.fn(),
  saveBillingCostSettings: vi.fn(),
  saveFirestoreCostControl: vi.fn(),
}));

const mockedGetData = vi.mocked(getBillingControlPanelData);
const mockedGetLiveEstimate = vi.mocked(getLiveFirebaseCostEstimate);

describe("BillingCostPanel", () => {
  beforeEach(() => {
    mockedGetLiveEstimate.mockResolvedValue({
      status: "current",
      currency: "EUR",
      source: "cloud_monitoring_firestore_operations",
      dataAsOfMs: Date.now() - 180_000,
      lagSeconds: 180,
      sampledWindowMinutes: 15,
      refreshSeconds: 60,
      costPerMinuteEur: 0.00125,
      projectedHourlyEur: 0.075,
      estimatedLastHourEur: 0.061,
      estimatedEgressMiBPerMinute: 3.69,
      estimatedEgressMiBLastHour: 221.4,
      readsPerMinute: 1_000,
      writesPerMinute: 100,
      deletesPerMinute: 0,
      readsLastHour: 60_000,
      writesLastHour: 6_000,
      deletesLastHour: 0,
      snapshotListeners: 4,
      activeConnections: 3,
      functionRequestsLastHour: 12,
      excludes: ["network_egress", "storage"],
      exchangeRate: { source: "ECB", rateDate: "2026-07-10" },
    });
    mockedGetData.mockResolvedValue({
      firestoreCostControl: {
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
      },
      settings: {
        budgetMonthlyEur: 50,
        warningPercent: 70,
        criticalPercent: 90,
      },
      canary: {
        enabled: true,
        canaryTrackerCount: 1,
        diagnosticFlushSeconds: 45,
        updatedAt: Date.now(),
      },
      metrics: {
        currency: "EUR",
        sourceCurrency: "USD",
        actualCostToday: 1.2,
        actualCost7Days: 11.81,
        actualCostMonth: 11.81,
        projectedMonthCost: 28.4,
        creditsMonth: 0,
        netCostMonth: 11.81,
        readsToday: 2_000_000,
        reads7Days: 19_103_161,
        writesToday: 80_000,
        writes7Days: 581_245,
        egressGiB7Days: 67.22,
        functionsInvocations7Days: null,
        gpsEstimatedCost7Days: 11.4,
        nonGpsEstimatedCost7Days: 0.41,
        budgetMonthlyEur: 50,
        budgetUsedPercent: 23.6,
        dailyCosts: [{ day: "2026-07-11", cost: 2.05 }],
        dailyUsage: [{ day: "2026-07-11", reads: 2_000_000, writes: 80_000 }],
        serviceBreakdown: [{ name: "Cloud Firestore", cost: 11.4 }],
        skuBreakdown: [{ name: "Read Ops", cost: 5.4 }],
        periodStart: "2026-06-12",
        periodEnd: "2026-07-11",
        updatedAtMs: Date.now(),
        freshnessStatus: "current",
        source: "cloud_billing_bigquery_standard",
        exchangeRate: {
          source: "ECB",
          rateDate: "2026-07-10",
        },
      },
    });
  });

  it("does not request or render billing information for a non-admin", () => {
    const { container } = render(<BillingCostPanel isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockedGetData).not.toHaveBeenCalled();
    expect(mockedGetLiveEstimate).not.toHaveBeenCalled();
  });

  it("shows costs, usage, canary status and unavailable metrics for an admin", async () => {
    render(<BillingCostPanel isAdmin />);
    expect(await screen.findByText("Consum și costuri")).toBeInTheDocument();
    await waitFor(() => expect(mockedGetData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedGetLiveEstimate).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Consum Firestore - intregul site")).toBeInTheDocument();
    expect(screen.getByText("Cost în ultimele 60 min raportate")).toBeInTheDocument();
    expect(screen.getByText("Citiri Firestore în ultimele 60 min")).toBeInTheDocument();
    expect(screen.queryByText("Proiecție la ritmul actual")).not.toBeInTheDocument();
    expect(screen.getByText(/0,00125/)).toBeInTheDocument();
    expect(screen.getByText("1.000 citiri/min")).toBeInTheDocument();
    expect(screen.getByText(/3,69 MiB egress\/min/)).toBeInTheDocument();
    expect(screen.getAllByText(/11,81/).length).toBeGreaterThan(0);
    expect(screen.getByText("67.22 GiB")).toBeInTheDocument();
    expect(screen.getByText("Canary gateway")).toBeInTheDocument();
    expect(screen.getAllByText("Indisponibil").length).toBeGreaterThan(0);
  });
});
