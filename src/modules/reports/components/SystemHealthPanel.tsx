import { useState } from "react";
import { Activity, Database, HardDrive, RefreshCw, Server, ShieldCheck } from "lucide-react";
import StatusBadge from "../../../components/StatusBadge";
import { useFeatureFlags } from "../../../lib/productIntelligence";
import { getWorkControlServerHealth, type WorkControlServerHealth } from "../services/systemHealthService";

type LocalHealth = {
  online: boolean;
  serviceWorker: boolean;
  indexedDb: boolean;
  sentryConfigured: boolean;
};

function getLocalHealth(): LocalHealth {
  return {
    online: navigator.onLine,
    serviceWorker: "serviceWorker" in navigator,
    indexedDb: typeof indexedDB !== "undefined",
    sentryConfigured: Boolean(import.meta.env.VITE_SENTRY_DSN),
  };
}

export default function SystemHealthPanel({ isAdmin }: { isAdmin: boolean }) {
  const { flags } = useFeatureFlags();
  const [local, setLocal] = useState<LocalHealth>(getLocalHealth);
  const [server, setServer] = useState<WorkControlServerHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isAdmin || !flags.systemHealth) return null;

  const check = async () => {
    setLoading(true);
    setError("");
    setLocal(getLocalHealth());
    try {
      setServer(await getWorkControlServerHealth());
    } catch (healthError) {
      console.warn("[SystemHealthPanel]", healthError);
      setError("Verificarea Functions nu a putut fi finalizata.");
    } finally {
      setLoading(false);
    }
  };

  const healthItems = [
    { id: "network", label: "Conexiune", ok: local.online, icon: Activity, detail: local.online ? "Online" : "Offline" },
    { id: "sw", label: "PWA cache", ok: local.serviceWorker, icon: HardDrive, detail: local.serviceWorker ? "Disponibil" : "Indisponibil" },
    { id: "idb", label: "Cozi offline", ok: local.indexedDb, icon: Database, detail: local.indexedDb ? "IndexedDB activ" : "IndexedDB indisponibil" },
    { id: "sentry", label: "Error monitoring", ok: local.sentryConfigured, icon: ShieldCheck, detail: local.sentryConfigured ? "Sentry configurat" : "Sentry opt-in neconfigurat" },
    { id: "functions", label: "Cloud Functions", ok: server?.status === "ok", icon: Server, detail: server ? `${server.region} · ${server.nodeVersion}` : "Neverificat" },
  ];

  return (
    <section id="health" className="panel wc-system-health-panel">
      <div className="tools-header tools-header--compact">
        <div>
          <h3 className="panel-subtitle">Health WorkControl</h3>
          <p className="tools-subtitle">Verificare la cerere, fara polling si fara date personale.</p>
        </div>
        <button className="secondary-btn" type="button" onClick={() => void check()} disabled={loading}>
          <RefreshCw size={16} /> {loading ? "Se verifica" : "Verifica acum"}
        </button>
      </div>
      {error ? <div className="tool-message error-message" role="alert">{error}</div> : null}
      <div className="wc-health-grid">
        {healthItems.map(({ id, label, ok, icon: Icon, detail }) => (
          <article key={id}>
            <Icon size={18} />
            <div><strong>{label}</strong><span>{detail}</span></div>
            <StatusBadge tone={ok ? "green" : id === "sentry" || !server ? "muted" : "orange"}>
              {ok ? "OK" : id === "sentry" || !server ? "Info" : "Atentie"}
            </StatusBadge>
          </article>
        ))}
      </div>
      {server ? <small>Ultima verificare: {new Date(server.checkedAt).toLocaleString("ro-RO")} · uptime instanta {server.uptimeSeconds}s</small> : null}
    </section>
  );
}
