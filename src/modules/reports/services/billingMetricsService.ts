import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";
import { getFleetRouteSyncMetrics } from "../../vehicles/services/fleetRouteSync";

export type BillingBreakdownItem = {
  name: string;
  cost: number;
};

export type BillingDailyCost = {
  day: string;
  cost: number;
};

export type BillingDailyUsage = {
  day: string;
  reads: number | null;
  writes: number | null;
};

export type BillingMetrics = {
  currency: "EUR";
  sourceCurrency: string | null;
  actualCostToday: number | null;
  actualCost7Days: number | null;
  actualCostMonth: number | null;
  projectedMonthCost: number | null;
  creditsMonth: number | null;
  netCostMonth: number | null;
  readsToday: number | null;
  reads7Days: number | null;
  writesToday: number | null;
  writes7Days: number | null;
  egressGiB7Days: number | null;
  functionsInvocations7Days: number | null;
  gpsEstimatedCost7Days: number | null;
  nonGpsEstimatedCost7Days: number | null;
  budgetMonthlyEur: number;
  budgetUsedPercent: number | null;
  dailyCosts: BillingDailyCost[];
  dailyUsage: BillingDailyUsage[];
  serviceBreakdown: BillingBreakdownItem[];
  skuBreakdown: BillingBreakdownItem[];
  periodStart: string | null;
  periodEnd: string | null;
  updatedAtMs: number | null;
  freshnessStatus: "current" | "delayed" | "awaiting_export" | "error";
  freshnessReason?: string;
  source: string;
  exchangeRate?: {
    source: string;
    rateDate: string | null;
  };
};

export type BillingCostSettings = {
  budgetMonthlyEur: number;
  warningPercent: number;
  criticalPercent: number;
};

export type GpsCostOptimizationStatus = {
  enabled: boolean;
  canaryTrackerCount: number;
  diagnosticFlushSeconds: number;
  updatedAt: number | null;
};

export type BillingControlPanelData = {
  metrics: BillingMetrics;
  settings: BillingCostSettings;
  canary: GpsCostOptimizationStatus;
};

export type LiveFirebaseCostEstimate = {
  status: "current" | "delayed" | "unavailable";
  currency: "EUR";
  source: string;
  dataAsOfMs: number | null;
  lagSeconds: number | null;
  sampledWindowMinutes: number;
  refreshSeconds: number;
  costPerMinuteEur: number | null;
  projectedHourlyEur: number | null;
  estimatedLastHourEur: number | null;
  readsPerMinute: number | null;
  writesPerMinute: number | null;
  deletesPerMinute: number | null;
  readsLastHour: number | null;
  writesLastHour: number | null;
  deletesLastHour: number | null;
  excludes: string[];
  exchangeRate: {
    source: string;
    rateDate: string | null;
  };
};

const EMPTY_METRICS: BillingMetrics = {
  currency: "EUR",
  sourceCurrency: null,
  actualCostToday: null,
  actualCost7Days: null,
  actualCostMonth: null,
  projectedMonthCost: null,
  creditsMonth: null,
  netCostMonth: null,
  readsToday: null,
  reads7Days: null,
  writesToday: null,
  writes7Days: null,
  egressGiB7Days: null,
  functionsInvocations7Days: null,
  gpsEstimatedCost7Days: null,
  nonGpsEstimatedCost7Days: null,
  budgetMonthlyEur: 0,
  budgetUsedPercent: null,
  dailyCosts: [],
  dailyUsage: [],
  serviceBreakdown: [],
  skuBreakdown: [],
  periodStart: null,
  periodEnd: null,
  updatedAtMs: null,
  freshnessStatus: "awaiting_export",
  source: "cloud_billing_bigquery_standard",
};

let liveEstimateCache: { value: LiveFirebaseCostEstimate; expiresAt: number } | null = null;
let liveEstimateRequest: Promise<LiveFirebaseCostEstimate> | null = null;

function finiteOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteOr(value: unknown, fallback: number) {
  return finiteOrNull(value) ?? fallback;
}

function mapBreakdown(value: unknown): BillingBreakdownItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: String(item?.name || "Necunoscut"),
      cost: finiteOr(item?.cost, 0),
    }))
    .slice(0, 20);
}

function mapDailyCosts(value: unknown): BillingDailyCost[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ day: String(item?.day || ""), cost: finiteOr(item?.cost, 0) }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day))
    .slice(-30);
}

function mapDailyUsage(value: unknown): BillingDailyUsage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      day: String(item?.day || ""),
      reads: finiteOrNull(item?.reads),
      writes: finiteOrNull(item?.writes),
    }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day))
    .slice(-30);
}

function mapBillingMetrics(value: unknown): BillingMetrics {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...EMPTY_METRICS,
    ...data,
    actualCostToday: finiteOrNull(data.actualCostToday),
    actualCost7Days: finiteOrNull(data.actualCost7Days),
    actualCostMonth: finiteOrNull(data.actualCostMonth),
    projectedMonthCost: finiteOrNull(data.projectedMonthCost),
    creditsMonth: finiteOrNull(data.creditsMonth),
    netCostMonth: finiteOrNull(data.netCostMonth),
    readsToday: finiteOrNull(data.readsToday),
    reads7Days: finiteOrNull(data.reads7Days),
    writesToday: finiteOrNull(data.writesToday),
    writes7Days: finiteOrNull(data.writes7Days),
    egressGiB7Days: finiteOrNull(data.egressGiB7Days),
    functionsInvocations7Days: finiteOrNull(data.functionsInvocations7Days),
    gpsEstimatedCost7Days: finiteOrNull(data.gpsEstimatedCost7Days),
    nonGpsEstimatedCost7Days: finiteOrNull(data.nonGpsEstimatedCost7Days),
    budgetMonthlyEur: finiteOr(data.budgetMonthlyEur, 0),
    budgetUsedPercent: finiteOrNull(data.budgetUsedPercent),
    dailyCosts: mapDailyCosts(data.dailyCosts),
    dailyUsage: mapDailyUsage(data.dailyUsage),
    serviceBreakdown: mapBreakdown(data.serviceBreakdown),
    skuBreakdown: mapBreakdown(data.skuBreakdown),
    updatedAtMs: finiteOrNull(data.updatedAtMs),
  } as BillingMetrics;
}

function mapBillingSettings(value: unknown): BillingCostSettings {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const warningPercent = Math.max(1, Math.min(100, finiteOr(data.warningPercent, 70)));
  return {
    budgetMonthlyEur: Math.max(0, finiteOr(data.budgetMonthlyEur, 50)),
    warningPercent,
    criticalPercent: Math.max(
      warningPercent + 1,
      Math.min(200, finiteOr(data.criticalPercent, 90))
    ),
  };
}

function mapCanaryStatus(value: unknown): GpsCostOptimizationStatus {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: data.enabled === true,
    canaryTrackerCount: Math.max(0, finiteOr(data.canaryTrackerCount, 0)),
    diagnosticFlushSeconds: Math.max(30, Math.min(60, finiteOr(data.diagnosticFlushSeconds, 45))),
    updatedAt: finiteOrNull(data.updatedAt),
  };
}

function mapLiveCostEstimate(value: unknown): LiveFirebaseCostEstimate {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const exchangeRate =
    data.exchangeRate && typeof data.exchangeRate === "object"
      ? (data.exchangeRate as Record<string, unknown>)
      : {};
  const status =
    data.status === "current" || data.status === "delayed" ? data.status : "unavailable";

  return {
    status,
    currency: "EUR",
    source: String(data.source || "cloud_monitoring_firestore_operations"),
    dataAsOfMs: finiteOrNull(data.dataAsOfMs),
    lagSeconds: finiteOrNull(data.lagSeconds),
    sampledWindowMinutes: Math.max(1, finiteOr(data.sampledWindowMinutes, 5)),
    refreshSeconds: Math.max(30, finiteOr(data.refreshSeconds, 60)),
    costPerMinuteEur: finiteOrNull(data.costPerMinuteEur),
    projectedHourlyEur: finiteOrNull(data.projectedHourlyEur),
    estimatedLastHourEur: finiteOrNull(data.estimatedLastHourEur),
    readsPerMinute: finiteOrNull(data.readsPerMinute),
    writesPerMinute: finiteOrNull(data.writesPerMinute),
    deletesPerMinute: finiteOrNull(data.deletesPerMinute),
    readsLastHour: finiteOrNull(data.readsLastHour),
    writesLastHour: finiteOrNull(data.writesLastHour),
    deletesLastHour: finiteOrNull(data.deletesLastHour),
    excludes: Array.isArray(data.excludes)
      ? data.excludes.map((item) => String(item)).slice(0, 10)
      : [],
    exchangeRate: {
      source: String(exchangeRate.source || "ECB"),
      rateDate: exchangeRate.rateDate ? String(exchangeRate.rateDate) : null,
    },
  };
}

export async function getBillingControlPanelData(): Promise<BillingControlPanelData> {
  const callable = httpsCallable<
    Record<string, never>,
    { metrics?: unknown; settings?: unknown; canary?: unknown }
  >(functions, "getBillingControlPanelData");
  const result = await callable({});
  return {
    metrics: mapBillingMetrics(result.data.metrics),
    settings: mapBillingSettings(result.data.settings),
    canary: mapCanaryStatus(result.data.canary),
  };
}

export async function saveBillingCostSettings(settings: BillingCostSettings) {
  const budgetMonthlyEur = finiteOr(settings.budgetMonthlyEur, -1);
  const warningPercent = finiteOr(settings.warningPercent, -1);
  const criticalPercent = finiteOr(settings.criticalPercent, -1);
  if (budgetMonthlyEur < 0 || budgetMonthlyEur > 100_000) {
    throw new Error("Bugetul lunar trebuie să fie între 0 și 100.000 EUR.");
  }
  if (warningPercent < 1 || warningPercent > 100) {
    throw new Error("Pragul de avertizare trebuie să fie între 1 și 100%.");
  }
  if (criticalPercent <= warningPercent || criticalPercent > 200) {
    throw new Error("Pragul critic trebuie să fie mai mare decât avertizarea și maximum 200%.");
  }

  const callable = httpsCallable<BillingCostSettings, { status: string }>(
    functions,
    "saveBillingCostSettings"
  );
  await callable({ budgetMonthlyEur, warningPercent, criticalPercent });
}

export async function refreshBillingMetricsNow() {
  const callable = httpsCallable<Record<string, never>, { status: string; reason?: string }>(
    functions,
    "refreshBillingMetricsNow"
  );
  const result = await callable({});
  return result.data;
}

export async function getLiveFirebaseCostEstimate(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && liveEstimateCache && liveEstimateCache.expiresAt > now) {
    return liveEstimateCache.value;
  }
  if (liveEstimateRequest) return liveEstimateRequest;

  liveEstimateRequest = (async () => {
    const callable = httpsCallable<Record<string, never>, unknown>(
      functions,
      "getLiveFirebaseCostEstimate"
    );
    const result = await callable({});
    const value = mapLiveCostEstimate(result.data);
    liveEstimateCache = { value, expiresAt: Date.now() + 45_000 };
    return value;
  })();

  try {
    return await liveEstimateRequest;
  } finally {
    liveEstimateRequest = null;
  }
}

export function getLocalGpsRouteCostMetrics() {
  const route = getFleetRouteSyncMetrics();
  return {
    ...route,
    estimatedBytesAvoided: Math.round(route.estimatedReadsAvoided * 3.78 * 1024),
  };
}
