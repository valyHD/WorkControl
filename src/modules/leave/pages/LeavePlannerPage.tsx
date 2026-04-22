import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../../../providers/AuthProvider";
import { db } from "../../../lib/firebase/firebase";
import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUserItem } from "../../../types/user";
import type { LeaveRequestFormValues, LeaveRequestItem } from "../../../types/leave";
import {
  getLeaveDateSet,
  getWorkedMinutesByDay,
  saveLeaveRequest,
} from "../services/leaveRequestsService";

const weekDays = ["L", "Ma", "Mi", "J", "V", "S", "D"];

type UserCalendarData = {
  timesheets: TimesheetItem[];
  leaveRequests: LeaveRequestItem[];
  timesheetsLoaded: boolean;
  leaveLoaded: boolean;
};

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthMatrix(baseDate: Date): Date[] {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startWeekday);

  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function defaultForm(userName: string, userEmail: string): LeaveRequestFormValues {
  return {
    userName,
    userEmail,
    companyName: "",
    roleTitle: "",
    requestType: "concediu_odihna",
    periodStart: "",
    periodEnd: "",
    reason: "",
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
    requestType: data.requestType === "invoire" ? "invoire" : "concediu_odihna",
    legalReason: data.legalReason ?? "",
    periodStart: data.periodStart ?? "",
    periodEnd: data.periodEnd ?? "",
    requestedDays: Number(data.requestedDays ?? 0),
    requestedMinutes: Number(data.requestedMinutes ?? 0),
    reason: data.reason ?? "",
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

export default function LeavePlannerPage() {
  const { user } = useAuth();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string>("");
  const [userCalendarData, setUserCalendarData] = useState<Record<string, UserCalendarData>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [formValues, setFormValues] = useState<LeaveRequestFormValues>(
    defaultForm(user?.displayName || user?.email || "", user?.email || "")
  );

  useEffect(() => {
    setFormValues(defaultForm(user?.displayName || user?.email || "", user?.email || ""));
  }, [user?.displayName, user?.email]);

  useEffect(() => {
    const usersQuery = query(collection(db, "users"), orderBy("createdAt", "asc"));

    return onSnapshot(usersQuery, (snap) => {
      const mapped = snap.docs.map((docItem) => {
        const data = docItem.data();
        return {
          id: docItem.id,
          uid: data.uid ?? docItem.id,
          fullName: data.fullName ?? "",
          email: data.email ?? "",
          active: data.active !== false,
          role: data.role ?? "angajat",
          themeKey: data.themeKey ?? undefined,
          createdAt: Number(data.createdAt ?? 0),
          updatedAt: Number(data.updatedAt ?? 0),
        } as AppUserItem;
      });

      setUsers(mapped);

      if (!expandedUserId) {
        setExpandedUserId(mapped[0]?.uid ?? "");
      }
    });
  }, [expandedUserId]);

  useEffect(() => {
    if (users.length === 0) {
      setUserCalendarData({});
      return;
    }

    const subscriptions: Array<() => void> = [];

    users.forEach((userItem) => {
      const uid = userItem.uid;

      setUserCalendarData((prev) => ({
        ...prev,
        [uid]: prev[uid] ?? {
          timesheets: [],
          leaveRequests: [],
          timesheetsLoaded: false,
          leaveLoaded: false,
        },
      }));

      const timesheetsUnsub = onSnapshot(
        query(collection(db, "timesheets"), where("userId", "==", uid), orderBy("startAt", "desc"), limit(500)),
        (snap) => {
          const mapped = snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));

          setUserCalendarData((prev) => ({
            ...prev,
            [uid]: {
              ...(prev[uid] ?? { leaveRequests: [], leaveLoaded: false }),
              timesheets: mapped,
              timesheetsLoaded: true,
            },
          }));
        }
      );

      const leaveUnsub = onSnapshot(
        query(collection(db, "leaveRequests"), where("userId", "==", uid), orderBy("createdAt", "desc")),
        (snap) => {
          const mapped = snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data()));

          setUserCalendarData((prev) => ({
            ...prev,
            [uid]: {
              ...(prev[uid] ?? { timesheets: [], timesheetsLoaded: false }),
              leaveRequests: mapped,
              leaveLoaded: true,
            },
          }));
        }
      );

      subscriptions.push(timesheetsUnsub, leaveUnsub);
    });

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [users]);

  const myRequests = useMemo(() => {
    if (!user?.uid) return [];
    return userCalendarData[user.uid]?.leaveRequests ?? [];
  }, [user?.uid, userCalendarData]);

  const myRequestsLoading = useMemo(() => {
    if (!user?.uid) return false;
    const ownData = userCalendarData[user.uid];
    if (!ownData) return true;
    return !ownData.leaveLoaded;
  }, [user?.uid, userCalendarData]);

  const monthCells = useMemo(() => getMonthMatrix(visibleMonth), [visibleMonth]);
  const monthTitle = useMemo(
    () => visibleMonth.toLocaleDateString("ro-RO", { month: "long", year: "numeric" }),
    [visibleMonth]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.uid) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      await saveLeaveRequest(user.uid, formValues);
      setSuccess("Cererea a fost generata si salvata cu PDF in lista de mai jos.");
      setFormValues((prev) => ({
        ...defaultForm(user.displayName || user.email || "", user.email || ""),
        companyName: prev.companyName,
        roleTitle: prev.roleTitle,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut salva cererea.");
    } finally {
      setSubmitting(false);
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
      <div className="panel">
        <div className="tools-header" style={{ paddingBottom: 12 }}>
          <div>
            <h2 className="panel-title">Concedii & zile lucrate</h2>
            <p className="tools-subtitle">Toti utilizatorii apar in lista, iar pe click vezi calendarul compact in dropdown.</p>
          </div>
          <a className="primary-btn" href="#leave-form">Programeaza concediu / cere liber</a>
        </div>

        <div className="leave-calendar-nav">
          <button className="secondary-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>Luna anterioara</button>
          <strong className="leave-month-title">{monthTitle}</strong>
          <button className="secondary-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>Luna urmatoare</button>
        </div>

        <div className="leave-legend">
          <span><i className="leave-dot leave-dot-worked" /> Zi lucrata (pontaj)</span>
          <span><i className="leave-dot leave-dot-leave" /> Concediu / invoire</span>
          <span><i className="leave-dot leave-dot-mixed" /> Pontaj + concediu in aceeasi zi</span>
        </div>

        <div className="leave-user-list">
          {users.map((userItem) => {
            const uid = userItem.uid;
            const userData = userCalendarData[uid];
            const isExpanded = expandedUserId === uid;
            const isLoading = !userData || !userData.timesheetsLoaded || !userData.leaveLoaded;
            const workedMinutesByDay = getWorkedMinutesByDay(userData?.timesheets ?? []);
            const leaveDateSet = getLeaveDateSet(userData?.leaveRequests ?? []);

            return (
              <div key={uid} className="leave-user-item">
                <button
                  type="button"
                  className="leave-user-trigger"
                  onClick={() => setExpandedUserId(isExpanded ? "" : uid)}
                >
                  <span>{buildUserLabel(userItem)}</span>
                  <small>{userItem.email}</small>
                </button>

                {isExpanded && (
                  <div className="leave-user-dropdown">
                    {isLoading ? (
                      <p className="tools-subtitle">Se incarca calendarul...</p>
                    ) : (
                      <div className="leave-calendar-grid leave-calendar-grid-compact">
                        {weekDays.map((day) => (
                          <div key={`${uid}-${day}`} className="leave-cell leave-cell-head">{day}</div>
                        ))}
                        {monthCells.map((date, index) => {
                          const iso = toIsoDate(date);
                          const minutes = workedMinutesByDay[iso] ?? 0;
                          const hasWork = minutes > 0;
                          const hasLeave = leaveDateSet.has(iso);
                          const outsideMonth = date.getMonth() !== visibleMonth.getMonth();

                          const className = [
                            "leave-cell",
                            outsideMonth ? "is-outside" : "",
                            hasWork && hasLeave ? "is-mixed" : hasWork ? "is-worked" : hasLeave ? "is-leave" : "",
                          ].join(" ");

                          return (
                            <div key={`${uid}-${iso}-${index}`} className={className}>
                              <div className="leave-cell-day">{date.getDate()}</div>
                              {minutes > 0 && <div className="leave-cell-minutes">{minutes} min</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div id="leave-form" className="panel">
        <h3 className="panel-title">Formular cerere concediu / invoire</h3>
        <p className="tools-subtitle">Model redactat pentru uz intern HR, cu referinte la Codul muncii (art. 144-151 si art. 152).</p>

        <form className="tool-form" onSubmit={handleSubmit}>
          <div className="tool-form-grid">
            <label className="tool-form-block">
              <span className="tool-form-label">Nume salariat</span>
              <input className="tool-input" value={formValues.userName} onChange={(event) => setFormValues((prev) => ({ ...prev, userName: event.target.value }))} required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Email</span>
              <input className="tool-input" type="email" value={formValues.userEmail} onChange={(event) => setFormValues((prev) => ({ ...prev, userEmail: event.target.value }))} required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Companie</span>
              <input className="tool-input" value={formValues.companyName} onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))} placeholder="Ex: SC Exemplu Construct SRL" required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Functie</span>
              <input className="tool-input" value={formValues.roleTitle} onChange={(event) => setFormValues((prev) => ({ ...prev, roleTitle: event.target.value }))} placeholder="Ex: Tehnician" />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Tip solicitare</span>
              <select className="tool-input" value={formValues.requestType} onChange={(event) => setFormValues((prev) => ({ ...prev, requestType: event.target.value as LeaveRequestFormValues["requestType"] }))}>
                <option value="concediu_odihna">Concediu de odihna</option>
                <option value="invoire">Invoire / zi libera</option>
              </select>
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Data inceput</span>
              <input className="tool-input" type="date" value={formValues.periodStart} onChange={(event) => setFormValues((prev) => ({ ...prev, periodStart: event.target.value }))} required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Data sfarsit</span>
              <input className="tool-input" type="date" value={formValues.periodEnd} onChange={(event) => setFormValues((prev) => ({ ...prev, periodEnd: event.target.value }))} required />
            </label>

            <label className="tool-form-block tool-form-block-full">
              <span className="tool-form-label">Motiv (declarativ)</span>
              <textarea className="tool-input tool-textarea" value={formValues.reason} onChange={(event) => setFormValues((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Detaliaza pe scurt motivul solicitarii." required />
            </label>
          </div>

          {error && <div className="status-error">{error}</div>}
          {success && <div className="status-ok">{success}</div>}

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={submitting}>{submitting ? "Se genereaza..." : "Genereaza cererea PDF"}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">Istoric cereri emise</h3>
        {myRequestsLoading ? (
          <p className="tools-subtitle">Se incarca cererile...</p>
        ) : myRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri emise momentan.</p>
        ) : (
          <div className="simple-list">
            {myRequests.map((request) => (
              <div key={request.id} className="simple-list-item leave-history-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{request.userName} · {request.requestType === "concediu_odihna" ? "Concediu de odihna" : "Invoire"}</div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} · {request.requestedDays} zile · emis la {new Date(request.issuedAt).toLocaleString("ro-RO")}
                  </div>
                  <div className="simple-list-subtitle">Status: {request.status.replace("_", " ")}</div>
                </div>
                <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
