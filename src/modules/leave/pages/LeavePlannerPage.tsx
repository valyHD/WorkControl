import { useEffect, useMemo, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../../../providers/AuthProvider";
import { db } from "../../../lib/firebase/firebase";
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

const weekDays = ["L", "Ma", "Mi", "J", "V", "S", "D"];

type UserCalendarData = {
  timesheets: TimesheetItem[];
  leaveRequests: LeaveRequestItem[];
  timesheetsLoaded: boolean;
  leaveLoaded: boolean;
};

type SignaturePoint = { x: number; y: number };

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

function getRomanianPublicHolidaySet(year: number): Set<string> {
  const fixedHolidays = [
    new Date(year, 0, 1),
    new Date(year, 0, 2),
    new Date(year, 0, 24),
    new Date(year, 4, 1),
    new Date(year, 5, 1),
    new Date(year, 7, 15),
    new Date(year, 10, 30),
    new Date(year, 11, 1),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
  ];
  const orthodoxEaster = getOrthodoxEasterDate(year);
  const movableHolidays = [
    shiftDate(orthodoxEaster, -2),
    orthodoxEaster,
    shiftDate(orthodoxEaster, 1),
    shiftDate(orthodoxEaster, 49),
    shiftDate(orthodoxEaster, 50),
  ];

  return new Set([...fixedHolidays, ...movableHolidays].map((date) => toIsoDate(date)));
}

function defaultForm(userName: string, userEmail: string): LeaveRequestFormValues {
  return {
    userName,
    userEmail,
    companyName: "",
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

export default function LeavePlannerPage() {
  const { user, role } = useAuth();
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
  const [myRequests, setMyRequests] = useState<LeaveRequestItem[]>([]);
  const [myRequestsLoaded, setMyRequestsLoaded] = useState(false);
  const [adminRequests, setAdminRequests] = useState<LeaveRequestItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [approvingRequestId, setApprovingRequestId] = useState("");
  const [deletingRequestId, setDeletingRequestId] = useState("");
  const [showYearCalendar, setShowYearCalendar] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [drawingSignature, setDrawingSignature] = useState(false);
  const [formValues, setFormValues] = useState<LeaveRequestFormValues>(
    defaultForm(user?.displayName || user?.email || "", user?.email || "")
  );
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureStrokeRef = useRef<SignaturePoint[]>([]);
  const signatureStrokesRef = useRef<SignaturePoint[][]>([]);

  useEffect(() => {
    setFormValues(defaultForm(user?.displayName || user?.email || "", user?.email || ""));
    signatureStrokesRef.current = [];
  }, [user?.displayName, user?.email]);

  useEffect(() => {
    if (!user?.uid) {
      setUsers([]);
      setExpandedUserId("");
      return undefined;
    }
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
      if (!expandedUserId) setExpandedUserId(mapped[0]?.uid ?? "");
    });
  }, [expandedUserId, user?.uid]);

  useEffect(() => {
    if (!expandedUserId) {
      setCalendarData({ timesheets: [], leaveRequests: [], timesheetsLoaded: false, leaveLoaded: false });
      return undefined;
    }

    setCalendarData({ timesheets: [], leaveRequests: [], timesheetsLoaded: false, leaveLoaded: false });

    const timesheetsUnsub = onSnapshot(
      query(collection(db, "timesheets"), where("userId", "==", expandedUserId), orderBy("startAt", "desc"), limit(500)),
      (snap) => {
        const mapped = snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));
        setCalendarData((prev) => ({ ...prev, timesheets: mapped, timesheetsLoaded: true }));
      }
    );

    const leaveUnsub = onSnapshot(
      query(collection(db, "leaveRequests"), where("userId", "==", expandedUserId), orderBy("createdAt", "desc")),
      (snap) => {
        const mapped = snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data()));
        setCalendarData((prev) => ({ ...prev, leaveRequests: mapped, leaveLoaded: true }));
      }
    );

    return () => {
      timesheetsUnsub();
      leaveUnsub();
    };
  }, [expandedUserId]);

  useEffect(() => {
    if (!user?.uid) {
      setMyRequests([]);
      setMyRequestsLoaded(false);
      return undefined;
    }

    setMyRequestsLoaded(false);

    return onSnapshot(
      query(collection(db, "leaveRequests"), where("userId", "==", user.uid), orderBy("createdAt", "desc")),
      (snap) => {
        setMyRequests(snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data())));
        setMyRequestsLoaded(true);
      }
    );
  }, [user?.uid]);

  useEffect(() => {
    return onSnapshot(query(collection(db, "leaveRequests"), orderBy("createdAt", "desc"), limit(500)), (snap) => {
      setAdminRequests(snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data())));
    });
  }, []);

  const monthTitle = useMemo(
    () => visibleMonth.toLocaleDateString("ro-RO", { month: "long", year: "numeric" }),
    [visibleMonth]
  );
  const workedMinutesByDay = useMemo(() => getWorkedMinutesByDay(calendarData.timesheets), [calendarData.timesheets]);
  const approvedLeaveDateSet = useMemo(
    () => getLeaveDateSet(calendarData.leaveRequests.filter((request) => request.status === "aprobat")),
    [calendarData.leaveRequests]
  );
  const romanianPublicHolidays = useMemo(() => getRomanianPublicHolidaySet(visibleMonth.getFullYear()), [visibleMonth]);
  const pendingLeaveRequests = useMemo(() => adminRequests.filter((request) => request.status === "in_asteptare"), [adminRequests]);
  const approvedMyRequests = useMemo(() => myRequests.filter((request) => request.status === "aprobat"), [myRequests]);
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, month) => new Date(visibleMonth.getFullYear(), month, 1)),
    [visibleMonth]
  );
  const expandedUser = useMemo(() => users.find((userItem) => userItem.uid === expandedUserId), [expandedUserId, users]);
  const expandedUserName = expandedUser ? buildUserLabel(expandedUser) : "Utilizator";

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
          const isHoliday = romanianPublicHolidays.has(iso);

          const className = [
            "leave-cell",
            outsideMonth ? "is-outside" : "",
            hasWork && hasLeave ? "is-mixed" : hasWork ? "is-worked" : hasLeave ? "is-leave" : "",
            isHoliday ? "is-holiday" : "",
          ].join(" ");

          return (
            <div key={`${scopeKey}-${iso}-${index}`} className={className} title={isHoliday ? "Sarbatoare legala (Romania)" : undefined}>
              <div className="leave-cell-day">{date.getDate()}</div>
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
      await saveLeaveRequest(user.uid, formValues);
      setSuccess("Cererea a fost trimisa. Va aparea in istoric dupa aprobare.");
      setFormValues((prev) => ({
        ...defaultForm(user.displayName || user.email || "", user.email || ""),
        companyName: prev.companyName,
        roleTitle: prev.roleTitle,
        department: prev.department,
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
      await approveLeaveRequest(requestId);
      setSuccess("Cererea a fost aprobata. PDF-ul contine acum eticheta albastra «Aprobat». ");
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
      await deleteLeaveRequest(requestId);
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
      <div className="panel">
        <div className="tools-header" style={{ paddingBottom: 12 }}>
          <div>
            <h2 className="panel-title">Concedii & zile lucrate</h2>
            <p className="tools-subtitle">Toti utilizatorii apar in lista, iar pe click vezi calendarul compact in dropdown.</p>
          </div>
          <a className="primary-btn" href="#leave-form">Programeaza concediu / cere liber</a>
        </div>

        <div className="leave-legend">
          <span><i className="leave-dot leave-dot-worked" /> Zi lucrata (pontaj)</span>
          <span><i className="leave-dot leave-dot-leave" /> Concediu / invoire</span>
          <span><i className="leave-dot leave-dot-mixed" /> Pontaj + concediu in aceeasi zi</span>
          <span><i className="leave-dot leave-dot-holiday" /> Sarbatoare legala Romania</span>
        </div>

        <div className="leave-user-list">
          {users.map((userItem) => {
            const uid = userItem.uid;
            const isExpanded = expandedUserId === uid;
            const isLoading = isExpanded && (!calendarData.timesheetsLoaded || !calendarData.leaveLoaded);

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
                    <div className="leave-inline-calendar-header">
                      <strong className="leave-month-title">{monthTitle}</strong>
                      <div className="leave-inline-calendar-actions">
                        <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} aria-label="Luna anterioara">◀</button>
                        <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} aria-label="Luna urmatoare">▶</button>
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

      <div id="leave-form" className="panel">
        <h3 className="panel-title">Formular cerere concediu / zi libera</h3>

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
              <input className="tool-input" value={formValues.roleTitle} onChange={(event) => setFormValues((prev) => ({ ...prev, roleTitle: event.target.value }))} placeholder="Ex: Tehnician" required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Departament</span>
              <input className="tool-input" value={formValues.department} onChange={(event) => setFormValues((prev) => ({ ...prev, department: event.target.value }))} placeholder="Ex: Operational" required />
            </label>

            <label className="tool-form-block">
              <span className="tool-form-label">Tip solicitare</span>
              <select className="tool-input" value={formValues.requestType} onChange={(event) => setFormValues((prev) => ({ ...prev, requestType: event.target.value as LeaveRequestFormValues["requestType"] }))}>
                <option value="concediu_odihna">Concediu de odihna</option>
                <option value="zi_libera_platita">Zi libera platita</option>
                <option value="zi_libera_eveniment">Zi libera eveniment deosebit</option>
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
              <span className="tool-form-label">Motiv (optional)</span>
              <textarea className="tool-input tool-textarea" value={formValues.reason} onChange={(event) => setFormValues((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Detaliaza pe scurt motivul solicitarii." />
            </label>

            <label className="tool-form-block tool-form-block-full">
              <span className="tool-form-label">Semnatura</span>
              <canvas
                ref={signatureCanvasRef}
                width={420}
                height={80}
                className="leave-signature-pad"
                onPointerDown={startSignature}
                onPointerMove={drawSignature}
                onPointerUp={endSignature}
              />
              <div className="tool-form-actions" style={{ padding: 0 }}>
                <button className="secondary-btn" type="button" onClick={clearSignature}>Sterge semnatura</button>
              </div>
            </label>
          </div>

          {error && <div className="status-error">{error}</div>}
          {success && <div className="status-ok">{success}</div>}

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={submitting}>{submitting ? "Se genereaza..." : "Trimite cererea"}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">Cereri in asteptare (admin)</h3>
        {!isAdmin ? (
          <p className="tools-subtitle">Doar adminii pot aproba cereri.</p>
        ) : pendingLeaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri in asteptare.</p>
        ) : (
          <div className="simple-list">
            {pendingLeaveRequests.map((request) => (
              <div key={request.id} className="simple-list-item leave-history-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{request.userName} · {requestTypeLabel(request.requestType)}</div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} · {request.requestedDays} zile
                  </div>
                </div>
                <div className="leave-admin-actions">
                  <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
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
        {!myRequestsLoaded ? (
          <p className="tools-subtitle">Se incarca cererile...</p>
        ) : approvedMyRequests.length === 0 ? (
          <p className="tools-subtitle">Nu exista cereri aprobate momentan.</p>
        ) : (
          <div className="simple-list">
            {approvedMyRequests.map((request) => (
              <div key={request.id} className="simple-list-item leave-history-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{request.userName} · {requestTypeLabel(request.requestType)}</div>
                  <div className="simple-list-subtitle">
                    {request.periodStart} - {request.periodEnd} · {request.requestedDays} zile · emis la {new Date(request.issuedAt).toLocaleString("ro-RO")}
                  </div>
                  <div className="simple-list-subtitle">Status: {request.status.replace("_", " ")}</div>
                </div>
                <div className="leave-admin-actions">
                  <a className="secondary-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
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
                <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear() - 1, visibleMonth.getMonth(), 1))} aria-label="An precedent">◀</button>
                <button className="secondary-btn leave-icon-btn" type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear() + 1, visibleMonth.getMonth(), 1))} aria-label="An urmator">▶</button>
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
