import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  Briefcase,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock3,
  FolderOpen,
  RefreshCw,
  TimerReset,
  Users,
  Wrench,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import { getDashboardData } from "../services/dashboardService";
import type { AppUserItem } from "../../../types/user";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";
import { formatMinutes } from "../../timesheets/services/timesheetsService";
import { getMyVehicleForUser } from "../../vehicles/services/vehiclesService";
import { resolveNotificationPath } from "../../../lib/notifications/notificationNavigation";
import UserProfileLink from "../../../components/UserProfileLink";
import KpiCard from "../../../components/KpiCard";
import StatusBadge from "../../../components/StatusBadge";
import EmptyState from "../../../components/EmptyState";
import DataTable, { type DataTableColumn } from "../../../components/DataTable";
import {
  getEffectiveWorkedMinutes,
  getLocalDateKey,
  getProjectLabel,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
  getUsersWithoutTimesheetToday,
} from "../../timesheets/utils/timesheetAnalytics";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

type NotificationLite = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  entityId?: string;
  eventType?: string;
  notificationPath?: string;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

type TodayRow = {
  id: string;
  user: AppUserItem;
  timesheet: TimesheetItem | null;
};

type ActivityItem = {
  id: string;
  title: string;
  subtitle: string;
  at: number;
  tone: "green" | "orange" | "red" | "blue" | "muted";
  to?: string;
};

function DashboardSkeleton() {
  return (
    <section className="page-section dashboard-modern-page">
      <div className="wc-kpi-grid wc-kpi-grid--six">
        {[...Array(6)].map((_, index) => (
          <div key={index} className="wc-kpi-card">
            <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 34, width: "42%", marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 10, width: "80%" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ro-RO");
}

function formatTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function isTodayTs(value?: number | null, todayKey = getLocalDateKey()) {
  if (!value) return false;
  return getLocalDateKey(value) === todayKey;
}

function getUserName(userItem: AppUserItem) {
  return userItem.fullName || userItem.email || "Utilizator";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [navigatingVehicle, setNavigatingVehicle] = useState(false);
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationLite[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getDashboardData(user?.uid);
      if (!mountedRef.current) return;
      setUsers(data.users ?? []);
      setTools(data.tools ?? []);
      setVehicles(data.vehicles ?? []);
      setTimesheets(data.timesheets ?? []);
      setProjects(data.projects ?? []);
      setNotifications(data.notifications ?? []);
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("[DashboardPage][load]", error);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.uid]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 120_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const openMyVehicle = useCallback(async () => {
    if (navigatingVehicle) return;
    if (!user?.uid) {
      navigate("/vehicles");
      return;
    }

    setNavigatingVehicle(true);
    try {
      const myVehicle = await getMyVehicleForUser(user.uid);
      navigate(myVehicle ? `/vehicles/${myVehicle.id}` : "/vehicles");
    } catch {
      navigate("/vehicles");
    } finally {
      setNavigatingVehicle(false);
    }
  }, [navigate, navigatingVehicle, user?.uid]);

  const todayKey = getLocalDateKey();
  const activeUsers = useMemo(() => users.filter((item) => item.active !== false), [users]);
  const todayTimesheets = useMemo(
    () => timesheets.filter((item) => item.workDate === todayKey),
    [timesheets, todayKey]
  );
  const activeTimesheetsToday = useMemo(
    () => todayTimesheets.filter((item) => item.status === "activ"),
    [todayTimesheets]
  );
  const usersWithoutToday = useMemo(
    () => getUsersWithoutTimesheetToday(activeUsers, todayTimesheets, todayKey),
    [activeUsers, todayKey, todayTimesheets]
  );
  const todayMinutes = useMemo(
    () => todayTimesheets.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item), 0),
    [todayTimesheets]
  );
  const activeProjects = useMemo(() => projects.filter((project) => project.status === "activ"), [projects]);
  const activeVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.status === "activa"), [vehicles]);
  const vehiclesWithoutDriver = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "activa" && !vehicle.currentDriverUserId),
    [vehicles]
  );
  const problemTools = useMemo(
    () => tools.filter((tool) => tool.status === "defecta" || tool.status === "pierduta"),
    [tools]
  );
  const problemVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "indisponibila" || vehicle.status === "avariata"),
    [vehicles]
  );
  const importantAlertsCount =
    usersWithoutToday.length +
    todayTimesheets.filter((item) => getEffectiveWorkedMinutes(item) > 8 * 60).length +
    todayTimesheets.filter((item) => !item.projectId && !item.projectName).length +
    vehiclesWithoutDriver.length +
    problemVehicles.length +
    problemTools.length;

  const rows = useMemo<TodayRow[]>(() => {
    const latestByUser = new Map<string, TimesheetItem>();
    for (const item of todayTimesheets) {
      const current = latestByUser.get(item.userId);
      if (!current || (item.startAt || 0) > (current.startAt || 0)) {
        latestByUser.set(item.userId, item);
      }
    }

    return activeUsers.map((userItem) => ({
      id: userItem.uid || userItem.id,
      user: userItem,
      timesheet: latestByUser.get(userItem.uid || userItem.id) ?? null,
    }));
  }, [activeUsers, todayTimesheets]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    todayTimesheets.forEach((item) => {
      items.push({
        id: `${item.id}-start`,
        title: `${item.userName || "Utilizator"} a pornit pontaj`,
        subtitle: `${getProjectLabel(item)} - ${formatTime(item.startAt)}`,
        at: item.startAt || 0,
        tone: "blue",
        to: `/timesheets/${item.id}`,
      });
      if (item.stopAt) {
        items.push({
          id: `${item.id}-stop`,
          title: `${item.userName || "Utilizator"} a oprit pontaj`,
          subtitle: `${formatMinutes(item.workedMinutes || 0)} - ${formatTime(item.stopAt)}`,
          at: item.stopAt,
          tone: "green",
          to: `/timesheets/${item.id}`,
        });
      }
    });

    vehicles
      .filter((vehicle) => isTodayTs(vehicle.updatedAt, todayKey) && vehicle.currentDriverUserId)
      .slice(0, 8)
      .forEach((vehicle) => {
        items.push({
          id: `vehicle-${vehicle.id}`,
          title: `${vehicle.currentDriverUserName || "Sofer"} are masina ${vehicle.plateNumber || "-"}`,
          subtitle: `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() || "Flota",
          at: vehicle.updatedAt || 0,
          tone: "orange",
          to: `/vehicles/${vehicle.id}`,
        });
      });

    notifications.slice(0, 8).forEach((item) => {
      items.push({
        id: `notification-${item.id}`,
        title: item.title || "Alerta recenta",
        subtitle: item.message || formatDateTime(item.createdAt),
        at: item.createdAt || 0,
        tone: item.read ? "muted" : "red",
        to: resolveNotificationPath({
          module: item.module,
          eventType: item.eventType,
          entityId: item.entityId,
          notificationPath: item.notificationPath,
        }),
      });
    });

    return items.sort((a, b) => b.at - a.at).slice(0, 10);
  }, [notifications, todayKey, todayTimesheets, vehicles]);

  const columns = useMemo<DataTableColumn<TodayRow>[]>(
    () => [
      {
        key: "employee",
        header: "Angajat",
        render: (row) => {
          const themeClass = getUserThemeClass(row.user.themeKey ?? row.timesheet?.userThemeKey ?? null);
          return (
            <div className={`wc-person-cell user-history-row ${themeClass}`}>
              <span className="user-accent-avatar">{getUserInitials(getUserName(row.user))}</span>
              <div>
                <UserProfileLink
                  userId={row.user.uid || row.user.id}
                  name={getUserName(row.user)}
                  themeKey={row.user.themeKey ?? row.timesheet?.userThemeKey}
                  className="user-accent-name"
                />
                <small>{row.user.department || row.user.roleTitle || row.user.email || "-"}</small>
              </div>
            </div>
          );
        },
      },
      {
        key: "project",
        header: "Proiect",
        render: (row) => (row.timesheet ? getProjectLabel(row.timesheet) : "-"),
      },
      {
        key: "start",
        header: "Ora start",
        render: (row) => formatTime(row.timesheet?.startAt),
      },
      {
        key: "duration",
        header: "Durata",
        render: (row) => (row.timesheet ? formatMinutes(getEffectiveWorkedMinutes(row.timesheet)) : "-"),
      },
      {
        key: "status",
        header: "Status",
        render: (row) =>
          row.timesheet ? (
            <StatusBadge tone={getTimesheetStatusTone(row.timesheet.status)}>
              {getTimesheetStatusLabel(row.timesheet.status)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="red">Nepontat</StatusBadge>
          ),
      },
      {
        key: "actions",
        header: "Actiuni",
        render: (row) =>
          row.timesheet ? (
            <Link className="secondary-btn secondary-btn--compact" to={`/timesheets/${row.timesheet.id}`}>
              Detalii
            </Link>
          ) : (
            <Link className="secondary-btn secondary-btn--compact" to={`/timesheets?assistantUserId=${row.id}`}>
              Vezi istoric
            </Link>
          ),
      },
    ],
    []
  );

  if (loading) return <DashboardSkeleton />;

  return (
    <section className="page-section dashboard-modern-page">
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
        <span className="dashboard-refresh-note">
          {refreshing ? <RefreshCw size={11} className="spin-icon" /> : null}
          actualizat {lastRefreshed.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="dashboard-action-strip">
        <button type="button" className="primary-btn" disabled={navigatingVehicle} onClick={() => void openMyVehicle()}>
          {navigatingVehicle ? "Se deschide..." : "Masina mea"}
        </button>
        <Link to="/my-timesheets" className="secondary-btn">
          <TimerReset size={16} /> Pontajul meu
        </Link>
        <Link to="/timesheets" className="secondary-btn">
          <Clock3 size={16} /> Pontaje
        </Link>
        <Link to="/projects" className="secondary-btn">
          <FolderOpen size={16} /> Proiecte
        </Link>
      </div>

      <div className="wc-kpi-grid wc-kpi-grid--six">
        <KpiCard
          label="Pontaje active azi"
          value={activeTimesheetsToday.length}
          helper={`${todayTimesheets.length} pontaje azi`}
          tone="blue"
          icon={Clock3}
          to="/timesheets?assistant=active"
        />
        <KpiCard
          label="Angajati nepontati azi"
          value={usersWithoutToday.length}
          helper={`${activeUsers.length} angajati activi`}
          tone={usersWithoutToday.length ? "red" : "green"}
          icon={Users}
          to="/timesheets?assistant=missing"
        />
        <KpiCard
          label="Ore lucrate azi"
          value={formatMinutes(todayMinutes)}
          helper="include pontajele active"
          tone="green"
          icon={TimerReset}
          to="/timesheets?period=today"
        />
        <KpiCard
          label="Proiecte active"
          value={activeProjects.length}
          helper={`${projects.length} total`}
          tone="blue"
          icon={Briefcase}
          to="/projects"
        />
        <KpiCard
          label="Masini active"
          value={activeVehicles.length}
          helper={`${vehiclesWithoutDriver.length} fara sofer`}
          tone={vehiclesWithoutDriver.length ? "orange" : "green"}
          icon={CarFront}
          to="/vehicles"
        />
        <KpiCard
          label="Alerte importante"
          value={importantAlertsCount}
          helper={importantAlertsCount ? "necesita verificare" : "totul arata ok"}
          tone={importantAlertsCount ? "orange" : "green"}
          icon={AlertTriangle}
          to="/notifications"
        />
      </div>

      <div className="content-grid dashboard-main-grid">
        <div className="panel" data-assistant-section="dashboard-today-timesheets">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Pontaje azi</h2>
              <p className="panel-subtitle">Cine este pontat, cine nu, si pe ce proiect lucreaza.</p>
            </div>
            <StatusBadge tone="blue">{rows.length} angajati</StatusBadge>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowClassName={(row) => (row.timesheet?.status === "activ" ? "is-active" : row.timesheet ? "" : "is-danger")}
            empty={<EmptyState icon={Clock3} title="Nu exista utilizatori activi" />}
          />
        </div>

        <div className="panel" data-assistant-section="dashboard-alerts">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Atentie</h2>
              <p className="panel-subtitle">Probleme care merita verificate rapid.</p>
            </div>
            <StatusBadge tone={importantAlertsCount ? "orange" : "green"}>{importantAlertsCount}</StatusBadge>
          </div>
          <div className="dashboard-alert-grid">
            <Link to="/timesheets?assistant=missing" className="dashboard-alert-card dashboard-alert-card--red">
              <strong>{usersWithoutToday.length}</strong>
              <span>angajati fara pontaj azi</span>
            </Link>
            <Link to="/timesheets?assistant=long" className="dashboard-alert-card dashboard-alert-card--orange">
              <strong>{todayTimesheets.filter((item) => getEffectiveWorkedMinutes(item) > 8 * 60).length}</strong>
              <span>pontaje peste 8 ore</span>
            </Link>
            <Link to="/timesheets?assistant=no-project" className="dashboard-alert-card dashboard-alert-card--orange">
              <strong>{todayTimesheets.filter((item) => !item.projectId && !item.projectName).length}</strong>
              <span>pontaje fara proiect</span>
            </Link>
            <Link to="/vehicles" className="dashboard-alert-card dashboard-alert-card--blue">
              <strong>{vehiclesWithoutDriver.length}</strong>
              <span>masini fara sofer</span>
            </Link>
            <Link to="/tools" className="dashboard-alert-card dashboard-alert-card--red">
              <strong>{problemTools.length}</strong>
              <span>scule cu probleme</span>
            </Link>
            <Link to="/vehicles" className="dashboard-alert-card dashboard-alert-card--red">
              <strong>{problemVehicles.length}</strong>
              <span>masini indisponibile</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="content-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Activitate azi</h2>
              <p className="panel-subtitle">Ultimele porniri, opriri, preluari si alerte.</p>
            </div>
            <Activity size={20} />
          </div>
          {activityItems.length ? (
            <div className="simple-list dashboard-activity-list">
              {activityItems.map((item) => {
                const content = (
                  <>
                    <span className={`dashboard-activity-dot dashboard-activity-dot--${item.tone}`} />
                    <div className="simple-list-text">
                      <div className="simple-list-label">{item.title}</div>
                      <div className="simple-list-subtitle">
                        {item.subtitle} - {formatDateTime(item.at)}
                      </div>
                    </div>
                    <StatusBadge tone={item.tone}>{formatTime(item.at)}</StatusBadge>
                  </>
                );
                return item.to ? (
                  <Link key={item.id} to={item.to} className="simple-list-item">
                    {content}
                  </Link>
                ) : (
                  <div key={item.id} className="simple-list-item">
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nicio activitate azi" subtitle="Cand apar pontaje sau alerte, le vezi aici." />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Notificari recente</h2>
              <p className="panel-subtitle">Inbox-ul tau operational.</p>
            </div>
            <Bell size={20} />
          </div>
          {notifications.length ? (
            <div className="simple-list">
              {notifications.slice(0, 6).map((item) => {
                const themeClass = getUserThemeClass(item.actorUserThemeKey ?? null);
                return (
                  <Link
                    key={item.id}
                    to={resolveNotificationPath({
                      module: item.module,
                      eventType: item.eventType,
                      entityId: item.entityId,
                      notificationPath: item.notificationPath,
                    })}
                    className={`simple-list-item user-history-row ${themeClass}`}
                  >
                    <div className="user-inline-meta">
                      <span className="user-accent-avatar">{getUserInitials(item.actorUserName || item.title || "N")}</span>
                    </div>
                    <div className="simple-list-text">
                      <div className="simple-list-label">{item.title || "Notificare"}</div>
                      <div className="simple-list-subtitle">{item.message || formatDateTime(item.createdAt)}</div>
                    </div>
                    <StatusBadge tone={item.read ? "muted" : "red"}>{item.read ? "citita" : "noua"}</StatusBadge>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Bell} title="Nicio notificare" subtitle="Totul este linistit momentan." />
          )}
        </div>
      </div>

      <div className="content-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Proiecte active</h2>
              <p className="panel-subtitle">Proiectele pe care se poate porni pontaj.</p>
            </div>
            <Wrench size={20} />
          </div>
          {activeProjects.length ? (
            <div className="simple-list">
              {activeProjects.slice(0, 8).map((project) => (
                <Link to="/projects" key={project.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">{project.name || "Fara nume"}</div>
                    <div className="simple-list-subtitle">Status: {project.status}</div>
                  </div>
                  <StatusBadge tone="green">activ</StatusBadge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={Briefcase} title="Niciun proiect activ" />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Angajati nepontati azi</h2>
              <p className="panel-subtitle">Lista scurta pentru manager.</p>
            </div>
            <Users size={20} />
          </div>
          {usersWithoutToday.length ? (
            <div className="simple-list">
              {usersWithoutToday.slice(0, 8).map((item) => (
                <Link key={item.id} to={`/timesheets?assistantUserId=${item.uid || item.id}`} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">{getUserName(item)}</div>
                    <div className="simple-list-subtitle">{item.department || item.roleTitle || item.email || "-"}</div>
                  </div>
                  <StatusBadge tone="red">nepontat</StatusBadge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Toata echipa are pontaj azi" />
          )}
        </div>
      </div>
    </section>
  );
}
