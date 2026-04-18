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
  uiFontFamily: "dm-sans",
  uiDensity: "comfortable",
  uiPalette: "blue",
  uiCardStyle: "elevated",
  uiContrast: "normal",
  uiAnimations: "full",
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
  const [saveMessage, setSaveMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [personalizationMessage, setPersonalizationMessage] = useState("");
  const [error, setError] = useState("");
  const [cleanupNotifications, setCleanupNotifications] = useState(true);
  const [cleanupToolEvents, setCleanupToolEvents] = useState(true);
  const [cleanupVehicleEvents, setCleanupVehicleEvents] = useState(true);
  const [cleanupTimesheets, setCleanupTimesheets] = useState(false);
  const [cleanupMode, setCleanupMode] = useState<"retention_only" | "delete_all_selected">("retention_only");

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
    document.documentElement.dataset.uiFontFamily = loadedSettings.uiFontFamily;
    document.documentElement.dataset.uiDensity = loadedSettings.uiDensity;
    document.documentElement.dataset.uiPalette = loadedSettings.uiPalette;
    document.documentElement.dataset.uiCardStyle = loadedSettings.uiCardStyle;
    document.documentElement.dataset.uiContrast = loadedSettings.uiContrast;
    document.documentElement.dataset.uiAnimations = loadedSettings.uiAnimations;
  }

  useEffect(() => {
    void loadData().catch((err) => {
      console.error(err);
      setError("Nu am putut încărca datele din Control Panel.");
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
    document.documentElement.dataset.uiFontFamily = settings.uiFontFamily;
    document.documentElement.dataset.uiDensity = settings.uiDensity;
    document.documentElement.dataset.uiPalette = settings.uiPalette;
    document.documentElement.dataset.uiCardStyle = settings.uiCardStyle;
    document.documentElement.dataset.uiContrast = settings.uiContrast;
    document.documentElement.dataset.uiAnimations = settings.uiAnimations;
  }, [settings.uiCardStyle, settings.uiContrast, settings.uiDensity, settings.uiFontFamily, settings.uiFontScale, settings.uiPalette, settings.uiAnimations]);

  async function handleSaveSettings() {
    try {
      setBusyMessage("Se salvează setările...");
      setError("");
      setSaveMessage("");
      setPersonalizationMessage("");

      await saveControlPanelSettings(settings);
      document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
      document.documentElement.dataset.uiFontFamily = settings.uiFontFamily;
      document.documentElement.dataset.uiDensity = settings.uiDensity;
      document.documentElement.dataset.uiPalette = settings.uiPalette;
      document.documentElement.dataset.uiCardStyle = settings.uiCardStyle;
      document.documentElement.dataset.uiContrast = settings.uiContrast;
      document.documentElement.dataset.uiAnimations = settings.uiAnimations;
      setSaveMessage("Setările au fost salvate.");
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
      setBackupMessage("");

      const { payload, prettyPayload, summary } = await exportBackupDataset();

      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `workcontrol-backup-${new Date(summary.generatedAt)
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);

      const prettyBlob = new Blob([prettyPayload], { type: "text/plain;charset=utf-8" });
      const prettyUrl = URL.createObjectURL(prettyBlob);
      const prettyLink = document.createElement("a");
      prettyLink.href = prettyUrl;
      prettyLink.download = `workcontrol-backup-raport-${new Date(summary.generatedAt)
        .toISOString()
        .replace(/[:.]/g, "-")}.txt`;
      prettyLink.click();
      URL.revokeObjectURL(prettyUrl);

      setBackupMessage(
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
      setCleanupMessage("");

      const result = await cleanupHistory({
        retentionMonths: settings.retentionMonths,
        cleanupMode,
        cleanNotifications: cleanupNotifications,
        cleanToolEvents: cleanupToolEvents,
        cleanVehicleEvents: cleanupVehicleEvents,
        cleanTimesheets: cleanupTimesheets,
      });

      setCleanupMessage(
        cleanupMode === "delete_all_selected"
          ? `Curățare totală finalizată: ${result.deletedCount} înregistrări șterse.`
          : `Curățare finalizată: ${result.deletedCount} înregistrări mai vechi de ${new Date(
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
        {error && <div className="tool-message">{error}</div>}
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Export profesional backup</h3>
        <p className="tools-subtitle">Backup JSON integral + raport text frumos pe categorii, per user și module.</p>

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
        {backupMessage && <div className="tool-message success-message" style={{ marginTop: 12 }}>{backupMessage}</div>}
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
        <div className="checkbox-grid" style={{ marginTop: 8 }}>
          <label className="checkbox-line">
            <input
              type="radio"
              checked={cleanupMode === "retention_only"}
              onChange={() => setCleanupMode("retention_only")}
            />
            Șterge doar istoricul vechi (după retenție)
          </label>
          <label className="checkbox-line">
            <input
              type="radio"
              checked={cleanupMode === "delete_all_selected"}
              onChange={() => setCleanupMode("delete_all_selected")}
            />
            Curățare totală pentru categoriile bifate
          </label>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="secondary-btn" type="button" onClick={() => void handleSaveSettings()}>
            Salvează setările
          </button>
          <button className="primary-btn" type="button" onClick={() => void handleCleanup()}>
            Curăță acum istoricul vechi
          </button>
        </div>
        {saveMessage && <div className="tool-message success-message" style={{ marginTop: 12 }}>{saveMessage}</div>}
        {cleanupMessage && <div className="tool-message success-message" style={{ marginTop: 12 }}>{cleanupMessage}</div>}
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
              <option value="sunset">Sunset</option>
              <option value="violet">Violet</option>
            </select>
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Font principal</label>
            <select className="tool-input" value={settings.uiFontFamily} onChange={(e) => setSettings((prev) => ({ ...prev, uiFontFamily: e.target.value as ControlPanelSettings["uiFontFamily"] }))}>
              <option value="dm-sans">DM Sans</option>
              <option value="inter">Inter</option>
              <option value="poppins">Poppins</option>
              <option value="roboto-slab">Roboto Slab</option>
            </select>
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Stil carduri</label>
            <select className="tool-input" value={settings.uiCardStyle} onChange={(e) => setSettings((prev) => ({ ...prev, uiCardStyle: e.target.value as ControlPanelSettings["uiCardStyle"] }))}>
              <option value="flat">Flat</option>
              <option value="elevated">Elevated</option>
              <option value="glass">Glass</option>
            </select>
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Contrast UI</label>
            <select className="tool-input" value={settings.uiContrast} onChange={(e) => setSettings((prev) => ({ ...prev, uiContrast: e.target.value as ControlPanelSettings["uiContrast"] }))}>
              <option value="normal">Normal</option>
              <option value="high">High contrast</option>
            </select>
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Animații</label>
            <select className="tool-input" value={settings.uiAnimations} onChange={(e) => setSettings((prev) => ({ ...prev, uiAnimations: e.target.value as ControlPanelSettings["uiAnimations"] }))}>
              <option value="full">Complete</option>
              <option value="reduced">Reduse</option>
              <option value="none">Oprite</option>
            </select>
          </div>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="secondary-btn" type="button" onClick={async () => {
            await handleSaveSettings();
            setPersonalizationMessage("Personalizarea a fost salvată și aplicată.");
          }}>
            Salvează personalizarea
          </button>
        </div>
        {personalizationMessage && <div className="tool-message success-message" style={{ marginTop: 12 }}>{personalizationMessage}</div>}
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Control rapid sistem</h3>
        <p className="tools-subtitle">Instrumente utile pentru administrator: verificări și resetări rapide.</p>
        <div className="quick-actions-grid">
          <div className="quick-action-card">
            <div className="quick-action-title">Verificare volum date</div>
            <div className="quick-action-subtitle">Ai acum {totalRecords} înregistrări în toate modulele.</div>
          </div>
          <div className="quick-action-card">
            <div className="quick-action-title">Ultimul backup</div>
            <div className="quick-action-subtitle">{lastBackupInfo?.exportedAt ? new Date(lastBackupInfo.exportedAt).toLocaleString("ro-RO") : "Nedefinit"}</div>
          </div>
          <div className="quick-action-card">
            <div className="quick-action-title">Recomandare</div>
            <div className="quick-action-subtitle">Rulează backup-ul cel puțin o dată la 3 zile pentru siguranță.</div>
          </div>
        </div>
      </div>
    </section>
  );
}
