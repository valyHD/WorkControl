import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { collectionGroup, getDocs, limit, orderBy, query } from "firebase/firestore";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  Car,
  ChevronLeft,
  Download,
  Gauge,
  MapPin,
  ReceiptText,
  Timer,
  UserRound,
  Wrench,
} from "lucide-react";
import { db } from "../../../lib/firebase/firebase";
import { useAuth } from "../../../providers/AuthProvider";
import type { ExpenseDocumentItem } from "../../../types/expense";
import type { LeaveRequestItem } from "../../../types/leave";
import type { MaintenanceReportHistoryItem } from "../../../types/maintenance";
import type { TimesheetItem } from "../../../types/timesheet";
import type { ToolItem } from "../../../types/tool";
import type { AppUserItem } from "../../../types/user";
import type { VehicleItem } from "../../../types/vehicle";
import { getExpenseDocuments, summarizeExpenses } from "../../expenses/services/expensesService";
import { getLeaveDateSet, getLeaveRequestsForUser } from "../../leave/services/leaveRequestsService";
import { getTimesheetsForUser } from "../../timesheets/services/timesheetsService";
import { getToolsList } from "../../tools/services/toolsService";
import { getVehiclesList } from "../../vehicles/services/vehiclesService";
import { getUserById } from "../services/usersService";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";

type ProfileData = {
  user: AppUserItem;
  tools: ToolItem[];
  vehicles: VehicleItem[];
  expenses: ExpenseDocumentItem[];
  timesheets: TimesheetItem[];
  leaveRequests: LeaveRequestItem[];
  maintenanceReports: MaintenanceReportHistoryItem[];
};

const PROFILE_DATA_CACHE_TTL_MS = 5 * 60_000;
const profileDataCache = new Map<string, { expiresAt: number; data: ProfileData }>();

const MONTH_LABEL = new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" });
const DATE_LABEL = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium" });
const DATE_TIME_LABEL = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short" });
const MONEY_LABEL = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" });
const MAX_ACTIVE_CALENDAR_MINUTES = 12 * 60;

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function uniq(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function isIdMatch(value: string | undefined, candidates: string[]) {
  return Boolean(value && candidates.includes(value));
}

function formatDate(value?: string | number | null) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return DATE_LABEL.format(date);
}

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return DATE_TIME_LABEL.format(date);
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  const weekDay = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - weekDay);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTimesheetDayKey(timesheet: TimesheetItem) {
  if (timesheet.workDate) return timesheet.workDate;
  if (!timesheet.startAt) return "";
  return toIsoDate(new Date(timesheet.startAt));
}

function getCalendarTimesheetMinutes(timesheet: TimesheetItem) {
  if (timesheet.status === "inchis" || timesheet.status === "corectat") {
    return Math.max(0, Number(timesheet.workedMinutes || 0));
  }

  if (timesheet.status === "activ" && getTimesheetDayKey(timesheet) === toIsoDate(new Date())) {
    const liveMinutes = Math.max(0, Math.round((Date.now() - timesheet.startAt) / 60000));
    return Math.min(liveMinutes, MAX_ACTIVE_CALENDAR_MINUTES);
  }

  return 0;
}

function groupTimesheetMinutesByDay(items: TimesheetItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getTimesheetDayKey(item);
    if (!key) return acc;
    const minutes = getCalendarTimesheetMinutes(item);
    if (minutes <= 0) return acc;
    acc[key] = (acc[key] ?? 0) + minutes;
    return acc;
  }, {});
}

function groupExpensesByMonth(items: ExpenseDocumentItem[]) {
  return items.reduce<Record<string, { total: number; reimbursable: number; count: number }>>((acc, item) => {
    const key = item.yearMonth || (item.documentDate ? item.documentDate.slice(0, 7) : "");
    if (!key) return acc;
    const current = acc[key] ?? { total: 0, reimbursable: 0, count: 0 };
    current.total += item.totalAmount || 0;
    current.reimbursable += item.reimbursable ? item.totalAmount || 0 : 0;
    current.count += 1;
    acc[key] = current;
    return acc;
  }, {});
}

function groupTimesheetsByMonth(items: TimesheetItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item.yearMonth || (item.workDate ? item.workDate.slice(0, 7) : "");
    if (!key) return acc;
    acc[key] = (acc[key] ?? 0) + Math.max(0, Number(item.workedMinutes || 0));
    return acc;
  }, {});
}

function groupTimesheetsByWeek(items: TimesheetItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item.weekKey || "Fara saptamana";
    acc[key] = (acc[key] ?? 0) + Math.max(0, Number(item.workedMinutes || 0));
    return acc;
  }, {});
}

function sortRecordEntriesDesc<T>(record: Record<string, T>) {
  return Object.entries(record).sort(([a], [b]) => b.localeCompare(a));
}

function countBy<T extends string>(items: T[]) {
  return items.reduce<Record<T, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function getLeaveRequestFileName(request: LeaveRequestItem) {
  const name = request.userName || request.userEmail || request.userId || "utilizator";
  return `cerere-concediu-${name}-${request.periodStart}-${request.periodEnd}.pdf`;
}

function getMaintenanceReportFileName(report: MaintenanceReportHistoryItem) {
  return report.fileName || `raport-mentenanta-${report.clientName || report.clientId || "client"}-${report.id}.pdf`;
}

function buildRecentActivity(data: ProfileData) {
  return [
    ...data.timesheets.slice(0, 6).map((item) => ({
      id: `timesheet-${item.id}`,
      ts: item.startAt,
      label: `Pontaj ${item.status}`,
      detail: `${item.projectName || item.projectCode || "Fara proiect"} · ${formatMinutes(item.workedMinutes)}`,
      href: `/timesheets/${item.id}`,
    })),
    ...data.expenses.slice(0, 6).map((item) => ({
      id: `expense-${item.id}`,
      ts: item.createdAt,
      label: item.reimbursable ? "Decont introdus" : "Cheltuiala introdusa",
      detail: `${item.supplierName || item.documentKind} · ${MONEY_LABEL.format(item.totalAmount || 0)}`,
      href: item.fileUrl || "",
    })),
    ...data.leaveRequests.slice(0, 6).map((item) => ({
      id: `leave-${item.id}`,
      ts: item.createdAt,
      label: `Cerere ${item.status.replace("_", " ")}`,
      detail: `${item.periodStart} - ${item.periodEnd} · ${item.requestedDays} zile`,
      href: item.pdfDataUrl || "",
    })),
    ...data.maintenanceReports.slice(0, 6).map((item) => ({
      id: `maintenance-${item.clientId}-${item.id}`,
      ts: item.createdAt,
      label: `Raport ${item.reportType || "mentenanta"}`,
      detail: `${item.clientName || "Client"} · lift ${item.lift || "-"}`,
      href: item.pdfUrl || "",
    })),
  ]
    .filter((item) => Number.isFinite(item.ts) && item.ts > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);
}

function mapMaintenanceReport(id: string, data: Record<string, unknown>): MaintenanceReportHistoryItem {
  return {
    id,
    clientId: String(data.clientId ?? ""),
    clientName: String(data.clientName ?? ""),
    reportType: String(data.reportType ?? ""),
    address: String(data.address ?? ""),
    lift: String(data.lift ?? ""),
    technicianName: String(data.technicianName ?? ""),
    comments: String(data.comments ?? ""),
    pdfUrl: String(data.pdfUrl ?? ""),
    pdfPath: String(data.pdfPath ?? ""),
    images: Array.isArray(data.images) ? (data.images as MaintenanceReportHistoryItem["images"]) : [],
    fileName: String(data.fileName ?? ""),
    createdAt: Number(data.createdAt ?? 0),
    dateText: String(data.dateText ?? ""),
    timeText: String(data.timeText ?? ""),
  };
}

async function getMaintenanceReportsForUser(user: AppUserItem) {
  const name = normalizeText(user.fullName || "");
  const email = normalizeText(user.email || "");
  const emailName = normalizeText((user.email || "").split("@")[0] || "");

  try {
    const snap = await getDocs(query(collectionGroup(db, "rapoarte"), orderBy("createdAt", "desc"), limit(100)));
    return snap.docs
      .map((docItem) => mapMaintenanceReport(docItem.id, docItem.data() as Record<string, unknown>))
      .filter((report) => {
        const technician = normalizeText(report.technicianName || "");
        if (!technician) return false;
        return Boolean(
          (name && technician.includes(name)) ||
            (email && technician.includes(email)) ||
            (emailName && technician.includes(emailName))
        );
      });
  } catch {
    return [];
  }
}

function Section({
  title,
  icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: ReactNode;
  count?: string | number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="user-profile-section" open={defaultOpen}>
      <summary>
        <span className="user-profile-section-icon">{icon}</span>
        <span>{title}</span>
        {count !== undefined ? <strong>{count}</strong> : null}
      </summary>
      <div className="user-profile-section-body">{children}</div>
    </details>
  );
}

function LeaveCalendar({ requests, timesheets }: { requests: LeaveRequestItem[]; timesheets: TimesheetItem[] }) {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const approvedSet = useMemo(
    () => getLeaveDateSet(requests.filter((request) => request.status === "aprobat")),
    [requests]
  );
  const pendingSet = useMemo(
    () => getLeaveDateSet(requests.filter((request) => request.status === "in_asteptare")),
    [requests]
  );
  const timesheetMinutesByDay = useMemo(() => groupTimesheetMinutesByDay(timesheets), [timesheets]);
  const days = useMemo(() => getMonthDays(visibleMonth), [visibleMonth]);

  return (
    <div className="user-profile-calendar-card">
      <div className="leave-inline-calendar-header">
        <strong className="leave-month-title">{MONTH_LABEL.format(visibleMonth)}</strong>
        <div className="leave-inline-calendar-actions">
          <button
            className="leave-icon-btn"
            type="button"
            onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
          >
            &lt;
          </button>
          <button className="secondary-btn" type="button" onClick={() => setVisibleMonth(new Date())}>
            Azi
          </button>
          <button
            className="leave-icon-btn"
            type="button"
            onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
          >
            &gt;
          </button>
        </div>
      </div>
      <div className="leave-calendar-grid leave-calendar-grid-compact user-profile-calendar-grid">
        {["L", "M", "M", "J", "V", "S", "D"].map((label) => (
          <div key={label} className="leave-cell leave-cell-head">
            {label}
          </div>
        ))}
        {days.map((date) => {
          const key = toIsoDate(date);
          const approved = approvedSet.has(key);
          const pending = pendingSet.has(key);
          const workedMinutes = timesheetMinutesByDay[key] ?? 0;
          const outside = date.getMonth() !== visibleMonth.getMonth();
          return (
            <div
              key={key}
              className={`leave-cell ${outside ? "is-outside" : ""} ${approved ? "is-leave" : ""} ${
                workedMinutes > 0 ? "is-worked" : ""
              } ${approved && workedMinutes > 0 ? "is-mixed" : ""} ${pending ? "is-pending-leave" : ""
              }`}
              title={approved ? "Concediu aprobat" : pending ? "Cerere in asteptare" : ""}
            >
              <span className="leave-cell-day">{date.getDate()}</span>
              {workedMinutes > 0 ? <span className="leave-cell-minutes">{formatMinutes(workedMinutes)}</span> : null}
              {approved ? <span className="user-profile-calendar-mark">aprobat</span> : null}
              {pending ? <span className="user-profile-calendar-mark">astept.</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VehicleMiniMap({ vehicle }: { vehicle: VehicleItem }) {
  const snapshot = vehicle.gpsSnapshot;
  if (!snapshot?.lat || !snapshot?.lng) {
    return <div className="user-profile-map-empty">Nu exista pozitie GPS salvata pentru masina.</div>;
  }

  return (
    <div className="user-profile-map">
      <MapContainer
        center={[snapshot.lat, snapshot.lng]}
        zoom={15}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        className="user-profile-map-leaflet"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          updateWhenIdle
        />
        <CircleMarker
          center={[snapshot.lat, snapshot.lng]}
          radius={8}
          pathOptions={{ color: "#1d4ed8", fillColor: "#2563eb", fillOpacity: 0.9, weight: 3 }}
        >
          <Popup>
            {vehicle.plateNumber || "Masina"}<br />
            {formatDateTime(snapshot.gpsTimestamp)}
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="tools-subtitle user-profile-empty-line">{children}</p>;
}

export default function UserActivityProfilePage() {
  const { userId = "" } = useParams();
  const location = useLocation();
  const { role, user: authUser } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const profileUser = await getUserById(userId);
        if (!profileUser) throw new Error("Utilizatorul nu exista.");

        const canRead = role === "admin" || profileUser.uid === authUser?.uid || profileUser.id === authUser?.uid;
        if (!canRead) throw new Error("Nu ai acces la acest profil.");

        const cached = profileDataCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
          if (!cancelled) setData(cached.data);
          return;
        }

        const candidates = uniq([profileUser.id, profileUser.uid]);
        const [tools, vehicles, expenses, maintenanceReports, ...perIdResults] = await Promise.all([
          getToolsList(),
          getVehiclesList(),
          getExpenseDocuments(200),
          getMaintenanceReportsForUser(profileUser),
          ...candidates.flatMap((candidate) => [
            getTimesheetsForUser(candidate, 120),
            getLeaveRequestsForUser(candidate, 80),
          ]),
        ]);

        const timesheets = perIdResults
          .filter((_, index) => index % 2 === 0)
          .flat() as TimesheetItem[];
        const leaveRequests = perIdResults
          .filter((_, index) => index % 2 === 1)
          .flat() as LeaveRequestItem[];

        const dedupedTimesheets = Array.from(new Map(timesheets.map((item) => [item.id, item])).values()).sort(
          (a, b) => b.startAt - a.startAt
        );
        const dedupedLeave = Array.from(new Map(leaveRequests.map((item) => [item.id, item])).values()).sort(
          (a, b) => b.createdAt - a.createdAt
        );

        if (cancelled) return;
        const nextData = {
          user: profileUser,
          tools: tools.filter(
            (tool) =>
              isIdMatch(tool.currentHolderUserId, candidates) ||
              isIdMatch(tool.ownerUserId, candidates)
          ),
          vehicles: vehicles.filter(
            (vehicle) =>
              isIdMatch(vehicle.currentDriverUserId, candidates) ||
              isIdMatch(vehicle.ownerUserId, candidates)
          ),
          expenses: expenses.filter(
            (expense) => isIdMatch(expense.assignedUserId, candidates) || isIdMatch(expense.uploadedByUserId, candidates)
          ),
          timesheets: dedupedTimesheets,
          leaveRequests: dedupedLeave,
          maintenanceReports,
        };
        profileDataCache.set(userId, { data: nextData, expiresAt: Date.now() + PROFILE_DATA_CACHE_TTL_MS });
        setData(nextData);
      } catch (err) {
        console.error("[UserActivityProfilePage][load]", err);
        if (!cancelled) setError(err instanceof Error ? err.message : "Nu am putut incarca profilul.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [authUser?.uid, role, userId]);

  useEffect(() => {
    if (loading || location.hash !== "#user-recent-activity") return;
    window.setTimeout(() => {
      document.getElementById("user-recent-activity")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
  }, [loading, location.hash]);

  const monthKey = currentYearMonth();
  const metrics = useMemo(() => {
    if (!data) return null;
    const monthExpenses = data.expenses.filter((item) => item.yearMonth === monthKey);
    const monthExpenseSummary = summarizeExpenses(monthExpenses);
    const monthTimesheets = data.timesheets.filter((item) => item.yearMonth === monthKey);
    const activeTimesheet = data.timesheets.find((item) => item.status === "activ") ?? null;
    const approvedLeaveDays = data.leaveRequests
      .filter((item) => item.status === "aprobat")
      .reduce((sum, item) => sum + Math.max(0, Number(item.requestedDays || 0)), 0);
    const toolsByStatus = countBy(data.tools.map((tool) => tool.status));
    const vehiclesWithGps = data.vehicles.filter((vehicle) => vehicle.gpsSnapshot?.lat && vehicle.gpsSnapshot?.lng).length;
    const recentActivity = buildRecentActivity(data);

    return {
      monthExpenseSummary,
      monthTimesheetMinutes: monthTimesheets.reduce((sum, item) => sum + Math.max(0, Number(item.workedMinutes || 0)), 0),
      activeTimesheet,
      approvedLeaveDays,
      toolsByStatus,
      vehiclesWithGps,
      recentActivity,
    };
  }, [data, monthKey]);

  if (loading) {
    return (
      <section className="page-section">
        <div className="panel">
          <h2 className="panel-title">Se incarca profilul...</h2>
          <p className="tools-subtitle">Strangem datele utilizatorului din module.</p>
        </div>
      </section>
    );
  }

  if (error || !data || !metrics) {
    return (
      <section className="page-section">
        <div className="panel">
          <Link to="/users" className="secondary-btn user-profile-back">
            <ChevronLeft size={15} /> Inapoi la utilizatori
          </Link>
          <h2 className="panel-title">Profil indisponibil</h2>
          <p className="tools-subtitle">{error || "Nu am gasit date pentru acest utilizator."}</p>
        </div>
      </section>
    );
  }

  const themeClass = getUserThemeClass(data.user.themeKey || null);
  const expenseMonths = groupExpensesByMonth(data.expenses);
  const timesheetMonths = groupTimesheetsByMonth(data.timesheets);
  const timesheetWeeks = groupTimesheetsByWeek(data.timesheets);

  return (
    <section className={`page-section user-profile-page ${themeClass}`}>
      <div className="panel user-profile-hero">
        <Link to="/users" className="secondary-btn user-profile-back">
          <ChevronLeft size={15} /> Inapoi la utilizatori
        </Link>
        <div className="user-profile-hero-main">
          <span className="user-accent-avatar user-profile-avatar">
            {data.user.avatarThumbUrl || data.user.avatarUrl ? (
              <img src={data.user.avatarThumbUrl || data.user.avatarUrl} alt="" />
            ) : (
              getUserInitials(data.user.fullName || data.user.email || "U")
            )}
          </span>
          <div>
            <h2 className="panel-title">{data.user.fullName || "Utilizator fara nume"}</h2>
            <p className="tools-subtitle">
              {data.user.email || "-"} · {data.user.role || "-"} · {data.user.active !== false ? "activ" : "inactiv"}
            </p>
            <p className="tools-subtitle">Last seen at: {formatDateTime(data.user.lastSeenAt)}</p>
          </div>
        </div>
        {role === "admin" ? (
          <Link to={`/users/${data.user.id}/edit`} className="primary-btn">
            Editeaza utilizator
          </Link>
        ) : null}
      </div>

      <div className="dashboard-kpi-grid user-profile-kpis">
        <div className="kpi-card">
          <div className="kpi-label">Scule detinute</div>
          <div className="kpi-value">{data.tools.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Masini</div>
          <div className="kpi-value">{data.vehicles.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Cheltuieli luna curenta</div>
          <div className="kpi-value">{MONEY_LABEL.format(metrics.monthExpenseSummary.total)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Decont luna curenta</div>
          <div className="kpi-value">{MONEY_LABEL.format(metrics.monthExpenseSummary.reimbursableTotal)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pontaj luna curenta</div>
          <div className="kpi-value">{formatMinutes(metrics.monthTimesheetMinutes)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Zile concediu aprobate</div>
          <div className="kpi-value">{metrics.approvedLeaveDays}</div>
        </div>
      </div>

      <div id="user-recent-activity" className="panel user-profile-overview-panel">
        <div className="user-profile-overview-head">
          <div>
            <h3 className="panel-title">Ansamblu activitate</h3>
            <p className="tools-subtitle">Ultimele actiuni relevante din modulele unde apare utilizatorul.</p>
          </div>
          <span className="badge badge-muted">{metrics.recentActivity.length} evenimente</span>
        </div>
        {metrics.recentActivity.length === 0 ? (
          <EmptyLine>Nu exista activitate recenta.</EmptyLine>
        ) : (
          <div className="user-profile-activity-strip">
            {metrics.recentActivity.map((item) => {
              const content = (
                <>
                  <span className="user-profile-activity-icon"><Activity size={14} /></span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                    <small>{formatDateTime(item.ts)}</small>
                  </span>
                </>
              );
              if (item.href.startsWith("/")) {
                return (
                  <Link key={item.id} to={item.href} className="user-profile-activity-item">
                    {content}
                  </Link>
                );
              }
              if (item.href) {
                return (
                  <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className="user-profile-activity-item">
                    {content}
                  </a>
                );
              }
              return <div key={item.id} className="user-profile-activity-item">{content}</div>;
            })}
          </div>
        )}
      </div>

      <Section title="Concedii si cereri" icon={<CalendarDays size={17} />} count={data.leaveRequests.length} defaultOpen>
        <LeaveCalendar requests={data.leaveRequests} timesheets={data.timesheets} />
        {data.leaveRequests.length === 0 ? (
          <EmptyLine>Nu exista cereri de concediu pentru acest utilizator.</EmptyLine>
        ) : (
          <div className="simple-list user-profile-list">
            {data.leaveRequests.slice(0, 10).map((request) => (
              <div key={request.id} className="simple-list-item leave-history-item leave-history-item-profile">
                <div>
                  <strong>{request.periodStart} - {request.periodEnd}</strong>
                  <div className="simple-list-subtitle">
                    {request.requestType.replaceAll("_", " ")} · {request.requestedDays} zile · {request.status.replace("_", " ")}
                  </div>
                </div>
                {request.pdfDataUrl ? (
                  <div className="leave-admin-actions">
                    <a className="secondary-btn leave-history-pdf-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                    <button
                      className="secondary-btn leave-history-pdf-btn"
                      type="button"
                      onClick={() =>
                        void downloadFileFromUrl({
                          url: request.pdfDataUrl,
                          fileName: getLeaveRequestFileName(request),
                        })
                      }
                    >
                      <Download size={14} />
                      Download
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Scule detinute" icon={<Wrench size={17} />} count={data.tools.length} defaultOpen={data.tools.length > 0}>
        <div className="user-profile-stat-pills">
          {Object.entries(metrics.toolsByStatus).map(([status, count]) => (
            <span key={status} className="badge badge-muted">{status}: {count}</span>
          ))}
          {data.tools.length === 0 ? <span className="badge badge-muted">0 scule</span> : null}
        </div>
        {data.tools.length === 0 ? (
          <EmptyLine>Nu are scule atribuite sau detinute.</EmptyLine>
        ) : (
          <div className="user-profile-details-list">
            {data.tools.map((tool) => (
              <details key={tool.id} className="user-profile-nested">
                <summary>
                  <span>{tool.name || tool.internalCode || "Scula"}</span>
                  <strong>{tool.status}</strong>
                </summary>
                <div className="user-profile-facts">
                  <span>Cod: <strong>{tool.internalCode || "-"}</strong></span>
                  <span>Locatie: <strong>{tool.locationLabel || "-"}</strong></span>
                  <span>Responsabil: <strong>{tool.ownerUserName || "-"}</strong></span>
                  <span>Detinator: <strong>{tool.currentHolderUserName || "Depozit"}</strong></span>
                  <span>Garantie: <strong>{tool.warrantyUntil || tool.warrantyText || "-"}</strong></span>
                </div>
                <Link to={`/tools/${tool.id}`} className="secondary-btn user-profile-inline-link">Deschide scula</Link>
              </details>
            ))}
          </div>
        )}
      </Section>

      <Section title="Masini si GPS" icon={<Car size={17} />} count={data.vehicles.length} defaultOpen={data.vehicles.length > 0}>
        <div className="user-profile-stat-pills">
          <span className="badge badge-muted">{metrics.vehiclesWithGps} cu GPS activ/salvat</span>
          <span className="badge badge-muted">{data.vehicles.reduce((sum, vehicle) => sum + (vehicle.documents?.length || 0), 0)} documente masina</span>
        </div>
        {data.vehicles.length === 0 ? (
          <EmptyLine>Nu are masina atribuita.</EmptyLine>
        ) : (
          <div className="user-profile-vehicle-grid">
            {data.vehicles.map((vehicle) => (
              <div key={vehicle.id} className="simple-list-item user-profile-vehicle-card">
                <div className="user-profile-vehicle-head">
                  <div>
                    <strong>{vehicle.plateNumber || "Masina fara numar"}</strong>
                    <div className="simple-list-subtitle">{vehicle.brand} {vehicle.model} · {vehicle.status}</div>
                  </div>
                  <Link to={`/vehicles/${vehicle.id}`} className="secondary-btn">Detalii</Link>
                </div>
                <VehicleMiniMap vehicle={vehicle} />
              <div className="user-profile-facts">
                <span><Gauge size={14} /> Km curenti: <strong>{vehicle.currentKm.toLocaleString("ro-RO")} km</strong></span>
                <span><MapPin size={14} /> Odometru GPS: <strong>{vehicle.gpsSnapshot?.odometerKm?.toLocaleString("ro-RO") ?? "-"} km</strong></span>
                <span>Viteza: <strong>{vehicle.gpsSnapshot?.speedKmh ?? 0} km/h</strong></span>
                <span>Tracker: <strong>{formatDateTime(vehicle.tracker?.lastSeenAt || vehicle.gpsSnapshot?.serverTimestamp)}</strong></span>
                <span>ITP: <strong>{vehicle.nextItpDate || "-"}</strong></span>
                <span>RCA: <strong>{vehicle.nextRcaDate || "-"}</strong></span>
              </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Facturi, bonuri si decont" icon={<ReceiptText size={17} />} count={data.expenses.length}>
        <div className="user-profile-two-col">
          <div className="simple-list-item">
            <strong>Luna curenta</strong>
            <div className="user-profile-facts">
              <span>Total: <strong>{MONEY_LABEL.format(metrics.monthExpenseSummary.total)}</strong></span>
              <span>Decont: <strong>{MONEY_LABEL.format(metrics.monthExpenseSummary.reimbursableTotal)}</strong></span>
              <span>Documente: <strong>{metrics.monthExpenseSummary.count}</strong></span>
            </div>
          </div>
          <div className="simple-list-item">
            <strong>Istoric luni</strong>
            <div className="user-profile-mini-history">
              {sortRecordEntriesDesc(expenseMonths).slice(0, 6).map(([month, value]) => (
                <span key={month}>{month}: <strong>{MONEY_LABEL.format(value.total)}</strong> · decont {MONEY_LABEL.format(value.reimbursable)}</span>
              ))}
              {Object.keys(expenseMonths).length === 0 ? <span>Nu exista istoric.</span> : null}
            </div>
          </div>
        </div>
        <div className="simple-list user-profile-list">
          {data.expenses.slice(0, 8).map((expense) => (
            <div key={expense.id} className="simple-list-item user-profile-row">
              <div>
                <strong>{expense.supplierName || expense.fileName || "Document"}</strong>
                <div className="simple-list-subtitle">
                  {expense.documentKind} · {formatDate(expense.documentDate)} · {expense.projectName || expense.projectCode || "-"}
                </div>
              </div>
              <div className="leave-admin-actions">
                <strong>{MONEY_LABEL.format(expense.totalAmount || 0)}</strong>
                {expense.fileUrl ? (
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() =>
                      void downloadFileFromUrl({
                        url: expense.fileUrl,
                        fileName: expense.fileName || expense.documentNumber || expense.supplierName || "document-cheltuiala",
                      })
                    }
                  >
                    <Download size={14} />
                    Download
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Pontaj curent si istoric" icon={<Timer size={17} />} count={data.timesheets.length}>
        {metrics.activeTimesheet ? (
          <div className="vc-feedback vc-feedback--info user-profile-active-line">
            Pontaj activ: {metrics.activeTimesheet.projectName || metrics.activeTimesheet.projectCode || "Fara proiect"} · pornit la {formatDateTime(metrics.activeTimesheet.startAt)}
          </div>
        ) : (
          <EmptyLine>Nu exista pontaj activ acum.</EmptyLine>
        )}
        <div className="user-profile-two-col">
          <div className="simple-list-item">
            <strong>Istoric pe luni</strong>
            <div className="user-profile-mini-history">
              {sortRecordEntriesDesc(timesheetMonths).slice(0, 8).map(([month, minutes]) => (
                <span key={month}>{month}: <strong>{formatMinutes(minutes)}</strong></span>
              ))}
            </div>
          </div>
          <div className="simple-list-item">
            <strong>Istoric pe saptamani</strong>
            <div className="user-profile-mini-history">
              {sortRecordEntriesDesc(timesheetWeeks).slice(0, 8).map(([week, minutes]) => (
                <span key={week}>{week}: <strong>{formatMinutes(minutes)}</strong></span>
              ))}
            </div>
          </div>
        </div>
        <div className="simple-list user-profile-list">
          {data.timesheets.slice(0, 10).map((timesheet) => (
            <div key={timesheet.id} className="simple-list-item user-profile-row">
              <div>
                <strong>{timesheet.workDate || formatDate(timesheet.startAt)} · {timesheet.projectName || timesheet.projectCode || "-"}</strong>
                <div className="simple-list-subtitle">{timesheet.status} · {formatDateTime(timesheet.startAt)} - {formatDateTime(timesheet.stopAt)}</div>
              </div>
              <strong>{formatMinutes(timesheet.workedMinutes)}</strong>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Mentenanta si rapoarte" icon={<BriefcaseBusiness size={17} />} count={data.maintenanceReports.length}>
        {data.maintenanceReports.length === 0 ? (
          <EmptyLine>Nu am gasit rapoarte de mentenanta generate de acest utilizator.</EmptyLine>
        ) : (
          <div className="simple-list user-profile-list">
            {data.maintenanceReports.slice(0, 12).map((report) => (
              <div key={`${report.clientId}-${report.id}`} className="simple-list-item user-profile-row">
                <div>
                  <strong>{report.clientName || "Client"} · {report.reportType || "raport"}</strong>
                  <div className="simple-list-subtitle">
                    {report.dateText || formatDate(report.createdAt)} · lift {report.lift || "-"} · {report.address || "-"}
                  </div>
                </div>
                {report.pdfUrl ? (
                  <div className="leave-admin-actions">
                    <a className="secondary-btn" href={report.pdfUrl} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() =>
                        void downloadFileFromUrl({
                          url: report.pdfUrl,
                          fileName: getMaintenanceReportFileName(report),
                        })
                      }
                    >
                      <Download size={14} />
                      Download
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Date cont" icon={<UserRound size={17} />}>
        <div className="user-profile-facts user-profile-account-facts">
          <span>UID: <strong>{data.user.uid || data.user.id}</strong></span>
          <span>Email: <strong>{data.user.email || "-"}</strong></span>
          <span>Creat: <strong>{formatDateTime(data.user.createdAt)}</strong></span>
          <span>Actualizat: <strong>{formatDateTime(data.user.updatedAt)}</strong></span>
          <span>Ultima intrare pe site: <strong>{formatDateTime(data.user.lastSiteEnteredAt)}</strong></span>
          <span>Ultima activitate: <strong>{formatDateTime(data.user.lastActiveAt)}</strong></span>
        </div>
      </Section>
    </section>
  );
}
