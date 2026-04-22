import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ProfessionalBackupView } from "../services/controlPanelService";
import { USER_THEME_KEYS, getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

type BackupPreviewPayload = {
  summary: ProfessionalBackupView;
  meta: { fileName: string; exportedAt: number | null };
};

const BACKUP_PREVIEW_STORAGE_KEY = "workcontrol_uploaded_backup_preview";

function readPayload(): BackupPreviewPayload | null {
  try {
    const raw = sessionStorage.getItem(BACKUP_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BackupPreviewPayload;
  } catch {
    return null;
  }
}

function pickThemeByUser(userEmail: string, userName: string) {
  const source = `${userEmail}::${userName}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 100000;
  }
  const key = USER_THEME_KEYS[Math.abs(hash) % USER_THEME_KEYS.length];
  return getUserThemeClass(key);
}

export default function BackupPreviewPage() {
  const payload = useMemo(() => readPayload(), []);

  const userCards = useMemo(() => {
    if (!payload) return [];

    const toolByOwner = new Map<string, ProfessionalBackupView["tools"]>();
    payload.summary.tools.forEach((tool) => {
      const key = `${tool.ownerName}__${tool.ownerEmail}`;
      if (!toolByOwner.has(key)) toolByOwner.set(key, []);
      toolByOwner.get(key)?.push(tool);
    });

    const vehiclesByOwner = new Map<string, ProfessionalBackupView["vehicles"]>();
    payload.summary.vehicles.forEach((vehicle) => {
      const key = `${vehicle.ownerName}__${vehicle.ownerEmail}`;
      if (!vehiclesByOwner.has(key)) vehiclesByOwner.set(key, []);
      vehiclesByOwner.get(key)?.push(vehicle);
    });

    return payload.summary.users
      .map((user) => {
        const key = `${user.userName}__${user.email}`;
        const toolEvents = payload.summary.toolEvents.find(
          (item) => `${item.userName}__${item.userEmail}` === key
        );
        const vehicleEvents = payload.summary.vehicleEvents.find(
          (item) => `${item.userName}__${item.userEmail}` === key
        );
        const timesheets = payload.summary.timesheets.find(
          (item) => `${item.userName}__${item.userEmail}` === key
        );

        return {
          ...user,
          tools: toolByOwner.get(key) ?? [],
          vehicles: vehiclesByOwner.get(key) ?? [],
          toolEvents: toolEvents?.events ?? [],
          vehicleEvents: vehicleEvents?.events ?? [],
          timesheets: timesheets?.entries ?? [],
          themeClass: pickThemeByUser(user.email, user.userName),
        };
      })
      .sort((a, b) => {
        const scoreA = a.tools.length + a.vehicles.length + a.toolEvents.length + a.vehicleEvents.length + a.timesheets.length;
        const scoreB = b.tools.length + b.vehicles.length + b.toolEvents.length + b.vehicleEvents.length + b.timesheets.length;
        return scoreB - scoreA;
      });
  }, [payload]);

  if (!payload) {
    return (
      <section className="page-section backup-preview-page">
        <div className="panel backup-preview-empty">
          <h2 className="panel-title">Raport backup indisponibil</h2>
          <p className="tools-subtitle">
            Nu există date de backup în memorie. Revino în Control Panel și încarcă din nou fișierul.
          </p>
          <Link to="/control-panel" className="secondary-btn">Înapoi în Control Panel</Link>
        </div>
      </section>
    );
  }

  const totalToolEvents = payload.summary.toolEvents.reduce((sum, item) => sum + item.events.length, 0);
  const totalVehicleEvents = payload.summary.vehicleEvents.reduce((sum, item) => sum + item.events.length, 0);
  const totalTimesheets = payload.summary.timesheets.reduce((sum, item) => sum + item.entries.length, 0);

  return (
    <section className="page-section backup-preview-page">
      <div className="panel backup-preview-hero">
        <div>
          <h2 className="panel-title">Backup Viewer · raport detaliat</h2>
          <p className="tools-subtitle">
            Datele sunt grupate logic pe utilizator, cu aceeași temă de culori pentru fiecare profil.
          </p>
          <p className="backup-preview-meta">
            <strong>{payload.meta.fileName}</strong>
            {payload.meta.exportedAt ? ` · Exportat la ${new Date(payload.meta.exportedAt).toLocaleString("ro-RO")}` : ""}
          </p>
        </div>
        <Link to="/control-panel" className="secondary-btn">Înapoi în Control Panel</Link>
      </div>

      <div className="backup-preview-kpis">
        <article className="kpi-card"><span className="kpi-label">Utilizatori</span><strong className="kpi-value">{payload.summary.users.length}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Scule</span><strong className="kpi-value">{payload.summary.tools.length}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Vehicule</span><strong className="kpi-value">{payload.summary.vehicles.length}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Evenimente scule</span><strong className="kpi-value">{totalToolEvents}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Evenimente vehicule</span><strong className="kpi-value">{totalVehicleEvents}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Pontaje</span><strong className="kpi-value">{totalTimesheets}</strong></article>
        <article className="kpi-card"><span className="kpi-label">Notificări</span><strong className="kpi-value">{payload.summary.notifications.length}</strong></article>
      </div>

      <div className="backup-preview-users-grid">
        {userCards.map((user) => (
          <article key={`${user.userName}-${user.email}`} className={`backup-user-overview ${user.themeClass}`}>
            <header className="backup-user-overview__header">
              <div className="user-accent-avatar">{getUserInitials(user.userName)}</div>
              <div>
                <h3>{user.userName}</h3>
                <p>{user.email}</p>
              </div>
            </header>

            <div className="backup-user-overview__mini-kpis">
              <span className="user-accent-chip">Scule: {user.tools.length}</span>
              <span className="user-accent-chip">Vehicule: {user.vehicles.length}</span>
              <span className="user-accent-chip">Ev. scule: {user.toolEvents.length}</span>
              <span className="user-accent-chip">Ev. vehicule: {user.vehicleEvents.length}</span>
              <span className="user-accent-chip">Pontaje: {user.timesheets.length}</span>
            </div>

            <div className="backup-user-overview__section">
              <h4>Resurse alocate</h4>
              {user.tools.length === 0 && user.vehicles.length === 0 ? (
                <p className="backup-empty-line">Fără resurse.</p>
              ) : (
                <>
                  {user.tools.map((tool) => (
                    <div key={`${tool.toolName}-${tool.internalCode}`} className="backup-data-line">
                      <strong>Sculă:</strong> {tool.toolName} · {tool.internalCode}
                    </div>
                  ))}
                  {user.vehicles.map((vehicle) => (
                    <div key={`${vehicle.vehicleName}-${vehicle.plateNumber}`} className="backup-data-line">
                      <strong>Vehicul:</strong> {vehicle.vehicleName} · {vehicle.plateNumber}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="backup-user-overview__section">
              <h4>Ultimele evenimente</h4>
              {[...user.toolEvents, ...user.vehicleEvents]
                .sort((a, b) => b.dateTime - a.dateTime)
                .slice(0, 6)
                .map((event, index) => (
                  <div key={`${event.message}-${event.dateTime}-${index}`} className="backup-timeline-item">
                    <small>{new Date(event.dateTime).toLocaleString("ro-RO")}</small>
                    <p>{event.message}</p>
                  </div>
                ))}
              {user.toolEvents.length + user.vehicleEvents.length === 0 && (
                <p className="backup-empty-line">Fără evenimente.</p>
              )}
            </div>

            <div className="backup-user-overview__section">
              <h4>Pontaje</h4>
              {user.timesheets.slice(0, 5).map((entry, index) => (
                <div key={`${entry.projectCode}-${entry.startAt}-${index}`} className="backup-data-line">
                  <strong>{entry.projectCode}</strong> · {entry.projectName} · {entry.workedMinutes} min · {entry.status}
                </div>
              ))}
              {user.timesheets.length === 0 && <p className="backup-empty-line">Fără pontaje.</p>}
            </div>
          </article>
        ))}
      </div>

      <div className="panel backup-notification-board">
        <h3 className="panel-subtitle">Notificări din backup</h3>
        <div className="backup-notification-grid">
          {payload.summary.notifications.map((notification, index) => (
            <article key={`${notification.title}-${notification.dateTime}-${index}`} className="backup-notification-card">
              <strong>{notification.title}</strong>
              <p>{notification.message}</p>
              <small>
                {notification.module} · {notification.eventType} · {new Date(notification.dateTime).toLocaleString("ro-RO")}
              </small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
