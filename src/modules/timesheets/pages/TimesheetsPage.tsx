import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CircleDot,
  Columns3,
  Download,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  MapPinned,
  Plus,
  Search,
  TimerReset,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUserItem } from "../../../types/user";
import { formatMinutes, getTimesheetsManagementList } from "../services/timesheetsService";
import { getAllUsers } from "../../users/services/usersService";
import UserProfileLink from "../../../components/UserProfileLink";
import KpiCard from "../../../components/KpiCard";
import FilterBar from "../../../components/FilterBar";
import {
  DetailsDrawer,
  ErrorState,
  LoadingState,
  PageHeader,
  PageLayout,
  PermissionState,
} from "../../../components/experience";
import ProductTabs from "../../../components/product/ProductTabs";
import StatusBadge from "../../../components/StatusBadge";
import DataTable, { type DataTableColumn } from "../../../components/DataTable";
import EmptyState from "../../../components/EmptyState";
import UserSummaryCard from "../../../components/UserSummaryCard";
import TimesheetChartCard from "../../../components/TimesheetChartCard";
import {
  buildDayMinuteBuckets,
  buildProjectMinuteBuckets,
  buildStatusBuckets,
  buildUserMinuteBuckets,
  buildUserTimesheetIndex,
  getEffectiveWorkedMinutes,
  getActiveTimesheetsNow,
  getActiveUsersNow,
  getLocalDateKey,
  getLocalMonthKey,
  getProjectLabel,
  getTimesheetMinutesForDay,
  getTimesheetMinutesForRange,
  getTimesheetPeriodRange,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
  getUserDisplayName,
  getUserTimesheetSummary,
  isIncompleteTimesheet,
  isStaleActiveTimesheet,
  isTimesheetInRange,
  sumTimesheetMinutes,
  sumTimesheetMinutesForDay,
  type TimesheetPeriodKey,
} from "../utils/timesheetAnalytics";
import { formatTimesheetLocation } from "../utils/timesheetLocation";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { subscribeTimesheetsChanged } from "../services/timesheetLiveUpdates";

type SortKey = "date" | "employee" | "department" | "project" | "duration" | "status";
type TimesheetManagerView =
  "overview" | "active" | "all" | "employees" | "projects" | "exceptions" | "reports";

type SavedTimesheetFilter = {
  period: TimesheetPeriodKey;
  userFilter: string;
  projectFilter: string;
  statusFilter: string;
  departmentFilter: string;
  activeOnly: boolean;
  incompleteOnly: boolean;
};

const TIMESHEET_VIEWS = new Set<TimesheetManagerView>([
  "overview",
  "active",
  "all",
  "employees",
  "projects",
  "exceptions",
  "reports",
]);
const TIMESHEET_FILTER_STORAGE_KEY = "workcontrol:timesheets:manager-filter";
const DEFAULT_COLUMN_KEYS = new Set([
  "date",
  "employee",
  "department",
  "project",
  "start",
  "stop",
  "duration",
  "status",
  "actions",
]);

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ro-RO");
}

function formatTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function getUserId(user: AppUserItem) {
  return user.uid || user.id;
}

function getUserMeta(usersById: Map<string, AppUserItem>, item: TimesheetItem) {
  return usersById.get(item.userId);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\n;]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, rows: Array<Array<unknown>>) {
  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function TimesheetsPage() {
  const { role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<TimesheetPeriodKey>("today");
  const [customFrom, setCustomFrom] = useState(getLocalDateKey());
  const [customTo, setCustomTo] = useState(getLocalDateKey());
  const [userFilter, setUserFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [previewTimesheet, setPreviewTimesheet] = useState<TimesheetItem | null>(null);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(
    () => new Set(DEFAULT_COLUMN_KEYS)
  );
  const [savedFilter, setSavedFilter] = useState<SavedTimesheetFilter | null>(() => {
    try {
      const stored = window.localStorage.getItem(TIMESHEET_FILTER_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as SavedTimesheetFilter) : null;
    } catch {
      return null;
    }
  });

  const assistantParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const activeView = useMemo<TimesheetManagerView>(() => {
    const requested = assistantParams.get("view") as TimesheetManagerView | null;
    return requested && TIMESHEET_VIEWS.has(requested) ? requested : "overview";
  }, [assistantParams]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [timesheetsData, usersData] = await Promise.all([
          getTimesheetsManagementList(),
          getAllUsers(),
        ]);
        if (cancelled) return;
        setTimesheets(timesheetsData);
        setUsers(usersData);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Nu am putut incarca pontajele.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const unsubscribe = subscribeTimesheetsChanged(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!timesheets.some((item) => item.status === "activ")) return undefined;
    setLiveClock(Date.now());
    const timer = window.setInterval(() => setLiveClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [timesheets]);

  useEffect(() => {
    const assistantSearch = assistantParams.get("assistantSearch") || "";
    const assistantUserId = assistantParams.get("assistantUserId") || "";
    const assistantPeriod = assistantParams.get("period") || "";
    const assistantMode = assistantParams.get("assistant") || "";

    if (assistantSearch) setSearch(assistantSearch);
    if (assistantUserId) {
      setUserFilter(assistantUserId);
      setSelectedUserId(assistantUserId);
    }
    if (assistantPeriod === "today" || assistantMode === "today") setPeriod("today");
    if (assistantPeriod === "month") setPeriod("month");
    if (assistantMode === "active") setActiveOnly(true);
    if (assistantMode === "no-project") setProjectFilter("__no_project__");
  }, [assistantParams]);

  function handleViewChange(nextView: string) {
    if (!TIMESHEET_VIEWS.has(nextView as TimesheetManagerView)) return;
    const params = new URLSearchParams(location.search);
    params.set("view", nextView);
    if (nextView === "active") {
      setActiveOnly(true);
      setIncompleteOnly(false);
      setPeriod("today");
    } else if (nextView === "exceptions") {
      setActiveOnly(false);
      setIncompleteOnly(true);
      setPeriod("month");
    } else if (nextView === "reports") {
      setActiveOnly(false);
      setIncompleteOnly(false);
      setPeriod("month");
    } else {
      setActiveOnly(false);
      setIncompleteOnly(false);
    }
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }

  function saveCurrentFilter() {
    const next: SavedTimesheetFilter = {
      period,
      userFilter,
      projectFilter,
      statusFilter,
      departmentFilter,
      activeOnly,
      incompleteOnly,
    };
    window.localStorage.setItem(TIMESHEET_FILTER_STORAGE_KEY, JSON.stringify(next));
    setSavedFilter(next);
  }

  function applySavedFilter() {
    if (!savedFilter) return;
    setPeriod(savedFilter.period);
    setUserFilter(savedFilter.userFilter);
    setProjectFilter(savedFilter.projectFilter);
    setStatusFilter(savedFilter.statusFilter);
    setDepartmentFilter(savedFilter.departmentFilter);
    setActiveOnly(savedFilter.activeOnly);
    setIncompleteOnly(savedFilter.incompleteOnly);
  }

  const usersById = useMemo(() => {
    const map = new Map<string, AppUserItem>();
    users.forEach((item) => map.set(getUserId(item), item));
    return map;
  }, [users]);

  const periodRange = useMemo(
    () => getTimesheetPeriodRange(period, customFrom, customTo),
    [customFrom, customTo, period]
  );
  const operationalTimesheets = useMemo(
    () => timesheets.filter((item) => !isStaleActiveTimesheet(item, liveClock)),
    [liveClock, timesheets]
  );
  const displayRange = period === "all" ? undefined : periodRange;
  const getDisplayMinutesForTimesheet = useCallback(
    (item: TimesheetItem) =>
      displayRange
        ? getTimesheetMinutesForRange(item, displayRange, liveClock)
        : getEffectiveWorkedMinutes(item, liveClock),
    [displayRange, liveClock]
  );

  const allProjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of operationalTimesheets) {
      const key = item.projectId || item.projectName || item.projectCode || "__no_project__";
      map.set(key, getProjectLabel(item));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [operationalTimesheets]);

  const departments = useMemo(
    () =>
      [
        ...new Set(
          users.map((item) => item.department).filter((item): item is string => Boolean(item))
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [users]
  );

  const filteredTimesheets = useMemo(() => {
    const q = normalizeSearchText(search);

    return operationalTimesheets.filter((item) => {
      const userItem = getUserMeta(usersById, item);
      const department = userItem?.department || "";
      const projectKey = item.projectId || item.projectName || item.projectCode || "__no_project__";

      if (!activeOnly && !isTimesheetInRange(item, periodRange, liveClock)) return false;
      if (userFilter && item.userId !== userFilter) return false;
      if (projectFilter && projectKey !== projectFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (departmentFilter && department !== departmentFilter) return false;
      if (activeOnly && item.status !== "activ") return false;
      if (incompleteOnly && !isIncompleteTimesheet(item)) return false;

      if (!q) return true;
      return (
        normalizeSearchText(item.userName).includes(q) ||
        normalizeSearchText(getProjectLabel(item)).includes(q) ||
        normalizeSearchText(item.status).includes(q) ||
        normalizeSearchText(department).includes(q) ||
        normalizeSearchText(formatTimesheetLocation(item.startLocation)).includes(q) ||
        normalizeSearchText(formatTimesheetLocation(item.stopLocation)).includes(q)
      );
    });
  }, [
    activeOnly,
    departmentFilter,
    incompleteOnly,
    liveClock,
    periodRange,
    projectFilter,
    search,
    statusFilter,
    operationalTimesheets,
    userFilter,
    usersById,
  ]);

  const sortedTimesheets = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...filteredTimesheets].sort((a, b) => {
      if (sortKey === "employee") return multiplier * a.userName.localeCompare(b.userName);
      if (sortKey === "department") {
        return (
          multiplier *
          (usersById.get(a.userId)?.department || "").localeCompare(
            usersById.get(b.userId)?.department || ""
          )
        );
      }
      if (sortKey === "project")
        return multiplier * getProjectLabel(a).localeCompare(getProjectLabel(b));
      if (sortKey === "duration")
        return multiplier * (getDisplayMinutesForTimesheet(a) - getDisplayMinutesForTimesheet(b));
      if (sortKey === "status") return multiplier * a.status.localeCompare(b.status);
      return multiplier * ((a.startAt || 0) - (b.startAt || 0));
    });
  }, [filteredTimesheets, getDisplayMinutesForTimesheet, sortDirection, sortKey, usersById]);

  const pageSize = 18;
  const totalPages = Math.max(1, Math.ceil(sortedTimesheets.length / pageSize));
  const pagedTimesheets = useMemo(
    () => sortedTimesheets.slice((page - 1) * pageSize, page * pageSize),
    [page, sortedTimesheets]
  );

  useEffect(() => {
    setPage(1);
  }, [
    activeOnly,
    departmentFilter,
    incompleteOnly,
    period,
    projectFilter,
    search,
    statusFilter,
    userFilter,
  ]);

  const todayKey = getLocalDateKey(liveClock);
  const monthKey = getLocalMonthKey(liveClock);
  const todayItems = useMemo(
    () =>
      operationalTimesheets.filter(
        (item) =>
          item.workDate === todayKey || getTimesheetMinutesForDay(item, todayKey, liveClock) > 0
      ),
    [liveClock, operationalTimesheets, todayKey]
  );
  const monthItems = useMemo(
    () => operationalTimesheets.filter((item) => item.yearMonth === monthKey),
    [monthKey, operationalTimesheets]
  );
  const activeNow = useMemo(
    () => getActiveTimesheetsNow(operationalTimesheets),
    [operationalTimesheets]
  );
  const activeUsersNow = useMemo(
    () => getActiveUsersNow(operationalTimesheets),
    [operationalTimesheets]
  );
  const todayOperationalItems = useMemo(() => {
    const byId = new Map(todayItems.map((item) => [item.id, item]));
    activeNow.forEach((item) => byId.set(item.id, item));
    return [...byId.values()];
  }, [activeNow, todayItems]);
  const todayMinutes = useMemo(
    () => sumTimesheetMinutesForDay(todayOperationalItems, todayKey, liveClock),
    [liveClock, todayKey, todayOperationalItems]
  );
  const incompleteItems = useMemo(
    () => filteredTimesheets.filter(isIncompleteTimesheet),
    [filteredTimesheets]
  );
  const topProject = useMemo(
    () => buildProjectMinuteBuckets(filteredTimesheets, liveClock, 1, displayRange)[0],
    [displayRange, filteredTimesheets, liveClock]
  );

  const userTimesheetIndex = useMemo(
    () => buildUserTimesheetIndex(filteredTimesheets),
    [filteredTimesheets]
  );
  const selectedUser = useMemo(
    () => users.find((item) => getUserId(item) === (selectedUserId || userFilter)) ?? null,
    [selectedUserId, userFilter, users]
  );
  const selectedUserItems = selectedUser
    ? (userTimesheetIndex.get(getUserId(selectedUser)) ?? [])
    : [];
  const selectedUserSummary = selectedUser
    ? getUserTimesheetSummary({
        user: selectedUser,
        items: selectedUserItems,
        range: periodRange,
        nowTs: liveClock,
      })
    : null;

  const columns = useMemo<DataTableColumn<TimesheetItem>[]>(
    () => [
      {
        key: "select",
        header: "Selecteaza",
        render: (item) => (
          <input
            type="checkbox"
            aria-label={`Selecteaza pontajul ${item.userName || item.id}`}
            checked={selectedIds.has(item.id)}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelectedIds((current) => {
                const next = new Set(current);
                if (checked) next.add(item.id);
                else next.delete(item.id);
                return next;
              });
            }}
          />
        ),
      },
      {
        key: "date",
        header: "Data",
        sortable: true,
        render: (item) => item.workDate || formatDateTime(item.startAt),
      },
      {
        key: "employee",
        header: "Angajat",
        sortable: true,
        render: (item) => {
          const userItem = usersById.get(item.userId);
          const themeClass = getUserThemeClass(item.userThemeKey ?? userItem?.themeKey ?? null);
          return (
            <button
              type="button"
              className={`wc-person-cell wc-person-cell--button user-history-row ${themeClass}`}
              onClick={() => setSelectedUserId(item.userId)}
            >
              <span className="user-accent-avatar">{getUserInitials(item.userName || "U")}</span>
              <span>
                <UserProfileLink
                  userId={item.userId}
                  name={item.userName || userItem?.fullName}
                  themeKey={item.userThemeKey ?? userItem?.themeKey}
                  className="user-accent-name"
                />
                <small>{userItem?.roleTitle || userItem?.email || "-"}</small>
              </span>
            </button>
          );
        },
      },
      {
        key: "department",
        header: "Departament",
        sortable: true,
        render: (item) => usersById.get(item.userId)?.department || "-",
      },
      {
        key: "project",
        header: "Proiect",
        sortable: true,
        render: (item) => getProjectLabel(item),
      },
      { key: "start", header: "Start", render: (item) => formatTime(item.startAt) },
      { key: "stop", header: "Stop", render: (item) => formatTime(item.stopAt) },
      {
        key: "duration",
        header: "Durata",
        sortable: true,
        render: (item) => formatMinutes(getDisplayMinutesForTimesheet(item)),
      },
      { key: "break", header: "Pauza", render: () => "-" },
      {
        key: "startLocation",
        header: "Locatie start",
        render: (item) => formatTimesheetLocation(item.startLocation) || "-",
      },
      {
        key: "stopLocation",
        header: "Locatie stop",
        render: (item) => formatTimesheetLocation(item.stopLocation) || "-",
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        render: (item) => (
          <StatusBadge tone={getTimesheetStatusTone(item.status)}>
            {getTimesheetStatusLabel(item.status)}
          </StatusBadge>
        ),
      },
      {
        key: "notes",
        header: "Observatii",
        render: (item) => item.explanation || item.startExplanation || item.stopExplanation || "-",
      },
      {
        key: "actions",
        header: "Actiuni",
        render: (item) => (
          <div className="wc-table-actions">
            <button
              type="button"
              className="secondary-btn secondary-btn--compact"
              onClick={() => setPreviewTimesheet(item)}
            >
              Detalii
            </button>
            <Link to={`/timesheets/${item.id}`} className="secondary-btn secondary-btn--compact">
              Editeaza
            </Link>
            {item.status === "activ" ? (
              <Link to={`/timesheets/${item.id}`} className="danger-btn danger-btn--compact">
                Inchide
              </Link>
            ) : null}
            <Link to={`/timesheets/${item.id}`} className="secondary-btn secondary-btn--compact">
              Observatie
            </Link>
            <Link to={`/timesheets/${item.id}`} className="secondary-btn secondary-btn--compact">
              <MapPinned size={13} /> Harta
            </Link>
          </div>
        ),
      },
    ],
    [getDisplayMinutesForTimesheet, selectedIds, usersById]
  );

  const displayedColumns = useMemo(
    () => columns.filter((column) => column.key === "select" || visibleColumnKeys.has(column.key)),
    [columns, visibleColumnKeys]
  );

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key as SortKey);
    setSortDirection("desc");
  }

  function handleExport(items = filteredTimesheets, fileName = "pontaje.csv") {
    downloadCsv(fileName, [
      [
        "Data",
        "Angajat",
        "Departament",
        "Proiect",
        "Start",
        "Stop",
        "Durata",
        "Status",
        "Locatie start",
        "Locatie stop",
        "Observatii",
      ],
      ...items.map((item) => {
        const userItem = usersById.get(item.userId);
        return [
          item.workDate,
          item.userName,
          userItem?.department || "",
          getProjectLabel(item),
          formatDateTime(item.startAt),
          formatDateTime(item.stopAt),
          formatMinutes(getDisplayMinutesForTimesheet(item)),
          getTimesheetStatusLabel(item.status),
          formatTimesheetLocation(item.startLocation),
          formatTimesheetLocation(item.stopLocation),
          item.explanation || item.startExplanation || item.stopExplanation || "",
        ];
      }),
    ]);
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <PageLayout className="timesheets-management-page">
        <PermissionState message="Dashboard-ul global de pontaje este disponibil doar pentru admin sau manager." />
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout className="timesheets-management-page">
        <LoadingState
          title="Se incarca pontajele"
          description="Pregatim situatia echipei si proiectelor."
        />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout className="timesheets-management-page">
        <ErrorState
          title="Pontajele nu au putut fi incarcate"
          description={loadError}
          retry={() => window.location.reload()}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout className="timesheets-management-page">
      <PageHeader
        eyebrow="Echipă și pontaje"
        title="Pontaje"
        description="Orele lucrate, proiectele și activitatea echipei, fără filtre ascunse."
        actions={[
          {
            id: "export",
            label: "Export Excel",
            icon: FileSpreadsheet,
            onClick: () => handleExport(),
            assistantAction: "export-timesheets",
          },
          {
            id: "monthly",
            label: "Raport lunar",
            icon: CalendarDays,
            onClick: () => setPeriod("month"),
            assistantAction: "timesheets-month",
          },
          {
            id: "manual",
            label: "Pontaj manual",
            icon: Plus,
            to: "/my-timesheets",
            assistantAction: "add-manual-timesheet",
          },
          {
            id: "active",
            label: "Pontaje active",
            icon: TimerReset,
            tone: "primary",
            onClick: () => setActiveOnly(true),
            assistantAction: "open-active-timesheets",
          },
        ]}
      />

      <ProductTabs
        activeId={activeView}
        onChange={handleViewChange}
        tabs={[
          { id: "overview", label: "Overview", icon: LayoutDashboard },
          { id: "active", label: "Active acum", icon: CircleDot, badge: activeNow.length },
          { id: "all", label: "Toate pontajele", icon: CalendarDays },
          { id: "employees", label: "Angajati", icon: Users, badge: users.length },
          { id: "projects", label: "Proiecte", icon: BriefcaseBusiness, to: "/projects" },
          { id: "exceptions", label: "Exceptii", icon: AlertCircle, badge: incompleteItems.length },
          { id: "reports", label: "Rapoarte", icon: BarChart3 },
        ]}
        label="Sectiuni management pontaje"
      />

      <div className="wc-kpi-grid wc-kpi-grid--five" hidden={activeView !== "overview"}>
        <KpiCard
          label="Total ore azi"
          value={formatMinutes(todayMinutes)}
          helper={`${todayOperationalItems.length} pontaje`}
          tone="green"
          icon={TimerReset}
        />
        <KpiCard
          label="Total ore luna curenta"
          value={formatMinutes(sumTimesheetMinutes(monthItems))}
          helper={`${monthItems.length} pontaje`}
          tone="blue"
          icon={CalendarDays}
        />
        <KpiCard
          label="Angajati activi azi"
          value={activeUsersNow.size}
          helper={`${activeNow.length} pontaje active`}
          tone="blue"
          icon={Users}
        />
        <KpiCard
          label="Pontaje incomplete"
          value={incompleteItems.length}
          helper={incompleteItems.length ? "necesita inchidere" : "niciun blocaj"}
          tone={incompleteItems.length ? "orange" : "green"}
          icon={Filter}
        />
        <KpiCard
          label="Proiect top"
          value={topProject?.label || "-"}
          helper={topProject?.displayValue || "fara ore"}
          tone="purple"
          icon={UserRound}
        />
      </div>

      <div
        className="wc-filter-drawer wc-filter-drawer--always-open"
        hidden={
          !(["all", "active", "exceptions", "reports"] as TimesheetManagerView[]).includes(
            activeView
          )
        }
      >
        <FilterBar
          title="Filtre pontaje"
          subtitle={periodRange.label}
          dataAssistantSection="timesheets-filters"
        >
          <label>
            Perioada
            <select
              className="tool-input"
              value={period}
              onChange={(event) => setPeriod(event.target.value as TimesheetPeriodKey)}
            >
              <option value="today">Azi</option>
              <option value="yesterday">Ieri</option>
              <option value="week">Saptamana asta</option>
              <option value="month">Luna asta</option>
              <option value="custom">Custom</option>
              <option value="all">Toate</option>
            </select>
          </label>
          {period === "custom" ? (
            <>
              <label>
                De la
                <input
                  className="tool-input"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label>
                Pana la
                <input
                  className="tool-input"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label data-assistant-action="filter-timesheets-user">
            User
            <select
              className="tool-input"
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="">Toti userii</option>
              {users.map((item) => (
                <option key={getUserId(item)} value={getUserId(item)}>
                  {getUserDisplayName(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Proiect
            <select
              className="tool-input"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="">Toate proiectele</option>
              <option value="__no_project__">Fara proiect</option>
              {allProjects
                .filter(([key]) => key !== "__no_project__")
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Status
            <select
              className="tool-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Toate statusurile</option>
              <option value="activ">Activ</option>
              <option value="inchis">Inchis</option>
              <option value="corectat">Corectat</option>
              <option value="neinchis">Incomplet</option>
              <option value="intarziat">Intarziat</option>
            </select>
          </label>
          <label>
            Departament
            <select
              className="tool-input"
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
            >
              <option value="">Toate departamentele</option>
              {departments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="wc-filter-check">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            Doar active
          </label>
          <label className="wc-filter-check">
            <input
              type="checkbox"
              checked={incompleteOnly}
              onChange={(event) => setIncompleteOnly(event.target.checked)}
            />
            Doar incomplete
          </label>
          <label className="wc-filter-search">
            <Search size={15} />
            <input
              className="tool-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cauta user, proiect, status sau locatie"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            data-assistant-action="filter-timesheets-today"
            onClick={() => setPeriod("today")}
          >
            Azi
          </button>
          <button type="button" className="secondary-btn" onClick={saveCurrentFilter}>
            Salveaza filtrul
          </button>
          {savedFilter ? (
            <button type="button" className="secondary-btn" onClick={applySavedFilter}>
              Aplica filtrul salvat
            </button>
          ) : null}
        </FilterBar>
      </div>

      <div className="panel" hidden={activeView !== "employees"}>
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Vizualizare rapida angajat</h2>
            <p className="panel-subtitle">
              Selecteaza un angajat si vezi imediat ore, proiecte si zile lipsa.
            </p>
          </div>
          <select
            className="tool-input wc-employee-select"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
          >
            <option value="">Selecteaza angajat</option>
            {users.map((item) => (
              <option key={getUserId(item)} value={getUserId(item)}>
                {getUserDisplayName(item)}
              </option>
            ))}
          </select>
        </div>
        {selectedUser && selectedUserSummary ? (
          <UserSummaryCard
            user={selectedUser}
            stats={[
              {
                label: "Total ore",
                value: formatMinutes(selectedUserSummary.totalMinutes),
                tone: "green",
              },
              {
                label: "Media / zi",
                value: formatMinutes(selectedUserSummary.averageMinutesPerDay),
                tone: "blue",
              },
              { label: "Proiecte", value: selectedUserSummary.projectCount, tone: "muted" },
              {
                label: "Zile lipsa",
                value: selectedUserSummary.missingDays.length,
                tone: selectedUserSummary.missingDays.length ? "red" : "green",
              },
              {
                label: "Incomplete",
                value: selectedUserSummary.incomplete.length,
                tone: selectedUserSummary.incomplete.length ? "orange" : "green",
              },
            ]}
            actions={
              <>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setUserFilter(getUserId(selectedUser))}
                >
                  Vezi toate pontajele
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    handleExport(
                      selectedUserItems,
                      `pontaje-${getUserDisplayName(selectedUser)}.csv`
                    )
                  }
                >
                  <Download size={15} /> Export pontaj angajat
                </button>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={UserRound}
            title="Alege un angajat"
            subtitle="Dupa selectare apar total ore, proiecte, zile lipsa si pontaje incomplete."
          />
        )}
      </div>

      <div
        className="content-grid timesheet-chart-grid"
        hidden={activeView !== "overview" && activeView !== "reports"}
      >
        <TimesheetChartCard
          title="Ore lucrate pe zile"
          subtitle={periodRange.label}
          bars={buildDayMinuteBuckets(filteredTimesheets, liveClock)}
        />
        <TimesheetChartCard
          title="Ore pe proiecte"
          bars={buildProjectMinuteBuckets(filteredTimesheets, liveClock, 6, displayRange)}
        />
        <TimesheetChartCard
          title="Prezenta echipa azi"
          bars={[
            {
              label: "Pontati",
              value: new Set(todayItems.map((item) => item.userId)).size,
              tone: "green",
            },
            {
              label: "Nepontati",
              value: Math.max(
                0,
                users.filter((item) => item.active !== false).length -
                  new Set(todayItems.map((item) => item.userId)).size
              ),
              tone: "red",
            },
            {
              label: "Zi inchisa",
              value: todayItems.filter(
                (item) => item.status === "inchis" || item.status === "corectat"
              ).length,
              tone: "blue",
            },
          ]}
        />
        <TimesheetChartCard
          title="Ore per utilizator"
          bars={buildUserMinuteBuckets(filteredTimesheets, liveClock, 8, displayRange)}
        />
        <TimesheetChartCard title="Statusuri" bars={buildStatusBuckets(filteredTimesheets)} />
      </div>

      <div
        className="panel"
        hidden={!(["active", "all", "exceptions"] as TimesheetManagerView[]).includes(activeView)}
      >
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Tabel avansat pontaje</h2>
            <p className="panel-subtitle">
              {filteredTimesheets.length} rezultate in perioada selectata.
            </p>
          </div>
          <div className="wc-table-management-actions">
            {selectedIds.size ? (
              <>
                <StatusBadge tone="blue">{selectedIds.size} selectate</StatusBadge>
                <button
                  type="button"
                  className="secondary-btn secondary-btn--compact"
                  onClick={() =>
                    handleExport(
                      filteredTimesheets.filter((item) => selectedIds.has(item.id)),
                      "pontaje-selectate.csv"
                    )
                  }
                >
                  <Download size={14} /> Exporta selectia
                </button>
                <button
                  type="button"
                  className="secondary-btn secondary-btn--compact"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Goleste selectia
                </button>
              </>
            ) : null}
            <details className="wc-column-picker">
              <summary>
                <Columns3 size={15} /> Coloane
              </summary>
              <div>
                {columns
                  .filter((column) => column.key !== "select")
                  .map((column) => (
                    <label key={column.key}>
                      <input
                        type="checkbox"
                        checked={visibleColumnKeys.has(column.key)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setVisibleColumnKeys((current) => {
                            const next = new Set(current);
                            if (checked) next.add(column.key);
                            else next.delete(column.key);
                            return next;
                          });
                        }}
                      />
                      {column.header}
                    </label>
                  ))}
              </div>
            </details>
            <StatusBadge tone="blue">
              Pagina {page}/{totalPages}
            </StatusBadge>
          </div>
        </div>
        <DataTable
          columns={displayedColumns}
          rows={pagedTimesheets}
          rowKey={(item) => item.id}
          rowClassName={(item) => `timesheet-row-status-${item.status}`}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          empty={<EmptyState icon={TimerReset} title="Nu exista pontaje pentru filtrul curent" />}
        />

        <div className="wc-mobile-card-list">
          {pagedTimesheets.map((item) => {
            const userItem = usersById.get(item.userId);
            const themeClass = getUserThemeClass(item.userThemeKey ?? userItem?.themeKey ?? null);
            return (
              <Link
                key={item.id}
                to={`/timesheets/${item.id}`}
                className={`wc-timesheet-mobile-card user-history-row ${themeClass}`}
              >
                <div>
                  <strong>{item.userName || userItem?.fullName || "Utilizator"}</strong>
                  <StatusBadge tone={getTimesheetStatusTone(item.status)}>
                    {getTimesheetStatusLabel(item.status)}
                  </StatusBadge>
                </div>
                <p>
                  {getProjectLabel(item)} - {item.workDate}
                </p>
                <p>
                  {formatTime(item.startAt)} - {formatTime(item.stopAt)} /{" "}
                  {formatMinutes(getDisplayMinutesForTimesheet(item))}
                </p>
                <small>{formatTimesheetLocation(item.startLocation) || "-"}</small>
              </Link>
            );
          })}
        </div>

        <div className="wc-pagination">
          <button
            type="button"
            className="secondary-btn"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Inapoi
          </button>
          <span>
            {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, sortedTimesheets.length)} din{" "}
            {sortedTimesheets.length}
          </span>
          <button
            type="button"
            className="secondary-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Inainte
          </button>
        </div>
      </div>

      {activeView === "employees" && selectedUser && selectedUserSummary ? (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Detalii pontaj utilizator</h2>
              <p className="panel-subtitle">
                {getUserDisplayName(selectedUser)} - {periodRange.label}
              </p>
            </div>
          </div>
          <div className="content-grid">
            <TimesheetChartCard
              title="Ore lucrate pe zile"
              bars={buildDayMinuteBuckets(selectedUserItems, liveClock)}
            />
            <TimesheetChartCard
              title="Ore pe proiecte"
              bars={buildProjectMinuteBuckets(selectedUserItems, liveClock, 6, displayRange)}
            />
          </div>
          <div className="content-grid" style={{ marginTop: 16 }}>
            <div className="tool-inner-panel">
              <h3 className="panel-title">Zile fara pontaj</h3>
              {selectedUserSummary.missingDays.length ? (
                <div className="wc-chip-list">
                  {selectedUserSummary.missingDays.slice(0, 20).map((day) => (
                    <span key={day} className="badge badge-red">
                      {day}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Nu exista zile lipsa in perioada selectata.</p>
              )}
            </div>
            <div className="tool-inner-panel">
              <h3 className="panel-title">Pontaje incomplete</h3>
              {selectedUserSummary.incomplete.length ? (
                <div className="simple-list">
                  {selectedUserSummary.incomplete.slice(0, 6).map((item) => (
                    <Link key={item.id} to={`/timesheets/${item.id}`} className="simple-list-item">
                      <div className="simple-list-text">
                        <div className="simple-list-label">{getProjectLabel(item)}</div>
                        <div className="simple-list-subtitle">
                          {item.workDate} - {formatTime(item.startAt)}
                        </div>
                      </div>
                      <StatusBadge tone={getTimesheetStatusTone(item.status)}>
                        {getTimesheetStatusLabel(item.status)}
                      </StatusBadge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Niciun pontaj incomplet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <DetailsDrawer
        open={Boolean(previewTimesheet)}
        title={
          previewTimesheet
            ? `Pontaj ${previewTimesheet.userName || "utilizator"}`
            : "Detalii pontaj"
        }
        description={
          previewTimesheet
            ? `${previewTimesheet.workDate} - ${getProjectLabel(previewTimesheet)}`
            : undefined
        }
        onClose={() => setPreviewTimesheet(null)}
      >
        {previewTimesheet ? (
          <div className="wc-operational-detail-list">
            <div>
              <span>Status</span>
              <StatusBadge tone={getTimesheetStatusTone(previewTimesheet.status)}>
                {getTimesheetStatusLabel(previewTimesheet.status)}
              </StatusBadge>
            </div>
            <div>
              <span>Interval</span>
              <strong>
                {formatTime(previewTimesheet.startAt)} - {formatTime(previewTimesheet.stopAt)}
              </strong>
            </div>
            <div>
              <span>Durata</span>
              <strong>{formatMinutes(getDisplayMinutesForTimesheet(previewTimesheet))}</strong>
            </div>
            <div>
              <span>Locatie start</span>
              <strong>{formatTimesheetLocation(previewTimesheet.startLocation) || "-"}</strong>
            </div>
            <div>
              <span>Locatie stop</span>
              <strong>{formatTimesheetLocation(previewTimesheet.stopLocation) || "-"}</strong>
            </div>
            <Link className="primary-btn" to={`/timesheets/${previewTimesheet.id}`}>
              Deschide fisa completa
            </Link>
          </div>
        ) : null}
      </DetailsDrawer>
    </PageLayout>
  );
}
