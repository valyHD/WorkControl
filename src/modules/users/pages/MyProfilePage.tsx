import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AppUser, ToolItem } from "../../../types/tool";
import { useAuth } from "../../../providers/AuthProvider";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Camera,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  ImageIcon,
  Mail,
  MapPin,
  Save,
  ShieldCheck,
  Timer,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  getToolsHeldByUserFromOthers,
  getToolsOwnedByUser,
  getToolsOwnedByUserButHeldByOthers,
  getUsersList,
} from "../../tools/services/toolsService";
import { subscribeVehiclesList } from "../../vehicles/services/vehiclesService";
import MyToolCard from "../components/MyToolCard";
import type { VehicleItem } from "../../../types/vehicle";
import type { TimesheetItem } from "../../../types/timesheet";
import type { LeaveRequestItem } from "../../../types/leave";
import type { CompanyItem } from "../../../types/company";
import { getCompaniesList, setUserPrimaryCompany } from "../../companies/services/companiesService";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { updateUserWorkDetails, uploadUserAvatar } from "../services/usersService";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";

type MyNotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  module?: string;
  eventType?: string;
};

const DATE_LABEL = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium" });
const DATE_TIME_LABEL = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short" });
const MONTH_LABEL = new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" });
const TIME_LABEL = new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit" });
const WEEK_DAYS = ["Lu", "Ma", "Mi", "Jo", "Vi", "Sa", "Du"];
const MAX_ACTIVE_CALENDAR_MINUTES = 12 * 60;
const ROLE_TITLE_OPTIONS = [
  "Electrician",
  "Montator lifturi",
  "Tehnician service lifturi",
  "Mecanic utilaje",
  "Operator utilaje",
  "Sofer",
  "Lacatus mecanic",
  "Sudor",
  "Gestionar depozit",
  "Coordonator echipa",
  "Inginer",
  "Administrator",
  "Ajutor montator",
  "Necalificat",
];
const DEPARTMENT_OPTIONS = [
  "Montaj Lifturi",
  "Service si Intretinere Lifturi",
  "Logistica si Transport",
  "Depozit si Aprovizionare",
  "Administrativ",
];

function CompactSection({
  title,
  subtitle,
  preview,
  icon,
  tone = "blue",
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  preview?: ReactNode;
  icon: ReactNode;
  tone?: "blue" | "green" | "orange" | "purple" | "cyan";
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={`panel profile-collapsible my-profile-section is-${tone}`} open={defaultOpen}>
      <summary className="profile-collapsible__summary">
        <div className="my-profile-section-title">
          <span className={`my-profile-section-icon is-${tone}`}>{icon}</span>
          <div>
            <h3 className="panel-title">{title}</h3>
            {subtitle && <p className="tools-subtitle">{subtitle}</p>}
            {preview && <div className="profile-collapsible__preview">{preview}</div>}
          </div>
        </div>
        <span className="badge profile-collapsible__details-badge">Detalii</span>
      </summary>
      <div className="profile-collapsible__body">{children}</div>
    </details>
  );
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

function formatTime(value?: number | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return TIME_LABEL.format(date);
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function getLeaveTypeLabel(type: LeaveRequestItem["requestType"]) {
  if (type === "zi_libera_platita") return "Zi libera platita";
  if (type === "zi_libera_eveniment") return "Zi libera eveniment";
  return "Concediu de odihna";
}

function getLeaveRequestFileName(request: LeaveRequestItem) {
  const name = request.userName || request.userEmail || request.userId || "utilizator";
  return `cerere-concediu-${name}-${request.periodStart}-${request.periodEnd}.pdf`;
}

function getLeaveDaySet(requests: LeaveRequestItem[]) {
  const days = new Map<string, LeaveRequestItem>();

  requests.forEach((request) => {
    if (!request.periodStart || !request.periodEnd) return;
    const start = new Date(`${request.periodStart}T00:00:00`);
    const end = new Date(`${request.periodEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    const cursor = new Date(start);
    while (cursor <= end) {
      days.set(toIsoDate(cursor), request);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return days;
}

function getTimesheetMinutes(timesheet: TimesheetItem) {
  if (timesheet.status === "activ" && timesheet.startAt) {
    return Math.max(0, Math.round((Date.now() - timesheet.startAt) / 60000));
  }
  return Number(timesheet.workedMinutes || 0);
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

function getTimesheetStatusLabel(status: TimesheetItem["status"]) {
  if (status === "activ") return "Activ";
  if (status === "inchis") return "Oprit";
  if (status === "corectat") return "Corectat";
  if (status === "intarziat") return "Intarziat";
  return "Neincheiat";
}

function getVehicleImage(vehicle: VehicleItem) {
  return vehicle.coverThumbUrl || vehicle.coverImageUrl || vehicle.images?.[0]?.thumbUrl || vehicle.images?.[0]?.url || "";
}

function getVehicleStatusLabel(status: VehicleItem["status"]) {
  if (status === "in_service") return "In service";
  if (status === "indisponibila") return "Indisponibila";
  if (status === "avariata") return "Avariata";
  return "Activa";
}

function StatPill({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <span className="my-profile-stat-pill">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export default function MyProfilePage() {
  const { user } = useAuth();

  const [ownedTools, setOwnedTools] = useState<ToolItem[]>([]);
  const [borrowedTools, setBorrowedTools] = useState<ToolItem[]>([]);
  const [givenTools, setGivenTools] = useState<ToolItem[]>([]);
  const [myVehicles, setMyVehicles] = useState<VehicleItem[]>([]);
  const [myTimesheets, setMyTimesheets] = useState<TimesheetItem[]>([]);
  const [myNotifications, setMyNotifications] = useState<MyNotificationItem[]>([]);
  const [myLeaveRequests, setMyLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [selectedCompanyKey, setSelectedCompanyKey] = useState("");
  const [roleTitle, setRoleTitle] = useState(user?.roleTitle || "");
  const [department, setDepartment] = useState(user?.department || "");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [companySaving, setCompanySaving] = useState(false);
  const [companyMessage, setCompanyMessage] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [avatarThumbUrl, setAvatarThumbUrl] = useState(user?.avatarThumbUrl || user?.avatarUrl || "");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const [owned, borrowed, given, usersData, companiesData] = await Promise.all([
        getToolsOwnedByUser(user.uid),
        getToolsHeldByUserFromOthers(user.uid),
        getToolsOwnedByUserButHeldByOthers(user.uid),
        getUsersList(),
        getCompaniesList(),
      ]);

      setOwnedTools(owned);
      setBorrowedTools(borrowed);
      setGivenTools(given);
      setUsers(usersData);
      setCompanies(companiesData);
      const currentUserData = usersData.find((item) => item.id === user.uid);
      setSelectedCompanyKey(currentUserData?.primaryCompanyId || "");
      setRoleTitle(currentUserData?.roleTitle || user.roleTitle || "");
      setDepartment(currentUserData?.department || user.department || "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setAvatarUrl(user?.avatarUrl || "");
    setAvatarThumbUrl(user?.avatarThumbUrl || user?.avatarUrl || "");
  }, [user?.avatarThumbUrl, user?.avatarUrl]);

  useEffect(() => {
    setRoleTitle(user?.roleTitle || "");
    setDepartment(user?.department || "");
  }, [user?.department, user?.roleTitle]);

  useEffect(() => {
    if (!user?.uid) return;

    const companyIds = Array.from(new Set([
      user.primaryCompanyId,
      ...(user.companyIds ?? []),
    ].filter(Boolean))).slice(0, 10);
    if (companyIds.length === 0) return;
    const companyConstraint = companyIds.length === 1
      ? where("companyId", "==", companyIds[0])
      : where("companyId", "in", companyIds);

    void load();

    const vehiclesUnsubscribe = subscribeVehiclesList((items) => {
      setMyVehicles(
        items
          .filter((item) => item.ownerUserId === user.uid || item.currentDriverUserId === user.uid)
          .slice(0, 20)
      );
    });
    const timesheetsUnsubscribe = onSnapshot(
      query(
        collection(db, "timesheets"),
        companyConstraint,
        where("userId", "==", user.uid),
        orderBy("startAt", "desc"),
        limit(20)
      ),
      (timesheetsSnap) => {
        setMyTimesheets(
          timesheetsSnap.docs.map((docItem) => {
            const data = docItem.data();
            const rawStatus = data.status ?? "activ";
            const normalizedStatus = rawStatus === "neinchis" && data.stopAt ? "corectat" : rawStatus;
            return {
              id: docItem.id,
              userId: data.userId ?? "",
              userName: data.userName ?? "",
              userThemeKey: data.userThemeKey ?? null,
              projectId: data.projectId ?? "",
              projectCode: data.projectCode ?? "",
              projectName: data.projectName ?? "",
              status: normalizedStatus,
              explanation: data.explanation ?? "",
              startExplanation: data.startExplanation ?? "",
              stopExplanation: data.stopExplanation ?? "",
              startPolicyFlag: data.startPolicyFlag ?? "",
              stopPolicyFlag: data.stopPolicyFlag ?? "",
              startExpectedTime: data.startExpectedTime ?? "",
              stopExpectedMinutes: typeof data.stopExpectedMinutes === "number" ? data.stopExpectedMinutes : null,
              startAt: data.startAt ?? Date.now(),
              stopAt: data.stopAt ?? null,
              workedMinutes: Number(data.workedMinutes ?? 0),
              startLocation: data.startLocation ?? { lat: null, lng: null, label: "" },
              stopLocation: data.stopLocation ?? null,
              startSource: data.startSource ?? "web",
              stopSource: data.stopSource ?? "",
              workDate: data.workDate ?? "",
              yearMonth: data.yearMonth ?? "",
              weekKey: data.weekKey ?? "",
              createdAt: data.createdAt ?? Date.now(),
              updatedAt: data.updatedAt ?? Date.now(),
              companyId: data.companyId ?? "",
            } as TimesheetItem;
          })
        );
      }
    );
    const notificationsUnsubscribe = onSnapshot(
      query(collection(db, "notifications"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(10)),
      (notificationsSnap) => {
        setMyNotifications(
          notificationsSnap.docs.map((docItem) => ({
            id: docItem.id,
            title: docItem.data().title ?? "Notificare",
            message: docItem.data().message ?? "",
            createdAt: docItem.data().createdAt ?? Date.now(),
            read: Boolean(docItem.data().read ?? false),
            module: docItem.data().module ?? "",
            eventType: docItem.data().eventType ?? "",
          }))
        );
      }
    );
    const leaveUnsubscribe = onSnapshot(
      query(
        collection(db, "leaveRequests"),
        companyConstraint,
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(20)
      ),
      (leaveSnap) => {
        setMyLeaveRequests(
          leaveSnap.docs
            .map((docItem) => {
              const data = docItem.data();
              return {
                id: docItem.id,
                userId: data.userId ?? "",
                userName: data.userName ?? "",
                userEmail: data.userEmail ?? "",
                companyName: data.companyName ?? "",
                roleTitle: data.roleTitle ?? "",
                department: data.department ?? "",
                requestType:
                  data.requestType === "zi_libera_platita" || data.requestType === "zi_libera_eveniment"
                    ? data.requestType
                    : "concediu_odihna",
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
                companyId: data.companyId ?? "",
              } as LeaveRequestItem;
            })
            .filter((request) => request.status === "aprobat")
        );
      }
    );

    return () => {
      vehiclesUnsubscribe();
      timesheetsUnsubscribe();
      notificationsUnsubscribe();
      leaveUnsubscribe();
    };
  }, [user?.uid, user?.primaryCompanyId, user?.companyIds]);

  const selectedCompany = useMemo(
    () => companies.find((item) => item.companyKey === selectedCompanyKey) || null,
    [companies, selectedCompanyKey]
  );

  const leaveDays = useMemo(() => getLeaveDaySet(myLeaveRequests), [myLeaveRequests]);
  const timesheetMinutesByDay = useMemo(() => groupTimesheetMinutesByDay(myTimesheets), [myTimesheets]);
  const calendarDays = useMemo(() => getMonthDays(calendarMonth), [calendarMonth]);
  const todayKey = toIsoDate(new Date());
  const missingAvatar = !(avatarThumbUrl || avatarUrl);
  const needsAttentionClass = (condition: boolean) => (condition ? "attention-pulse" : "");

  const timesheetStats = useMemo(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = toIsoDate(now);
    return myTimesheets.reduce(
      (acc, item) => {
        const minutes = getTimesheetMinutes(item);
        if (item.workDate === today) acc.today += minutes;
        if ((item.yearMonth || item.workDate?.slice(0, 7)) === currentMonth) acc.month += minutes;
        if (item.status === "activ") acc.active += 1;
        return acc;
      },
      { today: 0, month: 0, active: 0 }
    );
  }, [myTimesheets]);

  const toolChangeInitiator = useMemo(
    () => ({
      userId: user?.uid ?? "",
      userName: user?.displayName || user?.email || "Utilizator",
      userThemeKey: user?.themeKey ?? null,
    }),
    [user?.displayName, user?.email, user?.themeKey, user?.uid]
  );

  async function saveMyWorkProfile() {
    if (!user?.uid) return;
    const company = companies.find((item) => item.companyKey === selectedCompanyKey) || null;
    setCompanySaving(true);
    setCompanyMessage("");
    try {
      await Promise.all([
        setUserPrimaryCompany({ userId: user.uid, company }),
        updateUserWorkDetails(user.uid, { roleTitle, department }),
      ]);
      setCompanyMessage("Datele tale de lucru au fost salvate.");
    } catch (err) {
      console.error("[MyProfilePage][save work profile]", err);
      setCompanyMessage("Nu am putut salva datele de lucru.");
    } finally {
      setCompanySaving(false);
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!file || !user?.uid) return;
    setAvatarSaving(true);
    setAvatarMessage("");

    try {
      const avatar = await uploadUserAvatar(user.uid, file);
      setAvatarUrl(avatar.avatarUrl);
      setAvatarThumbUrl(avatar.avatarThumbUrl || avatar.avatarUrl);
      setAvatarMessage("Avatar salvat. Poza va aparea peste tot unde este numele tau.");
    } catch (err) {
      console.error("[MyProfilePage][avatar]", err);
      setAvatarMessage("Nu am putut salva avatarul. Alege o poza clara.");
    } finally {
      setAvatarSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="placeholder-page">
        <h2>Nu esti autentificat</h2>
        <p>Intra in cont pentru a vedea profilul.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca profilul...</h2>
        <p>Preluam sculele, masinile, pontajele si concediile tale.</p>
      </div>
    );
  }

  return (
    <section className="page-section user-profile-page my-profile-page">
      <div className="user-profile-hero my-profile-hero-rich">
        <div className="user-profile-hero-main">
          <label className={`user-profile-avatar my-profile-avatar-upload ${getUserThemeClass(user.themeKey)} ${needsAttentionClass(missingAvatar)}`}>
            {avatarThumbUrl || avatarUrl ? (
              <img src={avatarThumbUrl || avatarUrl} alt="" />
            ) : (
              getUserInitials(user.displayName || user.email || "EU")
            )}
            <span className="my-profile-avatar-upload__badge">
              <Camera size={14} />
            </span>
            <input
              type="file"
              accept="image/*"
              disabled={avatarSaving}
              onChange={(event) => void handleAvatarChange(event.target.files?.[0] || null)}
            />
          </label>
          <div>
            <span className="my-profile-eyebrow">
              <ShieldCheck size={15} />
              Profil personal
            </span>
            <h2 className="panel-title">Profilul meu</h2>
            <p className="panel-subtitle">{user.displayName || "Utilizator WorkControl"}</p>
            <div className="user-profile-facts">
              <span>
                <UserRound size={15} /> {user.displayName || "Fara nume"}
              </span>
              <span>
                <Mail size={15} /> {user.email}
              </span>
              <span>
                <Building2 size={15} /> {selectedCompany?.companyName || "Firma nesetata"}
              </span>
              <span>
                <BriefcaseBusiness size={15} /> {roleTitle || "Functie nesetata"}
              </span>
              <span>
                <ShieldCheck size={15} /> {department || "Departament nesetat"}
              </span>
            </div>
            <div className="my-profile-avatar-actions">
              <label className="secondary-btn">
                <Camera size={15} />
                {avatarSaving ? "Se incarca..." : "Schimba avatar"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={avatarSaving}
                  onChange={(event) => void handleAvatarChange(event.target.files?.[0] || null)}
                />
              </label>
              {avatarMessage && <span className="tools-subtitle">{avatarMessage}</span>}
            </div>
          </div>
        </div>
        <div className="my-profile-hero-actions">
          <Link to="/users" className="secondary-btn">
            <UserRound size={16} />
            Profil public
          </Link>
          <Link to="/my-leave" className="primary-btn">
            <CalendarDays size={16} />
            Calendar concedii
          </Link>
        </div>
      </div>

      <div className="my-profile-summary-grid">
        <div className="my-profile-summary-card is-tools">
          <span>
            <Wrench size={20} />
          </span>
          <small>Scule</small>
          <strong>{ownedTools.length + borrowedTools.length + givenTools.length}</strong>
        </div>
        <div className="my-profile-summary-card is-time">
          <span>
            <Clock3 size={20} />
          </span>
          <small>Pontaje</small>
          <strong>{formatMinutes(timesheetStats.month)}</strong>
        </div>
        <div className="my-profile-summary-card is-cars">
          <span>
            <CarFront size={20} />
          </span>
          <small>Masini</small>
          <strong>{myVehicles.length}</strong>
        </div>
        <div className="my-profile-summary-card is-alerts">
          <span>
            <Bell size={20} />
          </span>
          <small>Notificari necitite</small>
          <strong>{myNotifications.filter((item) => !item.read).length}</strong>
        </div>
      </div>

      <div className="panel my-profile-company-panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Firma, functia si departamentul</h3>
            <p className="panel-subtitle">Aceste date se folosesc automat in concedii, bonuri si rapoarte.</p>
          </div>
        </div>
        <div className="tool-form-grid">
          <div className={`tool-form-block ${needsAttentionClass(!selectedCompanyKey)}`}>
            <label className="tool-form-label">Firma mea</label>
            <select className="tool-input" value={selectedCompanyKey} onChange={(event) => setSelectedCompanyKey(event.target.value)}>
              <option value="">Fara firma selectata</option>
              {companies.map((company) => (
                <option key={company.id} value={company.companyKey}>
                  {company.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className={`tool-form-block ${needsAttentionClass(!roleTitle.trim())}`}>
            <label className="tool-form-label">Functie</label>
            <select className="tool-input" data-assistant-field="roleTitle" value={roleTitle} onChange={(event) => setRoleTitle(event.target.value)}>
              <option value="">Alege functia</option>
              {ROLE_TITLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className={`tool-form-block ${needsAttentionClass(!department.trim())}`}>
            <label className="tool-form-label">Departament</label>
            <select className="tool-input" data-assistant-field="department" value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">Alege departamentul</option>
              {DEPARTMENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="tool-form-actions">
          <button className="primary-btn" data-assistant-action="save-user" type="button" onClick={() => void saveMyWorkProfile()} disabled={companySaving}>
            <Save size={16} />
            {companySaving ? "Se salveaza..." : "Salveaza datele"}
          </button>
        </div>
        {companyMessage && <div className="tool-message success-message">{companyMessage}</div>}
      </div>

      <CompactSection
        title="Calendar concedii"
        subtitle="Zilele aprobate apar colorate direct in calendar."
        icon={<CalendarCheck2 size={20} />}
        tone="green"
        defaultOpen
        preview={
          <div className="my-profile-section-preview">
            <StatPill label="Aprobate" value={myLeaveRequests.length} icon={<CheckCircle2 size={14} />} />
            <StatPill label="Zile" value={myLeaveRequests.reduce((sum, item) => sum + Number(item.requestedDays || 0), 0)} icon={<CalendarDays size={14} />} />
          </div>
        }
      >
        <div className="my-profile-calendar-card">
          <div className="my-profile-calendar-head">
            <button
              className="icon-btn"
              type="button"
              aria-label="Luna anterioara"
              onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            >
              <ChevronLeft size={18} />
            </button>
            <strong>{MONTH_LABEL.format(calendarMonth)}</strong>
            <button
              className="icon-btn"
              type="button"
              aria-label="Luna urmatoare"
              onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="leave-calendar-grid leave-calendar-grid-compact my-profile-leave-calendar">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="leave-cell leave-cell-head">
                {day}
              </div>
            ))}
            {calendarDays.map((date) => {
              const dateKey = toIsoDate(date);
              const request = leaveDays.get(dateKey);
              const workedMinutes = timesheetMinutesByDay[dateKey] ?? 0;
              const outside = date.getMonth() !== calendarMonth.getMonth();
              return (
                <div
                  key={dateKey}
                  className={[
                    "leave-cell",
                    request ? "is-leave" : "",
                    workedMinutes > 0 ? "is-worked" : "",
                    request && workedMinutes > 0 ? "is-mixed" : "",
                    outside ? "is-outside" : "",
                    dateKey === todayKey ? "is-today" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <span className="leave-cell-day">{date.getDate()}</span>
                  {workedMinutes > 0 ? <span className="leave-cell-minutes">{formatMinutes(workedMinutes)}</span> : null}
                  {request ? <span className="user-profile-calendar-mark">{getLeaveTypeLabel(request.requestType)}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
        {myLeaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu ai cereri aprobate.</p>
        ) : (
          <div className="my-profile-card-grid">
            {myLeaveRequests.slice(0, 8).map((request) => (
              <div key={request.id} className="my-profile-info-card is-leave">
                <div>
                  <strong>{getLeaveTypeLabel(request.requestType)}</strong>
                  <small>{request.periodStart} - {request.periodEnd}</small>
                </div>
                <span>{request.requestedDays} zile</span>
                {request.pdfDataUrl ? (
                  <div className="leave-admin-actions">
                    <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">
                      PDF
                    </a>
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
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CompactSection>

      <CompactSection
        title="Istoric pontaje"
        subtitle="Pontajele apar cu proiect, ore, status, locatie si explicatii."
        icon={<Timer size={20} />}
        tone="purple"
        defaultOpen
        preview={
          <div className="my-profile-section-preview">
            <StatPill label="Azi" value={formatMinutes(timesheetStats.today)} icon={<Clock3 size={14} />} />
            <StatPill label="Luna" value={formatMinutes(timesheetStats.month)} icon={<Timer size={14} />} />
            <StatPill label="Active" value={timesheetStats.active} icon={<Bell size={14} />} />
          </div>
        }
      >
        {myTimesheets.length === 0 ? (
          <p className="tools-subtitle">Nu ai pontaje salvate.</p>
        ) : (
          <div className="my-profile-timesheet-list">
            {myTimesheets.map((timesheet) => (
              <article key={timesheet.id} className={`my-profile-timesheet-card is-${timesheet.status}`}>
                <div className="my-profile-timesheet-icon">
                  <Clock3 size={18} />
                </div>
                <div className="my-profile-timesheet-main">
                  <div className="my-profile-row-between">
                    <div>
                      <strong>{timesheet.projectName || timesheet.projectCode || "Fara proiect"}</strong>
                      <small>{formatDate(timesheet.workDate || timesheet.startAt)}</small>
                    </div>
                    <span className="badge">{getTimesheetStatusLabel(timesheet.status)}</span>
                  </div>
                  <div className="my-profile-stat-row">
                    <span>
                      <Timer size={14} /> {formatMinutes(getTimesheetMinutes(timesheet))}
                    </span>
                    <span>
                      <Clock3 size={14} /> {formatTime(timesheet.startAt)} - {timesheet.stopAt ? formatTime(timesheet.stopAt) : "in curs"}
                    </span>
                    <span>
                      <BriefcaseBusiness size={14} /> {timesheet.weekKey || timesheet.yearMonth || "fara perioada"}
                    </span>
                  </div>
                  <div className="my-profile-location-grid">
                    <span>
                      <MapPin size={14} /> Start: {timesheet.startLocation?.label || "fara locatie"}
                    </span>
                    <span>
                      <MapPin size={14} /> Stop: {timesheet.stopLocation?.label || (timesheet.stopAt ? "fara locatie" : "neoprit")}
                    </span>
                  </div>
                  {(timesheet.startExplanation || timesheet.stopExplanation || timesheet.explanation) && (
                    <div className="my-profile-explanation-box">
                      {timesheet.startExplanation ? <p><strong>Explicatie start:</strong> {timesheet.startExplanation}</p> : null}
                      {timesheet.stopExplanation ? <p><strong>Explicatie stop:</strong> {timesheet.stopExplanation}</p> : null}
                      {!timesheet.startExplanation && !timesheet.stopExplanation && timesheet.explanation ? <p>{timesheet.explanation}</p> : null}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </CompactSection>

      <CompactSection
        title="Masina mea"
        subtitle="Masinile tale apar cu poza, documente, kilometraj si GPS daca exista."
        icon={<CarFront size={20} />}
        tone="blue"
        preview={
          myVehicles.length === 0 ? (
            <p className="tools-subtitle">Nu ai masina alocata.</p>
          ) : (
            <div className="my-profile-section-preview">
              {myVehicles.slice(0, 2).map((vehicle) => (
                <StatPill key={vehicle.id} label={vehicle.plateNumber || "Masina"} value={`${Math.round(vehicle.currentKm || 0)} km`} icon={<Gauge size={14} />} />
              ))}
            </div>
          )
        }
      >
        {myVehicles.length === 0 ? (
          <p className="tools-subtitle">Nu ai masina alocata momentan.</p>
        ) : (
          <div className="my-profile-vehicle-grid">
            {myVehicles.map((vehicle) => {
              const imageUrl = getVehicleImage(vehicle);
              return (
                <article key={vehicle.id} className="my-profile-vehicle-card">
                  <div className="my-profile-vehicle-media">
                    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <ImageIcon size={30} />}
                    <span>{getVehicleStatusLabel(vehicle.status)}</span>
                  </div>
                  <div className="my-profile-vehicle-body">
                    <div className="my-profile-row-between">
                      <div>
                        <strong>{vehicle.plateNumber || "Fara numar"}</strong>
                        <small>{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Fara detalii"}</small>
                      </div>
                      <Link className="secondary-btn" to={`/vehicles/${vehicle.id}`}>
                        Deschide
                      </Link>
                    </div>
                    <div className="my-profile-stat-row">
                      <span><Gauge size={14} /> {Math.round(vehicle.currentKm || 0)} km</span>
                      <span><Wrench size={14} /> service {vehicle.nextServiceKm || "-"} km</span>
                      <span><CalendarDays size={14} /> ITP {vehicle.nextItpDate || "-"}</span>
                    </div>
                    <div className="my-profile-location-grid">
                      <span>Sofer: {vehicle.currentDriverUserName || "neasignat"}</span>
                      <span>GPS: {vehicle.gpsSnapshot?.online ? "online" : vehicle.tracker?.imei ? "tracker setat" : "fara tracker"}</span>
                      {vehicle.gpsSnapshot?.gpsTimestamp ? <span>Ultima pozitie: {formatDateTime(vehicle.gpsSnapshot.gpsTimestamp)}</span> : null}
                      <span>Poze: {vehicle.images?.length || 0} / Documente: {vehicle.documents?.length || 0}</span>
                    </div>
                    {vehicle.maintenanceNotes ? <p className="my-profile-note">{vehicle.maintenanceNotes}</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </CompactSection>

      <CompactSection
        title="Sculele mele"
        subtitle="Scule in responsabilitate, primite si date catre altii."
        icon={<Wrench size={20} />}
        tone="orange"
        preview={
          <div className="my-profile-section-preview">
            <StatPill label="La mine" value={ownedTools.length} icon={<Wrench size={14} />} />
            <StatPill label="Primite" value={borrowedTools.length} icon={<ChevronLeft size={14} />} />
            <StatPill label="Date" value={givenTools.length} icon={<ChevronRight size={14} />} />
          </div>
        }
      >
        <details className="my-profile-tool-group" open>
          <summary>
            <span><Wrench size={17} /> Scule in responsabilitate</span>
            <strong>{ownedTools.length}</strong>
          </summary>
          {ownedTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule in responsabilitate.</p>
          ) : (
            <div className="tools-grid">
              {ownedTools.map((tool) => (
                <MyToolCard key={tool.id} tool={tool} users={users} onChanged={load} showOwner={false} canManage={true} initiator={toolChangeInitiator} />
              ))}
            </div>
          )}
        </details>

        <details className="my-profile-tool-group">
          <summary>
            <span><ChevronLeft size={17} /> Scule primite de la altii</span>
            <strong>{borrowedTools.length}</strong>
          </summary>
          {borrowedTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule primite de la alti utilizatori.</p>
          ) : (
            <div className="tools-grid">
              {borrowedTools.map((tool) => (
                <MyToolCard key={tool.id} tool={tool} users={users} onChanged={load} canManage={false} initiator={toolChangeInitiator} />
              ))}
            </div>
          )}
        </details>

        <details className="my-profile-tool-group">
          <summary>
            <span><ChevronRight size={17} /> Scule date altora</span>
            <strong>{givenTools.length}</strong>
          </summary>
          {givenTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule date altor utilizatori.</p>
          ) : (
            <div className="tools-grid">
              {givenTools.map((tool) => (
                <MyToolCard key={tool.id} tool={tool} users={users} onChanged={load} showOwner={false} canManage={true} initiator={toolChangeInitiator} />
              ))}
            </div>
          )}
        </details>
      </CompactSection>

      <CompactSection
        title="Istoric notificari"
        subtitle="Notificarile personale sunt grupate vizual dupa citite si necitite."
        icon={<Bell size={20} />}
        tone="cyan"
        preview={
          <div className="my-profile-section-preview">
            <StatPill label="Total" value={myNotifications.length} icon={<Bell size={14} />} />
            <StatPill label="Noi" value={myNotifications.filter((item) => !item.read).length} icon={<CheckCircle2 size={14} />} />
          </div>
        }
      >
        {myNotifications.length === 0 ? (
          <p className="tools-subtitle">Nu ai notificari momentan.</p>
        ) : (
          <div className="my-profile-notification-list">
            {myNotifications.map((notification) => (
              <article key={notification.id} className={`my-profile-notification-card ${notification.read ? "is-read" : "is-unread"}`}>
                <span className="my-profile-notification-icon">
                  <Bell size={16} />
                </span>
                <div>
                  <div className="my-profile-row-between">
                    <strong>{notification.title}</strong>
                    <small>{formatDateTime(notification.createdAt)}</small>
                  </div>
                  <p>{notification.message || "Fara mesaj."}</p>
                  <div className="my-profile-stat-row">
                    <span>{notification.read ? "Citita" : "Noua"}</span>
                    {notification.module ? <span>Modul: {notification.module}</span> : null}
                    {notification.eventType ? <span>Eveniment: {notification.eventType}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </CompactSection>
    </section>
  );
}
