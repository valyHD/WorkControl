import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { ControlPanelSettings } from "../services/controlPanelService";
import {
  cleanupHistory,
  exportBackupDataset,
  getCollectionCounters,
  getControlPanelSettings,
  getLatestBackupJob,
  saveControlPanelSettings,
} from "../services/controlPanelService";

const FALLBACK_SETTINGS: ControlPanelSettings = {
  retentionMonths: 2,
  autoBackupEnabled: false,
  autoBackupIntervalDays: 7,
  notifyBeforeCleanupDays: 3,
  uiFontScale: 1,
  uiDensity: "comfortable",
  uiPalette: "blue",
  updatedAt: Date.now(),
};

function prettyBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size > 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size > 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function ControlPanelPage() {
  const { role } = useAuth();
  const [settings, setSettings] = useState<ControlPanelSettings>(FALLBACK_SETTINGS);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [lastBackupInfo, setLastBackupInfo] = useState<Record<string, any> | null>(null);
  const [busyMessage, setBusyMessage] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cleanupNotifications, setCleanupNotifications] = useState(true);
  const [cleanupToolEvents, setCleanupToolEvents] = useState(true);
  const [cleanupVehicleEvents, setCleanupVehicleEvents] = useState(true);
  const [cleanupTimesheets, setCleanupTimesheets] = useState(false);

  const totalRecords = useMemo(
    () => Object.values(counters).reduce((sum, count) => sum + count, 0),
    [counters]
  );

  async function loadData() {
    setError("");
    const [loadedSettings, loadedCounters, backupInfo] = await Promise.all([
      getControlPanelSettings(),
      getCollectionCounters(),
      getLatestBackupJob(),
    ]);

    setSettings(loadedSettings);
    setCounters(loadedCounters);
    setLastBackupInfo((backupInfo as Record<string, any> | null) ?? null);

    document.documentElement.style.setProperty("--ui-font-scale", String(loadedSettings.uiFontScale));
    document.documentElement.dataset.uiDensity = loadedSettings.uiDensity;
    document.documentElement.dataset.uiPalette = loadedSettings.uiPalette;
  }

  useEffect(() => {
    void loadData().catch((err) => {
      console.error(err);
      setError("Nu am putut încărca datele din Control Panel.");
    });
  }, []);

  async function handleSaveSettings() {
    try {
      setBusyMessage("Se salvează setările...");
      setError("");
      setMessage("");

      await saveControlPanelSettings(settings);
      document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
      document.documentElement.dataset.uiDensity = settings.uiDensity;
      document.documentElement.dataset.uiPalette = settings.uiPalette;
      setMessage("Setările au fost salvate.");
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva setările.");
    } finally {
      setBusyMessage("");
    }
  }

  async function handleExportBackup() {
    try {
      setBusyMessage("Se pregătește backup-ul...");
      setError("");
      setMessage("");

      const { payload, summary } = await exportBackupDataset();

      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `workcontrol-backup-${new Date(summary.generatedAt)
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setMessage(
        `Backup descărcat: ${summary.totalRecords} înregistrări, ${prettyBytes(summary.sizeBytes)}.`
      );
      await loadData();
    } catch (err) {
      console.error(err);
      setError("Exportul backup a eșuat.");
    } finally {
      setBusyMessage("");
    }
  }

  async function handleCleanup() {
    try {
      setBusyMessage("Se curăță istoricul vechi...");
      setError("");
      setMessage("");

      const result = await cleanupHistory({
        retentionMonths: settings.retentionMonths,
        cleanNotifications: cleanupNotifications,
        cleanToolEvents: cleanupToolEvents,
        cleanVehicleEvents: cleanupVehicleEvents,
        cleanTimesheets: cleanupTimesheets,
      });

      setMessage(
        `Curățare finalizată: ${result.deletedCount} înregistrări mai vechi de ${new Date(
          result.cutoffTs
        ).toLocaleDateString("ro-RO")}.`
      );
      await loadData();
    } catch (err) {
      console.error(err);
      setError("Curățarea istoricului a eșuat.");
    } finally {
      setBusyMessage("");
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restricționat</h2>
        <p>Doar adminul sau managerul pot accesa Control Panel-ul.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel control-panel-hero">
        <h2 className="panel-title">Control Panel · Backup & Stabilitate</h2>
        <p className="tools-subtitle">
          Export complet pentru NAS/stick, retenție automată pentru istoric și setări UI centralizate.
        </p>

        <div className="control-panel-kpis">
          <article className="kpi-card">
            <span className="kpi-label">Înregistrări live</span>
            <strong className="kpi-value">{totalRecords}</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Ultimul backup</span>
            <strong className="kpi-value">
              {lastBackupInfo?.exportedAt
                ? new Date(lastBackupInfo.exportedAt).toLocaleString("ro-RO")
                : "Niciun backup"}
            </strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Auto-backup</span>
            <strong className="kpi-value">{settings.autoBackupEnabled ? "Activ" : "Oprit"}</strong>
          </article>
        </div>

        {busyMessage && <div className="tool-message">{busyMessage}</div>}
        {message && <div className="tool-message success-message">{message}</div>}
        {error && <div className="tool-message">{error}</div>}
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Export profesional backup</h3>
        <p className="tools-subtitle">Backup JSON integral pentru utilizatori, pontaje, scule, mașini, reguli, notificări.</p>

        <div className="collection-grid">
          {Object.entries(counters).map(([name, count]) => {
            const percentage = totalRecords > 0 ? Math.round((count / totalRecords) * 100) : 0;
            return (
              <div key={name} className="collection-card">
                <div className="collection-header">
                  <strong>{name}</strong>
                  <span>{count}</span>
                </div>
                <div className="collection-progress-track">
                  <div className="collection-progress-fill" style={{ width: `${percentage}%` }} />
                </div>
                <small>{percentage}% din total</small>
              </div>
            );
          })}
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="primary-btn" type="button" onClick={() => void handleExportBackup()}>
            Exportă backup complet
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Politică retenție + curățare automată</h3>
        <p className="tools-subtitle">
          Setezi după câte luni se pot șterge datele istorice, după ce ai exportat backup-ul.
        </p>

        <div className="tool-form-grid">
          <div className="tool-form-block">
            <label className="tool-form-label">Retenție istoric (luni)</label>
            <input
              className="tool-input"
              type="number"
              min={1}
              max={24}
              value={settings.retentionMonths}
              onChange={(e) => setSettings((prev) => ({ ...prev, retentionMonths: Number(e.target.value) || 1 }))}
            />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Auto-backup</label>
            <select
              className="tool-input"
              value={settings.autoBackupEnabled ? "yes" : "no"}
              onChange={(e) => setSettings((prev) => ({ ...prev, autoBackupEnabled: e.target.value === "yes" }))}
            >
              <option value="yes">Activ</option>
              <option value="no">Inactiv</option>
            </select>
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Interval auto-backup (zile)</label>
            <input
              className="tool-input"
              type="number"
              min={1}
              max={30}
              value={settings.autoBackupIntervalDays}
              onChange={(e) => setSettings((prev) => ({ ...prev, autoBackupIntervalDays: Number(e.target.value) || 1 }))}
            />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Notifică înainte de cleanup (zile)</label>
            <input
              className="tool-input"
              type="number"
              min={1}
              max={30}
              value={settings.notifyBeforeCleanupDays}
              onChange={(e) => setSettings((prev) => ({ ...prev, notifyBeforeCleanupDays: Number(e.target.value) || 1 }))}
            />
          </div>
        </div>

        <div className="checkbox-grid" style={{ marginTop: 12 }}>
          <label className="checkbox-line"><input type="checkbox" checked={cleanupNotifications} onChange={(e) => setCleanupNotifications(e.target.checked)} />Notificări</label>
          <label className="checkbox-line"><input type="checkbox" checked={cleanupToolEvents} onChange={(e) => setCleanupToolEvents(e.target.checked)} />Istoric scule</label>
          <label className="checkbox-line"><input type="checkbox" checked={cleanupVehicleEvents} onChange={(e) => setCleanupVehicleEvents(e.target.checked)} />Istoric mașini</label>
          <label className="checkbox-line"><input type="checkbox" checked={cleanupTimesheets} onChange={(e) => setCleanupTimesheets(e.target.checked)} />Pontaje vechi</label>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="secondary-btn" type="button" onClick={() => void handleSaveSettings()}>
            Salvează setările
          </button>
          <button className="primary-btn" type="button" onClick={() => void handleCleanup()}>
            Curăță acum istoricul vechi
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">UI Personalizare rapidă</h3>
        <p className="tools-subtitle">Font size, densitate carduri și paleta principală pentru citire mai ușoară.</p>

        <div className="tool-form-grid">
          <div className="tool-form-block">
            <label className="tool-form-label">Scalare font</label>
            <input
              className="tool-input"
              type="number"
              step="0.05"
              min={0.9}
              max={1.25}
              value={settings.uiFontScale}
              onChange={(e) => setSettings((prev) => ({ ...prev, uiFontScale: Number(e.target.value) || 1 }))}
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Densitate carduri</label>
            <select className="tool-input" value={settings.uiDensity} onChange={(e) => setSettings((prev) => ({ ...prev, uiDensity: e.target.value as ControlPanelSettings["uiDensity"] }))}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfort</option>
              <option value="spacious">Spațios</option>
            </select>
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Paletă culori</label>
            <select className="tool-input" value={settings.uiPalette} onChange={(e) => setSettings((prev) => ({ ...prev, uiPalette: e.target.value as ControlPanelSettings["uiPalette"] }))}>
              <option value="blue">Blue</option>
              <option value="slate">Slate</option>
              <option value="emerald">Emerald</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
