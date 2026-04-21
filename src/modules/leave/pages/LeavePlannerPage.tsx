import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../../../providers/AuthProvider";
import { db } from "../../../lib/firebase/firebase";
import type { TimesheetItem } from "../../../types/timesheet";
import type { LeaveRequestFormValues, LeaveRequestItem } from "../../../types/leave";
import {
  getLeaveDateSet,
  getWorkedMinutesByDay,
  saveLeaveRequest,
  subscribeLeaveRequestsForUser,
} from "../services/leaveRequestsService";

const weekDays = ["L", "Ma", "Mi", "J", "V", "S", "D"];

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

export default function LeavePlannerPage() {
  const { user } = useAuth();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!user?.uid) return;

    setLoading(true);

    const timesheetUnsub = onSnapshot(
      query(
        collection(db, "timesheets"),
        where("userId", "==", user.uid),
        orderBy("startAt", "desc"),
        limit(500)
      ),
      (snap) => {
        const mapped: TimesheetItem[] = snap.docs.map((docItem) => ({
          id: docItem.id,
          userId: docItem.data().userId ?? "",
          userName: docItem.data().userName ?? "",
          userThemeKey: docItem.data().userThemeKey ?? null,
          projectId: docItem.data().projectId ?? "",
          projectCode: docItem.data().projectCode ?? "",
          projectName: docItem.data().projectName ?? "",
          status: docItem.data().status ?? "activ",
          explanation: docItem.data().explanation ?? "",
          startAt: Number(docItem.data().startAt ?? Date.now()),
          stopAt: docItem.data().stopAt ?? null,
          workedMinutes: Number(docItem.data().workedMinutes ?? 0),
          startLocation: docItem.data().startLocation ?? { lat: null, lng: null, label: "" },
          stopLocation: docItem.data().stopLocation ?? null,
          startSource: docItem.data().startSource ?? "web",
          stopSource: docItem.data().stopSource ?? "",
          workDate: docItem.data().workDate ?? "",
          yearMonth: docItem.data().yearMonth ?? "",
          weekKey: docItem.data().weekKey ?? "",
          createdAt: Number(docItem.data().createdAt ?? Date.now()),
          updatedAt: Number(docItem.data().updatedAt ?? Date.now()),
        }));

        setTimesheets(mapped);
        setLoading(false);
      }
    );

    const leaveUnsub = subscribeLeaveRequestsForUser(user.uid, (items) => {
      setLeaveRequests(items);
      setLoading(false);
    });

    return () => {
      timesheetUnsub();
      leaveUnsub();
    };
  }, [user?.uid]);

  const workedMinutesByDay = useMemo(() => getWorkedMinutesByDay(timesheets), [timesheets]);
  const leaveDateSet = useMemo(() => getLeaveDateSet(leaveRequests), [leaveRequests]);

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
            <p className="tools-subtitle">{user.displayName || user.email} · Calendar lunar cu pontaje (mov) si concedii/invoiri (galben).</p>
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

        <div className="leave-calendar-grid">
          {weekDays.map((day) => (
            <div key={day} className="leave-cell leave-cell-head">{day}</div>
          ))}
          {monthCells.map((date) => {
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
              <div key={iso} className={className}>
                <div className="leave-cell-day">{date.getDate()}</div>
                {minutes > 0 && <div className="leave-cell-minutes">{minutes} min</div>}
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
        {loading ? (
          <p className="tools-subtitle">Se incarca cererile...</p>
        ) : leaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri emise momentan.</p>
        ) : (
          <div className="simple-list">
            {leaveRequests.map((request) => (
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
