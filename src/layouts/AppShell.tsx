import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logoutUser } from "../modules/auth/services/authService";
import { useNotificationsListener } from "../lib/notifications/useNotificationsListener";
import { hasPushVapidKey, syncPushTokenIfGranted } from "../lib/notifications/pushNotifications";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { NotificationPermissionBanner } from "../components/NotificationPermissionBanner";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import VoiceCommandAssistant from "../components/VoiceCommandAssistant";
import { FloatingQuickLinks } from "../components/FloatingQuickLinks";
import { logPageView, subscribeAuditLogs } from "../modules/audit/services/auditLogService";
import type { AuditLogItem } from "../types/audit";
import {
  LayoutDashboard, User, Users, Wrench, CarFront, Clock3, Clock4,
  Briefcase, Bell, BellRing, BarChart3, LogOut, Menu, X, ChevronRight, Building2, CalendarDays, ReceiptText, History, PackageSearch,
} from "lucide-react";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { getControlPanelSettings } from "../modules/reports/services/controlPanelService";
import { runVehicleMaintenanceAlerts } from "../modules/vehicles/services/vehiclesService";

const pagePrefetchers: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("../modules/dashboard/pages/DashboardPage"),
  "/my-profile": () => import("../modules/users/pages/MyProfilePage"),
  "/my-leave": () => import("../modules/leave/pages/LeavePlannerPage"),
  "/notification-rules": () => import("../modules/notifications/pages/NotificationRulesPage"),
  "/users": () => import("../modules/users/pages/UsersPage"),
  "/tools": () => import("../modules/tools/pages/ToolsPage"),
  "/vehicles": () => import("../modules/vehicles/pages/VehiclesPage"),
  "/my-vehicle": () => import("../modules/vehicles/pages/MyVehiclePage"),
  "/timesheets": () => import("../modules/timesheets/pages/TimesheetsPage"),
  "/my-timesheets": () => import("../modules/timesheets/pages/MyTimesheetsPage"),
  "/projects": () => import("../modules/timesheets/pages/ProjectsPage"),
  "/notifications": () => import("../modules/notifications/pages/NotificationsPage"),
  "/control-panel": () => import("../modules/reports/pages/ReportsPage"),
  "/maintenance": () => import("../modules/maintenance/pages/MaintenancePage"),
  "/maintenance/orders": () => import("../modules/maintenance/pages/MaintenancePartOrdersPage"),
  "/expenses/scan": () => import("../modules/expenses/pages/ExpenseScanPage"),
  "/expenses/invoices": () => import("../modules/expenses/pages/ExpenseInvoicesPage"),
  "/expenses/reports": () => import("../modules/expenses/pages/ExpenseReportsPage"),
  "/companies": () => import("../modules/companies/pages/CompaniesPage"),
  "/history": () => import("../modules/audit/pages/AuditLogPage"),
};

const prefetchedPaths = new Set<string>();

function prefetchPage(path: string) {
  if (prefetchedPaths.has(path)) return;
  const prefetch = pagePrefetchers[path];
  if (!prefetch) return;
  prefetchedPaths.add(path);
  void prefetch().catch(() => {
    prefetchedPaths.delete(path);
  });
}

type MenuItem = {
  label: string; path: string; Icon: ElementType;
  colorClass: "menu-icon-blue" | "menu-icon-violet" | "menu-icon-cyan" | "menu-icon-orange" | "menu-icon-green" | "menu-icon-rose";
  section: string;
};

const menuSections: { label: string; items: MenuItem[] }[] = [
  {
    label: "Principal",
    items: [
      { label: "Dashboard", path: "/dashboard", Icon: LayoutDashboard, colorClass: "menu-icon-blue", section: "Principal" },
      { label: "Profilul meu", path: "/my-profile", Icon: User, colorClass: "menu-icon-violet", section: "Principal" },
      { label: "Concedii & Liber", path: "/my-leave", Icon: CalendarDays, colorClass: "menu-icon-orange", section: "Principal" },
      { label: "Utilizatori", path: "/users", Icon: Users, colorClass: "menu-icon-cyan", section: "Principal" },
    ],
  },
  {
    label: "Operațional",
    items: [
      { label: "Scule", path: "/tools", Icon: Wrench, colorClass: "menu-icon-orange", section: "Operațional" },
      { label: "Mașini", path: "/vehicles", Icon: CarFront, colorClass: "menu-icon-green", section: "Operațional" },
      { label: "Mașina mea", path: "/my-vehicle", Icon: CarFront, colorClass: "menu-icon-blue", section: "Operațional" },
      { label: "Scanare bonuri", path: "/expenses/scan", Icon: ReceiptText, colorClass: "menu-icon-rose", section: "Operational" },
      { label: "Facturi", path: "/expenses/invoices", Icon: ReceiptText, colorClass: "menu-icon-cyan", section: "Operational" },
      { label: "Rapoarte cheltuieli", path: "/expenses/reports", Icon: BarChart3, colorClass: "menu-icon-green", section: "Operational" },
    ],
  },
  {
    label: "Pontaje",
    items: [
      { label: "Dashboard Pontaje", path: "/timesheets", Icon: Clock3, colorClass: "menu-icon-blue", section: "Pontaje" },
      { label: "Pontajul meu", path: "/my-timesheets", Icon: Clock4, colorClass: "menu-icon-violet", section: "Pontaje" },
      { label: "Proiecte", path: "/projects", Icon: Briefcase, colorClass: "menu-icon-cyan", section: "Pontaje" },
    ],
  },
  {
    label: "Notificări",
    items: [
      { label: "Notificări", path: "/notifications", Icon: Bell, colorClass: "menu-icon-orange", section: "Notificări" },
      { label: "Reguli notificări", path: "/notification-rules", Icon: BellRing, colorClass: "menu-icon-blue", section: "Notificări" },
    ],
  },
  {
    label: "Administrare",
    items: [
      { label: "Control Panel", path: "/control-panel", Icon: BarChart3, colorClass: "menu-icon-cyan", section: "Administrare" },
      { label: "Istoric", path: "/history", Icon: History, colorClass: "menu-icon-orange", section: "Administrare" },
      { label: "Mentenanță", path: "/maintenance", Icon: Building2, colorClass: "menu-icon-violet", section: "Administrare" },
    ],
  },
];

menuSections.splice(
  0,
  menuSections.length,
  {
    label: "Principal",
    items: [
      { label: "Dashboard", path: "/dashboard", Icon: LayoutDashboard, colorClass: "menu-icon-blue", section: "Principal" },
      { label: "Profilul meu", path: "/my-profile", Icon: User, colorClass: "menu-icon-violet", section: "Principal" },
      { label: "Concedii", path: "/my-leave", Icon: CalendarDays, colorClass: "menu-icon-orange", section: "Principal" },
      { label: "Utilizatori", path: "/users", Icon: Users, colorClass: "menu-icon-cyan", section: "Principal" },
    ],
  },
  {
    label: "Pontaje",
    items: [
      { label: "Dashboard Pontaje", path: "/timesheets", Icon: Clock3, colorClass: "menu-icon-blue", section: "Pontaje" },
      { label: "Pontajul meu", path: "/my-timesheets", Icon: Clock4, colorClass: "menu-icon-violet", section: "Pontaje" },
      { label: "Proiecte", path: "/projects", Icon: Briefcase, colorClass: "menu-icon-cyan", section: "Pontaje" },
    ],
  },
  {
    label: "Operational",
    items: [
      { label: "Scanare bonuri", path: "/expenses/scan", Icon: ReceiptText, colorClass: "menu-icon-rose", section: "Operational" },
      { label: "Facturi", path: "/expenses/invoices", Icon: ReceiptText, colorClass: "menu-icon-cyan", section: "Operational" },
      { label: "Rapoarte", path: "/expenses/reports", Icon: BarChart3, colorClass: "menu-icon-green", section: "Operational" },
      { label: "Firme", path: "/companies", Icon: Building2, colorClass: "menu-icon-violet", section: "Operational" },
      { label: "Scule", path: "/tools", Icon: Wrench, colorClass: "menu-icon-orange", section: "Operational" },
      { label: "Masini", path: "/vehicles", Icon: CarFront, colorClass: "menu-icon-green", section: "Operational" },
      { label: "Masina mea", path: "/my-vehicle", Icon: CarFront, colorClass: "menu-icon-blue", section: "Operational" },
    ],
  },
  {
    label: "Service Lift",
    items: [
      { label: "Mentenanta", path: "/maintenance", Icon: Building2, colorClass: "menu-icon-violet", section: "Service Lift" },
      { label: "Comenzi piese", path: "/maintenance/orders", Icon: PackageSearch, colorClass: "menu-icon-orange", section: "Service Lift" },
    ],
  },
  {
    label: "Notificari",
    items: [
      { label: "Notificari", path: "/notifications", Icon: Bell, colorClass: "menu-icon-orange", section: "Notificari" },
      { label: "Reguli notificari", path: "/notification-rules", Icon: BellRing, colorClass: "menu-icon-blue", section: "Notificari" },
    ],
  },
  {
    label: "Administrare",
    items: [
      { label: "Control Panel", path: "/control-panel", Icon: BarChart3, colorClass: "menu-icon-cyan", section: "Administrare" },
      { label: "Istoric", path: "/history", Icon: History, colorClass: "menu-icon-orange", section: "Administrare" },
    ],
  }
);

const allItems = menuSections.flatMap((s) => s.items);

type PageChangeSummary = {
  latestAt: number;
  items: AuditLogItem[];
};

type PageChangeMap = Record<string, PageChangeSummary>;
type PageReadState = Record<string, number>;

const ignoredChangeCategories = new Set(["auth", "navigation"]);
const ignoredChangeActions = new Set([
  "page_view",
  "site_entered",
  "user_site_entered",
  "notification_delivered",
  "notification_read",
  "push_token_synced",
]);

function cleanAuditPath(path: string) {
  return String(path || "").split("?")[0].split("#")[0].trim();
}

function matchesMenuPath(pathname: string, menuPath: string) {
  return pathname === menuPath || pathname.startsWith(`${menuPath}/`);
}

function getMenuItemForPath(pathname: string) {
  const safePath = cleanAuditPath(pathname);
  return [...allItems]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => matchesMenuPath(safePath, item.path)) || null;
}

function inferAuditPath(item: AuditLogItem) {
  const path = cleanAuditPath(item.path);
  if (path.startsWith("/")) return path;

  if (item.category === "users") return "/users";
  if (item.category === "tools") return "/tools";
  if (item.category === "vehicles") return "/vehicles";
  if (item.category === "timesheets") return "/timesheets";
  if (item.category === "leave") return "/my-leave";
  if (item.category === "projects") return "/projects";
  if (item.category === "notifications") return "/notifications";
  if (item.category === "maintenance") return "/maintenance";
  if (item.category === "expenses") return "/expenses/scan";
  if (item.category === "backup" || item.category === "system" || item.category === "web" || item.category === "server") {
    return "/control-panel";
  }

  return "";
}

function isVisiblePageChange(item: AuditLogItem) {
  if (ignoredChangeCategories.has(item.category)) return false;
  if (ignoredChangeActions.has(item.action)) return false;
  if (item.metadata?.eventType && ignoredChangeActions.has(String(item.metadata.eventType))) return false;
  const text = `${item.title || ""} ${item.message || ""}`.toLowerCase();
  if (text.includes("a intrat pe site") || text.includes("intrare pe site")) return false;
  if (!item.title && !item.message) return false;
  return Boolean(getMenuItemForPath(inferAuditPath(item)));
}

function pageReadKey(userId: string, path: string) {
  return `wc_page_changes_read:${userId}:${path}`;
}

function pageChangesInitializedKey(userId: string) {
  return `wc_page_changes_initialized:${userId}:v1`;
}

function pageReadDocId(path: string) {
  return encodeURIComponent(path).replace(/\./g, "%2E");
}

function buildInitialPageReadState(readAt = Date.now()): PageReadState {
  return allItems.reduce<PageReadState>((acc, item) => {
    acc[item.path] = readAt;
    return acc;
  }, {});
}

function getLocalPageReadAt(userId: string, path: string) {
  if (!userId || typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(pageReadKey(userId, path)) || "0");
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function initializeLocalPageChangeReads(userId: string, readAt = Date.now()) {
  if (!userId || typeof window === "undefined") return false;
  try {
    const key = pageChangesInitializedKey(userId);
    if (window.localStorage.getItem(key)) return false;
    allItems.forEach((item) => {
      window.localStorage.setItem(pageReadKey(userId, item.path), String(readAt));
    });
    window.localStorage.setItem(key, String(readAt));
    return true;
  } catch {
    return false;
  }
}

function writeLocalPageRead(userId: string, path: string, readAt: number) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pageReadKey(userId, path), String(readAt));
  } catch {
    // localStorage can be unavailable in private modes; the UI still works for the current session.
  }
}

async function seedRemotePageChangeReads(userId: string, readAt: number) {
  await Promise.all(
    allItems.map((item) =>
      setDoc(
        doc(db, "users", userId, "pageChangeReads", pageReadDocId(item.path)),
        {
          path: item.path,
          readAt,
          updatedAt: Date.now(),
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}

async function markPageChangesRead(userId: string, path: string, readAt: number) {
  if (!userId) return;
  writeLocalPageRead(userId, path, readAt);
  await setDoc(
    doc(db, "users", userId, "pageChangeReads", pageReadDocId(path)),
    {
      path,
      readAt,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

function getAuditDetailLines(item: AuditLogItem) {
  const metadata = item.metadata || {};
  const candidates = [metadata.changesText, metadata.fieldsText, metadata.detailsText];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((line) => String(line)).filter(Boolean).slice(0, 5);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return [candidate.trim()];
    }
  }
  return [];
}

function formatAuditMoment(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Date(ts).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPageChangeMap(
  items: AuditLogItem[],
  pageReadState: PageReadState,
  readsLoaded: boolean,
  currentUserId: string
): PageChangeMap {
  if (!readsLoaded) return {};

  return items.reduce<PageChangeMap>((acc, item) => {
    if (!isVisiblePageChange(item)) return acc;
    if (currentUserId && item.actorUserId === currentUserId) return acc;
    const menuItem = getMenuItemForPath(inferAuditPath(item));
    if (!menuItem) return acc;

    const readAt = pageReadState[menuItem.path] || 0;
    if (item.createdAt <= readAt) return acc;

    const existing = acc[menuItem.path] || { latestAt: 0, items: [] };
    existing.items.push(item);
    existing.latestAt = Math.max(existing.latestAt, item.createdAt);
    acc[menuItem.path] = existing;
    return acc;
  }, {});
}

function PageChangesPanel({
  pageTitle,
  changes,
  onMarkRead,
}: {
  pageTitle: string;
  changes: AuditLogItem[];
  onMarkRead: () => void;
}) {
  const visibleChanges = changes.slice(0, 6);

  return (
    <section className="page-changes-panel" aria-live="polite">
      <div className="page-changes-header">
        <div>
          <div className="page-changes-eyebrow">Modificari noi</div>
          <div className="page-changes-title">
            {changes.length === 1
              ? `1 schimbare pe ${pageTitle}`
              : `${changes.length} schimbari pe ${pageTitle}`}
          </div>
        </div>
        <button type="button" className="secondary-btn page-changes-read-btn" onClick={onMarkRead}>
          Am vazut modificarile
        </button>
      </div>
      <div className="page-changes-list">
        {visibleChanges.map((item) => {
          const detailLines = getAuditDetailLines(item);
          return (
            <article key={item.id} className="page-change-card">
              <div className="page-change-card-top">
                <strong>{item.title || "Modificare"}</strong>
                <span>{formatAuditMoment(item.createdAt)}</span>
              </div>
              {item.message && <p>{item.message}</p>}
              {detailLines.length > 0 && (
                <ul>
                  {detailLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="page-change-meta">
                {item.actorUserName || "WorkControl"}
                {item.entityLabel ? ` - ${item.entityLabel}` : ""}
              </div>
            </article>
          );
        })}
        {changes.length > visibleChanges.length && (
          <div className="page-change-more">
            +{changes.length - visibleChanges.length} modificari mai vechi pe pagina aceasta
          </div>
        )}
      </div>
    </section>
  );
}

function NavItems({
  onNavigate,
  unreadCount,
  pageChangeMap,
}: {
  onNavigate?: () => void;
  unreadCount: number;
  pageChangeMap: PageChangeMap;
}) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const fromMyVehicleView = searchParams.get("view") === "my-vehicle";

  return (
    <>
      {menuSections.map((section) => (
        <div key={section.label}>
          <div className="nav-section-label">{section.label}</div>
          {section.items.map(({ label, path, Icon, colorClass }) => {
            const changeCount = pageChangeMap[path]?.items.length || 0;
            return (
              <NavLink key={path} to={path} onClick={onNavigate}
                onMouseEnter={() => prefetchPage(path)}
                onFocus={() => prefetchPage(path)}
                onTouchStart={() => prefetchPage(path)}
                className={({ isActive }) => {
                  const forceMyVehicleActive = path === "/my-vehicle" && fromMyVehicleView;
                  const suppressVehiclesActive = path === "/vehicles" && fromMyVehicleView;
                  const suppressMaintenanceActive = path === "/maintenance" && location.pathname.startsWith("/maintenance/orders");
                  const active = suppressVehiclesActive || suppressMaintenanceActive ? false : (isActive || forceMyVehicleActive);
                  return active ? "nav-item nav-item-active" : "nav-item";
                }}>
                <span className={`nav-item-icon-wrap ${colorClass}`}>
                  <Icon size={17} strokeWidth={2.2} className="nav-item-icon" />
                </span>
                <span className="nav-item-label">{label}</span>
                {changeCount > 0 && (
                  <span
                    className="nav-change-dot"
                    title={`${changeCount} modificari noi`}
                    aria-label={`${changeCount} modificari noi`}
                  />
                )}
                {path === "/notifications" && unreadCount > 0 && (
                  <span className="nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
    </>
  );
}

function TopbarClock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const timeStr = currentTime.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  const dateStr = currentTime.toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2 }}
      className="desktop-logout-btn"
    >
      <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.3px", color: "var(--text)" }}>
        {timeStr}
      </span>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{dateStr}</span>
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const { user, role } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [auditItems, setAuditItems] = useState<AuditLogItem[]>([]);
  const [pageReadState, setPageReadState] = useState<PageReadState>({});
  const [pageReadsLoaded, setPageReadsLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Track uid for maintenance alert — only run when uid changes, not on displayName/email/themeKey
  const maintenanceRanRef = useRef<string | null>(null);

  useNotificationsListener(user?.uid);

  useEffect(() => {
    if (!user?.uid) return;
    if (!hasPushVapidKey()) return;
    void syncPushTokenIfGranted(user.uid);
  }, [user?.uid]);

  // Unread notifications badge
  useEffect(() => {
    if (!user?.uid) { setUnreadCount(0); return; }
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      where("read", "==", false)
    );
    return onSnapshot(q,
      (snap) => {
        setUnreadCount(snap.size);
        try { localStorage.setItem("wc_unread_count", String(snap.size)); } catch { /* no-op */ }
      },
      () => setUnreadCount(0)
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setAuditItems([]);
      return;
    }

    return subscribeAuditLogs(
      setAuditItems,
      (error) => console.warn("[AppShell][pageChanges]", error),
      500
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setPageReadState({});
      setPageReadsLoaded(false);
      return;
    }

    setPageReadsLoaded(false);
    const readsRef = collection(db, "users", user.uid, "pageChangeReads");

    return onSnapshot(
      readsRef,
      (snap) => {
        if (snap.empty) {
          const readAt = Date.now();
          const initialState = buildInitialPageReadState(readAt);
          initializeLocalPageChangeReads(user.uid, readAt);
          setPageReadState(initialState);
          setPageReadsLoaded(true);
          void seedRemotePageChangeReads(user.uid, readAt).catch((error) => {
            console.warn("[AppShell][seedPageChangeReads]", error);
          });
          return;
        }

        const nextState: PageReadState = {};
        snap.docs.forEach((readDoc) => {
          const data = readDoc.data() as { path?: unknown; readAt?: unknown };
          const path = typeof data.path === "string" ? data.path : "";
          const remoteReadAt = typeof data.readAt === "number" && Number.isFinite(data.readAt) ? data.readAt : 0;
          if (!path) return;
          nextState[path] = Math.max(remoteReadAt, getLocalPageReadAt(user.uid, path));
        });

        setPageReadState(nextState);
        setPageReadsLoaded(true);
      },
      (error) => {
        console.warn("[AppShell][pageChangeReads]", error);
        const fallbackState = allItems.reduce<PageReadState>((acc, item) => {
          acc[item.path] = getLocalPageReadAt(user.uid, item.path);
          return acc;
        }, {});
        setPageReadState(fallbackState);
        setPageReadsLoaded(true);
      }
    );
  }, [user?.uid]);

  // UI preferences — once per mount
  useEffect(() => {
    const load = async () => {
      try {
        const settings = await getControlPanelSettings();
        document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
        document.documentElement.dataset.uiFontFamily = settings.uiFontFamily;
        document.documentElement.dataset.uiDensity = settings.uiDensity;
        document.documentElement.dataset.uiPalette = settings.uiPalette;
        document.documentElement.dataset.uiCardStyle = settings.uiCardStyle;
        document.documentElement.dataset.uiContrast = settings.uiContrast;
        document.documentElement.dataset.uiAnimations = settings.uiAnimations;
      } catch (err) {
        console.error("[AppShell][loadUiPreferences]", err);
      }
    };
    void load();
  }, []);

  // Vehicle maintenance alerts — run in background after the shell settles
  useEffect(() => {
    if (!user?.uid) return;
    if (role !== "admin" && role !== "manager") return;
    const runKey = `${user.uid}:${role}`;
    if (maintenanceRanRef.current === runKey) return;
    maintenanceRanRef.current = runKey;

    let timerId: number | undefined;
    let idleId: number | undefined;
    const requestIdleCallback = window.requestIdleCallback?.bind(window);
    const cancelIdleCallback = window.cancelIdleCallback?.bind(window);

    const runAlerts = () => {
      void runVehicleMaintenanceAlerts({
        userId: user.uid,
        userName: user.displayName || user.email || "WorkControl",
        userThemeKey: user.themeKey ?? null,
      }).catch((err) => console.error("[AppShell][runVehicleMaintenanceAlerts]", err));
    };

    if (requestIdleCallback) {
      idleId = requestIdleCallback(runAlerts, { timeout: 4_000 });
    } else {
      timerId = window.setTimeout(runAlerts, 2_500);
    }

    return () => {
      if (typeof timerId === "number") {
        window.clearTimeout(timerId);
      }
      if (typeof idleId === "number" && cancelIdleCallback) {
        cancelIdleCallback(idleId);
      }
    };
  }, [user?.uid, user?.displayName, user?.email, user?.themeKey, role]);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!user?.uid) return;
    const item = getMenuItemForPath(location.pathname);
    const fullPath = `${location.pathname}${location.search || ""}`;
    logPageView({
      userId: user.uid,
      userName: user.displayName || user.email || "Utilizator",
      userThemeKey: user.themeKey ?? null,
      path: fullPath,
      pageTitle: item?.label || "WorkControl",
    });
  }, [location.pathname, location.search, user?.displayName, user?.email, user?.themeKey, user?.uid]);

  // Close on resize
  useEffect(() => {
    const handle = () => { if (window.innerWidth > 860) setMobileMenuOpen(false); };
    window.addEventListener("resize", handle, { passive: true });
    return () => window.removeEventListener("resize", handle);
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logoutUser(); }
    catch (err) { console.error("[AppShell][logout]", err); setLoggingOut(false); }
  }

  const currentItem = getMenuItemForPath(location.pathname);
  const pageChangeMap = useMemo(
    () => buildPageChangeMap(auditItems, pageReadState, pageReadsLoaded, user?.uid || ""),
    [auditItems, pageReadState, pageReadsLoaded, user?.uid]
  );
  const currentChanges = currentItem ? pageChangeMap[currentItem.path]?.items || [] : [];
  const pageTitle = currentItem?.label || "WorkControl";
  const pageSection = currentItem?.section || "";
  const PageIcon = currentItem?.Icon || LayoutDashboard;

  const initials = (user?.displayName || "A")
    .split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  function handleMarkCurrentPageChangesRead() {
    if (!user?.uid || !currentItem) return;
    const latestAt = pageChangeMap[currentItem.path]?.latestAt || Date.now();
    setPageReadState((state) => ({ ...state, [currentItem.path]: latestAt }));
    void markPageChangesRead(user.uid, currentItem.path, latestAt).catch((error) => {
      console.warn("[AppShell][markPageChangesRead]", error);
    });
  }

  return (
    <div className="shell">
      {/* ── DESKTOP SIDEBAR ── */}
      <aside className="sidebar desktop-sidebar" aria-label="Navigare principală">
        <div className="brand">
          <div className="brand-badge">WC</div>
          <div>
            <div className="brand-title">WorkControl</div>
            <div className="brand-subtitle">Management firmă</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavItems unreadCount={unreadCount} pageChangeMap={pageChangeMap} />
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="nav-item desktop-logout-btn"
            onClick={() => void handleLogout()} disabled={loggingOut}
            style={{ width: "100%", background: "none", border: "none", cursor: loggingOut ? "wait" : "pointer", color: "var(--danger)" }}>
            <span className="nav-item-icon-wrap menu-icon-rose" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <LogOut size={17} strokeWidth={2.2} className="nav-item-icon" />
            </span>
            <span className="nav-item-label">{loggingOut ? "Se deconectează..." : "Deconectare"}</span>
          </button>
        </div>
      </aside>

      {/* ── MOBILE OVERLAY ── */}
      {mobileMenuOpen && (
        <button type="button" className="mobile-menu-overlay"
          onClick={() => setMobileMenuOpen(false)} aria-label="Închide meniul" />
      )}

      {/* ── MOBILE DRAWER ── */}
      <aside className={`mobile-drawer ${mobileMenuOpen ? "mobile-drawer-open" : ""}`}
        aria-label="Meniu mobil" aria-hidden={!mobileMenuOpen}>
        <div className="mobile-drawer-header">
          <div className="brand" style={{ border: "none", padding: "0", marginBottom: 0 }}>
            <div className="brand-badge">WC</div>
            <div>
              <div className="brand-title">WorkControl</div>
              <div className="brand-subtitle">Management firmă</div>
            </div>
          </div>
          <button type="button" className="mobile-menu-close"
            onClick={() => setMobileMenuOpen(false)} aria-label="Închide">
            <X size={16} />
          </button>
        </div>
        <nav className="sidebar-nav">
          <NavItems onNavigate={() => setMobileMenuOpen(false)} unreadCount={unreadCount} pageChangeMap={pageChangeMap} />
        </nav>
        <div className="mobile-drawer-footer">
          <button type="button" className="secondary-btn mobile-logout-btn"
            onClick={() => void handleLogout()} disabled={loggingOut} style={{ gap: 8 }}>
            <LogOut size={15} strokeWidth={2.2} />
            {loggingOut ? "Se deconectează..." : "Deconectare"}
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-main-row">
            <div className="topbar-left">
              <button type="button" className="mobile-menu-button"
                onClick={() => setMobileMenuOpen(true)} aria-label="Deschide meniul"
                aria-expanded={mobileMenuOpen}>
                <Menu size={20} strokeWidth={2.2} />
              </button>
              <div className="topbar-heading">
                <h1 className="topbar-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="page-title-icon-box">
                    <PageIcon size={17} strokeWidth={2.2} />
                  </span>
                  {pageTitle}
                </h1>
                <div className="topbar-breadcrumb">
                  <span>WorkControl</span>
                  {pageSection && (
                    <>
                      <ChevronRight size={11} className="topbar-breadcrumb-sep" />
                      <span>{pageSection}</span>
                    </>
                  )}
                  {pageSection !== pageTitle && (
                    <>
                      <ChevronRight size={11} className="topbar-breadcrumb-sep" />
                      <span className="topbar-breadcrumb-current">{pageTitle}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="topbar-right-cluster">
              <TopbarClock />
              <div className="topbar-user">
                <div className="topbar-user-avatar">
                  {user?.avatarThumbUrl || user?.avatarUrl ? (
                    <img src={user.avatarThumbUrl || user.avatarUrl} alt="" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="topbar-user-meta">
                  <div className="topbar-user-name">{user?.displayName || "Admin"}</div>
                  <div className="topbar-user-role">{user?.email || "Administrator"}</div>
                </div>
                <button type="button" className="secondary-btn desktop-logout-btn"
                  onClick={() => void handleLogout()} disabled={loggingOut}
                  style={{ padding: "7px 12px", gap: 6 }}>
                  <LogOut size={15} strokeWidth={2.2} />
                  {loggingOut ? "..." : "Logout"}
                </button>
              </div>
            </div>
          </div>
        </header>

        <AppUpdateBanner />
        <InstallAppBanner />
        <NotificationPermissionBanner userId={user?.uid} />
        {currentItem && currentChanges.length > 0 && (
          <PageChangesPanel
            pageTitle={pageTitle}
            changes={currentChanges}
            onMarkRead={handleMarkCurrentPageChangesRead}
          />
        )}

        <main className="page-content" id="main-content">
          <Outlet />
        </main>
      </div>
      <FloatingQuickLinks />
      <VoiceCommandAssistant />
    </div>
  );
}
