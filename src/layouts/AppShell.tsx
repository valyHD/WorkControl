import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logoutUser } from "../modules/auth/services/authService";
import { hasPushVapidKey, syncPushTokenIfGranted } from "../lib/notifications/pushNotifications";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { NotificationPermissionBanner } from "../components/NotificationPermissionBanner";
import { FloatingQuickLinks } from "../components/FloatingQuickLinks";
import { getAuditLogs, logPageView } from "../modules/audit/services/auditLogService";
import type { AuditLogItem } from "../types/audit";
import { LayoutDashboard, LogOut, Menu } from "lucide-react";
import { collection, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { getControlPanelSettings } from "../modules/reports/services/controlPanelService";
import { applyControlPanelUiPreferences } from "../modules/reports/services/controlPanelUiPreferences";
import { clearFleetRouteSessionCache } from "../modules/vehicles/services/fleetRouteSync";
import { getNavigationItemForPath } from "../config/navigation";
import { getPageExperience } from "../config/pageExperience";
import { ConnectivityBanner, PageBreadcrumbs } from "../components/experience";
import ProductIntelligenceHub from "../components/product/ProductIntelligenceHub";
import { trackWorkControlPage, useFeatureFlags } from "../lib/productIntelligence";
import OfflineSyncCoordinator from "../components/product/OfflineSyncCoordinator";
import { AppShellNavigation, TopbarClock } from "./appShell/AppShellNavigation";
import {
  PageChangesPanel,
  buildInitialPageReadState,
  buildLocalPageReadState,
  buildPageChangeMap,
  getLocalPageReadAt,
  initializeLocalPageChangeReads,
  markPageChangesRead,
  seedRemotePageChangeReads,
  type PageReadState,
} from "./appShell/pageChanges";

const VoiceCommandAssistant = lazy(() => import("../components/VoiceCommandAssistant"));
const GlobalCommandPalette = lazy(() => import("../components/product/GlobalCommandPalette"));

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
        setPageReadState(buildLocalPageReadState(user.uid));
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
        applyControlPanelUiPreferences(settings);
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
    const navigation = drawer.querySelector<HTMLElement>(".mobile-drawer-navigation");
    const activeItem = drawer.querySelector<HTMLElement>(".nav-item-active");
    const activeNavigationItem = navigation?.querySelector<HTMLElement>(".nav-item-active");
    const initialFocusTarget = activeItem || getFocusable()[0];
    initialFocusTarget?.focus({ preventScroll: true });
    if (activeNavigationItem && navigation) {
      const navigationRect = navigation.getBoundingClientRect();
      const itemRect = activeNavigationItem.getBoundingClientRect();
      const centeredOffset = (navigationRect.height - itemRect.height) / 2;
      navigation.scrollTop = Math.max(
        0,
        navigation.scrollTop + itemRect.top - navigationRect.top - centeredOffset
      );
    }
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
    const item = getNavigationItemForPath(location.pathname);
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

  const currentItem = getNavigationItemForPath(location.pathname);
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
      <AppShellNavigation
        mobileMenuOpen={mobileMenuOpen}
        sidebarCollapsed={sidebarCollapsed}
        loggingOut={loggingOut}
        unreadCount={unreadCount}
        pageChangeMap={pageChangeMap}
        role={role || "angajat"}
        globalAdmin={user?.globalAdmin === true}
        mobileDrawerRef={mobileDrawerRef}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        onLogout={() => void handleLogout()}
      />

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
                  <span className="topbar-title__text">{pageTitle}</span>
                </h1>
                <PageBreadcrumbs items={breadcrumbs} />
              </div>
            </div>

            <div className="topbar-right-cluster">
              {flags.contextualHelp && user?.uid ? (
                <ProductIntelligenceHub userId={user.uid} role={role || "angajat"} pathname={location.pathname} />
              ) : null}
              <span className="topbar-global-search">
                <Suspense fallback={<span className="wc-command-trigger wc-command-trigger--loading" aria-hidden="true" />}>
                  <GlobalCommandPalette />
                </Suspense>
              </span>
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
      <OfflineSyncCoordinator />
      <Suspense fallback={null}><VoiceCommandAssistant /></Suspense>
    </div>
  );
}
