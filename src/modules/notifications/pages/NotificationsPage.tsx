import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import { useAuth } from "../../../providers/AuthProvider";
import { requestBrowserPermission } from "../../../lib/notifications/requestPermission";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

type NotificationItem = {
  id: string;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  entityId?: string;
  targetUserThemeKey?: string | null;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [permissionState, setPermissionState] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

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

  async function handleEnableBrowserNotifications() {
    const granted = await requestBrowserPermission();
    setPermissionState(granted ? "granted" : Notification.permission);
  }

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

          <div className="tools-header-actions">
            {permissionState !== "granted" ? (
              <button
                className="primary-btn"
                type="button"
                onClick={() => void handleEnableBrowserNotifications()}
              >
                Activeaza notificari browser
              </button>
            ) : (
              <span className="badge badge-green">Notificari browser active</span>
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
      onClick={() => void markAsRead(notification.id)}
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
        <div className="simple-list-subtitle">
          {notification.message}
        </div>
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