import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import { getDashboardData } from "../services/dashboardService";
import type { AppUserItem } from "../../../types/user";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";
import ToolStatusBadge from "../../tools/components/ToolStatusBadge";
import VehicleStatusBadge from "../../vehicles/components/VehicleStatusBadge";
import { formatMinutes } from "../../timesheets/services/timesheetsService";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { backfillUserThemeSnapshots } from "../../../scripts/backfillUserThemeSnapshots";
import {
  Users,
  Wrench,
  CarFront,
  Clock3,
  Briefcase,
  Bell,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Activity,
  FolderOpen,
  BellDot,
  Settings2,
  TimerReset,
  RefreshCw,
  CalendarClock,
} from "lucide-react";

type NotificationLite = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  entityId?: string;
  targetUserThemeKey?: string | null;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

/* ── KPI Card ── */
function KpiCard({
  label,
  value,
  trend,
  trendType,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: React.ReactNode;
  trend: string;
  trendType: "positive" | "warning" | "danger" | "muted";
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  iconClass: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-head">
        <div className="kpi-label">{label}</div>
        <div className={`kpi-icon-wrap ${iconClass}`}>
          <Icon size={18} strokeWidth={2.1} />
        </div>
      </div>
      <div className="kpi-value">{value}</div>
      <div className={`kpi-trend kpi-trend-${trendType}`}>{trend}</div>
    </div>
  );
}

/* ── Section title ── */
function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <h2 className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-xs)",
          background: "var(--primary-soft)",
          color: "var(--primary)",
          flexShrink: 0,
        }}
      >
        <Icon size={15} strokeWidth={2.3} />
      </span>
      {children}
    </h2>
  );
}

/* ── Empty state ── */
function EmptyState({
  icon: Icon,
  title,
  subtitle,
  success = false,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  subtitle?: string;
  success?: boolean;
}) {
  return (
    <div className="empty-state">
      <div
        className="empty-state-icon"
        style={
          success
            ? { background: "var(--success-soft)", color: "var(--success)" }
            : undefined
        }
      >
        <Icon size={20} strokeWidth={1.8} />
      </div>
      <div className="empty-state-title">{title}</div>
      {subtitle && <div>{subtitle}</div>}
    </div>
  );
}

/* ── Skeleton ── */
function DashboardSkeleton() {
  return (
    <section className="page-section">
      <div className="kpi-grid">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="kpi-card" style={{ minHeight: 120 }}>
            <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 36, width: "40%", marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 10, width: "80%" }} />
          </div>
        ))}
      </div>
      <div className="content-grid">
        <div className="panel" style={{ minHeight: 280 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)" }}>
            <div className="skeleton" style={{ height: 16, width: "40%" }} />
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 48, borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
        </div>
        <div className="panel" style={{ minHeight: 280 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)" }}>
            <div className="skeleton" style={{ height: 16, width: "50%" }} />
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius-sm)" }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Main component ── */
export default function DashboardPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [, setUsers] = useState<AppUserItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationLite[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalTools: 0,
    defectiveTools: 0,
    lostTools: 0,
    toolsInWarehouse: 0,
    totalVehicles: 0,
    unavailableVehicles: 0,
    damagedVehicles: 0,
    activeTimesheets: 0,
    totalProjects: 0,
    activeProjects: 0,
    unreadNotifications: 0,
  });

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await getDashboardData(user?.uid);
      setUsers(data.users);
      setTools(data.tools);
      setVehicles(data.vehicles);
      setTimesheets(data.timesheets);
      setProjects(data.projects);
      setNotifications(data.notifications);
      setStats(data.stats);
      setLastRefreshed(new Date());
      // sync badge
      localStorage.setItem("wc_unread_count", String(data.stats.unreadNotifications));
      window.dispatchEvent(new Event("storage"));
    } catch (error) {
      console.error("Eroare dashboard:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    // auto-refresh la 2 minute
    const interval = setInterval(() => void load(true), 120_000);
    return () => clearInterval(interval);
  }, [user?.uid]);

  const problemTools = useMemo(
    () => tools.filter((t) => t.status === "defecta" || t.status === "pierduta"),
    [tools]
  );

  const problemVehicles = useMemo(
    () => vehicles.filter((v) => v.status === "indisponibila" || v.status === "avariata"),
    [vehicles]
  );

  const activeTimesheets = useMemo(
    () => timesheets.filter((i) => i.status === "activ").slice(0, 8),
    [timesheets]
  );

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "activ").slice(0, 8),
    [projects]
  );

  const recentNotifications = useMemo(
    () => notifications.slice(0, 8),
    [notifications]
  );

  const totalWorkedToday = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return timesheets
      .filter((i) => i.workDate === todayKey)
      .reduce((sum, i) => sum + i.workedMinutes, 0);
  }, [timesheets]);

  if (loading) return <DashboardSkeleton />;

  const refreshedStr = lastRefreshed.toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="page-section">

      {/* ── TODAY STRIP ── */}
      <div className="today-strip">
        <div className="today-strip-dot" />
        <CalendarClock size={15} strokeWidth={2.1} />
        <span>
          {new Date().toLocaleDateString("ro-RO", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 11 }}>
          {refreshing && <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} />}
          actualizat {refreshedStr}
        </span>
      </div>

      {/* ── KPI GRID ── */}
      <div className="kpi-grid">
        <KpiCard
          label="Utilizatori activi"
          value={stats.activeUsers}
          trend={`din ${stats.totalUsers} total`}
          trendType="positive"
          icon={Users}
          iconClass="kpi-icon-blue"
        />
        <KpiCard
          label="Scule totale"
          value={stats.totalTools}
          trend={`depozit: ${stats.toolsInWarehouse}`}
          trendType="warning"
          icon={Wrench}
          iconClass="kpi-icon-orange"
        />
        <KpiCard
          label="Mașini totale"
          value={stats.totalVehicles}
          trend={`indisponibile: ${stats.unavailableVehicles}`}
          trendType="warning"
          icon={CarFront}
          iconClass="kpi-icon-orange"
        />
        <KpiCard
          label="Pontaje active"
          value={stats.activeTimesheets}
          trend={`azi: ${formatMinutes(totalWorkedToday)}`}
          trendType="positive"
          icon={Clock3}
          iconClass="kpi-icon-green"
        />
        <KpiCard
          label="Proiecte active"
          value={stats.activeProjects}
          trend={`din ${stats.totalProjects} total`}
          trendType="positive"
          icon={Briefcase}
          iconClass="kpi-icon-purple"
        />
        <KpiCard
          label="Notificări necitite"
          value={stats.unreadNotifications}
          trend="inbox personal"
          trendType={stats.unreadNotifications > 0 ? "danger" : "muted"}
          icon={Bell}
          iconClass={stats.unreadNotifications > 0 ? "kpi-icon-red" : "kpi-icon-sky"}
        />
      </div>

      {/* ── ROW 1: Quick actions + Notifications ── */}
      <div className="content-grid">

        {/* Quick actions */}
        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={Activity}>Acțiuni rapide</SectionTitle>
            {/* Buton backfill mutat discret aici */}
            <button
              className="icon-btn"
              type="button"
              title="Backfill culori documente vechi"
              onClick={async () => {
                try {
                  const count = await backfillUserThemeSnapshots();
                  alert(`Backfill terminat. Documente actualizate: ${count}`);
                  void load(true);
                } catch (error) {
                  console.error(error);
                  alert("A apărut o eroare la backfill.");
                }
              }}
            >
              <RefreshCw size={14} strokeWidth={2.2} />
            </button>
          </div>

          <div className="quick-actions-grid">
            <Link to="/tools/new" className="quick-action-card">
              <div className="quick-action-icon">
                <Wrench size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">Adaugă sculă</div>
              <div className="quick-action-subtitle">Inventar nou în sistem</div>
            </Link>

            <Link to="/vehicles/new" className="quick-action-card">
              <div className="quick-action-icon">
                <CarFront size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">Adaugă mașină</div>
              <div className="quick-action-subtitle">Element nou în flotă</div>
            </Link>

            <Link to="/my-timesheets" className="quick-action-card">
              <div className="quick-action-icon">
                <TimerReset size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">Pontajul meu</div>
              <div className="quick-action-subtitle">Start / stop / istoric</div>
            </Link>

            <Link to="/projects" className="quick-action-card">
              <div className="quick-action-icon">
                <FolderOpen size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">Proiecte</div>
              <div className="quick-action-subtitle">Active, în lucru, finalizate</div>
            </Link>

            <Link to="/notifications" className="quick-action-card">
              <div className="quick-action-icon" style={stats.unreadNotifications > 0 ? { background: "var(--danger-soft)", color: "var(--danger)" } : undefined}>
                <BellDot size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">
                Notificări
                {stats.unreadNotifications > 0 && (
                  <span className="nav-badge" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                    {stats.unreadNotifications}
                  </span>
                )}
              </div>
              <div className="quick-action-subtitle">Inbox-ul tău</div>
            </Link>

            <Link to="/notification-rules" className="quick-action-card">
              <div className="quick-action-icon">
                <Settings2 size={18} strokeWidth={2.1} />
              </div>
              <div className="quick-action-title">Reguli notificări</div>
              <div className="quick-action-subtitle">Automatizări și destinații</div>
            </Link>
          </div>
        </div>

        {/* Recent notifications */}
        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={Bell}>Notificări recente</SectionTitle>
            <Link to="/notifications" style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", display: "flex", alignItems: "center", gap: 3 }}>
              Vezi toate <ChevronRight size={13} />
            </Link>
          </div>

          {recentNotifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nicio notificare"
              subtitle="Totul e liniștit pe front"
              success
            />
          ) : (
            <div className="simple-list">
              {recentNotifications.map((item) => {
                const userThemeClass = getUserThemeClass(
                  item.actorUserThemeKey || item.targetUserThemeKey || null
                );
                return (
                  <Link
                    to="/notifications"
                    key={item.id}
                    className={`simple-list-item user-history-row ${userThemeClass}`}
                  >
                    <div className="simple-list-text">
                      <div className="user-inline-meta">
                        <span className="user-accent-avatar">
                          {getUserInitials(item.actorUserName || item.title || "S")}
                        </span>
                        <span className="simple-list-label user-accent-name">
                          {item.actorUserName || item.title}
                        </span>
                      </div>
                      <div className="simple-list-subtitle">{item.title}</div>
                      <div className="simple-list-subtitle">{item.message}</div>
                      <div className="simple-list-subtitle">
                        {new Date(item.createdAt).toLocaleString("ro-RO")}
                      </div>
                    </div>
                    <span className={item.read ? "badge badge-muted" : "badge badge-orange"}>
                      {item.read ? "citita" : "noua"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 2: Problem tools + Problem vehicles ── */}
      <div className="content-grid">

        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={AlertTriangle}>Scule cu probleme</SectionTitle>
            {problemTools.length > 0 && (
              <span className="badge badge-red">{problemTools.length}</span>
            )}
          </div>

          {problemTools.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nicio sculă cu probleme"
              subtitle="Toate sculele sunt în regulă"
              success
            />
          ) : (
            <div className="simple-list">
              {problemTools.slice(0, 8).map((tool) => {
                const userThemeClass = getUserThemeClass(
                  tool.currentHolderThemeKey || tool.ownerThemeKey || null
                );
                return (
                  <div key={tool.id} className={`simple-list-item user-history-row ${userThemeClass}`}>
                    <div className="simple-list-text">
                      <div className="user-inline-meta">
                        <span className="user-accent-avatar">
                          {getUserInitials(tool.currentHolderUserName || tool.ownerUserName || "D")}
                        </span>
                        <span className="simple-list-label user-accent-name">{tool.name}</span>
                      </div>
                      <div className="simple-list-subtitle">
                        Responsabil: {tool.ownerUserName || "–"} · La cine:{" "}
                        {tool.currentHolderUserName || "Depozit"}
                      </div>
                    </div>
                    <div className="dashboard-inline-actions">
                      <ToolStatusBadge status={tool.status} />
                      <Link
                        to={`/tools/${tool.id}`}
                        className="secondary-btn"
                        style={{ gap: 5, paddingLeft: 12, paddingRight: 12 }}
                      >
                        Vezi
                        <ChevronRight size={13} strokeWidth={2.4} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={CarFront}>Mașini cu probleme</SectionTitle>
            {problemVehicles.length > 0 && (
              <span className="badge badge-red">{problemVehicles.length}</span>
            )}
          </div>

          {problemVehicles.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nicio mașină cu probleme"
              subtitle="Toată flota este disponibilă"
              success
            />
          ) : (
            <div className="simple-list">
              {problemVehicles.slice(0, 8).map((vehicle) => {
                const userThemeClass = getUserThemeClass(
                  vehicle.currentDriverThemeKey || vehicle.ownerThemeKey || null
                );
                return (
                  <div key={vehicle.id} className={`simple-list-item user-history-row ${userThemeClass}`}>
                    <div className="simple-list-text">
                      <div className="user-inline-meta">
                        <span className="user-accent-avatar">
                          {getUserInitials(vehicle.currentDriverUserName || vehicle.ownerUserName || "A")}
                        </span>
                        <span className="simple-list-label user-accent-name">
                          {vehicle.plateNumber} · {vehicle.brand} {vehicle.model}
                        </span>
                      </div>
                      <div className="simple-list-subtitle">
                        Responsabil: {vehicle.ownerUserName || "–"} · Șofer:{" "}
                        {vehicle.currentDriverUserName || "–"}
                      </div>
                    </div>
                    <div className="dashboard-inline-actions">
                      <VehicleStatusBadge status={vehicle.status} />
                      <Link
                        to={`/vehicles/${vehicle.id}`}
                        className="secondary-btn"
                        style={{ gap: 5, paddingLeft: 12, paddingRight: 12 }}
                      >
                        Vezi
                        <ChevronRight size={13} strokeWidth={2.4} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 3: Live timesheets + Active projects ── */}
      <div className="content-grid">

        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={Clock3}>Pontaje active live</SectionTitle>
            {activeTimesheets.length > 0 && (
              <span className="badge badge-green">{activeTimesheets.length} activ{activeTimesheets.length !== 1 ? "e" : ""}</span>
            )}
          </div>

          {activeTimesheets.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title="Niciun pontaj activ"
              subtitle="Nu există sesiuni în desfășurare"
            />
          ) : (
            <div className="simple-list">
              {activeTimesheets.map((item) => {
                const userThemeClass = getUserThemeClass(item.userThemeKey || null);
                return (
                  <Link
                    to={`/timesheets/${item.id}`}
                    key={item.id}
                    className={`simple-list-item user-history-row ${userThemeClass}`}
                  >
                    <div className="simple-list-text">
                      <div className="user-inline-meta">
                        <span className="user-accent-avatar">{getUserInitials(item.userName)}</span>
                        <span className="simple-list-label user-accent-name">
                          {item.userName} · {item.projectCode} – {item.projectName}
                        </span>
                      </div>
                      <div className="simple-list-subtitle">
                        Start: {new Date(item.startAt).toLocaleString("ro-RO")} ·{" "}
                        {item.startLocation?.label || "–"}
                      </div>
                    </div>
                    <span className="badge badge-orange">activ</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div style={{ padding: "16px 20px", borderBottom: "1.5px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle icon={Briefcase}>Proiecte active</SectionTitle>
            <Link to="/projects" style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", display: "flex", alignItems: "center", gap: 3 }}>
              Toate <ChevronRight size={13} />
            </Link>
          </div>

          {activeProjects.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="Niciun proiect activ"
              subtitle="Adaugă un proiect pentru a începe"
            />
          ) : (
            <div className="simple-list">
              {activeProjects.map((project) => (
                <Link to="/projects" key={project.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">
                      {project.code} – {project.name}
                    </div>
                    <div className="simple-list-subtitle">Status: {project.status}</div>
                  </div>
                  <span className="badge badge-green">activ</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

    </section>
  );
}