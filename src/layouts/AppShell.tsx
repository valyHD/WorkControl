import { useEffect, useRef, useState, type ElementType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logoutUser } from "../modules/auth/services/authService";
import { useNotificationsListener } from "../lib/notifications/useNotificationsListener";
import { hasPushVapidKey, syncPushTokenIfGranted } from "../lib/notifications/pushNotifications";
import {
  LayoutDashboard, User, Users, Wrench, CarFront, Clock3, Clock4,
  Briefcase, Bell, BellRing, BarChart3, LogOut, Menu, X, ChevronRight, Building2, CalendarDays,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { getControlPanelSettings } from "../modules/reports/services/controlPanelService";
import { runVehicleMaintenanceAlerts } from "../modules/vehicles/services/vehiclesService";

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
      { label: "Mentenanță", path: "/maintenance", Icon: Building2, colorClass: "menu-icon-violet", section: "Administrare" },
    ],
  },
];

const allItems = menuSections.flatMap((s) => s.items);

function NavItems({ onNavigate, unreadCount }: { onNavigate?: () => void; unreadCount: number }) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const fromMyVehicleView = searchParams.get("view") === "my-vehicle";

  return (
    <>
      {menuSections.map((section) => (
        <div key={section.label}>
          <div className="nav-section-label">{section.label}</div>
          {section.items.map(({ label, path, Icon, colorClass }) => (
            <NavLink key={path} to={path} onClick={onNavigate}
              className={({ isActive }) => {
                const forceMyVehicleActive = path === "/my-vehicle" && fromMyVehicleView;
                const suppressVehiclesActive = path === "/vehicles" && fromMyVehicleView;
                const active = suppressVehiclesActive ? false : (isActive || forceMyVehicleActive);
                return active ? "nav-item nav-item-active" : "nav-item";
              }}>
              <span className={`nav-item-icon-wrap ${colorClass}`}>
                <Icon size={17} strokeWidth={2.2} className="nav-item-icon" />
              </span>
              <span className="nav-item-label">{label}</span>
              {path === "/notifications" && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

export default function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [unreadCount, setUnreadCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  // Track uid for maintenance alert — only run when uid changes, not on displayName/email/themeKey
  const maintenanceRanRef = useRef<string | null>(null);

  useNotificationsListener(user?.uid);

  useEffect(() => {
    if (!user?.uid) return;
    if (!hasPushVapidKey()) return;
    void syncPushTokenIfGranted(user.uid);
  }, [user?.uid]);

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

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

  // Vehicle maintenance alerts — only when uid actually changes
  useEffect(() => {
    if (!user?.uid) return;
    if (maintenanceRanRef.current === user.uid) return;
    maintenanceRanRef.current = user.uid;

    void runVehicleMaintenanceAlerts({
      userId: user.uid,
      userName: user.displayName || user.email || "WorkControl",
      userThemeKey: user.themeKey ?? null,
    }).catch((err) => console.error("[AppShell][runVehicleMaintenanceAlerts]", err));
  }, [user?.uid, user?.displayName, user?.email, user?.themeKey]);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

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

  const currentItem = allItems.find((item) => location.pathname.startsWith(item.path)) || null;
  const pageTitle = currentItem?.label || "WorkControl";
  const pageSection = currentItem?.section || "";
  const PageIcon = currentItem?.Icon || LayoutDashboard;

  const initials = (user?.displayName || "A")
    .split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const timeStr = currentTime.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  const dateStr = currentTime.toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "short" });

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
          <NavItems unreadCount={unreadCount} />
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
          <NavItems onNavigate={() => setMobileMenuOpen(false)} unreadCount={unreadCount} />
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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2 }}
                className="desktop-logout-btn">
                <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.3px", color: "var(--text)" }}>{timeStr}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{dateStr}</span>
              </div>
              <div className="topbar-user">
                <div className="topbar-user-avatar">{initials}</div>
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

        <main className="page-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
