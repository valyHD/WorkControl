import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Cloud,
  Database,
  RefreshCw,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  getBillingControlPanelData,
  getLiveFirebaseCostEstimate,
  getLocalGpsRouteCostMetrics,
  refreshBillingMetricsNow,
  saveBillingCostSettings,
  saveFirestoreCostControl,
  type BillingCostSettings,
  type BillingMetrics,
  type GpsCostOptimizationStatus,
  type LiveFirebaseCostEstimate,
} from "../services/billingMetricsService";
import {
  DEFAULT_FIRESTORE_COST_CONTROL,
  type FirestoreCostControlConfig,
} from "../../../config/firestoreCostControl";

type BillingCostPanelProps = {
  isAdmin: boolean;
};

function money(value: number | null) {
  return value === null
    ? "Indisponibil"
    : new Intl.NumberFormat("ro-RO", { style: "currency", currency: "EUR" }).format(value);
}

function count(value: number | null) {
  return value === null ? "Indisponibil" : new Intl.NumberFormat("ro-RO").format(value);
}

function decimal(value: number, digits = 2) {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : 1)} ${units[unit]}`;
}

function liveMoney(value: number | null, suffix = "") {
  if (value === null) return "Indisponibil";
  const formatted = new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  }).format(value);
  return suffix ? `${formatted}/${suffix}` : formatted;
}

function liveLagLabel(live: LiveFirebaseCostEstimate | null) {
  if (!live?.dataAsOfMs || live.lagSeconds === null) return "Aștept metricile Cloud Monitoring";
  const minutes = Math.max(1, Math.ceil(live.lagSeconds / 60));
  return `Date raportate acum aproximativ ${minutes} min`;
}

function freshnessLabel(metrics: BillingMetrics | null) {
  if (!metrics || metrics.freshnessStatus === "awaiting_export")
    return "Datele contabile se încarcă";
  if (!metrics.updatedAtMs) return "Momentul actualizării este indisponibil";
  const ageHours = Math.max(0, (Date.now() - metrics.updatedAtMs) / 3_600_000);
  if (ageHours < 1) return "Actualizat în ultima oră";
  return `Actualizat acum ${Math.floor(ageHours)} ore`;
}

export default function BillingCostPanel({ isAdmin }: BillingCostPanelProps) {
  const [metrics, setMetrics] = useState<BillingMetrics | null>(null);
  const [settings, setSettings] = useState<BillingCostSettings>({
    budgetMonthlyEur: 50,
    warningPercent: 70,
    criticalPercent: 90,
  });
  const [canary, setCanary] = useState<GpsCostOptimizationStatus | null>(null);
  const [firestoreCostControl, setFirestoreCostControl] =
    useState<FirestoreCostControlConfig>(DEFAULT_FIRESTORE_COST_CONTROL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveEstimate, setLiveEstimate] = useState<LiveFirebaseCostEstimate | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [localRouteMetrics] = useState(() => getLocalGpsRouteCostMetrics());
  const queryTelemetry = localRouteMetrics.queryTelemetry ?? {
    activeListeners: 0,
    queries: 0,
    documents: 0,
    averageDocumentsPerQuery: 0,
    topConsumers: [],
  };

  const loadLiveEstimate = useCallback(
    async (force = false) => {
      if (!isAdmin || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
        return;
      }
      setLiveLoading(true);
      setLiveError("");
      try {
        setLiveEstimate(await getLiveFirebaseCostEstimate({ force }));
      } catch (loadError) {
        console.error("[BillingCostPanel][live-cost]", loadError);
        setLiveError("Estimarea aproape live nu este disponibilă momentan.");
      } finally {
        setLiveLoading(false);
      }
    },
    [isAdmin]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getBillingControlPanelData();
      setMetrics(data.metrics);
      setSettings(data.settings);
      setCanary(data.canary);
      setFirestoreCostControl(data.firestoreCostControl);
    } catch (loadError) {
      console.error("[BillingCostPanel][load]", loadError);
      setError("Nu am putut încărca datele de consum și cost.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    queueMicrotask(() => void load());
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    queueMicrotask(() => void loadLiveEstimate());
    const timer = window.setInterval(
      () => void loadLiveEstimate(),
      firestoreCostControl.billingRefreshMinutes * 60_000
    );
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadLiveEstimate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [firestoreCostControl.billingRefreshMinutes, isAdmin, loadLiveEstimate]);

  if (!isAdmin) return null;

  const budgetPercent = metrics?.budgetUsedPercent ?? null;
  const budgetTone =
    budgetPercent === null
      ? "neutral"
      : budgetPercent >= settings.criticalPercent
        ? "danger"
        : budgetPercent >= settings.warningPercent
          ? "warning"
          : "success";
  const maxDailyCost = Math.max(0.01, ...(metrics?.dailyCosts.map((item) => item.cost) ?? [0.01]));
  const maxServiceCost = Math.max(
    0.01,
    ...(metrics?.serviceBreakdown.map((item) => item.cost) ?? [0.01])
  );
  const recentDailyUsage = metrics?.dailyUsage.slice(-14) ?? [];
  const maxDailyUsage = Math.max(
    1,
    ...recentDailyUsage.flatMap((item) => [item.reads ?? 0, item.writes ?? 0])
  );
  const splitTotal =
    (metrics?.gpsEstimatedCost7Days ?? 0) + (metrics?.nonGpsEstimatedCost7Days ?? 0);
  const gpsSplitPercent =
    splitTotal > 0 ? ((metrics?.gpsEstimatedCost7Days ?? 0) / splitTotal) * 100 : 0;
  const kpis: Array<{ label: string; value: string; Icon: LucideIcon }> = [
    { label: "Cost astăzi", value: money(metrics?.actualCostToday ?? null), Icon: WalletCards },
    { label: "Ultimele 7 zile", value: money(metrics?.actualCost7Days ?? null), Icon: Activity },
    { label: "Luna curentă", value: money(metrics?.netCostMonth ?? null), Icon: WalletCards },
    {
      label: "Estimare final lună",
      value: money(metrics?.projectedMonthCost ?? null),
      Icon: Cloud,
    },
    { label: "Citiri astăzi", value: count(metrics?.readsToday ?? null), Icon: Database },
    { label: "Citiri 7 zile", value: count(metrics?.reads7Days ?? null), Icon: Database },
    { label: "Scrieri astăzi", value: count(metrics?.writesToday ?? null), Icon: Database },
    { label: "Scrieri 7 zile", value: count(metrics?.writes7Days ?? null), Icon: Database },
    {
      label: "Egress 7 zile",
      value:
        metrics?.egressGiB7Days === null || metrics?.egressGiB7Days === undefined
          ? "Indisponibil"
          : `${metrics.egressGiB7Days.toFixed(2)} GiB`,
      Icon: Cloud,
    },
    {
      label: "Functions 7 zile",
      value: count(metrics?.functionsInvocations7Days ?? null),
      Icon: Activity,
    },
    {
      label: "GPS estimat 7 zile",
      value: money(metrics?.gpsEstimatedCost7Days ?? null),
      Icon: Activity,
    },
    {
      label: "Rest aplicație",
      value: money(metrics?.nonGpsEstimatedCost7Days ?? null),
      Icon: Database,
    },
  ];

  async function handleRefresh() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await refreshBillingMetricsNow();
      setMessage(
        result.status === "awaiting_export"
          ? "Exportul Standard este activ; Google încă încarcă datele contabile recente."
          : "Datele de billing au fost actualizate."
      );
      await load();
      await loadLiveEstimate(true);
    } catch (refreshError) {
      console.error("[BillingCostPanel][refresh]", refreshError);
      setError("Actualizarea manuală a datelor de billing a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBudget() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await saveBillingCostSettings(settings);
      setMessage("Bugetul și pragurile au fost salvate.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Setările nu au putut fi salvate.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEmergencyMode() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveFirestoreCostControl(firestoreCostControl);
      setFirestoreCostControl(saved);
      setMessage(
        saved.emergencyMode
          ? "Modul de economisire Firestore este activ."
          : "Modul de economisire a fost dezactivat; hărțile flotei revin la comportamentul anterior."
      );
    } catch (saveError) {
      console.error("[BillingCostPanel][firestore-cost-control]", saveError);
      setError("Configurația de urgență nu a putut fi salvată.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel billing-cost-panel" data-assistant-section="firebase-costs">
      <div className="tools-header">
        <div>
          <h3 className="panel-subtitle">Consum și costuri</h3>
          <p className="tools-subtitle">
            Cost net din Cloud Billing Export, convertit server-side în EUR și păstrat în cache.
          </p>
        </div>
        <button
          className="secondary-btn"
          type="button"
          disabled={busy || loading}
          title="Actualizează cache-ul din BigQuery; operația este disponibilă numai adminului"
          data-assistant-action="refresh-billing-metrics"
          onClick={() => void handleRefresh()}
        >
          <RefreshCw size={16} /> {busy ? "Se actualizează..." : "Actualizează"}
        </button>
      </div>

      <div
        className={`billing-freshness billing-freshness--${metrics?.freshnessStatus ?? "delayed"}`}
      >
        <span>{freshnessLabel(metrics)}</span>
        {metrics?.sourceCurrency && metrics.sourceCurrency !== "EUR" ? (
          <span>
            Conversie estimată {metrics.sourceCurrency} → EUR · BCE{" "}
            {metrics.exchangeRate?.rateDate || "-"}
          </span>
        ) : null}
      </div>

      <section
        className={`billing-live-meter billing-live-meter--${liveEstimate?.status ?? "unavailable"}`}
        aria-label="Estimare aproape live a costului Firebase"
      >
        <div className="billing-live-meter__header">
          <div>
            <span className="billing-live-meter__eyebrow">
              <i aria-hidden="true" /> APROAPE LIVE
            </span>
            <h4>Consum Firestore - intregul site</h4>
          </div>
          <Zap size={19} aria-hidden="true" />
        </div>
        <div className="billing-live-meter__values">
          <div>
            <span>Medie pe minut ({liveEstimate?.sampledWindowMinutes ?? 15} min)</span>
            <strong>{liveMoney(liveEstimate?.costPerMinuteEur ?? null, "min")}</strong>
          </div>
          <div>
            <span>Cost în ultimele 60 min raportate</span>
            <strong>{liveMoney(liveEstimate?.estimatedLastHourEur ?? null)}</strong>
          </div>
          <div>
            <span>Citiri Firestore în ultimele 60 min</span>
            <strong>{count(liveEstimate?.readsLastHour ?? null)}</strong>
          </div>
        </div>
        <div className="billing-live-meter__operations">
          <span>{count(liveEstimate?.readsPerMinute ?? null)} citiri/min</span>
          <span>{count(liveEstimate?.writesPerMinute ?? null)} scrieri/min</span>
          <span>~{decimal(liveEstimate?.estimatedEgressMiBPerMinute ?? 0)} MiB egress/min</span>
          <span>{count(liveEstimate?.snapshotListeners ?? null)} listener-e snapshot</span>
          <span>{count(liveEstimate?.activeConnections ?? null)} conexiuni active</span>
          <span>{count(liveEstimate?.functionRequestsLastHour ?? null)} requesturi Functions/60 min</span>
          <span>{liveLagLabel(liveEstimate)}</span>
        </div>
        {liveLoading ? <small>Actualizez estimarea...</small> : null}
        {liveError ? <small className="is-error">{liveError}</small> : null}
        <small>
          Include toate operațiunile Firestore ale proiectului WorkControl, nu doar GPS-ul.
          Costul pe 60 minute este o fereastră mobilă completă. Egress-ul este aproximat la
          3,78 KiB/citire; Storage, Functions, quota gratuită și discounturile nu sunt incluse.
        </small>
      </section>

      {loading ? <div className="billing-loading">Se încarcă valorile de billing...</div> : null}
      {error ? <div className="tool-message error-message">{error}</div> : null}
      {message ? <div className="tool-message success-message">{message}</div> : null}

      <div className="billing-kpi-grid">
        {kpis.map(({ label, value, Icon }) => (
          <article className="billing-kpi-card" key={label}>
            <Icon size={17} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="billing-chart-grid">
        <article className="billing-chart-card">
          <h4>Cost zilnic · 30 zile</h4>
          {metrics?.dailyCosts.length ? (
            <div className="billing-daily-chart" aria-label="Grafic cost zilnic">
              {metrics.dailyCosts.map((item) => (
                <div
                  className="billing-daily-chart__item"
                  key={item.day}
                  title={`${item.day}: ${money(item.cost)}`}
                >
                  <span style={{ height: `${Math.max(3, (item.cost / maxDailyCost) * 100)}%` }} />
                  <small>{item.day.slice(8)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="tools-subtitle">Datele zilnice nu sunt încă disponibile.</p>
          )}
        </article>

        <article className="billing-chart-card">
          <h4>Cost pe serviciu · luna curentă</h4>
          {metrics?.serviceBreakdown.length ? (
            <div className="billing-service-list">
              {metrics.serviceBreakdown.slice(0, 8).map((item) => (
                <div key={item.name} className="billing-service-row">
                  <div>
                    <span>{item.name}</span>
                    <strong>{money(item.cost)}</strong>
                  </div>
                  <span className="billing-service-track">
                    <i style={{ width: `${Math.max(2, (item.cost / maxServiceCost) * 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="tools-subtitle">Breakdown-ul pe servicii va apărea după primul export.</p>
          )}
        </article>

        <article className="billing-chart-card">
          <h4>Citiri și scrieri · 14 zile</h4>
          {recentDailyUsage.length ? (
            <div className="billing-usage-chart" aria-label="Grafic citiri și scrieri">
              {recentDailyUsage.map((item) => (
                <div
                  className="billing-usage-chart__item"
                  key={item.day}
                  title={`${item.day}: ${count(item.reads)} citiri, ${count(item.writes)} scrieri`}
                >
                  <span
                    className="is-read"
                    style={{ height: `${Math.max(2, ((item.reads ?? 0) / maxDailyUsage) * 100)}%` }}
                  />
                  <span
                    className="is-write"
                    style={{
                      height: `${Math.max(2, ((item.writes ?? 0) / maxDailyUsage) * 100)}%`,
                    }}
                  />
                  <small>{item.day.slice(8)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="tools-subtitle">Usage-ul zilnic nu este încă disponibil.</p>
          )}
          <div className="billing-chart-legend">
            <span className="is-read">Citiri</span>
            <span className="is-write">Scrieri</span>
          </div>
        </article>

        <article className="billing-chart-card">
          <h4>GPS estimat vs rest aplicație · 7 zile</h4>
          {splitTotal > 0 ? (
            <>
              <div className="billing-cost-split" aria-label="Proporție cost GPS estimat">
                <span className="is-gps" style={{ width: `${gpsSplitPercent}%` }} />
                <span className="is-rest" style={{ width: `${100 - gpsSplitPercent}%` }} />
              </div>
              <div className="billing-cost-split__labels">
                <span>
                  GPS estimat <strong>{money(metrics?.gpsEstimatedCost7Days ?? null)}</strong>
                </span>
                <span>
                  Rest <strong>{money(metrics?.nonGpsEstimatedCost7Days ?? null)}</strong>
                </span>
              </div>
            </>
          ) : (
            <p className="tools-subtitle">Separarea va apărea după primul export complet.</p>
          )}
        </article>
      </div>

      <div className="billing-detail-grid">
        <article className={`billing-budget-card billing-budget-card--${budgetTone}`}>
          <div>
            <h4>Buget lunar</h4>
            <strong>{money(settings.budgetMonthlyEur)}</strong>
          </div>
          <div className="billing-budget-progress">
            <span style={{ width: `${Math.min(100, budgetPercent ?? 0)}%` }} />
          </div>
          <p>
            {budgetPercent === null
              ? "Procent indisponibil"
              : `${budgetPercent.toFixed(1)}% utilizat`}
          </p>
          <div className="billing-budget-fields">
            <label>
              Buget EUR
              <input
                type="number"
                min={0}
                max={100000}
                value={settings.budgetMonthlyEur}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    budgetMonthlyEur: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Avertizare %
              <input
                type="number"
                min={1}
                max={100}
                value={settings.warningPercent}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    warningPercent: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Critic %
              <input
                type="number"
                min={2}
                max={200}
                value={settings.criticalPercent}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    criticalPercent: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
          <button
            className="secondary-btn"
            type="button"
            disabled={busy}
            onClick={() => void handleSaveBudget()}
          >
            Salvează bugetul
          </button>
        </article>

        <article className="billing-technical-card">
          <h4>Optimizare GPS</h4>
          <div className="billing-emergency-control">
            <label>
              <input
                type="checkbox"
                checked={firestoreCostControl.emergencyMode}
                onChange={(event) =>
                  setFirestoreCostControl((current) => ({
                    ...current,
                    emergencyMode: event.target.checked,
                    fleetRoutesOnDemandOnly: event.target.checked,
                    disableBackgroundRouteSync: event.target.checked,
                    disableHiddenPageListeners: event.target.checked,
                  }))
                }
              />
              Mod economie Firestore
            </label>
            <button
              className="secondary-btn"
              type="button"
              disabled={busy}
              onClick={() => void handleSaveEmergencyMode()}
            >
              Salvează modul
            </button>
          </div>
          <dl>
            <div>
              <dt>Trasee flotă</dt>
              <dd>{firestoreCostControl.fleetRoutesOnDemandOnly ? "La cerere" : "Toate"}</dd>
            </div>
            <div>
              <dt>Refresh snapshot</dt>
              <dd>{firestoreCostControl.maxFleetSnapshotRefreshSeconds} sec</dd>
            </div>
            <div>
              <dt>Limită traseu</dt>
              <dd>{count(firestoreCostControl.maxRoutePointsPerRequest)}</dd>
            </div>
            <div>
              <dt>Listener-e active local</dt>
              <dd>{queryTelemetry.activeListeners}</dd>
            </div>
            <div>
              <dt>Query-uri locale</dt>
              <dd>{queryTelemetry.queries}</dd>
            </div>
            <div>
              <dt>Documente/query</dt>
              <dd>{decimal(queryTelemetry.averageDocumentsPerQuery, 1)}</dd>
            </div>
            <div>
              <dt>Canary gateway</dt>
              <dd>{canary?.enabled ? "Activ" : "Oprit"}</dd>
            </div>
            <div>
              <dt>Trackere canary</dt>
              <dd>{canary?.canaryTrackerCount ?? 0}</dd>
            </div>
            <div>
              <dt>Flush diagnostic</dt>
              <dd>{canary?.diagnosticFlushSeconds ?? 45} sec</dd>
            </div>
            <div>
              <dt>Full-route sesiune</dt>
              <dd>{localRouteMetrics.fullRouteRequests}</dd>
            </div>
            <div>
              <dt>Incremental sesiune</dt>
              <dd>{localRouteMetrics.incrementalRequests}</dd>
            </div>
            <div>
              <dt>Cache hits</dt>
              <dd>{localRouteMetrics.cacheHits}</dd>
            </div>
            <div>
              <dt>Requesturi partajate</dt>
              <dd>{localRouteMetrics.sharedRequests}</dd>
            </div>
            <div>
              <dt>Fetch-uri ascunse evitate</dt>
              <dd>{localRouteMetrics.hiddenPageFetchesAvoided}</dd>
            </div>
            <div>
              <dt>Reads estimate evitate</dt>
              <dd>{count(localRouteMetrics.estimatedReadsAvoided)}</dd>
            </div>
            <div>
              <dt>Transfer estimat evitat</dt>
              <dd>{bytes(localRouteMetrics.estimatedBytesAvoided)}</dd>
            </div>
          </dl>
          <small>
            Metricile de traseu sunt agregate pentru sesiunea curentă; billing-ul este global.
          </small>
          {queryTelemetry.topConsumers.length ? (
            <div className="billing-query-consumers">
              <strong>Consumatori locali principali</strong>
              {queryTelemetry.topConsumers.map((item) => (
                <span key={`${item.module}:${item.operation}`}>
                  {item.module} · {item.operation}: {count(item.documents)} doc.
                </span>
              ))}
            </div>
          ) : null}
        </article>
      </div>

      <article className="billing-sku-card">
        <h4>Top SKU · luna curentă</h4>
        {metrics?.skuBreakdown.length ? (
          <div className="billing-sku-list">
            {metrics.skuBreakdown.slice(0, 10).map((item) => (
              <div key={item.name}>
                <span>{item.name}</span>
                <strong>{money(item.cost)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="tools-subtitle">SKU-urile vor apărea după popularea exportului Standard.</p>
        )}
      </article>
    </section>
  );
}
