import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { Bell, BellRing, CheckCheck, History, Settings, SlidersHorizontal } from "lucide-react";
import { db } from "../../../lib/firebase/firebase";
import { useAuth } from "../../../providers/AuthProvider";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { resolveNotificationPath } from "../../../lib/notifications/notificationNavigation";
import UserProfileLink from "../../../components/UserProfileLink";
import { createAuditLog } from "../../audit/services/auditLogService";
import { pruneNotificationsForUser } from "../services/notificationsService";
import { PageHeader, PageLayout } from "../../../components/experience";
import ProductTabs from "../../../components/product/ProductTabs";
import {
  activatePushNotifications,
  hasPushVapidKey,
  hasUserPushToken,
  syncPushTokenIfGranted,
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
  notificationPath?: string;
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

  if (result.reason === "ios_requires_install") {
    return "Pe iPhone, instaleaza WorkControl pe ecranul principal si deschide aplicatia din icon inainte sa activezi notificarile.";
  }

  return "Dispozitivul nu suporta notificari push in fundal.";
}

export default function NotificationsPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [permissionState, setPermissionState] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [activatingPush, setActivatingPush] = useState(false);
  const [pushResult, setPushResult] = useState<PushActivationResult | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [bulkReadError, setBulkReadError] = useState("");
  const [activeTab, setActiveTab] = useState<"inbox" | "unread" | "critical" | "preferences">("inbox");

  const pushConfigReady = hasPushVapidKey();

  useEffect(() => {
    if (!user) return;

    void pruneNotificationsForUser(user.uid, 10).catch((error) => {
      console.warn("[NotificationsPage][retention]", error);
    });

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(10)
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
          notificationPath: data.notificationPath ?? "",
          targetUserThemeKey: data.targetUserThemeKey ?? null,
        });
      });
      setNotifications(list);
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!pushConfigReady) return;

    const loadPushState = async () => {
      try {
        if (typeof Notification !== "undefined") {
          setPermissionState(Notification.permission);
        }

        if (typeof Notification === "undefined" || Notification.permission !== "granted") {
          return;
        }

        await syncPushTokenIfGranted(user.uid);

        const hasToken = await hasUserPushToken(user.uid);
        if (hasToken) {
          setPushResult({ ok: true, reason: "ok" });
        }
      } catch (error) {
        console.error("[NotificationsPage][loadPushState]", error);
      }
    };

    void loadPushState();
  }, [user?.uid, pushConfigReady]);

  async function markAsRead(id: string) {
    await updateDoc(doc(db, "notifications", id), {
      read: true,
    });
    const notification = notifications.find((item) => item.id === id);
    if (notification && user?.uid) {
      void createAuditLog({
        category: "notifications",
        action: "notification_read",
        title: "Notificare citita",
        message: `${user.displayName || user.email || "Utilizator"} a citit notificarea: ${notification.title}.`,
        actorUserId: user.uid,
        actorUserName: user.displayName || user.email || "Utilizator",
        actorUserThemeKey: user.themeKey ?? null,
        targetUserId: notification.userId,
        targetUserName: user.displayName || user.email || notification.userId,
        entityId: id,
        entityLabel: notification.title,
        path: "/notifications",
        pageTitle: "Notificari",
      }).catch((error) => console.warn("[audit][notification_read]", error));
    }
  }

  async function handleMarkAllRead() {
    if (!user?.uid || markingAllRead) return;

    setMarkingAllRead(true);
    setBulkReadError("");
    try {
      const unreadSnap = await getDocs(
        query(
          collection(db, "notifications"),
          where("userId", "==", user.uid),
          where("read", "==", false),
          limit(100)
        )
      );

      const unreadDocs = unreadSnap.docs;
      if (unreadDocs.length === 0) return;

      for (let index = 0; index < unreadDocs.length; index += 450) {
        const batch = writeBatch(db);
        unreadDocs.slice(index, index + 450).forEach((notificationDoc) => {
          batch.update(notificationDoc.ref, { read: true });
        });
        await batch.commit();
      }

      const unreadIds = new Set(unreadDocs.map((notificationDoc) => notificationDoc.id));
      setNotifications((current) =>
        current.map((notification) =>
          unreadIds.has(notification.id) ? { ...notification, read: true } : notification
        )
      );

      void createAuditLog({
        category: "notifications",
        action: "notification_read",
        title: "Notificari marcate ca citite",
        message: `${user.displayName || user.email || "Utilizator"} a marcat ${unreadDocs.length} notificari ca citite.`,
        actorUserId: user.uid,
        actorUserName: user.displayName || user.email || "Utilizator",
        actorUserThemeKey: user.themeKey ?? null,
        targetUserId: user.uid,
        targetUserName: user.displayName || user.email || user.uid,
        entityId: user.uid,
        entityLabel: "Notificari",
        path: "/notifications",
        pageTitle: "Notificari",
        metadata: {
          count: unreadDocs.length,
        },
      }).catch((error) => console.warn("[audit][notifications_mark_all_read]", error));
    } catch (error) {
      console.error("[NotificationsPage][handleMarkAllRead]", error);
      setBulkReadError("Nu am putut marca toate notificarile ca citite.");
    } finally {
      setMarkingAllRead(false);
    }
  }

  async function handleDeleteNotification(id: string) {
    const confirmed = window.confirm("Stergi notificarea?");
    if (!confirmed || deletingId) return;

    setDeletingId(id);
    try {
      const notification = notifications.find((item) => item.id === id);
      await deleteDoc(doc(db, "notifications", id));
      if (notification && user?.uid) {
        void createAuditLog({
          category: "notifications",
          action: "notification_deleted",
          title: "Notificare stearsa",
          message: `${user.displayName || user.email || "Utilizator"} a sters notificarea: ${notification.title}.`,
          actorUserId: user.uid,
          actorUserName: user.displayName || user.email || "Utilizator",
          actorUserThemeKey: user.themeKey ?? null,
          targetUserId: notification.userId,
          targetUserName: user.displayName || user.email || notification.userId,
          entityId: id,
          entityLabel: notification.title,
          path: "/notifications",
          pageTitle: "Notificari",
        }).catch((error) => console.warn("[audit][notification_deleted]", error));
      }
    } finally {
      setDeletingId("");
    }
  }

  async function handleOpenNotification(notification: NotificationItem) {
    await markAsRead(notification.id);
    navigate(
      resolveNotificationPath({
        module: notification.module,
        eventType: notification.eventType,
        entityId: notification.entityId,
        notificationPath: notification.notificationPath,
      })
    );
  }

  async function handleActivatePush() {
    if (!user?.uid || activatingPush || !pushConfigReady) return;

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
  const unreadCount = useMemo(
    () => notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0),
    [notifications]
  );
  const criticalNotifications = useMemo(
    () =>
      notifications.filter((notification) => {
        const text = `${notification.module || ""} ${notification.eventType || ""} ${notification.title}`.toLowerCase();
        return /critic|eroare|error|urgent|securitate|offline|expirat/.test(text);
      }),
    [notifications]
  );
  const visibleNotifications = useMemo(() => {
    if (activeTab === "unread") return notifications.filter((notification) => !notification.read);
    if (activeTab === "critical") return criticalNotifications;
    return notifications;
  }, [activeTab, criticalNotifications, notifications]);

  if (!user) {
    return (
      <div className="placeholder-page">
        <h2>Nu esti autentificat</h2>
        <p>Intra in cont pentru a vedea notificarile.</p>
      </div>
    );
  }

  return (
    <PageLayout className="notifications-operational-page">
      <PageHeader
        eyebrow="Comunicare"
        title="Notificări"
        description={`${unreadCount} necitite din ultimele ${notifications.length} notificări păstrate`}
        actions={[
          {
            id: "read-all",
            label: markingAllRead ? "Se marchează" : "Citește tot",
            icon: CheckCheck,
            onClick: () => void handleMarkAllRead(),
            disabled: markingAllRead || unreadCount === 0,
            assistantAction: "mark-all-notifications-read",
          },
        ]}
      />
      <ProductTabs
        activeId={activeTab}
        onChange={(id) => {
          if (id === "inbox" || id === "unread" || id === "critical" || id === "preferences") setActiveTab(id);
        }}
        tabs={[
          { id: "inbox", label: "Inbox", icon: Bell, badge: notifications.length },
          { id: "unread", label: "Necitite", icon: BellRing, badge: unreadCount },
          { id: "critical", label: "Critice", icon: SlidersHorizontal, badge: criticalNotifications.length },
          ...(role === "admin" || role === "manager" ? [{ id: "rules", label: "Reguli", icon: Settings, to: "/notification-rules" }] : []),
          ...(role === "admin" || role === "manager" ? [{ id: "history", label: "Istoric trimiteri", icon: History, to: "/history?category=notifications" }] : []),
          { id: "preferences", label: "Preferințe", icon: Settings },
        ]}
      />
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Notificari</h2>
            <p className="tools-subtitle">
              Inbox-ul tau de notificari din aplicatie.
            </p>
          </div>

          <div className="tools-header-actions notifications-activate-box" hidden={activeTab !== "preferences"}>
            <button
              className="secondary-btn notifications-mark-all-btn"
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markingAllRead || unreadCount === 0}
              title="Marcheaza toate notificarile necitite ca citite"
            >
              <CheckCheck size={15} />
              {markingAllRead ? "Se marcheaza..." : `Citit tot${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
            </button>
            <button
              className="primary-btn"
              type="button"
              onClick={() => void handleActivatePush()}
              disabled={activatingPush || !pushConfigReady}
            >
              {activatingPush ? "Se activeaza..." : "Activeaza notificari push (fundal)"}
            </button>
            {permissionState === "granted" && (
              <span className="badge badge-green">Permisiune browser: activa</span>
            )}
            {!pushConfigReady && (
              <span className="badge badge-orange">Lipseste configurarea VAPID pe frontend (.env).</span>
            )}
            {pushMessage && (
              <span className={pushResult?.ok ? "badge badge-green" : "badge badge-orange"}>
                {pushMessage}
              </span>
            )}
            {bulkReadError && (
              <span className="badge badge-orange">{bulkReadError}</span>
            )}
          </div>
        </div>

        {activeTab === "preferences" ? (
          <div className="wc-notification-preferences">
            <h3>Preferințe dispozitiv</h3>
            <p>Activează notificările push numai pe dispozitivele pe care vrei să primești alerte în fundal.</p>
          </div>
        ) : visibleNotifications.length === 0 ? (
          <div className="placeholder-page">
            <h2>Nu ai notificari</h2>
            <p>Cand vor exista evenimente noi, ele apar aici.</p>
          </div>
        ) : (
          <div className="simple-list">
            {visibleNotifications.map((notification) => {
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
                      <UserProfileLink
                        userId={notification.actorUserId}
                        name={notification.actorUserName || notification.title}
                        themeKey={notification.actorUserThemeKey}
                        className="simple-list-label user-accent-name"
                      />
                    </div>

                    <div className="simple-list-subtitle">{notification.title}</div>
                    <div className="simple-list-subtitle">{notification.message}</div>
                    <div className="simple-list-subtitle">
                      {new Date(notification.createdAt).toLocaleString("ro-RO")}
                    </div>
                  </div>

                  <div className="dashboard-inline-actions">
                    <span
                      className={
                        notification.read ? "badge badge-green" : "badge badge-orange"
                      }
                    >
                      {notification.read ? "citita" : "noua"}
                    </span>
                    <button
                      className="danger-btn"
                      type="button"
                      disabled={deletingId === notification.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteNotification(notification.id);
                      }}
                    >
                      {deletingId === notification.id ? "Se sterge..." : "Sterge"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
