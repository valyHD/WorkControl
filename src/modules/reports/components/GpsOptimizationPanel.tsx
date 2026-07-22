import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Gauge, RefreshCw, Route, ShieldCheck } from "lucide-react";
import {
  getBillingControlPanelData,
  getLocalGpsRouteCostMetrics,
  saveFirestoreCostControl,
  type GpsCostOptimizationStatus,
} from "../services/billingMetricsService";
import {
  DEFAULT_FIRESTORE_COST_CONTROL,
  type FirestoreCostControlConfig,
} from "../../../config/firestoreCostControl";
import { formatLocalConsumerLabel } from "../utils/billingTelemetryLabels";

function formatCount(value: number) {
  return new Intl.NumberFormat("ro-RO").format(value);
}

function formatBytes(value: number) {
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

export default function GpsOptimizationPanel({ isAdmin }: { isAdmin: boolean }) {
  const [config, setConfig] = useState<FirestoreCostControlConfig>(DEFAULT_FIRESTORE_COST_CONTROL);
  const [canary, setCanary] = useState<GpsCostOptimizationStatus | null>(null);
  const [routeMetrics, setRouteMetrics] = useState(() => getLocalGpsRouteCostMetrics());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void getBillingControlPanelData()
      .then((data) => {
        if (!active) return;
        setConfig(data.firestoreCostControl);
        setCanary(data.canary);
      })
      .catch((loadError) => {
        console.error("[GpsOptimizationPanel][load]", loadError);
        if (active) setError("Nu am putut încărca setările de economisire GPS.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const save = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveFirestoreCostControl(config);
      setConfig(saved);
      setMessage(
        saved.emergencyMode
          ? "Modul de economisire este activ și a fost salvat."
          : "Modul de economisire a fost dezactivat."
      );
    } catch (saveError) {
      console.error("[GpsOptimizationPanel][save]", saveError);
      setError("Setările GPS nu au putut fi salvate.");
    } finally {
      setBusy(false);
    }
  };

  const telemetry = routeMetrics.queryTelemetry;

  return (
    <section className="panel gps-cost-panel" data-assistant-section="gps-cost-optimization">
      <div className="tools-header">
        <div>
          <h2 className="panel-title">Economie GPS și Firestore</h2>
          <p className="tools-subtitle">
            Controlează cât de des harta flotei cere date. Nu schimbă pozițiile, traseele, filtrarea
            jitter sau pagina individuală a mașinii.
          </p>
        </div>
        <Link className="secondary-btn" to="/vehicles/gps-map">
          <Route size={16} /> Deschide toate GPS-urile
        </Link>
      </div>

      {loading ? <div className="billing-loading">Se încarcă setările...</div> : null}
      {error ? <div className="tool-message error-message">{error}</div> : null}
      {message ? <div className="tool-message success-message">{message}</div> : null}

      <div className={`gps-cost-summary${config.emergencyMode ? " is-active" : ""}`}>
        <ShieldCheck size={20} />
        <div>
          <strong>{config.emergencyMode ? "Mod economie activ" : "Mod standard activ"}</strong>
          <span>
            {config.emergencyMode
              ? `Pozițiile flotei se verifică la ${config.maxFleetSnapshotRefreshSeconds} secunde, iar traseele compacte la ${config.fleetRouteRefreshMinutes} minute.`
              : "Harta flotei folosește frecvența standard de citire."}
          </span>
        </div>
      </div>

      <div className="gps-cost-controls" aria-label="Setări economie GPS">
        <label className="gps-cost-toggle">
          <input
            type="checkbox"
            checked={config.emergencyMode}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                emergencyMode: event.target.checked,
                fleetRoutesOnDemandOnly: event.target.checked,
                disableBackgroundRouteSync: event.target.checked,
                disableHiddenPageListeners: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Mod economie Firestore</strong>
            <small>
              Oprește sincronizarea traseelor în fundal și citirile când pagina este ascunsă.
            </small>
          </span>
        </label>
        <label className="gps-cost-toggle">
          <input
            type="checkbox"
            checked={config.fleetRoutesCompactAll}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                fleetRoutesCompactAll: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Trasee compacte în harta flotei</strong>
            <small>
              Afișează forma traseului cu maximum {config.fleetRoutePointsPerVehicle} puncte pe
              mașină. Pagina Mașina mea rămâne detaliată.
            </small>
          </span>
        </label>
        <button className="primary-btn" type="button" disabled={busy || loading} onClick={save}>
          {busy ? "Se salvează..." : "Salvează setările"}
        </button>
      </div>

      <div className="gps-cost-kpis">
        <article>
          <RefreshCw size={18} />
          <span>Poziții flotă</span>
          <strong>{config.maxFleetSnapshotRefreshSeconds} sec</strong>
          <small>Ultima poziție a fiecărei mașini.</small>
        </article>
        <article>
          <Route size={18} />
          <span>Trasee flotă</span>
          <strong>{config.fleetRouteRefreshMinutes} min</strong>
          <small>Refresh-ul paginii cere imediat date noi.</small>
        </article>
        <article>
          <Gauge size={18} />
          <span>Detaliu traseu</span>
          <strong>{formatCount(config.fleetRoutePointsPerVehicle)} puncte</strong>
          <small>Pentru fiecare hartă din lista flotei.</small>
        </article>
      </div>

      <details className="gps-cost-diagnostics">
        <summary>Diagnostic tehnic și metrici pentru sesiunea curentă</summary>
        <p>
          Valorile zero înseamnă că acțiunea respectivă nu s-a produs de când ai deschis aplicația
          în acest tab. Nu sunt metrici globale și nu indică o eroare.
        </p>
        <div className="gps-cost-diagnostics__grid">
          <div>
            <span>Limită maximă cerere traseu</span>
            <strong>{formatCount(config.maxRoutePointsPerRequest)}</strong>
          </div>
          <div>
            <span>Canary gateway</span>
            <strong>{canary?.enabled ? "Activ" : "Oprit"}</strong>
          </div>
          <div>
            <span>Trackere în batching</span>
            <strong>{canary?.canaryTrackerCount ?? 0}</strong>
          </div>
          <div>
            <span>Flush diagnostic gateway</span>
            <strong>{canary?.diagnosticFlushSeconds ?? 300} sec</strong>
          </div>
          <div>
            <span>Listener-e active local</span>
            <strong>{telemetry?.activeListeners ?? 0}</strong>
          </div>
          <div>
            <span>Query-uri locale</span>
            <strong>{telemetry?.queries ?? 0}</strong>
          </div>
          <div>
            <span>Documente/query</span>
            <strong>{(telemetry?.averageDocumentsPerQuery ?? 0).toFixed(1)}</strong>
          </div>
          <div>
            <span>Transfer local estimat</span>
            <strong>{formatBytes(telemetry?.estimatedBytes ?? 0)}</strong>
          </div>
          <div>
            <span>Cache hits locale</span>
            <strong>{formatCount(telemetry?.cacheHits ?? 0)}</strong>
          </div>
          <div>
            <span>Query-uri evitate local</span>
            <strong>{formatCount(telemetry?.avoidedQueries ?? 0)}</strong>
          </div>
          <div>
            <span>Documente evitate local</span>
            <strong>{formatCount(telemetry?.avoidedDocuments ?? 0)}</strong>
          </div>
          <div>
            <span>Transfer evitat local</span>
            <strong>{formatBytes(telemetry?.avoidedBytes ?? 0)}</strong>
          </div>
          <div>
            <span>Cereri traseu complet</span>
            <strong>{routeMetrics.fullRouteRequests}</strong>
          </div>
          <div>
            <span>Cereri incrementale</span>
            <strong>{routeMetrics.incrementalRequests}</strong>
          </div>
          <div>
            <span>Răspunsuri din cache</span>
            <strong>{routeMetrics.cacheHits}</strong>
          </div>
          <div>
            <span>Cereri partajate</span>
            <strong>{routeMetrics.sharedRequests}</strong>
          </div>
          <div>
            <span>Fetch-uri ascunse evitate</span>
            <strong>{routeMetrics.hiddenPageFetchesAvoided}</strong>
          </div>
          <div>
            <span>Citiri estimate evitate</span>
            <strong>{formatCount(routeMetrics.estimatedReadsAvoided)}</strong>
          </div>
          <div>
            <span>Transfer estimat evitat</span>
            <strong>{formatBytes(routeMetrics.estimatedBytesAvoided)}</strong>
          </div>
        </div>
        {telemetry?.topConsumers?.length ? (
          <div className="billing-query-consumers">
            <strong>Consumatori locali observați</strong>
            {telemetry.topConsumers.map((item) => (
              <span key={`${item.module}:${item.operation}`}>
                {formatLocalConsumerLabel(item.module)} · {formatLocalConsumerLabel(item.operation)}:{" "}
                {formatCount(item.documents)} documente,{" "}
                {formatCount(item.queries)} query-uri, {formatBytes(item.estimatedBytes ?? 0)}
              </span>
            ))}
          </div>
        ) : (
          <div className="gps-cost-empty-diagnostic">
            <Database size={17} /> Nu au fost înregistrate query-uri locale în această sesiune.
          </div>
        )}
        <button
          className="secondary-btn"
          type="button"
          onClick={() => setRouteMetrics(getLocalGpsRouteCostMetrics())}
        >
          <RefreshCw size={15} /> Actualizează diagnosticul local
        </button>
      </details>
    </section>
  );
}
