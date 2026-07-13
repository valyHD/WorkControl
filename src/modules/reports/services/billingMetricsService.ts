import { httpsCallable } from "firebase/functions";
import { functions } from "../../../lib/firebase/firebase";
import {
  normalizeFirestoreCostControl,
  type FirestoreCostControlConfig,
} from "../../../config/firestoreCostControl";
import { getFirestoreQueryTelemetry } from "../../../lib/firebase/firestoreQueryTelemetry";
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
  exportFromDay: string | null;
  exportThroughDay: string | null;
  exportLagDays: number | null;
  costAttributionStatus: "available" | "unavailable";
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
  firestoreCostControl: FirestoreCostControlConfig;
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
  estimatedEgressMiBPerMinute: number | null;
  estimatedEgressMiBLastHour: number | null;
  readsPerMinute: number | null;
  writesPerMinute: number | null;
  deletesPerMinute: number | null;
  readsLastHour: number | null;
  writesLastHour: number | null;
  deletesLastHour: number | null;
  snapshotListeners: number | null;
  activeConnections: number | null;
  functionRequestsLastHour: number | null;
  estimatedCostTodayEur: number | null;
  estimatedCost7DaysEur: number | null;
  projectedMonthEur: number | null;
  estimatedEgressMiB7Days: number | null;
  readsToday: number | null;
  writesToday: number | null;
  deletesToday: number | null;
  reads7Days: number | null;
  writes7Days: number | null;
  deletes7Days: number | null;
  functionsInvocations7Days: number | null;
  dailyUsage: Array<{ day: string; reads: number; writes: number; deletes: number }>;
  dailyEstimatedCosts: Array<{ day: string; cost: number | null }>;
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
  exportFromDay: null,
  exportThroughDay: null,
  exportLagDays: null,
  costAttributionStatus: "unavailable",
  updatedAtMs: null,
  freshnessStatus: "awaiting_export",
  source: "cloud_billing_bigquery_standard",
};

let liveEstimateCache: { value: LiveFirebaseCostEstimate; expiresAt: number } | null = null;
let liveEstimateRequest: Promise<LiveFirebaseCostEstimate> | null = null;
let billingControlCache: { value: BillingControlPanelData; expiresAt: number } | null = null;
let billingControlRequest: Promise<BillingControlPanelData> | null = null;

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
    exportFromDay: data.exportFromDay ? String(data.exportFromDay) : null,
    exportThroughDay: data.exportThroughDay ? String(data.exportThroughDay) : null,
    exportLagDays: finiteOrNull(data.exportLagDays),
    costAttributionStatus: data.costAttributionStatus === "available" ? "available" : "unavailable",
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
  const dailyUsage = Array.isArray(data.dailyUsage)
    ? data.dailyUsage
        .map((item) => ({
          day: String(item?.day || ""),
          reads: Math.max(0, finiteOr(item?.reads, 0)),
          writes: Math.max(0, finiteOr(item?.writes, 0)),
          deletes: Math.max(0, finiteOr(item?.deletes, 0)),
        }))
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day))
        .slice(-14)
    : [];
  const dailyEstimatedCosts = Array.isArray(data.dailyEstimatedCosts)
    ? data.dailyEstimatedCosts
        .map((item) => ({
          day: String(item?.day || ""),
          cost: finiteOrNull(item?.cost),
        }))
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day))
        .slice(-14)
    : [];

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
    estimatedEgressMiBPerMinute: finiteOrNull(data.estimatedEgressMiBPerMinute),
    estimatedEgressMiBLastHour: finiteOrNull(data.estimatedEgressMiBLastHour),
    readsPerMinute: finiteOrNull(data.readsPerMinute),
    writesPerMinute: finiteOrNull(data.writesPerMinute),
    deletesPerMinute: finiteOrNull(data.deletesPerMinute),
    readsLastHour: finiteOrNull(data.readsLastHour),
    writesLastHour: finiteOrNull(data.writesLastHour),
    deletesLastHour: finiteOrNull(data.deletesLastHour),
    snapshotListeners: finiteOrNull(data.snapshotListeners),
    activeConnections: finiteOrNull(data.activeConnections),
    functionRequestsLastHour: finiteOrNull(data.functionRequestsLastHour),
    estimatedCostTodayEur: finiteOrNull(data.estimatedCostTodayEur),
    estimatedCost7DaysEur: finiteOrNull(data.estimatedCost7DaysEur),
    projectedMonthEur: finiteOrNull(data.projectedMonthEur),
    estimatedEgressMiB7Days: finiteOrNull(data.estimatedEgressMiB7Days),
    readsToday: finiteOrNull(data.readsToday),
    writesToday: finiteOrNull(data.writesToday),
    deletesToday: finiteOrNull(data.deletesToday),
    reads7Days: finiteOrNull(data.reads7Days),
    writes7Days: finiteOrNull(data.writes7Days),
    deletes7Days: finiteOrNull(data.deletes7Days),
    functionsInvocations7Days: finiteOrNull(data.functionsInvocations7Days),
    dailyUsage,
    dailyEstimatedCosts,
    excludes: Array.isArray(data.excludes)
      ? data.excludes.map((item) => String(item)).slice(0, 10)
      : [],
    exchangeRate: {
      source: String(exchangeRate.source || "ECB"),
      rateDate: exchangeRate.rateDate ? String(exchangeRate.rateDate) : null,
    },
  };
}

export async function getBillingControlPanelData(
  options: { force?: boolean } = {}
): Promise<BillingControlPanelData> {
  const now = Date.now();
  if (!options.force && billingControlCache?.expiresAt && billingControlCache.expiresAt > now) {
    return billingControlCache.value;
  }
  if (billingControlRequest) return billingControlRequest;

  billingControlRequest = (async () => {
    const callable = httpsCallable<
      Record<string, never>,
      { metrics?: unknown; settings?: unknown; canary?: unknown; firestoreCostControl?: unknown }
    >(functions, "getBillingControlPanelData");
    const result = await callable({});
    const value = {
      metrics: mapBillingMetrics(result.data.metrics),
      settings: mapBillingSettings(result.data.settings),
      canary: mapCanaryStatus(result.data.canary),
      firestoreCostControl: normalizeFirestoreCostControl(result.data.firestoreCostControl),
    };
    billingControlCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  })();

  try {
    return await billingControlRequest;
  } finally {
    billingControlRequest = null;
  }
}

export async function saveFirestoreCostControl(config: FirestoreCostControlConfig) {
  const normalized = normalizeFirestoreCostControl(config);
  const callable = httpsCallable<FirestoreCostControlConfig, { status: string; config?: unknown }>(
    functions,
    "saveFirestoreCostControl"
  );
  const result = await callable(normalized);
  const saved = normalizeFirestoreCostControl(result.data.config);
  billingControlCache = null;
  return saved;
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
  billingControlCache = null;
}

export async function refreshBillingMetricsNow() {
  const callable = httpsCallable<Record<string, never>, { status: string; reason?: string }>(
    functions,
    "refreshBillingMetricsNow"
  );
  const result = await callable({});
  billingControlCache = null;
  return result.data;
}

export async function getLiveFirebaseCostEstimate(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && liveEstimateCache && liveEstimateCache.expiresAt > now) {
    return liveEstimateCache.value;
  }
  if (liveEstimateRequest) return liveEstimateRequest;

  liveEstimateRequest = (async () => {
    const callable = httpsCallable<{ force?: boolean }, unknown>(
      functions,
      "getLiveFirebaseCostEstimate"
    );
    const result = await callable({ force: options.force === true });
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
    queryTelemetry: getFirestoreQueryTelemetry(),
  };
}
