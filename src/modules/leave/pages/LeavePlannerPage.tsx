import { useEffect, useMemo, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, Download, FileSignature, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import { db } from "../../../lib/firebase/firebase";
import {
  buildCompanyScopeConstraints,
  getCurrentCompanyAccessContext,
} from "../../../lib/firebase/companyAccess";
import { getUserDirectoryCollectionName } from "../../../lib/firebase/companyIsolationRollout";
import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUserItem } from "../../../types/user";
import type { LeaveRequestFormValues, LeaveRequestItem } from "../../../types/leave";
import {
  approveLeaveRequest,
  deleteLeaveRequest,
  getLeaveDateSet,
  getWorkedMinutesByDay,
  saveLeaveRequest,
} from "../services/leaveRequestsService";
import UserProfileLink from "../../../components/UserProfileLink";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import ProductTabs from "../../../components/product/ProductTabs";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import { ASSISTANT_FILL_LEAVE_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { registerAssistantFormDraftAdapter } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import { highlightAssistantElement } from "../../../lib/assistant/runtime/assistantButtonHighlighter";
import {
  inferAssistantLeaveRange,
  parseAssistantLeaveDate,
  toLeaveIsoDate,
} from "../utils/leaveDateUtils";
import { getUserThemeClass } from "../../../lib/ui/userTheme";

const weekDays = ["L", "Ma", "Mi", "J", "V", "S", "D"];

type UserCalendarData = {
  timesheets: TimesheetItem[];
  leaveRequests: LeaveRequestItem[];
  timesheetsLoaded: boolean;
  leaveLoaded: boolean;
};

type SignaturePoint = { x: number; y: number };

const toIsoDate = toLeaveIsoDate;

function getMonthMatrix(baseDate: Date): Date[] {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startWeekday);

  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function getOrthodoxEasterDate(year: number): Date {
  const a = year % 19;
  const b = year % 7;
  const c = year % 4;
  const d = (19 * a + 16) % 30;
  const e = (2 * c + 4 * b + 6 * d) % 7;
  const oldStyleDay = 3 + d + e;
  const julianToGregorianOffset = year >= 2100 ? 14 : 13;
  return new Date(year, 3, oldStyleDay + julianToGregorianOffset);
}

function shiftDate(baseDate: Date, days: number): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + days);
}

type HolidayLookup = {
  holidayDates: Set<string>;
  holidayReasonByDate: Record<string, string>;
};

function getRomanianPublicHolidayLookup(year: number): HolidayLookup {
  const holidayReasonByDate: Record<string, string> = {};
  const addHoliday = (date: Date, reason: string) => {
    holidayReasonByDate[toIsoDate(date)] = reason;
  };

  const fixedHolidays = [
    { date: new Date(year, 0, 1), reason: "Anul Nou (prima zi)" },
    { date: new Date(year, 0, 2), reason: "Anul Nou (a doua zi)" },
    { date: new Date(year, 0, 6), reason: "Boboteaza" },
    { date: new Date(year, 0, 7), reason: "Sfantul Ioan Botezatorul" },
    { date: new Date(year, 0, 24), reason: "Ziua Unirii Principatelor Romane" },
    { date: new Date(year, 4, 1), reason: "Ziua Muncii" },
    { date: new Date(year, 5, 1), reason: "Ziua Copilului" },
    { date: new Date(year, 7, 15), reason: "Adormirea Maicii Domnului" },
    { date: new Date(year, 10, 30), reason: "Sfantul Andrei" },
    { date: new Date(year, 11, 1), reason: "Ziua Nationala a Romaniei" },
    { date: new Date(year, 11, 25), reason: "Craciunul (prima zi)" },
    { date: new Date(year, 11, 26), reason: "Craciunul (a doua zi)" },
  ];
  const orthodoxEaster = getOrthodoxEasterDate(year);
  const movableHolidays = [
    { date: shiftDate(orthodoxEaster, -2), reason: "Vinerea Mare (Paste ortodox)" },
    { date: orthodoxEaster, reason: "Paste ortodox (prima zi)" },
    { date: shiftDate(orthodoxEaster, 1), reason: "Paste ortodox (a doua zi)" },
    { date: shiftDate(orthodoxEaster, 49), reason: "Rusalii (prima zi)" },
    { date: shiftDate(orthodoxEaster, 50), reason: "Rusalii (a doua zi)" },
  ];

  [...fixedHolidays, ...movableHolidays].forEach((item) => addHoliday(item.date, item.reason));

  return { holidayDates: new Set(Object.keys(holidayReasonByDate)), holidayReasonByDate };
}

function defaultForm(userName: string, userEmail: string, companyName = ""): LeaveRequestFormValues {
  return {
    userName,
    userEmail,
    companyName,
    roleTitle: "",
    department: "",
    requestType: "concediu_odihna",
    periodStart: "",
    periodEnd: "",
    reason: "",
    signatureData: "",
  };
}

function mapTimesheetDoc(id: string, data: Record<string, any>): TimesheetItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    userThemeKey: data.userThemeKey ?? null,
    projectId: data.projectId ?? "",
    projectCode: data.projectCode ?? "",
    projectName: data.projectName ?? "",
    status: data.status ?? "activ",
    explanation: data.explanation ?? "",
    startAt: Number(data.startAt ?? Date.now()),
    stopAt: data.stopAt ?? null,
    workedMinutes: Number(data.workedMinutes ?? 0),
    startLocation: data.startLocation ?? { lat: null, lng: null, label: "" },
    stopLocation: data.stopLocation ?? null,
    startSource: data.startSource ?? "web",
    stopSource: data.stopSource ?? "",
    workDate: data.workDate ?? "",
    yearMonth: data.yearMonth ?? "",
    weekKey: data.weekKey ?? "",
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

function mapLeaveDoc(id: string, data: Record<string, any>): LeaveRequestItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    userEmail: data.userEmail ?? "",
    companyName: data.companyName ?? "",
    roleTitle: data.roleTitle ?? "",
    department: data.department ?? "",
    requestType: data.requestType === "zi_libera_platita" || data.requestType === "zi_libera_eveniment" ? data.requestType : "concediu_odihna",
    legalReason: data.legalReason ?? "",
    periodStart: data.periodStart ?? "",
    periodEnd: data.periodEnd ?? "",
    requestedDays: Number(data.requestedDays ?? 0),
    requestedMinutes: Number(data.requestedMinutes ?? 0),
    reason: data.reason ?? "",
    signatureData: data.signatureData ?? "",
    issuedAt: Number(data.issuedAt ?? Date.now()),
    status: data.status === "aprobat" || data.status === "respins" ? data.status : "in_asteptare",
    pdfDataUrl: data.pdfDataUrl ?? "",
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

function buildUserLabel(userItem: AppUserItem): string {
  return userItem.fullName?.trim() || userItem.email || "Utilizator";
}

function requestTypeLabel(type: LeaveRequestItem["requestType"]): string {
  if (type === "concediu_odihna") return "Concediu de odihna";
  if (type === "zi_libera_platita") return "Zi libera platita";
  return "Zi libera eveniment";
}

function getLeaveRequestFileName(request: LeaveRequestItem) {
  const name = request.userName || request.userEmail || request.userId || "utilizator";
  return `cerere-concediu-${name}-${request.periodStart}-${request.periodEnd}.pdf`;
}

function assistantLeaveField(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = String(fields[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function getProfileCompanyName(user: ReturnType<typeof useAuth>["user"]): string {
  return user?.primaryCompanyName?.trim() || user?.companyNames?.find((name) => name.trim())?.trim() || "";
}

export default function LeavePlannerPage() {
  const { user, role } = useAuth();
  const location = useLocation();
  const isAdmin = role === "admin";
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string>("");
  const [calendarData, setCalendarData] = useState<UserCalendarData>({
    timesheets: [],
    leaveRequests: [],
    timesheetsLoaded: false,
    leaveLoaded: false,
  });
  const [adminRequests, setAdminRequests] = useState<LeaveRequestItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [approvingRequestId, setApprovingRequestId] = useState("");
  const [deletingRequestId, setDeletingRequestId] = useState("");
  const [showYearCalendar, setShowYearCalendar] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [submittedLeaveRequestId, setSubmittedLeaveRequestId] = useState("");
  const [drawingSignature, setDrawingSignature] = useState(false);
  const [formValues, setFormValues] = useState<LeaveRequestFormValues>(
    {
      ...defaultForm(user?.displayName || user?.email || "", user?.email || "", getProfileCompanyName(user)),
      roleTitle: user?.roleTitle || "",
      department: user?.department || "",
    }
  );
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureStrokeRef = useRef<SignaturePoint[]>([]);
  const signatureStrokesRef = useRef<SignaturePoint[][]>([]);
  const previousProfileCompanyNameRef = useRef(getProfileCompanyName(user));
  const previousProfileRoleTitleRef = useRef(user?.roleTitle || "");
  const previousProfileDepartmentRef = useRef(user?.department || "");
  const assistantLeaveKeyRef = useRef("");

  useEffect(() => {
    const profileCompanyName = getProfileCompanyName(user);
    const previousProfileCompanyName = previousProfileCompanyNameRef.current;
    const profileRoleTitle = user?.roleTitle || "";
    const previousProfileRoleTitle = previousProfileRoleTitleRef.current;
    const profileDepartment = user?.department || "";
    const previousProfileDepartment = previousProfileDepartmentRef.current;
    setFormValues((prev) => {
      const shouldUseProfileCompany =
        !prev.companyName || prev.companyName === previousProfileCompanyName;
      const shouldUseProfileRoleTitle =
        !prev.roleTitle || prev.roleTitle === previousProfileRoleTitle;
      const shouldUseProfileDepartment =
        !prev.department || prev.department === previousProfileDepartment;

      return {
        ...defaultForm(user?.displayName || user?.email || "", user?.email || "", shouldUseProfileCompany ? profileCompanyName : prev.companyName),
        roleTitle: shouldUseProfileRoleTitle ? profileRoleTitle : prev.roleTitle,
        department: shouldUseProfileDepartment ? profileDepartment : prev.department,
        requestType: prev.requestType,
        periodStart: prev.periodStart,
        periodEnd: prev.periodEnd,
        reason: prev.reason,
        signatureData: prev.signatureData,
      };
    });
    previousProfileCompanyNameRef.current = profileCompanyName;
    previousProfileRoleTitleRef.current = profileRoleTitle;
    previousProfileDepartmentRef.current = profileDepartment;
    signatureStrokesRef.current = [];
  }, [user, user?.companyNames, user?.department, user?.displayName, user?.email, user?.primaryCompanyName, user?.roleTitle]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("assistant") !== "leave") return;
    if (assistantLeaveKeyRef.current === location.search) return;

    assistantLeaveKeyRef.current = location.search;
    const start = params.get("start") || "";
    const end = params.get("end") || start;

    setFormValues((prev) => ({
      ...prev,
      companyName: getProfileCompanyName(user) || prev.companyName,
      roleTitle: user?.roleTitle || prev.roleTitle,
      department: user?.department || prev.department,
      requestType: "concediu_odihna",
      periodStart: start || prev.periodStart,
      periodEnd: end || prev.periodEnd,
    }));

    window.setTimeout(() => {
      document.getElementById("leave-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  }, [location.search, user, user?.department, user?.primaryCompanyName, user?.roleTitle]);

  useEffect(() => {
    const handleAssistantLeaveFill = (detail: Readonly<Record<string, unknown>>) => {
      const inferredRange = inferAssistantLeaveRange(
        [
          assistantLeaveField(detail, ["period", "perioada", "text", "range"]),
          assistantLeaveField(detail, ["spokenText", "command"]),
        ].filter(Boolean).join(" ")
      );
      const startDate =
        parseAssistantLeaveDate(assistantLeaveField(detail, ["startDate", "periodStart", "dataInceput", "inceput"])) ||
        inferredRange?.startDate ||
        "";
      const endDate =
        parseAssistantLeaveDate(assistantLeaveField(detail, ["endDate", "periodEnd", "dataSfarsit", "sfarsit"])) ||
        inferredRange?.endDate ||
        startDate;
      const reason = assistantLeaveField(detail, ["reason", "motiv", "observatii"]);
      const requestType = assistantLeaveField(detail, ["requestType", "tip", "tipSolicitare"]);

      setError("");
      setSuccess("Asistentul a completat perioada. Verifica semnatura si trimite cererea.");
      setFormValues((prev) => ({
        ...prev,
        companyName: getProfileCompanyName(user) || prev.companyName,
        roleTitle: user?.roleTitle || prev.roleTitle,
        department: user?.department || prev.department,
        requestType:
          requestType === "zi_libera_platita" || requestType === "zi_libera_eveniment" || requestType === "concediu_odihna"
            ? requestType
            : prev.requestType,
        periodStart: startDate || prev.periodStart,
        periodEnd: endDate || prev.periodEnd,
        reason: reason || prev.reason,
      }));

      if (startDate) {
        const visibleDate = new Date(startDate);
        if (!Number.isNaN(visibleDate.getTime())) {
          setVisibleMonth(new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1));
        }
      }

      window.setTimeout(() => {
        document.getElementById("leave-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        highlightAssistantElement("[data-assistant-action='submit-leave-request']");
      }, 180);
    };

    return registerAssistantFormDraftAdapter(ASSISTANT_FILL_LEAVE_EVENT, handleAssistantLeaveFill);
  }, [user, user?.department, user?.primaryCompanyName, user?.roleTitle]);

  useEffect(() => {
    if (!showYearCalendar) return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [showYearCalendar]);

  useEffect(() => {
    if (!user?.uid) {
      setUsers([]);
      setExpandedUserId("");
      return undefined;
    }
    let unsubscribe: () => void = () => {};
    let cancelled = false;
    void getCurrentCompanyAccessContext().then((context) => {
      if (cancelled) return;
      const managementScope = role === "admin" || role === "manager";
      const userViews = collection(db, getUserDirectoryCollectionName());
      const companyScope = buildCompanyScopeConstraints(context);
      const usersQuery = managementScope
        ? query(userViews, ...companyScope, orderBy("fullName", "asc"), limit(100))
        : query(userViews, ...companyScope, where("uid", "==", user.uid), limit(1));

      unsubscribe = onSnapshot(usersQuery, (snap) => {
      const mappedByUser = new Map<string, AppUserItem>();
      snap.docs.forEach((docItem) => {
        const data = docItem.data();
        const uid = data.uid ?? docItem.id;
        const companyNames = Array.isArray(data.companyNames)
          ? data.companyNames.map((name: unknown) => String(name || "").trim()).filter(Boolean)
          : [];
        const primaryCompanyName = String(data.primaryCompanyName || companyNames[0] || "").trim();
        mappedByUser.set(uid, {
          id: uid,
          uid,
          fullName: data.fullName ?? "",
          email: data.email ?? "",
          active: data.active !== false,
          role: data.role ?? "angajat",
          roleTitle: data.roleTitle ?? "",
          department: data.department ?? "",
          themeKey: data.themeKey ?? undefined,
          companyIds: [data.companyId].filter(Boolean),
          companyNames,
          primaryCompanyId: data.primaryCompanyId ?? data.companyId ?? "",
          primaryCompanyName,
          createdAt: Number(data.createdAt ?? 0),
          updatedAt: Number(data.updatedAt ?? 0),
          isOnline: data.isOnline === true,
          lastSeenAt: Number(data.lastSeenAt ?? 0),
          lastActiveAt: Number(data.lastActiveAt ?? 0),
        } as AppUserItem);
      });
      const mapped = [...mappedByUser.values()];

      setUsers(mapped);
      setExpandedUserId((current) => current || mapped[0]?.uid || "");
      });
    }).catch((error) => {
      console.error("[LeavePlannerPage][users]", error);
      setError("Lista utilizatorilor nu a putut fi incarcata.");
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [role, user?.uid]);

  useEffect(() => {
    if (!expandedUserId) {
      setCalendarData({ timesheets: [], leaveRequests: [], timesheetsLoaded: false, leaveLoaded: false });
      return undefined;
    }

    setCalendarData({ timesheets: [], leaveRequests: [], timesheetsLoaded: false, leaveLoaded: false });

    let timesheetsUnsub: () => void = () => {};
    let leaveUnsub: () => void = () => {};
    let cancelled = false;
    void getCurrentCompanyAccessContext().then((context) => {
      if (cancelled) return;
      const companyScope = buildCompanyScopeConstraints(context);
      timesheetsUnsub = onSnapshot(
        query(
          collection(db, "timesheets"),
          ...companyScope,
          where("userId", "==", expandedUserId),
          orderBy("startAt", "desc"),
          limit(180)
        ),
        (snap) => {
        const mapped = snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));
        setCalendarData((prev) => ({ ...prev, timesheets: mapped, timesheetsLoaded: true }));
        },
        (snapshotError) => {
          console.error("[LeavePlannerPage][timesheets]", snapshotError);
          setCalendarData((prev) => ({ ...prev, timesheetsLoaded: true }));
          setError("Pontajele din calendar nu au putut fi incarcate.");
        }
      );

      leaveUnsub = onSnapshot(
        query(
          collection(db, "leaveRequests"),
          ...companyScope,
          where("userId", "==", expandedUserId),
          orderBy("createdAt", "desc"),
          limit(100)
        ),
        (snap) => {
        const mapped = snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data()));
        setCalendarData((prev) => ({ ...prev, leaveRequests: mapped, leaveLoaded: true }));
        },
        (snapshotError) => {
          console.error("[LeavePlannerPage][leave calendar]", snapshotError);
          setCalendarData((prev) => ({ ...prev, leaveLoaded: true }));
          setError("Concediile din calendar nu au putut fi incarcate.");
        }
      );
    }).catch((error) => console.error("[LeavePlannerPage][calendar]", error));

    return () => {
      cancelled = true;
      timesheetsUnsub();
      leaveUnsub();
    };
  }, [expandedUserId]);

  useEffect(() => {
    if (!user?.uid) return;
    let unsubscribe: () => void = () => {};
    let cancelled = false;
    void getCurrentCompanyAccessContext().then((context) => {
      if (cancelled) return;
      const managementScope = role === "admin" || role === "manager";
      const requestsQuery = query(
        collection(db, "leaveRequests"),
        ...buildCompanyScopeConstraints(context),
        ...(managementScope ? [] : [where("userId", "==", user.uid)]),
        orderBy("createdAt", "desc"),
        limit(managementScope ? 100 : 30)
      );
      unsubscribe = onSnapshot(
        requestsQuery,
        (snap) => {
          setAdminRequests(snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data())));
        },
        (snapshotError) => {
          console.error("[LeavePlannerPage][requests]", snapshotError);
          setError("Cererile de concediu nu au putut fi incarcate.");
        }
      );
    }).catch((error) => {
      console.error("[LeavePlannerPage][requests]", error);
      setError("Cererile de concediu nu au putut fi incarcate.");
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [role, user?.uid]);

  const monthTitle = useMemo(
    () => visibleMonth.toLocaleDateString("ro-RO", { month: "long", year: "numeric" }),
    [visibleMonth]
  );
  const workedMinutesByDay = useMemo(() => getWorkedMinutesByDay(calendarData.timesheets), [calendarData.timesheets]);
  const approvedLeaveDateSet = useMemo(
    () => getLeaveDateSet(calendarData.leaveRequests.filter((request) => request.status === "aprobat")),
    [calendarData.leaveRequests]
  );
  const holidayLookup = useMemo(() => getRomanianPublicHolidayLookup(visibleMonth.getFullYear()), [visibleMonth]);
  const pendingLeaveRequests = useMemo(() => adminRequests.filter((request) => request.status === "in_asteptare"), [adminRequests]);
  const approvedRequests = useMemo(() => adminRequests.filter((request) => request.status === "aprobat"), [adminRequests]);
  const myLeaveRequests = useMemo(
    () => adminRequests.filter((request) => request.userId === user?.uid),
    [adminRequests, user?.uid]
  );
  const overlappingTeamLeave = useMemo(() => {
    if (!formValues.periodStart || !formValues.periodEnd) return [];
    return adminRequests.filter(
      (request) =>
        request.userId !== user?.uid &&
        request.status !== "respins" &&
        request.periodStart <= formValues.periodEnd &&
        request.periodEnd >= formValues.periodStart
    );
  }, [adminRequests, formValues.periodEnd, formValues.periodStart, user?.uid]);
  const leaveFormNeedsAttention =
    !formValues.userName.trim() ||
    !formValues.userEmail.trim() ||
    !formValues.companyName.trim() ||
    !formValues.roleTitle.trim() ||
    !formValues.department.trim() ||
    !formValues.periodStart ||
    !formValues.periodEnd ||
    !formValues.signatureData;
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, month) => new Date(visibleMonth.getFullYear(), month, 1)),
    [visibleMonth]
  );
  const expandedUser = useMemo(() => users.find((userItem) => userItem.uid === expandedUserId), [expandedUserId, users]);
  const expandedUserName = expandedUser ? buildUserLabel(expandedUser) : "Utilizator";
  const userThemeById = useMemo(
    () => new Map(users.flatMap((userItem) => [userItem.uid, userItem.id].filter(Boolean).map((id) => [id, userItem.themeKey ?? null] as const))),
    [users]
  );
  const attentionClass = (condition: boolean) => (condition ? "attention-pulse" : "");

  useEffect(() => {
    if (!submittedLeaveRequestId) return;
    if (!myLeaveRequests.some((request) => request.id === submittedLeaveRequestId)) return;

    window.setTimeout(() => {
      document.getElementById(`leave-request-${submittedLeaveRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, [myLeaveRequests, submittedLeaveRequestId]);

  function formatWorkedMinutesLabel(minutes: number): string {
    const safeMinutes = Math.max(0, Math.floor(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const restMinutes = safeMinutes % 60;
    return `${hours}h${restMinutes}m`;
  }

  function renderMonthCalendar(monthDate: Date, scopeKey: string, compact = false) {
    const cells = getMonthMatrix(monthDate);
    return (
      <div className={`leave-calendar-grid ${compact ? "leave-calendar-grid-compact" : ""}`}>
        {weekDays.map((day) => (
          <div key={`${scopeKey}-${monthDate.toISOString()}-${day}`} className="leave-cell leave-cell-head">{day}</div>
        ))}
        {cells.map((date, index) => {
          const iso = toIsoDate(date);
          const minutes = workedMinutesByDay[iso] ?? 0;
          const hasWork = minutes > 0;
          const hasLeave = approvedLeaveDateSet.has(iso);
          const outsideMonth = date.getMonth() !== monthDate.getMonth();
          const isHoliday = holidayLookup.holidayDates.has(iso);
          const holidayReason = holidayLookup.holidayReasonByDate[iso];

          const className = [
            "leave-cell",
            outsideMonth ? "is-outside" : "",
            hasWork && hasLeave ? "is-mixed" : hasWork ? "is-worked" : hasLeave ? "is-leave" : "",
            isHoliday ? "is-holiday" : "",
          ].join(" ");

          return (
            <div key={`${scopeKey}-${iso}-${index}`} className={className} title={isHoliday ? holidayReason || "Sarbatoare legala (Romania)" : undefined}>
              <div className="leave-cell-day">{date.getDate()}</div>
              {isHoliday && holidayReason && !outsideMonth && <div className="leave-cell-holiday-reason">{holidayReason}</div>}
              {minutes > 0 && <div className="leave-cell-minutes">{formatWorkedMinutesLabel(minutes)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function getSignaturePoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, event.clientY - rect.top)),
    };
  }

  function startSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    setDrawingSignature(true);
    signatureStrokeRef.current = [getSignaturePoint(event)];
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingSignature) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getSignaturePoint(event);
    const stroke = signatureStrokeRef.current;
    const previousPoint = stroke[stroke.length - 1];
    stroke.push(point);
    ctx.beginPath();
    ctx.moveTo(previousPoint.x, previousPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function endSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    if (drawingSignature && signatureStrokeRef.current.length > 0) {
      signatureStrokesRef.current.push([...signatureStrokeRef.current]);
      setFormValues((prev) => ({ ...prev, signatureData: JSON.stringify(signatureStrokesRef.current) }));
    }
    signatureStrokeRef.current = [];
    setDrawingSignature(false);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signatureStrokesRef.current = [];
    signatureStrokeRef.current = [];
    setFormValues((prev) => ({ ...prev, signatureData: "" }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.uid) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      if (!formValues.signatureData) {
        throw new Error("Semnatura este obligatorie.");
      }
      const requestId = await saveLeaveRequest(user.uid, formValues);
      setSubmittedLeaveRequestId(requestId);
      setExpandedUserId(user.uid);
      setSuccess("Cererea a fost trimisa si apare mai jos in Cererile mele.");
      setFormValues((prev) => ({
        ...defaultForm(user.displayName || user.email || "", user.email || "", getProfileCompanyName(user) || prev.companyName),
        roleTitle: user.roleTitle || prev.roleTitle,
        department: user.department || prev.department,
      }));
      clearSignature();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut salva cererea.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApproveRequest(requestId: string) {
    setApprovingRequestId(requestId);
    setError("");
    setSuccess("");

    try {
      await approveLeaveRequest({
        requestId,
        actorUserId: user?.uid || "",
        actorUserName: user?.displayName || user?.email || "Administrator",
        actorUserThemeKey: user?.themeKey ?? null,
      });
      setSuccess("Cererea a fost aprobata. PDF-ul contine acum eticheta albastra Aprobat.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut aproba cererea.");
    } finally {
      setApprovingRequestId("");
    }
  }

  async function handleDeleteRequest(requestId: string) {
    setDeletingRequestId(requestId);
    setError("");
    setSuccess("");

    try {
      await deleteLeaveRequest(
        requestId,
        user?.uid || "",
        isAdmin,
        user?.displayName || user?.email || "Utilizator",
        user?.themeKey ?? null
      );
      setSuccess("Cererea PDF a fost stearsa.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut sterge cererea.");
    } finally {
      setDeletingRequestId("");
    }
  }

  if (!user) {
    return (
      <div className="placeholder-page">
        <h2>Nu esti autentificat</h2>
        <p>Intra in cont pentru a vedea planificarea concediilor.</p>
      </div>
    );
  }

  return (
    <section className="page-section leave-page">
      <ActionBar
        title="Concedii & zile lucrate"
        subtitle="Toti utilizatorii apar in lista, iar pe click vezi calendarul compact in dropdown."
        actions={[
          {
            label: "Programeaza concediu",
            href: "#leave-form",
            icon: <FileSignature size={16} />,
            variant: "primary",
            assistantAction: "submit-leave-request",
            tooltip: "Completeaza cererea si trimite-o catre manager",
          },
        ]}
      />

      <ProductTabs
        activeId={(location.hash || "#leave-calendar").replace("#", "")}
        tabs={[
          { id: "leave-calendar", label: "Calendar", to: "/my-leave#leave-calendar", icon: CalendarDays, assistantAction: "view-leave-calendar" },
          { id: "leave-form", label: "Cerere nouă", to: "/my-leave?assistant=leave#leave-form", icon: Send, assistantAction: "open-leave-form" },
          { id: "my-leave-requests", label: "Cererile mele", to: "/my-leave#my-leave-requests", icon: FileSignature, assistantAction: "view-my-leave-requests" },
          ...(role === "admin" || role === "manager" ? [{ id: "leave-approvals", label: "Aprobări", to: "/my-leave#leave-approvals", icon: BadgeCheck }] : []),
        ]}
      />

      <PageQuickActions
        actions={[
          {
            label: "Programeaza concediu",
            href: "#leave-form",
            icon: <FileSignature size={16} />,
            assistantAction: "submit-leave-request",
            tooltip: "Completeaza formularul de concediu",
            variant: "primary",
          },
          {
            label: "Vezi calendar",
            href: "#leave-calendar",
            icon: <CalendarDays size={16} />,
            assistantSection: "leave-calendar",
            tooltip: "Vezi calendarul utilizatorilor",
          },
          {
            label: "Cererile mele",
            href: "#my-leave-requests",
            icon: <BadgeCheck size={16} />,
            assistantSection: "my-leave-requests",
            tooltip: "Coboara la cererile tale",
          },
        ]}
      />

      <div id="leave-calendar" className="panel" data-assistant-section="leave-calendar">

        <div className="leave-legend">
          <span><i className="leave-dot leave-dot-worked" /> Zi lucrata (pontaj)</span>
          <span><i className="leave-dot leave-dot-leave" /> Concediu / invoire</span>
          <span><i className="leave-dot leave-dot-mixed" /> Pontaj + concediu in aceeasi zi</span>
          <span><i className="leave-dot leave-dot-holiday" /> Sarbatoare legala Romania</span>
        </div>

        <div className="leave-help-grid" aria-label="Cum folosesti pagina de concedii">
          <div className="leave-help-card leave-help-card-blue">
            <span className="leave-help-icon"><CalendarDays size={18} /></span>
            <strong>1. Verifica luna</strong>
            <p>Apasa pe numele unui user si vezi in calendar zile lucrate, concedii aprobate si sarbatori legale.</p>
          </div>
          <div className="leave-help-card leave-help-card-amber">
            <span className="leave-help-icon"><FileSignature size={18} /></span>
            <strong>2. Completeaza cererea</strong>
            <p>Alege tipul solicitarii, perioada de inceput/sfarsit si scrie motivul daca este nevoie.</p>
          </div>
          <div className="leave-help-card leave-help-card-green">
            <span className="leave-help-icon"><Send size={18} /></span>
            <strong>3. Semneaza si trimite</strong>
            <p>Semnatura este obligatorie. Dupa trimitere, cererea ajunge la admin pentru aprobare.</p>
          </div>
          <div className="leave-help-card leave-help-card-violet">
            <span className="leave-help-icon"><BadgeCheck size={18} /></span>
            <strong>4. Urmareste statusul</strong>
            <p>Dupa aprobare, zilele apar colorate in calendar si PDF-ul ramane in istoricul cererilor.</p>
          </div>
        </div>

        <div className="leave-user-list">
          {users.map((userItem) => {
            const uid = userItem.uid;
            const isExpanded = expandedUserId === uid;
            const isLoading = isExpanded && (!calendarData.timesheetsLoaded || !calendarData.leaveLoaded);
            const userThemeClass = getUserThemeClass(userItem.themeKey);

            return (
              <div key={uid} className={`leave-user-item ${userThemeClass}`}>
                <button
                  type="button"
                  data-assistant-action="view-leave-calendar"
                  className={`leave-user-trigger user-accent-surface ${userThemeClass} ${attentionClass(uid === user.uid)}`}
                  title="Deschide calendarul acestui utilizator"
                  onClick={() => setExpandedUserId(isExpanded ? "" : uid)}
                >
                  <span>{buildUserLabel(userItem)}</span>
                  <small>{userItem.email}</small>
                </button>

                {isExpanded && (
                  <div className={`leave-user-dropdown user-accent-surface ${userThemeClass}`}>
                    <div className="leave-inline-calendar-header">
                      <strong className="leave-month-title">{monthTitle}</strong>
                      <div className="leave-inline-calendar-actions">
                        <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} aria-label="Luna anterioara"><ChevronLeft size={16} /></button>
                        <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} aria-label="Luna urmatoare"><ChevronRight size={16} /></button>
                        <button className="secondary-btn" type="button" onClick={() => setShowYearCalendar(true)}>Fullscreen</button>
                      </div>
                    </div>
                    {isLoading ? (
                      <p className="tools-subtitle">Se incarca calendarul...</p>
                    ) : (
                      renderMonthCalendar(visibleMonth, uid, true)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div id="leave-form" className="panel" data-assistant-section="leave-form">
        <h3 className="panel-title">Formular cerere concediu / zi libera</h3>
        <div className="leave-form-guide">
          <div>
            <strong>Ce trebuie completat?</strong>
            <span>Nume, companie, functie, departament, tip solicitare, perioada si semnatura.</span>
          </div>
          <div>
            <strong>Ce se intampla dupa trimitere?</strong>
            <span>Se genereaza cererea PDF si ramane in asteptare pana cand adminul o aproba.</span>
          </div>
        </div>

        <form className="tool-form" onSubmit={handleSubmit}>
          <div className="tool-form-grid">
            <label className={`tool-form-block ${attentionClass(!formValues.userName.trim())}`}>
              <span className="tool-form-label">Nume salariat</span>
              <input className="tool-input" data-assistant-field="leave-user-name" value={formValues.userName} onChange={(event) => setFormValues((prev) => ({ ...prev, userName: event.target.value }))} required />
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.userEmail.trim())}`}>
              <span className="tool-form-label">Email</span>
              <input className="tool-input" data-assistant-field="leave-user-email" type="email" value={formValues.userEmail} onChange={(event) => setFormValues((prev) => ({ ...prev, userEmail: event.target.value }))} required />
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.companyName.trim())}`}>
              <span className="tool-form-label">Companie</span>
              <input className="tool-input" data-assistant-field="leave-company" value={formValues.companyName} onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))} placeholder="Ex: SC Exemplu Construct SRL" required />
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.roleTitle.trim())}`}>
              <span className="tool-form-label">Functie</span>
              <input className="tool-input" data-assistant-field="leave-role-title" value={formValues.roleTitle} onChange={(event) => setFormValues((prev) => ({ ...prev, roleTitle: event.target.value }))} placeholder="Ex: Tehnician" required />
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.department.trim())}`}>
              <span className="tool-form-label">Departament</span>
              <input className="tool-input" data-assistant-field="leave-department" value={formValues.department} onChange={(event) => setFormValues((prev) => ({ ...prev, department: event.target.value }))} placeholder="Ex: Operational" required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Tip solicitare</span>
              <select className="tool-input" data-assistant-field="leave-request-type" value={formValues.requestType} onChange={(event) => setFormValues((prev) => ({ ...prev, requestType: event.target.value as LeaveRequestFormValues["requestType"] }))}>
                <option value="concediu_odihna">Concediu de odihna</option>
                <option value="zi_libera_platita">Zi libera platita</option>
                <option value="zi_libera_eveniment">Zi libera eveniment deosebit</option>
              </select>
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.periodStart)}`}>
              <span className="tool-form-label">Data inceput</span>
              <input className="tool-input" data-assistant-field="leave-start-date" type="date" value={formValues.periodStart} onChange={(event) => setFormValues((prev) => ({ ...prev, periodStart: event.target.value }))} required />
            </label>

            <label className={`tool-form-block ${attentionClass(!formValues.periodEnd)}`}>
              <span className="tool-form-label">Data sfarsit</span>
              <input className="tool-input" data-assistant-field="leave-end-date" type="date" value={formValues.periodEnd} onChange={(event) => setFormValues((prev) => ({ ...prev, periodEnd: event.target.value }))} required />
            </label>
            {overlappingTeamLeave.length ? (
              <div className="tool-message tool-form-block-full" role="status">
                <strong>Posibil conflict de echipă:</strong> {overlappingTeamLeave.length} colegi au cereri suprapuse în această perioadă.
                <div className="simple-list-subtitle">
                  {overlappingTeamLeave.slice(0, 4).map((request) => `${request.userName}: ${request.periodStart} - ${request.periodEnd}`).join(" · ")}
                </div>
              </div>
            ) : null}

            <label className="tool-form-block tool-form-block-full">
              <span className="tool-form-label">Motiv (optional)</span>
              <textarea className="tool-input tool-textarea" data-assistant-field="leave-reason" value={formValues.reason} onChange={(event) => setFormValues((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Detaliaza pe scurt motivul solicitarii." />
            </label>

            <label className={`tool-form-block tool-form-block-full ${attentionClass(!formValues.signatureData)}`}>
              <span className="tool-form-label">Semnatura</span>
              <canvas
                ref={signatureCanvasRef}
                data-assistant-field="leave-signature"
                width={420}
                height={120}
                className={`leave-signature-pad ${attentionClass(!formValues.signatureData)}`}
                onPointerDown={startSignature}
                onPointerMove={drawSignature}
                onPointerUp={endSignature}
              />
              <div className="tool-form-actions" style={{ padding: 0 }}>
                <button className="secondary-btn" data-assistant-action="clear-leave-signature" type="button" onClick={clearSignature} title="Sterge semnatura si o poti face din nou">Sterge semnatura</button>
              </div>
            </label>
          </div>

          {error && <div className="status-error">{error}</div>}
          {success && <div className="status-ok">{success}</div>}

          <div className="tool-form-actions">
            <button className={`primary-btn ${attentionClass(leaveFormNeedsAttention)}`} data-assistant-action="submit-leave-request" type="submit" title="Trimite cererea catre manager" disabled={submitting}>{submitting ? "Se genereaza..." : "Trimite cererea"}</button>
          </div>
        </form>
      </div>

      <div id="my-leave-requests" className="panel" data-assistant-section="my-leave-requests">
        <h3 className="panel-title">Cererile mele</h3>
        {myLeaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu ai cereri depuse momentan.</p>
        ) : (
          <div className="simple-list">
            {myLeaveRequests.map((request) => (
              <div
                id={`leave-request-${request.id}`}
                key={request.id}
                className={`simple-list-item user-history-row ${getUserThemeClass(userThemeById.get(request.userId))} leave-history-item leave-history-item-vertical ${attentionClass(request.id === submittedLeaveRequestId)}`}
              >
                <div className="simple-list-text">
                  <div className="simple-list-label">{requestTypeLabel(request.requestType)}</div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} - {request.requestedDays} zile - status: {request.status.replace("_", " ")}
                  </div>
                  <div className="simple-list-subtitle">
                    {request.companyName || "Fara companie"} - {request.roleTitle || "Fara functie"} - {request.department || "Fara departament"}
                  </div>
                </div>
                <div className="leave-admin-actions">
                  {request.pdfDataUrl ? (
                    <>
                      <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
                      <button
                        className="secondary-btn"
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
                    </>
                  ) : null}
                  <span className={request.status === "aprobat" ? "badge badge-green" : "badge badge-orange"}>
                    {request.status.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="leave-approvals" className="panel">
        <h3 className="panel-title">Cereri in asteptare (admin)</h3>
        {!isAdmin ? (
          <p className="tools-subtitle">Doar adminii pot aproba cereri.</p>
        ) : pendingLeaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri in asteptare.</p>
        ) : (
          <div className="simple-list">
            {pendingLeaveRequests.map((request) => (
              <div key={request.id} className={`simple-list-item user-history-row ${getUserThemeClass(userThemeById.get(request.userId))} leave-history-item`}>
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    <UserProfileLink userId={request.userId} name={request.userName} themeKey={userThemeById.get(request.userId)} />
                    {" "}· {requestTypeLabel(request.requestType)}
                  </div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} · {request.requestedDays} zile
                  </div>
                </div>
                <div className="leave-admin-actions">
                  <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
                  <button
                    className="secondary-btn"
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
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => handleApproveRequest(request.id)}
                    disabled={approvingRequestId === request.id}
                  >
                    {approvingRequestId === request.id ? "Se aproba..." : "Aproba"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Istoric cereri aprobate</h3>
        {approvedRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri aprobate momentan.</p>
        ) : (
          <div className="simple-list">
            {approvedRequests.map((request) => (
              <div key={request.id} className={`simple-list-item user-history-row ${getUserThemeClass(userThemeById.get(request.userId))} leave-history-item leave-history-item-vertical`}>
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    <UserProfileLink userId={request.userId} name={request.userName} themeKey={userThemeById.get(request.userId)} />
                    {" "}· {requestTypeLabel(request.requestType)}
                  </div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} · {request.requestedDays} zile · emis la {new Date(request.issuedAt).toLocaleString("ro-RO")}
                  </div>
                  <div className="simple-list-subtitle">Status: {request.status.replace("_", " ")}</div>
                </div>
                <div className="leave-admin-actions">
                  <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
                  <button
                    className="secondary-btn"
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
                  {(isAdmin || request.userId === user.uid) && (
                    <button className="danger-btn" type="button" onClick={() => handleDeleteRequest(request.id)} disabled={deletingRequestId === request.id}>
                      {deletingRequestId === request.id ? "Se sterge..." : "Sterge PDF (cerere)"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showYearCalendar && (
        <div className="leave-year-modal" role="dialog" aria-modal="true">
          <div className="panel leave-year-modal-panel">
            <div className="leave-calendar-nav">
              <strong className="leave-month-title">Calendar fullscreen · {expandedUserName} · {visibleMonth.getFullYear()}</strong>
              <div className="leave-inline-calendar-actions">
                <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear() - 1, visibleMonth.getMonth(), 1))} aria-label="An precedent"><ChevronLeft size={16} /></button>
                <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear() + 1, visibleMonth.getMonth(), 1))} aria-label="An urmator"><ChevronRight size={16} /></button>
                <button className="primary-btn" type="button" onClick={() => setShowYearCalendar(false)}>Exit fullscreen</button>
              </div>
            </div>
            <div className="leave-year-grid leave-year-grid-calendars">
              {yearMonths.map((monthDate) => (
                <div key={monthDate.toISOString()} className="leave-year-month-calendar">
                  <div className="leave-year-month-title">{monthDate.toLocaleDateString("ro-RO", { month: "long" })}</div>
                  {renderMonthCalendar(monthDate, `year-${monthDate.toISOString()}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
