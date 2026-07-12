import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logoutUser } from "../modules/auth/services/authService";
import { hasPushVapidKey, syncPushTokenIfGranted } from "../lib/notifications/pushNotifications";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { NotificationPermissionBanner } from "../components/NotificationPermissionBanner";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import { FloatingQuickLinks } from "../components/FloatingQuickLinks";
import { getAuditLogs, logPageView } from "../modules/audit/services/auditLogService";
import type { AuditLogItem } from "../types/audit";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { collection, doc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { getControlPanelSettings } from "../modules/reports/services/controlPanelService";
import { clearFleetRouteSessionCache } from "../modules/vehicles/services/fleetRouteSync";
import {
  NAVIGATION_ITEMS,
  getNavigationItemForPath,
  getNavigationSectionsForRole,
} from "../config/navigation";
import { getPageExperience } from "../config/pageExperience";
import { ConnectivityBanner, PageBreadcrumbs } from "../components/experience";
import ProductIntelligenceHub from "../components/product/ProductIntelligenceHub";
import { trackWorkControlPage, useFeatureFlags } from "../lib/productIntelligence";

const VoiceCommandAssistant = lazy(() => import("../components/VoiceCommandAssistant"));
const GlobalCommandPalette = lazy(() => import("../components/product/GlobalCommandPalette"));

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
  "/inbox": () => import("../modules/inbox/pages/OperationalInboxPage"),
  "/control-panel": () => import("../modules/reports/pages/ReportsPage"),
  "/maintenance": () => import("../modules/maintenance/pages/MaintenancePage"),
  "/maintenance/orders": () => import("../modules/maintenance/pages/MaintenancePartOrdersPage"),
  "/expenses/scan": () => import("../modules/expenses/pages/ExpenseScanPage"),
  "/expenses/invoices": () => import("../modules/expenses/pages/ExpenseInvoicesPage"),
  "/expenses/reports": () => import("../modules/expenses/pages/ExpenseReportsPage"),
  "/companies": () => import("../modules/companies/pages/CompaniesPage"),
  "/history": () => import("../modules/audit/pages/AuditLogPage"),
  "/control-panel/ui-lab": () => import("../modules/reports/pages/UiLabPage"),
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

const allItems = NAVIGATION_ITEMS;

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

function getMenuItemForPath(pathname: string) {
  return getNavigationItemForPath(pathname);
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
  role,
  mobile = false,
}: {
  onNavigate?: () => void;
  unreadCount: number;
  pageChangeMap: PageChangeMap;
  role: string;
  mobile?: boolean;
}) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const fromMyVehicleView = searchParams.get("view") === "my-vehicle";
  const menuSections = getNavigationSectionsForRole(role || "angajat");

  return (
    <>
      {menuSections.map((section) => (
        <div key={section.label} className={section.compact ? "nav-section nav-section--compact" : "nav-section"}>
          <div className="nav-section-label">{section.label}</div>
          {[...section.items]
            .sort((left, right) => mobile ? left.mobilePriority - right.mobilePriority : 0)
            .map(({ label, path, icon: Icon, colorClass }) => {
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
  const { flags } = useFeatureFlags();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("wc_sidebar_collapsed:v1") === "true";
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [auditItems, setAuditItems] = useState<AuditLogItem[]>([]);
  const [pageReadState, setPageReadState] = useState<PageReadState>({});
  const [pageReadsLoaded, setPageReadsLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Track uid for maintenance alert — only run when uid changes, not on displayName/email/themeKey
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
      where("read", "==", false),
      limit(30)
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

    let cancelled = false;
    void getAuditLogs(20)
      .then((items) => {
        if (!cancelled) setAuditItems(items);
      })
      .catch((error) => console.warn("[AppShell][pageChanges]", error));
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setPageReadState({});
      setPageReadsLoaded(false);
      return;
    }

    let cancelled = false;
    setPageReadsLoaded(false);
    const readsRef = collection(db, "users", user.uid, "pageChangeReads");

    void getDocs(readsRef)
      .then((snap) => {
        if (cancelled) return;
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
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[AppShell][pageChangeReads]", error);
        const fallbackState = allItems.reduce<PageReadState>((acc, item) => {
          acc[item.path] = getLocalPageReadAt(user.uid, item.path);
          return acc;
        }, {});
        setPageReadState(fallbackState);
        setPageReadsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
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

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem("wc_sidebar_collapsed:v1", String(sidebarCollapsed));
    } catch {
      // The sidebar still works when localStorage is unavailable.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!mobileMenuOpen || !mobileDrawerRef.current) return;
    const drawer = mobileDrawerRef.current;
    const menuTrigger = menuButtonRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector));
    getFocusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer.addEventListener("keydown", handleKeyDown);
    return () => {
      drawer.removeEventListener("keydown", handleKeyDown);
      (previous || menuTrigger)?.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!user?.uid) return;
    const item = getMenuItemForPath(location.pathname);
    logPageView({
      userId: user.uid,
      userName: user.displayName || user.email || "Utilizator",
      userThemeKey: user.themeKey ?? null,
      path: location.pathname,
      pageTitle: item?.label || "WorkControl",
    });
    if (flags.usageAnalytics) void trackWorkControlPage(location.pathname, role || "angajat");
  }, [flags.usageAnalytics, location.pathname, role, user?.displayName, user?.email, user?.themeKey, user?.uid]);

  // Close on resize
  useEffect(() => {
    const handle = () => { if (window.innerWidth > 860) setMobileMenuOpen(false); };
    window.addEventListener("resize", handle, { passive: true });
    return () => window.removeEventListener("resize", handle);
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      clearFleetRouteSessionCache(user?.uid);
      await logoutUser();
    }
    catch (err) { console.error("[AppShell][logout]", err); setLoggingOut(false); }
  }

  const currentItem = getMenuItemForPath(location.pathname);
  const pageExperience = getPageExperience(location.pathname);
  const pageChangeMap = useMemo(
    () => buildPageChangeMap(auditItems, pageReadState, pageReadsLoaded, user?.uid || ""),
    [auditItems, pageReadState, pageReadsLoaded, user?.uid]
  );
  const currentChanges = currentItem ? pageChangeMap[currentItem.path]?.items || [] : [];
  const pageTitle = pageExperience?.title || currentItem?.label || "WorkControl";
  const PageIcon = currentItem?.icon || LayoutDashboard;
  const breadcrumbs = pageExperience?.breadcrumbs || (currentItem ? [{ label: currentItem.label }] : []);

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
    <div className={`shell${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">Sari la continut</a>
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
          <NavItems unreadCount={unreadCount} pageChangeMap={pageChangeMap} role={role} />
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item sidebar-collapse-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Extinde meniul" : "Restrange meniul"}
            title={sidebarCollapsed ? "Extinde meniul" : "Restrange meniul"}
          >
            <span className="nav-item-icon-wrap menu-icon-cyan">
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </span>
            <span className="nav-item-label">Restrange meniul</span>
          </button>
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
      <aside ref={mobileDrawerRef} className={`mobile-drawer ${mobileMenuOpen ? "mobile-drawer-open" : ""}`}
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
          <NavItems mobile onNavigate={() => setMobileMenuOpen(false)} unreadCount={unreadCount} pageChangeMap={pageChangeMap} role={role} />
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
              <button ref={menuButtonRef} type="button" className="mobile-menu-button"
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
                <PageBreadcrumbs items={breadcrumbs} />
              </div>
            </div>

            <div className="topbar-right-cluster">
              {flags.contextualHelp && user?.uid ? (
                <ProductIntelligenceHub userId={user.uid} role={role || "angajat"} pathname={location.pathname} />
              ) : null}
              <Suspense fallback={<span className="wc-command-trigger wc-command-trigger--loading" aria-hidden="true" />}>
                <GlobalCommandPalette />
              </Suspense>
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
        <ConnectivityBanner />
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
      <Suspense fallback={null}><VoiceCommandAssistant /></Suspense>
    </div>
  );
}
