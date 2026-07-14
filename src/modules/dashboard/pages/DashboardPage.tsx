import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  FolderOpen,
  RefreshCw,
  ReceiptText,
  TimerReset,
  Wrench,
  Building,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import { getDashboardData } from "../services/dashboardService";
import type { DashboardMaintenanceSummary } from "../services/dashboardService";
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
import { ProductContentLayout, ProductQuickActions } from "../../../components/product/ProductPage";
import { LoadingState, PageHeader, PageLayout } from "../../../components/experience";
import UniversalTimeline from "../../../components/product/UniversalTimeline";
import {
  getEffectiveWorkedMinutes,
  getLocalDateKey,
  getProjectLabel,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
} from "../../timesheets/utils/timesheetAnalytics";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import {
  getLiveFirebaseCostEstimate,
  type LiveFirebaseCostEstimate,
} from "../../reports/services/billingMetricsService";
import { getDashboardRoleProfile } from "../config/dashboardRoleProfile";

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

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ro-RO");
}

function formatTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function getUserName(userItem: AppUserItem) {
  return userItem.fullName || userItem.email || "Utilizator";
}

export default function DashboardPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const loadInProgressRef = useRef(false);
  const lastLoadedAtRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [navigatingVehicle, setNavigatingVehicle] = useState(false);
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationLite[]>([]);
  const [maintenance, setMaintenance] = useState<DashboardMaintenanceSummary>({
    clients: 0,
    lifts: 0,
    expiredLifts: 0,
    expiringSoonLifts: 0,
    isPartial: false,
  });
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [billingEstimate, setBillingEstimate] = useState<LiveFirebaseCostEstimate | null>(null);
  const roleProfile = useMemo(() => getDashboardRoleProfile(role || "angajat"), [role]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (user?.globalAdmin !== true) return;
    let active = true;
    void getLiveFirebaseCostEstimate()
      .then((value) => {
        if (active) setBillingEstimate(value);
      })
      .catch((error) => console.warn("[Dashboard][billing]", error));
    return () => {
      active = false;
    };
  }, [user?.globalAdmin]);

  const load = useCallback(
    async (silent = false) => {
      if (loadInProgressRef.current) return;
      loadInProgressRef.current = true;
      if (!silent) setLoading(true);
      else setRefreshing(true);

      try {
        const data = await getDashboardData(user?.uid, undefined, role);
        if (!mountedRef.current) return;
        setUsers(data.users ?? []);
        setTools(data.tools ?? []);
        setVehicles(data.vehicles ?? []);
        setTimesheets(data.timesheets ?? []);
        setProjects(data.projects ?? []);
        setNotifications(data.notifications ?? []);
        setMaintenance(data.maintenance);
        setLastRefreshed(new Date());
        lastLoadedAtRef.current = Date.now();
      } catch (error) {
        console.error("[DashboardPage][load]", error);
      } finally {
        loadInProgressRef.current = false;
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [role, user?.uid]
  );

  useEffect(() => {
    void load();
    const refreshIfVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadedAtRef.current >= 30 * 60_000
      ) {
        void load(true);
      }
    };
    const interval = window.setInterval(refreshIfVisible, 30 * 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
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
  const activeTimesheetsNow = useMemo(
    () => timesheets.filter((item) => item.status === "activ"),
    [timesheets]
  );
  const currentTeamTimesheets = useMemo(
    () => timesheets.filter((item) => item.workDate === todayKey || item.status === "activ"),
    [timesheets, todayKey]
  );
  const todayMinutes = useMemo(
    () => todayTimesheets.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item), 0),
    [todayTimesheets]
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "activ"),
    [projects]
  );
  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "activa"),
    [vehicles]
  );
  const vehiclesWithoutDriver = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "activa" && !vehicle.currentDriverUserId),
    [vehicles]
  );
  const problemTools = useMemo(
    () => tools.filter((tool) => tool.status === "defecta" || tool.status === "pierduta"),
    [tools]
  );
  const problemVehicles = useMemo(
    () =>
      vehicles.filter(
        (vehicle) => vehicle.status === "indisponibila" || vehicle.status === "avariata"
      ),
    [vehicles]
  );
  const importantAlertsCount =
    todayTimesheets.filter((item) => getEffectiveWorkedMinutes(item) > 8 * 60).length +
    todayTimesheets.filter((item) => !item.projectId && !item.projectName).length +
    vehiclesWithoutDriver.length +
    problemVehicles.length +
    problemTools.length +
    maintenance.expiredLifts +
    maintenance.expiringSoonLifts;

  const managementScope = role === "admin" || role === "manager";

  const rows = useMemo<TodayRow[]>(() => {
    const latestByUser = new Map<string, TimesheetItem>();
    for (const item of currentTeamTimesheets) {
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
  }, [activeUsers, currentTeamTimesheets]);

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

    return items.sort((a, b) => b.at - a.at).slice(0, 10);
  }, [todayTimesheets]);

  const columns = useMemo<DataTableColumn<TodayRow>[]>(
    () => [
      {
        key: "employee",
        header: "Angajat",
        render: (row) => {
          const themeClass = getUserThemeClass(
            row.user.themeKey ?? row.timesheet?.userThemeKey ?? null
          );
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
        render: (row) =>
          row.timesheet ? formatMinutes(getEffectiveWorkedMinutes(row.timesheet)) : "-",
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
            <Link
              className="secondary-btn secondary-btn--compact"
              to={`/timesheets/${row.timesheet.id}`}
            >
              Detalii
            </Link>
          ) : (
            <Link
              className="secondary-btn secondary-btn--compact"
              to={`/timesheets?assistantUserId=${row.id}`}
            >
              Vezi istoric
            </Link>
          ),
      },
    ],
    []
  );

  if (loading) {
    return (
      <PageLayout className="dashboard-modern-page">
        <LoadingState title="Se incarca centrul operational" description="Pregatim indicatorii relevanti pentru rolul tau." />
      </PageLayout>
    );
  }

  return (
    <PageLayout className="dashboard-modern-page">
      <PageHeader
        eyebrow={roleProfile.eyebrow}
        title={roleProfile.title}
        description={roleProfile.description}
        meta={
          <span className="today-strip">
            <CalendarClock size={14} />
            {new Date().toLocaleDateString("ro-RO", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        }
        actions={[
          {
            id: "refresh-dashboard",
            label: refreshing
              ? "Se actualizează"
              : `Actualizat ${lastRefreshed.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}`,
            icon: RefreshCw,
            onClick: () => void load(true),
            disabled: refreshing,
            assistantAction: "refresh-dashboard",
          },
        ]}
      />

      <div className="wc-kpi-grid wc-kpi-grid--six">
        <KpiCard
          label="Pontaje active acum"
          value={activeTimesheetsNow.length}
          helper={`${todayTimesheets.length} pontaje azi`}
          tone="blue"
          icon={Clock3}
          to="/timesheets?assistant=active"
        />
        <KpiCard
          label="Ore lucrate azi"
          value={formatMinutes(todayMinutes)}
          helper="include pontajele active"
          tone="green"
          icon={TimerReset}
          to="/timesheets?period=today"
        />
        {managementScope ? (
          <KpiCard
            label="Proiecte active"
            value={activeProjects.length}
            helper={`${projects.length} incarcate`}
            tone="blue"
            icon={Briefcase}
            to="/projects"
          />
        ) : null}
        {managementScope ? (
          <KpiCard
            label="Masini active"
            value={activeVehicles.length}
            helper={`${vehiclesWithoutDriver.length} fara sofer`}
            tone={vehiclesWithoutDriver.length ? "orange" : "green"}
            icon={CarFront}
            to="/vehicles"
          />
        ) : null}
        {managementScope ? (
          <KpiCard
            label="Mentenanta lifturi"
            value={maintenance.lifts}
            helper={`${maintenance.expiredLifts + maintenance.expiringSoonLifts} necesita atentie`}
            tone={
              maintenance.expiredLifts ? "red" : maintenance.expiringSoonLifts ? "orange" : "green"
            }
            icon={Building}
            to="/maintenance"
          />
        ) : null}
        {managementScope ? (
          <KpiCard
            label="Alerte importante"
            value={importantAlertsCount}
            helper={importantAlertsCount ? "necesita verificare" : "totul arata ok"}
            tone={importantAlertsCount ? "orange" : "green"}
            icon={AlertTriangle}
            to="/notifications"
          />
        ) : null}
        {user?.globalAdmin === true ? (
          <KpiCard
            label="Cost Firebase live"
            value={
              billingEstimate?.costPerMinuteEur != null
                ? `${billingEstimate.costPerMinuteEur.toLocaleString("ro-RO", { maximumFractionDigits: 5 })} € / min`
                : "-"
            }
            helper={
              billingEstimate?.status === "current"
                ? "Cloud Monitoring"
                : "date în curs de actualizare"
            }
            tone="blue"
            icon={Database}
            to="/control-panel#billing"
          />
        ) : null}
        {user?.globalAdmin === true ? (
          <KpiCard
            label="Cost estimat luna"
            value={
              billingEstimate?.estimatedLastHourEur != null
                ? `${(billingEstimate.estimatedLastHourEur * 24 * 30).toLocaleString("ro-RO", { maximumFractionDigits: 2 })} €`
                : "-"
            }
            helper="estimare din media ultimelor 60 min"
            tone="purple"
            icon={CreditCard}
            to="/control-panel#billing"
          />
        ) : null}
      </div>

      <ProductContentLayout
        aside={
          <ProductQuickActions
            actions={[
              {
                id: "my-timesheet",
                label: "Pontajul meu",
                to: "/my-timesheets",
                icon: TimerReset,
                tone: "primary",
                assistantAction: "open-my-timesheet",
              },
              {
                id: "my-vehicle",
                label: navigatingVehicle ? "Se deschide..." : "Mașina mea",
                onClick: () => void openMyVehicle(),
                icon: CarFront,
                disabled: navigatingVehicle,
                assistantAction: "open-my-vehicle",
              },
              {
                id: "scan-receipt",
                label: "Scanează bon",
                to: "/expenses/scan?assistant=upload",
                icon: ReceiptText,
                assistantAction: "upload-receipt",
              },
              {
                id: "maintenance-report",
                label: "Raport nou",
                to: "/maintenance?tab=report&assistant=report",
                icon: Building2,
                assistantAction: "maintenance-report",
              },
              {
                id: "projects",
                label: "Vezi proiecte",
                to: "/projects",
                icon: FolderOpen,
                assistantAction: "open-projects",
              },
            ]}
          />
        }
      >
        {managementScope ? (
          <div className="content-grid dashboard-main-grid">
            <div className="panel" data-assistant-section="dashboard-today-timesheets">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">Pontaje azi</h2>
                  <p className="panel-subtitle">
                    Cine este pontat, cine nu, si pe ce proiect lucreaza.
                  </p>
                </div>
                <StatusBadge tone="blue">{rows.length} angajati</StatusBadge>
              </div>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowClassName={(row) =>
                  row.timesheet?.status === "activ" ? "is-active" : row.timesheet ? "" : "is-danger"
                }
                empty={<EmptyState icon={Clock3} title="Nu exista utilizatori activi" />}
              />
            </div>

            <div className="panel" data-assistant-section="dashboard-alerts">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">Atentie</h2>
                  <p className="panel-subtitle">Probleme care merita verificate rapid.</p>
                </div>
                <StatusBadge tone={importantAlertsCount ? "orange" : "green"}>
                  {importantAlertsCount}
                </StatusBadge>
              </div>
              <div className="dashboard-alert-grid">
                <Link
                  to="/timesheets?assistant=long"
                  className="dashboard-alert-card dashboard-alert-card--orange"
                >
                  <strong>
                    {
                      todayTimesheets.filter((item) => getEffectiveWorkedMinutes(item) > 8 * 60)
                        .length
                    }
                  </strong>
                  <span>pontaje peste 8 ore</span>
                </Link>
                <Link
                  to="/timesheets?assistant=no-project"
                  className="dashboard-alert-card dashboard-alert-card--orange"
                >
                  <strong>
                    {todayTimesheets.filter((item) => !item.projectId && !item.projectName).length}
                  </strong>
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
                <Link
                  to="/maintenance?tab=checks"
                  className="dashboard-alert-card dashboard-alert-card--orange"
                >
                  <strong>{maintenance.expiredLifts + maintenance.expiringSoonLifts}</strong>
                  <span>lifturi cu expirari</span>
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <div className="content-grid">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Activitate azi</h2>
                <p className="panel-subtitle">
                  Ultimele porniri si opriri de pontaj ale utilizatorilor.
                </p>
              </div>
              <Activity size={20} />
            </div>
            {activityItems.length ? (
              <UniversalTimeline
                items={activityItems.map((item) => ({
                  id: item.id,
                  title: item.title,
                  description: item.subtitle,
                  timestamp: item.at,
                  tone: item.tone,
                  to: item.to,
                }))}
              />
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title="Nicio activitate azi"
                subtitle="Cand utilizatorii pornesc sau opresc pontajul, activitatea apare aici."
              />
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
                        <span className="user-accent-avatar">
                          {getUserInitials(item.actorUserName || item.title || "N")}
                        </span>
                      </div>
                      <div className="simple-list-text">
                        <div className="simple-list-label">{item.title || "Notificare"}</div>
                        <div className="simple-list-subtitle">
                          {item.message || formatDateTime(item.createdAt)}
                        </div>
                      </div>
                      <StatusBadge tone={item.read ? "muted" : "red"}>
                        {item.read ? "citita" : "noua"}
                      </StatusBadge>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Bell}
                title="Nicio notificare"
                subtitle="Totul este linistit momentan."
              />
            )}
          </div>
        </div>

        {managementScope ? (
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
          </div>
        ) : null}
      </ProductContentLayout>
    </PageLayout>
  );
}
