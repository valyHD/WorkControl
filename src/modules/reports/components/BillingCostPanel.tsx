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
  refreshBillingMetricsNow,
  saveBillingCostSettings,
  type BillingCostSettings,
  type BillingMetrics,
  type LiveFirebaseCostEstimate,
} from "../services/billingMetricsService";

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
  if ((metrics.exportLagDays ?? 0) > 1) {
    return `Billing Export recuperează datele (${metrics.exportLagDays} zile întârziere)`;
  }
  if (!metrics.updatedAtMs) return "Momentul actualizării este indisponibil";
  const ageHours = Math.max(0, (Date.now() - metrics.updatedAtMs) / 3_600_000);
  if (ageHours < 1) return "Actualizat în ultima oră";
  return `Actualizat acum ${Math.floor(ageHours)} ore`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "indisponibilă";
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default function BillingCostPanel({ isAdmin }: BillingCostPanelProps) {
  const [metrics, setMetrics] = useState<BillingMetrics | null>(null);
  const [settings, setSettings] = useState<BillingCostSettings>({
    budgetMonthlyEur: 50,
    warningPercent: 70,
    criticalPercent: 90,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveEstimate, setLiveEstimate] = useState<LiveFirebaseCostEstimate | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState("");

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
    const timer = window.setInterval(() => void loadLiveEstimate(), 30 * 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadLiveEstimate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isAdmin, loadLiveEstimate]);

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
  const monitoringDailyCosts = (liveEstimate?.dailyEstimatedCosts ?? [])
    .filter((item): item is { day: string; cost: number } => item.cost !== null)
    .slice(-14);
  const displayedDailyCosts =
    metrics?.exportLagDays !== null && (metrics?.exportLagDays ?? 0) <= 1
      ? (metrics?.dailyCosts ?? [])
      : monitoringDailyCosts;
  const maxDailyCost = Math.max(0.01, ...displayedDailyCosts.map((item) => item.cost));
  const maxServiceCost = Math.max(
    0.01,
    ...(metrics?.serviceBreakdown.map((item) => item.cost) ?? [0.01])
  );
  const recentDailyUsage = liveEstimate?.dailyUsage.length
    ? liveEstimate.dailyUsage.slice(-14)
    : (metrics?.dailyUsage.slice(-14) ?? []);
  const maxDailyUsage = Math.max(
    1,
    ...recentDailyUsage.flatMap((item) => [item.reads ?? 0, item.writes ?? 0])
  );
  const kpis: Array<{ label: string; value: string; helper: string; Icon: LucideIcon }> = [
    {
      label: "Cost astăzi",
      value: money(metrics?.actualCostToday ?? liveEstimate?.estimatedCostTodayEur ?? null),
      helper: metrics?.actualCostToday != null ? "Cost contabil" : "Estimare Firestore",
      Icon: WalletCards,
    },
    {
      label: "Ultimele 7 zile",
      value: money(metrics?.actualCost7Days ?? liveEstimate?.estimatedCost7DaysEur ?? null),
      helper: metrics?.actualCost7Days != null ? "Cost contabil" : "Estimare Firestore",
      Icon: Activity,
    },
    {
      label: "Luna curentă",
      value: money(metrics?.netCostMonth ?? null),
      helper:
        metrics?.netCostMonth != null
          ? "Cost contabil"
          : `Export disponibil până la ${dateLabel(metrics?.exportThroughDay)}`,
      Icon: WalletCards,
    },
    {
      label: "Estimare final lună",
      value: money(metrics?.projectedMonthCost ?? liveEstimate?.projectedMonthEur ?? null),
      helper:
        metrics?.projectedMonthCost != null ? "Pe baza facturării" : "Pe baza ultimelor 7 zile",
      Icon: Cloud,
    },
    {
      label: "Citiri astăzi",
      value: count(metrics?.readsToday ?? liveEstimate?.readsToday ?? null),
      helper: metrics?.readsToday != null ? "Billing Export" : "Cloud Monitoring",
      Icon: Database,
    },
    {
      label: "Citiri 7 zile",
      value: count(metrics?.reads7Days ?? liveEstimate?.reads7Days ?? null),
      helper: metrics?.reads7Days != null ? "Billing Export" : "Cloud Monitoring",
      Icon: Database,
    },
    {
      label: "Scrieri astăzi",
      value: count(metrics?.writesToday ?? liveEstimate?.writesToday ?? null),
      helper: metrics?.writesToday != null ? "Billing Export" : "Cloud Monitoring",
      Icon: Database,
    },
    {
      label: "Scrieri 7 zile",
      value: count(metrics?.writes7Days ?? liveEstimate?.writes7Days ?? null),
      helper: metrics?.writes7Days != null ? "Billing Export" : "Cloud Monitoring",
      Icon: Database,
    },
    {
      label: "Egress 7 zile",
      value:
        metrics?.egressGiB7Days === null || metrics?.egressGiB7Days === undefined
          ? liveEstimate?.estimatedEgressMiB7Days === null ||
            liveEstimate?.estimatedEgressMiB7Days === undefined
            ? "Indisponibil"
            : `${decimal(liveEstimate.estimatedEgressMiB7Days, 1)} MiB`
          : `${metrics.egressGiB7Days.toFixed(2)} GiB`,
      helper: metrics?.egressGiB7Days != null ? "Billing Export" : "Estimare din citiri",
      Icon: Cloud,
    },
    {
      label: "Functions 7 zile",
      value: count(
        metrics?.functionsInvocations7Days ?? liveEstimate?.functionsInvocations7Days ?? null
      ),
      helper: metrics?.functionsInvocations7Days != null ? "Billing Export" : "Cloud Monitoring",
      Icon: Activity,
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

  return (
    <section className="panel billing-cost-panel" data-assistant-section="firebase-costs">
      <div className="tools-header">
        <div>
          <h3 className="panel-subtitle">Consum și costuri</h3>
          <p className="tools-subtitle">
            Estimări operaționale din Cloud Monitoring și cost contabil din Billing Export, afișate
            separat ca să nu confunde întârzierile Google cu un cost zero.
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
        <span>
          {freshnessLabel(metrics)}
          {metrics?.exportThroughDay
            ? ` · export contabil disponibil până la ${dateLabel(metrics.exportThroughDay)}`
            : ""}
        </span>
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
          <span>
            {count(liveEstimate?.functionRequestsLastHour ?? null)} requesturi Functions/60 min
          </span>
          <span>{liveLagLabel(liveEstimate)}</span>
        </div>
        {liveLoading ? <small>Actualizez estimarea...</small> : null}
        {liveError ? <small className="is-error">{liveError}</small> : null}
        <small>
          Include toate operațiunile Firestore ale proiectului WorkControl, nu doar GPS-ul. Valorile
          estimate nu sunt factura finală: egress-ul este aproximat la 3,78 KiB/citire, iar Storage,
          costul Functions, quota gratuită și discounturile nu sunt incluse.
        </small>
      </section>

      {loading ? <div className="billing-loading">Se încarcă valorile de billing...</div> : null}
      {error ? <div className="tool-message error-message">{error}</div> : null}
      {message ? <div className="tool-message success-message">{message}</div> : null}

      <div className="billing-kpi-grid">
        {kpis.map(({ label, value, helper, Icon }) => (
          <article className="billing-kpi-card" key={label}>
            <Icon size={17} />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{helper}</small>
          </article>
        ))}
      </div>

      <div className="billing-chart-grid">
        <article className="billing-chart-card">
          <h4>Cost zilnic · {displayedDailyCosts.length} zile</h4>
          <p className="tools-subtitle">
            {metrics?.exportLagDays !== null && (metrics?.exportLagDays ?? 0) <= 1
              ? "Cost contabil din Billing Export."
              : "Estimare Firestore din Cloud Monitoring până când exportul contabil ajunge la zi."}
          </p>
          {displayedDailyCosts.length ? (
            <div className="billing-daily-chart" aria-label="Grafic cost zilnic">
              {displayedDailyCosts.map((item) => (
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
          <h4>Cost pe serviciu · ultima perioadă exportată</h4>
          <p className="tools-subtitle">
            Date contabile până la {dateLabel(metrics?.exportThroughDay)}. Arată serviciile Google
            care au produs cost.
          </p>
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
            <p className="tools-subtitle">
              Billing Export nu a furnizat încă un breakdown pe servicii.
            </p>
          )}
        </article>

        <article className="billing-chart-card">
          <h4>Citiri și scrieri · 14 zile</h4>
          <p className="tools-subtitle">
            {liveEstimate?.dailyUsage.length
              ? "Cloud Monitoring, actualizat automat fără citiri suplimentare din Firestore."
              : `Billing Export până la ${dateLabel(metrics?.exportThroughDay)}.`}
          </p>
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

        <article className="billing-chart-card billing-attribution-card">
          <h4>GPS vs restul aplicației</h4>
          <p className="tools-subtitle">
            Firestore nu etichetează automat citirile după pagină sau modul. Nu mai afișăm o
            împărțire procentuală inventată. Diagnosticarea GPS se face separat din tabul GPS, iar
            costul global rămâne verificabil aici.
          </p>
        </article>
      </div>

      <div className="billing-detail-grid billing-detail-grid--single">
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
      </div>

      <article className="billing-sku-card">
        <h4>Ce taxează Google · SKU</h4>
        <p className="tools-subtitle">
          SKU este denumirea exactă a tarifului Google. Lista te ajută să vezi dacă plătești mai
          ales pentru transfer Firestore, Functions, Scheduler sau alt serviciu. Perioada
          disponibilă se încheie la {dateLabel(metrics?.exportThroughDay)}.
        </p>
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
          <p className="tools-subtitle">
            Exportul contabil încă nu conține suficiente date pentru această listă.
          </p>
        )}
      </article>
    </section>
  );
}
