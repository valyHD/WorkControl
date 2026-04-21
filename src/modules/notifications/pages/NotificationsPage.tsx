import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import { useAuth } from "../../../providers/AuthProvider";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { resolveNotificationPath } from "../../../lib/notifications/notificationNavigation";
import {
  activatePushNotifications,
  type PushActivationResult,
} from "../../../lib/notifications/pushNotifications";

type NotificationItem = {
  id: string;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  eventType?: string;
  entityId?: string;
  targetUserThemeKey?: string | null;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

function getActivationMessage(result: PushActivationResult | null): string {
  if (!result) return "";

  if (result.ok) {
    return "Notificarile push sunt active. Vei primi notificari si cand aplicatia este inchisa.";
  }

  if (result.reason === "permission_denied") {
    return "Permisiunea de notificari este blocata. Activeaz-o din setarile browserului.";
  }

  if (result.reason === "missing_vapid") {
    return "Lipseste configurarea VAPID (VITE_FIREBASE_VAPID_KEY).";
  }

  if (result.reason === "token_error") {
    return "Nu am putut inregistra dispozitivul pentru push. Reincearca.";
  }

  if (result.reason === "missing_service_worker") {
    return "Service Worker-ul de notificari nu este disponibil pe acest dispozitiv.";
  }

  return "Dispozitivul nu suporta notificari push in fundal.";
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [permissionState, setPermissionState] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [activatingPush, setActivatingPush] = useState(false);
  const [pushResult, setPushResult] = useState<PushActivationResult | null>(null);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: NotificationItem[] = [];
      snap.forEach((item) => {
        const data = item.data();
        list.push({
          id: item.id,
          actorUserId: data.actorUserId ?? "",
          actorUserName: data.actorUserName ?? "",
          actorUserThemeKey: data.actorUserThemeKey ?? null,
          userId: data.userId ?? "",
          title: data.title ?? "",
          message: data.message ?? "",
          read: data.read ?? false,
          createdAt: data.createdAt ?? Date.now(),
          module: data.module ?? "",
          eventType: data.eventType ?? "",
          entityId: data.entityId ?? "",
          targetUserThemeKey: data.targetUserThemeKey ?? null,
        });
      });
      setNotifications(list);
    });

    return () => unsub();
  }, [user]);

  async function markAsRead(id: string) {
    await updateDoc(doc(db, "notifications", id), {
      read: true,
    });
  }

  async function handleOpenNotification(notification: NotificationItem) {
    await markAsRead(notification.id);
    navigate(
      resolveNotificationPath({
        module: notification.module,
        eventType: notification.eventType,
        entityId: notification.entityId,
      })
    );
  }

  async function handleActivatePush() {
    if (!user?.uid || activatingPush) return;

    setActivatingPush(true);
    try {
      const result = await activatePushNotifications(user.uid);
      setPushResult(result);
      setPermissionState(
        typeof Notification !== "undefined" ? Notification.permission : "default"
      );
    } finally {
      setActivatingPush(false);
    }
  }

  const pushMessage = useMemo(() => getActivationMessage(pushResult), [pushResult]);

  if (!user) {
    return (
      <div className="placeholder-page">
        <h2>Nu esti autentificat</h2>
        <p>Intra in cont pentru a vedea notificarile.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Notificari</h2>
            <p className="tools-subtitle">
              Inbox-ul tau de notificari din aplicatie.
            </p>
          </div>

          <div className="tools-header-actions" style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <button
              className="primary-btn"
              type="button"
              onClick={() => void handleActivatePush()}
              disabled={activatingPush}
            >
              {activatingPush ? "Se activeaza..." : "Activeaza notificari push (fundal)"}
            </button>
            {permissionState === "granted" && (
              <span className="badge badge-green">Permisiune browser: activa</span>
            )}
            {pushMessage && (
              <span className={pushResult?.ok ? "badge badge-green" : "badge badge-orange"}>
                {pushMessage}
              </span>
            )}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="placeholder-page">
            <h2>Nu ai notificari</h2>
            <p>Cand vor exista evenimente noi, ele apar aici.</p>
          </div>
        ) : (
          <div className="simple-list">
            {notifications.map((notification) => {
              const userThemeClass = getUserThemeClass(
                notification.actorUserThemeKey ?? null
              );

              return (
                <div
                  key={notification.id}
                  className={`simple-list-item user-history-row ${userThemeClass}`}
                  onClick={() => void handleOpenNotification(notification)}
                  style={{
                    cursor: "pointer",
                    opacity: notification.read ? 0.9 : 1,
                  }}
                >
                  <div className="simple-list-text">
                    <div className="user-inline-meta">
                      <span className="user-accent-avatar">
                        {getUserInitials(notification.actorUserName || notification.title || "S")}
                      </span>
                      <span className="simple-list-label user-accent-name">
                        {notification.actorUserName || notification.title}
                      </span>
                    </div>

                    <div className="simple-list-subtitle">{notification.title}</div>
                    <div className="simple-list-subtitle">{notification.message}</div>
                    <div className="simple-list-subtitle">
                      {new Date(notification.createdAt).toLocaleString("ro-RO")}
                    </div>
                  </div>

                  <span
                    className={
                      notification.read ? "badge badge-green" : "badge badge-orange"
                    }
                  >
                    {notification.read ? "citita" : "noua"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
