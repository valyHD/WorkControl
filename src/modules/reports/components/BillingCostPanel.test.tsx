import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingCostPanel from "./BillingCostPanel";
import { getBillingControlPanelData } from "../services/billingMetricsService";

vi.mock("../services/billingMetricsService", () => ({
  getBillingControlPanelData: vi.fn(),
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
  })),
  refreshBillingMetricsNow: vi.fn(),
  saveBillingCostSettings: vi.fn(),
}));

const mockedGetData = vi.mocked(getBillingControlPanelData);

describe("BillingCostPanel", () => {
  beforeEach(() => {
    mockedGetData.mockResolvedValue({
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
  });

  it("shows costs, usage, canary status and unavailable metrics for an admin", async () => {
    render(<BillingCostPanel isAdmin />);
    expect(await screen.findByText("Consum și costuri")).toBeInTheDocument();
    await waitFor(() => expect(mockedGetData).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/11,81/).length).toBeGreaterThan(0);
    expect(screen.getByText("67.22 GiB")).toBeInTheDocument();
    expect(screen.getByText("Canary gateway")).toBeInTheDocument();
    expect(screen.getAllByText("Indisponibil").length).toBeGreaterThan(0);
  });
});
