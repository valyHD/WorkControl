import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AppUser, ToolItem } from "../../../types/tool";
import { useAuth } from "../../../providers/AuthProvider";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import {
  getToolsHeldByUserFromOthers,
  getToolsOwnedByUser,
  getToolsOwnedByUserButHeldByOthers,
  getUsersList,
} from "../../tools/services/toolsService";
import MyToolCard from "../components/MyToolCard";
import type { VehicleItem } from "../../../types/vehicle";
import type { TimesheetItem } from "../../../types/timesheet";
import type { LeaveRequestItem } from "../../../types/leave";

type MyNotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
};

function CompactSection({
  title,
  subtitle,
  preview,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  preview?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="panel profile-collapsible" open={defaultOpen}>
      <summary className="profile-collapsible__summary">
        <div>
          <h3 className="panel-title">{title}</h3>
          {subtitle && <p className="tools-subtitle">{subtitle}</p>}
          {preview && <div className="profile-collapsible__preview">{preview}</div>}
        </div>
        <span className="badge">Detalii</span>
      </summary>
      <div className="profile-collapsible__body">{children}</div>
    </details>
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
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const [owned, borrowed, given, usersData] = await Promise.all([
        getToolsOwnedByUser(user.uid),
        getToolsHeldByUserFromOthers(user.uid),
        getToolsOwnedByUserButHeldByOthers(user.uid),
        getUsersList(),
      ]);

      setOwnedTools(owned);
      setBorrowedTools(borrowed);
      setGivenTools(given);
      setUsers(usersData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.uid) return;

    void load();

    const vehiclesUnsubscribe = onSnapshot(
      query(
        collection(db, "vehicles"),
        orderBy("updatedAt", "desc"),
        limit(50)
      ),
      (vehiclesSnap) => {
        setMyVehicles(
          vehiclesSnap.docs
            .filter((docItem) => {
              const data = docItem.data();
              return data.ownerUserId === user.uid || data.currentDriverUserId === user.uid;
            })
            .map((docItem) => ({
              id: docItem.id,
              plateNumber: docItem.data().plateNumber ?? "",
              brand: docItem.data().brand ?? "",
              model: docItem.data().model ?? "",
              year: docItem.data().year ?? "",
              vin: docItem.data().vin ?? "",
              fuelType: docItem.data().fuelType ?? "",
              status: docItem.data().status ?? "activa",
              currentKm: Number(docItem.data().currentKm ?? docItem.data().gpsSnapshot?.odometerKm ?? 0),
              initialRecordedKm: Number(docItem.data().initialRecordedKm ?? docItem.data().currentKm ?? 0),
              ownerUserId: docItem.data().ownerUserId ?? "",
              ownerUserName: docItem.data().ownerUserName ?? "",
              ownerThemeKey: docItem.data().ownerThemeKey ?? null,
              currentDriverUserId: docItem.data().currentDriverUserId ?? "",
              currentDriverUserName: docItem.data().currentDriverUserName ?? "",
              currentDriverThemeKey: docItem.data().currentDriverThemeKey ?? null,
              maintenanceNotes: docItem.data().maintenanceNotes ?? "",
              serviceStrategy: docItem.data().serviceStrategy === "absolute" ? "absolute" : "interval",
              serviceIntervalKm: Number(docItem.data().serviceIntervalKm ?? 15000),
              nextServiceKm: Number(docItem.data().nextServiceKm ?? 0),
              nextItpDate: docItem.data().nextItpDate ?? "",
              nextRcaDate: docItem.data().nextRcaDate ?? "",
              nextCascoDate: docItem.data().nextCascoDate ?? "",
              coverImageUrl: docItem.data().coverImageUrl ?? "",
              coverThumbUrl: docItem.data().coverThumbUrl ?? "",
              images: Array.isArray(docItem.data().images) ? docItem.data().images : [],
              createdAt: docItem.data().createdAt ?? Date.now(),
              updatedAt: docItem.data().updatedAt ?? Date.now(),
            }))
        );
      }
    );
    const timesheetsUnsubscribe = onSnapshot(
      query(
        collection(db, "timesheets"),
        where("userId", "==", user.uid),
        orderBy("startAt", "desc"),
        limit(20)
      ),
      (timesheetsSnap) => {
        setMyTimesheets(
          timesheetsSnap.docs.map((docItem) => ({
            id: docItem.id,
            userId: docItem.data().userId ?? "",
            userName: docItem.data().userName ?? "",
            userThemeKey: docItem.data().userThemeKey ?? null,
            projectId: docItem.data().projectId ?? "",
            projectCode: docItem.data().projectCode ?? "",
            projectName: docItem.data().projectName ?? "",
            status: docItem.data().status ?? "activ",
            explanation: docItem.data().explanation ?? "",
            startAt: docItem.data().startAt ?? Date.now(),
            stopAt: docItem.data().stopAt ?? null,
            workedMinutes: Number(docItem.data().workedMinutes ?? 0),
            startLocation: docItem.data().startLocation ?? { lat: null, lng: null, label: "" },
            stopLocation: docItem.data().stopLocation ?? null,
            startSource: docItem.data().startSource ?? "web",
            stopSource: docItem.data().stopSource ?? "",
            workDate: docItem.data().workDate ?? "",
            yearMonth: docItem.data().yearMonth ?? "",
            weekKey: docItem.data().weekKey ?? "",
            createdAt: docItem.data().createdAt ?? Date.now(),
            updatedAt: docItem.data().updatedAt ?? Date.now(),
          }))
        );
      }
    );
    const notificationsUnsubscribe = onSnapshot(
      query(
        collection(db, "notifications"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(30)
      ),
      (notificationsSnap) => {
        setMyNotifications(
          notificationsSnap.docs.map((docItem) => ({
            id: docItem.id,
            title: docItem.data().title ?? "Notificare",
            message: docItem.data().message ?? "",
            createdAt: docItem.data().createdAt ?? Date.now(),
            read: Boolean(docItem.data().read ?? false),
          }))
        );
      }
    );
    const leaveUnsubscribe = onSnapshot(
      query(
        collection(db, "leaveRequests"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(30)
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
  }, [user?.uid]);

  const timesheetPreview = useMemo(
    () => myTimesheets.slice(0, 2),
    [myTimesheets]
  );

  const toolChangeInitiator = useMemo(
    () => ({
      userId: user?.uid ?? "",
      userName: user?.displayName || user?.email || "Utilizator",
      userThemeKey: user?.themeKey ?? null,
    }),
    [user?.displayName, user?.email, user?.themeKey, user?.uid]
  );

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
        <p>Preluam sculele tale.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <h2 className="panel-title">Profilul meu</h2>
        <div className="tool-detail-line">
          <strong>Nume:</strong> {user.displayName}
        </div>
        <div className="tool-detail-line">
          <strong>Email:</strong> {user.email}
        </div>
        <div className="tool-form-actions" style={{ padding: 0, marginTop: 12 }}>
          <Link to="/my-leave" className="primary-btn">Calendar concedii & cereri libere</Link>
        </div>
      </div>

      <CompactSection
        title="Istoric cereri concediu"
        subtitle="In profil apar cererile aprobate."
        preview={
          myLeaveRequests.length === 0 ? (
            <p className="tools-subtitle">Nu ai cereri aprobate.</p>
          ) : (
            <div className="simple-list compact-rows">
              {myLeaveRequests.slice(0, 2).map((request) => (
                <div key={request.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">{request.requestType === "concediu_odihna" ? "Concediu" : request.requestType === "zi_libera_platita" ? "Zi libera platita" : "Zi libera eveniment"}</div>
                    <div className="simple-list-subtitle">{request.periodStart} - {request.periodEnd}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      >
        {myLeaveRequests.length === 0 ? (
          <p className="tools-subtitle">Nu ai cereri aprobate.</p>
        ) : (
          <div className="simple-list">
            {myLeaveRequests.map((request) => (
              <div key={request.id} className="simple-list-item leave-history-item leave-history-item-profile">
                <div className="simple-list-text">
                  <div className="simple-list-label">{request.requestType === "concediu_odihna" ? "Concediu de odihna" : request.requestType === "zi_libera_platita" ? "Zi libera platita" : "Zi libera eveniment"}</div>
                  <div className="simple-list-subtitle">{request.periodStart} - {request.periodEnd} · {request.requestedDays} zile</div>
                </div>
                <a className="secondary-btn leave-history-pdf-btn" href={request.pdfDataUrl} target="_blank" rel="noreferrer">PDF</a>
              </div>
            ))}
          </div>
        )}
      </CompactSection>

      <CompactSection
        title="Pontajele mele"
        subtitle="Preview compact (2 randuri), apoi dropdown pentru istoric complet."
        preview={
          timesheetPreview.length === 0 ? (
            <p className="tools-subtitle">Nu ai pontaje salvate.</p>
          ) : (
            <div className="simple-list compact-rows">
              {timesheetPreview.map((timesheet) => (
                <div key={timesheet.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">
                      {timesheet.projectCode} - {timesheet.projectName}
                    </div>
                    <div className="simple-list-subtitle">
                      {new Date(timesheet.startAt).toLocaleString("ro-RO")} · {timesheet.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      >
        {myTimesheets.length === 0 ? (
          <p className="tools-subtitle">Nu ai pontaje salvate.</p>
        ) : (
          <div className="simple-list">
            {myTimesheets.map((timesheet) => (
              <div key={timesheet.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    {timesheet.projectCode} - {timesheet.projectName}
                  </div>
                  <div className="simple-list-subtitle">
                    {new Date(timesheet.startAt).toLocaleString("ro-RO")} · {timesheet.status} · {timesheet.workedMinutes} min
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CompactSection>

      {myVehicles.length > 0 && (
        <CompactSection
          title="Masinile mele"
          subtitle="Sectiunea apare doar daca ai cel putin o masina."
          preview={
            <div className="simple-list compact-rows">
              {myVehicles.slice(0, 2).map((vehicle) => (
                <div key={vehicle.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">
                      {vehicle.plateNumber} · {vehicle.brand} {vehicle.model}
                    </div>
                    <div className="simple-list-subtitle">
                      status: {vehicle.status} · km: {vehicle.currentKm}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <div className="simple-list">
            {myVehicles.map((vehicle) => (
              <div key={vehicle.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    {vehicle.plateNumber} · {vehicle.brand} {vehicle.model}
                  </div>
                  <div className="simple-list-subtitle">
                    status: {vehicle.status} · km: {vehicle.currentKm}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CompactSection>
      )}

      <CompactSection
        title="Sculele mele"
        subtitle="Sculele proprii, scule primite si scule date altora."
        preview={<p className="tools-subtitle">Total: {ownedTools.length + borrowedTools.length + givenTools.length} scule in istoric.</p>}
      >
        <div className="panel" style={{ marginBottom: 12 }}>
          <h4 className="panel-title">Scule in responsabilitate</h4>
          {ownedTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule in responsabilitate.</p>
          ) : (
            <div className="tools-grid">
              {ownedTools.map((tool) => (
                <MyToolCard
                  key={tool.id}
                  tool={tool}
                  users={users}
                  onChanged={load}
                  showOwner={false}
                  canManage={true}
                  initiator={toolChangeInitiator}
                />
              ))}
            </div>
          )}
        </div>

        <div className="panel" style={{ marginBottom: 12 }}>
          <h4 className="panel-title">Scule primite de la altii</h4>
          {borrowedTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule primite de la alti utilizatori.</p>
          ) : (
            <div className="tools-grid">
              {borrowedTools.map((tool) => (
                <MyToolCard
                  key={tool.id}
                  tool={tool}
                  users={users}
                  onChanged={load}
                  canManage={false}
                  initiator={toolChangeInitiator}
                />
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h4 className="panel-title">Scule date altora</h4>
          {givenTools.length === 0 ? (
            <p className="tools-subtitle">Nu ai scule date altor utilizatori.</p>
          ) : (
            <div className="tools-grid">
              {givenTools.map((tool) => (
                <MyToolCard
                  key={tool.id}
                  tool={tool}
                  users={users}
                  onChanged={load}
                  showOwner={false}
                  canManage={true}
                  initiator={toolChangeInitiator}
                />
              ))}
            </div>
          )}
        </div>
      </CompactSection>

      <CompactSection
        title="Istoric notificari"
        subtitle="Log notificari personale cu dropdown."
        preview={<p className="tools-subtitle">{myNotifications.length} notificari in total.</p>}
      >
        {myNotifications.length === 0 ? (
          <p className="tools-subtitle">Nu ai notificari momentan.</p>
        ) : (
          <div className="simple-list">
            {myNotifications.map((notification) => (
              <div key={notification.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{notification.title}</div>
                  <div className="simple-list-subtitle">{notification.message}</div>
                  <div className="simple-list-subtitle">
                    {new Date(notification.createdAt).toLocaleString("ro-RO")} · {notification.read ? "citita" : "noua"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CompactSection>
    </section>
  );
}
