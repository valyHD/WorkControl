import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectFormValues,
  ProjectItem,
  TimesheetItem,
  TimesheetLocation,
} from "../../../types/timesheet";
import { useAuth } from "../../../providers/AuthProvider";
import {
  computeTimesheetStats,
  createProject,
  formatMinutes,
  getActiveProjectsList,
  getActiveTimesheetForUser,
  getTimesheetsForUser,
  getUserTimesheetProjectPreference,
  saveUserTimesheetProjectPreference,
  startTimesheet,
  stopTimesheet,
} from "../services/timesheetsService";
import TimesheetForm from "../components/TimesheetForm";
import TimesheetCalendar from "../components/TimesheetCalendar";
import ProjectForm from "../components/ProjectForm";
import { Link } from "react-router-dom";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { formatTimesheetLocation } from "../utils/timesheetLocation";
import { subscribeNotificationRules } from "../../notifications/services/notificationRulesService";
import type { NotificationRuleItem } from "../../../types/notification-rule";
import type { LeaveRequestItem } from "../../../types/leave";
import { getLeaveRequestsForUser } from "../../leave/services/leaveRequestsService";
import KpiCard from "../../../components/KpiCard";
import { PageHeader, PageLayout } from "../../../components/experience";
import TimesheetStatusCard from "../../../components/TimesheetStatusCard";
import TimesheetChartCard from "../../../components/TimesheetChartCard";
import StatusBadge from "../../../components/StatusBadge";
import EmptyState from "../../../components/EmptyState";
import {
  buildDayMinuteBuckets,
  buildProjectMinuteBuckets,
  getEffectiveWorkedMinutes,
  getLocalDateKey,
  getMissingWorkdaysForUser,
  getTimesheetPeriodRange,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
  sumTimesheetMinutes,
} from "../utils/timesheetAnalytics";
import { CalendarDays, Clock3, TimerReset, TrendingUp, AlertTriangle } from "lucide-react";
import {
  getOfflineTimesheetQueue,
  getPendingOfflineTimesheetStart,
  flushOfflineTimesheetQueue,
  queueOfflineTimesheetStart,
  queueOfflineTimesheetStop,
  type OfflineTimesheetAction,
} from "../services/offlineTimesheetQueue";
import { useFeatureFlags } from "../../../lib/productIntelligence";

const TIMESHEETS_CHANGED_EVENT = "workcontrol:timesheets-changed";
const DEFAULT_START_ATTENTION_FROM_MINUTES = 7 * 60;
const DEFAULT_START_ATTENTION_TO_MINUTES = 9 * 60;
const DEFAULT_STOP_ATTENTION_FROM_MINUTES = 16 * 60;
const DEFAULT_STOP_ATTENTION_TO_MINUTES = 18 * 60 + 30;

function getProjectDisplayName(projectName?: string, projectCode?: string): string {
  const name = String(projectName ?? "").trim();
  const code = String(projectCode ?? "").trim();
  return name || code || "Fara proiect";
}

function getTimesheetProjectStorageKey(userId: string): string {
  return `workcontrol:last-timesheet-project:${userId}`;
}

function buildOfflineActiveTimesheet(action: Extract<OfflineTimesheetAction, { type: "start" }>): TimesheetItem {
  const workDate = getLocalDateKey(action.occurredAt);
  return {
    id: `offline:${action.id}`,
    userId: action.payload.userId,
    userName: action.payload.userName,
    userThemeKey: action.payload.userThemeKey ?? null,
    projectId: action.payload.projectId,
    projectCode: action.payload.projectCode,
    projectName: action.payload.projectName,
    status: "activ",
    explanation: action.payload.startExplanation || "",
    startExplanation: action.payload.startExplanation || "",
    startPolicyFlag: action.payload.startPolicyFlag || "",
    stopExplanation: "",
    stopPolicyFlag: "",
    startExpectedTime: action.payload.startExpectedTime || "",
    stopExpectedMinutes: null,
    startAt: action.occurredAt,
    stopAt: null,
    workedMinutes: 0,
    startLocation: action.payload.startLocation,
    stopLocation: null,
    startSource: "web",
    stopSource: "",
    workDate,
    yearMonth: workDate.slice(0, 7),
    weekKey: "",
    createdAt: action.occurredAt,
    updatedAt: action.occurredAt,
  };
}

function readSavedProjectId(userId: string): string {
  if (!userId) return "";
  try {
    return window.localStorage.getItem(getTimesheetProjectStorageKey(userId)) || "";
  } catch {
    return "";
  }
}

function writeSavedProjectId(userId: string, projectId: string) {
  if (!userId) return;
  try {
    const key = getTimesheetProjectStorageKey(userId);
    if (projectId) {
      window.localStorage.setItem(key, projectId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage poate fi blocat in unele browsere mobile.
  }
}

function parseClockMinutes(value: string, fallback: number): number {
  const [hoursRaw, minutesRaw] = String(value || "").split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function getTodayRuleWeekday(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function isMinuteInWindow(current: number, start: number, end: number) {
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function isRuleActiveToday(rule: NotificationRuleItem, date: Date) {
  if (!rule.enabled) return false;
  if (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0) return true;
  return rule.weekdays.includes(getTodayRuleWeekday(date));
}

function isTimesheetAttentionTime(
  rules: NotificationRuleItem[],
  mode: "start" | "stop",
  nowMs: number
) {
  const now = new Date(nowMs);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayIsWorkday = getTodayRuleWeekday(now) <= 5;
  const relevantRules = rules.filter(
    (rule) =>
      rule.module === "timesheets" &&
      isRuleActiveToday(rule, now) &&
      (rule.eventType === "timesheet_work_interval_reminder" ||
        rule.eventType === "timesheet_start_daily_reminder" ||
        rule.eventType === "timesheet_stop_after_8h_reminder")
  );

  if (relevantRules.length === 0) {
    return mode === "start"
      ? dayIsWorkday &&
          isMinuteInWindow(
            currentMinutes,
            DEFAULT_START_ATTENTION_FROM_MINUTES,
            DEFAULT_START_ATTENTION_TO_MINUTES
          )
      : dayIsWorkday &&
          isMinuteInWindow(
            currentMinutes,
            DEFAULT_STOP_ATTENTION_FROM_MINUTES,
            DEFAULT_STOP_ATTENTION_TO_MINUTES
          );
  }

  return relevantRules.some((rule) => {
    const activeMinutes = Math.max(0, Number(rule.reminderActiveMinutes || 120));
    const startMinutes = parseClockMinutes(rule.scheduleTime, DEFAULT_START_ATTENTION_FROM_MINUTES);
    const stopMinutes = parseClockMinutes(rule.stopTime, DEFAULT_STOP_ATTENTION_FROM_MINUTES);

    if (mode === "start") {
      if (rule.eventType === "timesheet_start_daily_reminder") {
        return isMinuteInWindow(
          currentMinutes,
          startMinutes,
          Math.min(1439, startMinutes + activeMinutes)
        );
      }
      if (rule.eventType === "timesheet_work_interval_reminder") {
        return isMinuteInWindow(currentMinutes, startMinutes, stopMinutes);
      }
      return false;
    }

    if (rule.eventType === "timesheet_stop_after_8h_reminder") {
      return isMinuteInWindow(
        currentMinutes,
        startMinutes,
        Math.min(1439, startMinutes + activeMinutes)
      );
    }
    if (rule.eventType === "timesheet_work_interval_reminder") {
      return isMinuteInWindow(
        currentMinutes,
        stopMinutes,
        Math.min(1439, stopMinutes + activeMinutes)
      );
    }
    return false;
  });
}

export default function MyTimesheetsPage() {
  const { user, role } = useAuth();
  const { flags } = useFeatureFlags();
  const canUseCustomTimesheetLocation =
    (user?.email || "").trim().toLowerCase() === "ionut.matura23@gmail.com";

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [activeTimesheet, setActiveTimesheet] = useState<TimesheetItem | null>(null);
  const [notificationRules, setNotificationRules] = useState<NotificationRuleItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [attentionClock, setAttentionClock] = useState(() => Date.now());

  const [loading, setLoading] = useState(true);
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [preferredProjectId, setPreferredProjectId] = useState("");
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState("");
  const offlineSyncInProgress = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (!user?.uid) return;

      if (!silent) {
        setLoading(true);
      }
      try {
        const [projectsData, timesheetsData, activeData, savedProjectId, leaveData] =
          await Promise.all([
            getActiveProjectsList(),
            getTimesheetsForUser(user.uid),
            getActiveTimesheetForUser(user.uid),
            getUserTimesheetProjectPreference(user.uid),
            getLeaveRequestsForUser(user.uid, 20),
          ]);
        const fallbackProjectId = readSavedProjectId(user.uid);
        const nextPreferredProjectId =
          [fallbackProjectId, savedProjectId].find((projectId) =>
            projectsData.some((project) => project.id === projectId)
          ) || "";

        setProjects(projectsData);
        setTimesheets(timesheetsData);
        setActiveTimesheet(activeData);
        setLeaveRequests(leaveData);
        setPreferredProjectId(nextPreferredProjectId);
      } finally {
        setLoading(false);
      }
    },
    [user?.uid]
  );

  const refreshOfflineState = useCallback(() => {
    if (!user?.uid) return;
    const queue = getOfflineTimesheetQueue(user.uid);
    const queuedStart = getPendingOfflineTimesheetStart(user.uid);
    setOfflineQueueCount(queue.length);
    if (queuedStart) {
      setActiveTimesheet((current) => current && !current.id.startsWith("offline:")
        ? current
        : buildOfflineActiveTimesheet(queuedStart));
    }
  }, [user?.uid]);

  const syncOfflineActions = useCallback(async () => {
    if (!user?.uid || !navigator.onLine || offlineSyncInProgress.current) return;
    const queue = getOfflineTimesheetQueue(user.uid);
    if (!queue.length) return;
    offlineSyncInProgress.current = true;
    setOfflineStatus("Se sincronizeaza actiunile de pontaj salvate offline...");
    try {
      await flushOfflineTimesheetQueue(user.uid);
      setOfflineStatus("Pontajele offline au fost sincronizate.");
      await load(true);
    } catch (error) {
      console.warn("[MyTimesheetsPage][offline-sync]", error);
      setOfflineStatus("Sincronizarea pontajului asteapta o conexiune stabila.");
    } finally {
      offlineSyncInProgress.current = false;
      refreshOfflineState();
    }
  }, [load, refreshOfflineState, user?.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    refreshOfflineState();
    const handleQueue = () => refreshOfflineState();
    const handleOnline = () => void syncOfflineActions();
    window.addEventListener("workcontrol:offline-timesheet-queue", handleQueue);
    window.addEventListener("online", handleOnline);
    if (navigator.onLine) void syncOfflineActions();
    return () => {
      window.removeEventListener("workcontrol:offline-timesheet-queue", handleQueue);
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshOfflineState, syncOfflineActions]);

  useEffect(() => {
    return subscribeNotificationRules(setNotificationRules, (error) =>
      console.warn("[MyTimesheetsPage][notification rules]", error)
    );
  }, []);

  useEffect(() => {
    setAttentionClock(Date.now());
    const timer = window.setInterval(
      () => setAttentionClock(Date.now()),
      activeTimesheet ? 1_000 : 60_000
    );
    return () => window.clearInterval(timer);
  }, [activeTimesheet?.id]);

  useEffect(() => {
    const currentUserId = user?.uid;
    if (!currentUserId) return;

    function handleTimesheetsChanged(event: Event) {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== currentUserId) return;
      void load(true);
    }

    window.addEventListener(TIMESHEETS_CHANGED_EVENT, handleTimesheetsChanged);
    return () => window.removeEventListener(TIMESHEETS_CHANGED_EVENT, handleTimesheetsChanged);
  }, [load, user?.uid]);

  function handlePreferredProjectChange(projectId: string) {
    if (!user?.uid) return;
    setPreferredProjectId(projectId);
    writeSavedProjectId(user.uid, projectId);
    void saveUserTimesheetProjectPreference(user.uid, projectId).catch((error) => {
      console.warn("[MyTimesheetsPage][save project preference]", error);
    });
  }

  async function handleStart(
    projectId: string,
    location: TimesheetLocation,
    startExplanation = "",
    startPolicyFlag = "",
    startExpectedTime = ""
  ) {
    if (!user?.uid) return;

    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Proiectul selectat nu exista sau nu este activ.");
    }

    handlePreferredProjectChange(project.id);

    const payload = {
      userId: user.uid,
      userName: user.displayName || user.email || "Utilizator",
      userThemeKey: (user as any)?.themeKey || null,
      projectId: project.id,
      projectCode: "",
      projectName: project.name,
      startLocation: location,
      startExplanation,
      startPolicyFlag,
      startExpectedTime,
    };

    if (flags.offlineTimesheets && !navigator.onLine) {
      const action = queueOfflineTimesheetStart(payload);
      setActiveTimesheet(buildOfflineActiveTimesheet(action));
      setOfflineStatus("Pornirea a fost salvata pe dispozitiv si se va sincroniza automat.");
      return;
    }

    await startTimesheet(payload);

    await load();
  }

  async function handleStop(
    explanation: string,
    location: TimesheetLocation,
    stopPolicyFlag = "",
    stopExpectedMinutes?: number
  ) {
    if (!activeTimesheet) {
      throw new Error("Nu exista pontaj activ.");
    }

    const payload = {
      timesheetId: activeTimesheet.id,
      explanation,
      stopLocation: location,
      stopPolicyFlag,
      stopExpectedMinutes,
    };

    if (flags.offlineTimesheets && !navigator.onLine) {
      queueOfflineTimesheetStop({ ...payload, userId: activeTimesheet.userId });
      setActiveTimesheet(null);
      setOfflineStatus("Oprirea a fost salvata pe dispozitiv si se va sincroniza automat.");
      return;
    }

    await stopTimesheet(payload);

    await load();
  }

  async function handleCreateProject(values: ProjectFormValues) {
    setProjectSubmitting(true);
    setProjectError("");

    try {
      if (!values.name.trim()) {
        setProjectError("Completeaza numele proiectului.");
        return;
      }

      await createProject(values);
      await load();
    } catch (error) {
      console.error(error);
      setProjectError("Nu am putut salva proiectul.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  const stats = useMemo(
    () => computeTimesheetStats(timesheets, attentionClock),
    [attentionClock, timesheets]
  );
  const recentTimesheets = useMemo(() => timesheets.slice(0, 10), [timesheets]);
  const lastSevenTimesheets = useMemo(() => {
    const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return timesheets.filter((item) => (item.startAt || 0) >= from).slice(0, 12);
  }, [timesheets]);
  const todayKey = getLocalDateKey(attentionClock);
  const todayTimesheets = useMemo(
    () => timesheets.filter((item) => item.workDate === todayKey),
    [timesheets, todayKey]
  );
  const liveTodayTimesheets = useMemo(() => {
    const activeWorkDate = activeTimesheet
      ? activeTimesheet.workDate || getLocalDateKey(activeTimesheet.startAt)
      : "";

    if (
      !activeTimesheet ||
      activeWorkDate !== todayKey ||
      todayTimesheets.some((item) => item.id === activeTimesheet.id)
    ) {
      return todayTimesheets;
    }

    return [activeTimesheet, ...todayTimesheets];
  }, [activeTimesheet, todayKey, todayTimesheets]);
  const todayLiveMinutes = useMemo(
    () => sumTimesheetMinutes(liveTodayTimesheets, attentionClock),
    [attentionClock, liveTodayTimesheets]
  );
  const todayClosedTimesheet = useMemo(
    () => todayTimesheets.find((item) => item.status !== "activ" && item.stopAt),
    [todayTimesheets]
  );
  const weekRange = useMemo(() => getTimesheetPeriodRange("week"), []);
  const missingWeekDays = useMemo(
    () => getMissingWorkdaysForUser(timesheets, weekRange),
    [timesheets, weekRange]
  );
  const incompleteTimesheets = useMemo(
    () => timesheets.filter((item) => item.status === "neinchis" || item.status === "activ"),
    [timesheets]
  );
  const activeMinutes = activeTimesheet
    ? getEffectiveWorkedMinutes(activeTimesheet, attentionClock)
    : 0;
  const nextApprovedLeave = useMemo(() => {
    const today = getLocalDateKey(attentionClock);
    return (
      leaveRequests
        .filter((item) => item.status === "aprobat" && item.periodEnd >= today)
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0] ?? null
    );
  }, [attentionClock, leaveRequests]);
  const currentStatus = activeTimesheet
    ? {
        title: "Lucrezi acum",
        label: "Activ",
        tone: "blue" as const,
        subtitle: `${getProjectDisplayName(activeTimesheet.projectName, activeTimesheet.projectCode)} - pornit la ${new Date(activeTimesheet.startAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}`,
      }
    : todayClosedTimesheet
      ? {
          title: "Pontaj inchis azi",
          label: "Inchis",
          tone: "green" as const,
          subtitle: `${getProjectDisplayName(todayClosedTimesheet.projectName, todayClosedTimesheet.projectCode)} - ${formatMinutes(todayClosedTimesheet.workedMinutes)}`,
        }
      : {
          title: "Nu ai pontaj pornit",
          label: "Nepornit",
          tone: "orange" as const,
          subtitle:
            new Date(attentionClock).getHours() >= 8
              ? "Ai intarziat pornirea pontajului. Va fi ceruta explicatie."
              : "Alege proiectul si porneste pontajul cand incepi lucrul.",
        };
  const timesheetAttentionActive = useMemo(
    () =>
      isTimesheetAttentionTime(
        notificationRules,
        activeTimesheet ? "stop" : "start",
        attentionClock
      ),
    [activeTimesheet, attentionClock, notificationRules]
  );

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca pontajul meu...</h2>
        <p>Preluam datele personale din Firebase.</p>
      </div>
    );
  }

  return (
    <PageLayout className="my-timesheets-modern-page">
      <PageHeader
        eyebrow="Spațiul meu de lucru"
        title="Pontajul meu"
        description={
          activeTimesheet
            ? "Cronometrul este activ și se actualizează în timp real."
            : "Alege proiectul și pornește pontajul când începi lucrul."
        }
        meta={
          <StatusBadge tone={activeTimesheet ? "green" : "muted"}>
            {currentStatus.label}
          </StatusBadge>
        }
        actions={[
          {
            id: "projects",
            label: "Proiecte",
            to: "/projects",
            icon: TimerReset,
            assistantAction: "open-projects",
          },
          {
            id: "leave",
            label: "Concedii",
            to: "/my-leave",
            icon: CalendarDays,
            assistantAction: "open-leave",
          },
        ]}
      />
      {offlineQueueCount || offlineStatus ? (
        <div className="wc-offline-queue-status" role="status">
          <strong>{offlineQueueCount ? `${offlineQueueCount} actiuni de pontaj in asteptare` : "Pontaj sincronizat"}</strong>
          <span>{offlineStatus || "Sincronizarea porneste automat cand revine internetul."}</span>
        </div>
      ) : null}
      <TimesheetStatusCard
        title={currentStatus.title}
        subtitle={currentStatus.subtitle}
        statusLabel={currentStatus.label}
        tone={currentStatus.tone}
        dataAssistantSection="my-timesheet-status"
      >
        {activeTimesheet ? (
          <div className="my-timesheet-live-grid">
            <div>
              <span>Proiect curent</span>
              <strong>
                {getProjectDisplayName(activeTimesheet.projectName, activeTimesheet.projectCode)}
              </strong>
            </div>
            <div>
              <span>Ora start</span>
              <strong>
                {new Date(activeTimesheet.startAt).toLocaleTimeString("ro-RO", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </strong>
            </div>
            <div>
              <span>Durata live</span>
              <strong>{formatMinutes(activeMinutes)}</strong>
            </div>
            <div>
              <span>Locatie start</span>
              <strong>{formatTimesheetLocation(activeTimesheet.startLocation) || "-"}</strong>
            </div>
          </div>
        ) : null}
      </TimesheetStatusCard>

      <div className="wc-kpi-grid wc-kpi-grid--four">
        <KpiCard
          label="Ore azi"
          value={formatMinutes(todayLiveMinutes)}
          helper={
            liveTodayTimesheets.length ? `${liveTodayTimesheets.length} pontaje` : "nicio sesiune"
          }
          tone="green"
          icon={Clock3}
        />
        <KpiCard
          label="Ore saptamana asta"
          value={formatMinutes(stats.weekMinutes)}
          helper={`${missingWeekDays.length} zile lipsa`}
          tone={missingWeekDays.length ? "orange" : "green"}
          icon={TrendingUp}
        />
        <KpiCard
          label="Ore luna asta"
          value={formatMinutes(stats.monthMinutes)}
          helper={`medie ${formatMinutes(stats.avgMinutesPerWorkedDayMonth)} / zi`}
          tone="blue"
          icon={CalendarDays}
        />
        <KpiCard
          label="Pontaje incomplete"
          value={incompleteTimesheets.length}
          helper={incompleteTimesheets.length ? "verifica istoricul" : "totul este inchis"}
          tone={incompleteTimesheets.length ? "red" : "green"}
          icon={AlertTriangle}
        />
      </div>

      <Link className="wc-upcoming-leave-strip" to="/my-leave?tab=requests">
        <CalendarDays size={18} />
        <div>
          <span>Urmatorul concediu aprobat</span>
          <strong>
            {nextApprovedLeave
              ? `${nextApprovedLeave.periodStart} - ${nextApprovedLeave.periodEnd}`
              : "Nu exista concedii aprobate programate"}
          </strong>
        </div>
        <span>Vezi concediile</span>
      </Link>

      <div className="content-grid">
        <TimesheetForm
          projects={projects}
          activeTimesheet={activeTimesheet}
          onStart={handleStart}
          onStop={handleStop}
          loading={loading}
          allowCustomLocation={canUseCustomTimesheetLocation}
          selectedProjectId={preferredProjectId}
          onProjectChange={handlePreferredProjectChange}
          attentionActive={timesheetAttentionActive}
        />

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Proiecte active</h2>
              <p className="panel-subtitle">Ultimul proiect folosit este selectat automat.</p>
            </div>
            <TimerReset size={20} />
          </div>

          {(role === "admin" || role === "manager") && (
            <>
              {projectError && (
                <div className="tool-message" style={{ marginBottom: 16 }}>
                  {projectError}
                </div>
              )}

              <ProjectForm
                initialValues={{
                  name: "",
                  status: "activ",
                }}
                submitting={projectSubmitting}
                onSubmit={handleCreateProject}
              />
            </>
          )}

          <div className="panel-body">
            <div className="simple-list">
              {projects.length === 0 ? (
                <EmptyState
                  title="Nu exista proiecte active"
                  subtitle="Un manager poate crea rapid un proiect nou."
                />
              ) : (
                projects.map((project) => (
                  <div key={project.id} className="simple-list-item">
                    <div className="simple-list-text">
                      <div className="simple-list-label">{project.name || "Fara nume"}</div>
                      <div className="simple-list-subtitle">status: {project.status}</div>
                    </div>
                    <StatusBadge tone={project.id === preferredProjectId ? "blue" : "green"}>
                      {project.id === preferredProjectId ? "selectat" : project.status}
                    </StatusBadge>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <Link to="/projects" className="secondary-btn">
                Vezi toate proiectele
              </Link>
            </div>
          </div>
        </div>
      </div>

      <TimesheetCalendar timesheets={timesheets} />

      <div className="content-grid timesheet-chart-grid">
        <TimesheetChartCard
          title="Ore lucrate pe zile"
          subtitle="Istoricul personal"
          bars={buildDayMinuteBuckets(timesheets.slice(0, 40))}
        />
        <TimesheetChartCard title="Ore pe proiecte" bars={buildProjectMinuteBuckets(timesheets)} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Ultimele 7 zile</h2>
            <p className="panel-subtitle">Istoric scurt, totaluri si statusuri clare.</p>
          </div>
          <StatusBadge tone="blue">
            {formatMinutes(
              lastSevenTimesheets.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item), 0)
            )}
          </StatusBadge>
        </div>

        {lastSevenTimesheets.length === 0 ? (
          <EmptyState title="Nu exista pontaje in ultimele 7 zile" />
        ) : (
          <div className="simple-list">
            {lastSevenTimesheets.map((item) => (
              <Link
                to={`/timesheets/${item.id}`}
                key={item.id}
                className={`simple-list-item user-history-row ${getUserThemeClass((item as any).userThemeKey)}`}
              >
                <div className="simple-list-text">
                  <div className="user-inline-meta">
                    <span className="user-accent-avatar">
                      {getUserInitials(item.userName || "Eu")}
                    </span>
                    <span className="simple-list-label user-accent-name">
                      {getProjectDisplayName(item.projectName, item.projectCode)}
                    </span>
                  </div>
                  <div className="simple-list-subtitle">
                    {item.workDate} -{" "}
                    {new Date(item.startAt).toLocaleTimeString("ro-RO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" / "}
                    {item.stopAt
                      ? new Date(item.stopAt).toLocaleTimeString("ro-RO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                    {" / "}
                    {formatMinutes(getEffectiveWorkedMinutes(item))}
                  </div>
                </div>
                <StatusBadge tone={getTimesheetStatusTone(item.status)}>
                  {getTimesheetStatusLabel(item.status)}
                </StatusBadge>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Istoricul meu de pontaje</h2>
            <p className="panel-subtitle">Lista completa recenta.</p>
          </div>
        </div>

        {recentTimesheets.length === 0 ? (
          <EmptyState title="Nu exista pontaje inregistrate" />
        ) : (
          <div className="simple-list">
            {recentTimesheets.map((item) => {
              const userThemeClass = getUserThemeClass((item as any).userThemeKey);

              return (
                <Link
                  to={`/timesheets/${item.id}`}
                  key={item.id}
                  className={`simple-list-item user-history-row ${userThemeClass}`}
                >
                  <div className="simple-list-text">
                    <div className="user-inline-meta">
                      <span className="user-accent-avatar">
                        {getUserInitials(item.userName || "Eu")}
                      </span>
                      <span className="simple-list-label user-accent-name">
                        {getProjectDisplayName(item.projectName, item.projectCode)}
                      </span>
                    </div>

                    <div className="simple-list-subtitle">
                      Start: {new Date(item.startAt).toLocaleString("ro-RO")} · Stop:{" "}
                      {item.stopAt ? new Date(item.stopAt).toLocaleString("ro-RO") : "-"} · Durata:{" "}
                      {formatMinutes(item.workedMinutes)}
                    </div>

                    <div className="simple-list-subtitle">
                      Locatie start: {formatTimesheetLocation(item.startLocation)}
                    </div>

                    <div className="simple-list-subtitle">
                      Locatie stop: {formatTimesheetLocation(item.stopLocation)}
                    </div>
                  </div>

                  <span className="badge badge-orange">{item.status}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
