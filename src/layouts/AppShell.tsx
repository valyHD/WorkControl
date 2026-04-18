import { useEffect, useState, type ElementType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logoutUser } from "../modules/auth/services/authService";
import { useNotificationsListener } from "../lib/notifications/useNotificationsListener";
import {
  LayoutDashboard,
  User,
  Users,
  Wrench,
  CarFront,
  Clock3,
  Clock4,
  Briefcase,
  Bell,
  BellRing,
  BarChart3,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { getControlPanelSettings } from "../modules/reports/services/controlPanelService";
import { runVehicleMaintenanceAlerts } from "../modules/vehicles/services/vehiclesService";

type MenuItem = {
  label: string;
  path: string;
  Icon: ElementType;
  colorClass:
    | "menu-icon-blue"
    | "menu-icon-violet"
    | "menu-icon-cyan"
    | "menu-icon-orange"
    | "menu-icon-green"
    | "menu-icon-rose";
  section: string;
};

const menuSections: { label: string; items: MenuItem[] }[] = [
  {
    label: "Principal",
    items: [
      { label: "Dashboard", path: "/dashboard", Icon: LayoutDashboard, colorClass: "menu-icon-blue", section: "Principal" },
      { label: "Profilul meu", path: "/my-profile", Icon: User, colorClass: "menu-icon-violet", section: "Principal" },
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
    ],
  },
];

const allItems = menuSections.flatMap((section) => section.items);

function NavItems({
  onNavigate,
  unreadCount,
}: {
  onNavigate?: () => void;
  unreadCount: number;
}) {
  return (
    <>
      {menuSections.map((section) => (
        <div key={section.label}>
          <div className="nav-section-label">{section.label}</div>

          {section.items.map(({ label, path, Icon, colorClass }) => (
            <NavLink
              key={path}
              to={path}
              onClick={onNavigate}
              className={({ isActive }) =>
                isActive ? "nav-item nav-item-active" : "nav-item"
              }
            >
              <span className={`nav-item-icon-wrap ${colorClass}`}>
                <Icon size={17} strokeWidth={2.2} className="nav-item-icon" />
              </span>
              <span className="nav-item-label">{label}</span>

              {/* Badge notificări necitite pe itemul Notificări */}
              {path === "/notifications" && unreadCount > 0 && (
                <span className="nav-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
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

  useNotificationsListener(user?.uid);

  // Ceas live în topbar
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setUnreadCount(0);
      return;
    }

    const unreadQuery = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      where("read", "==", false)
    );

    return onSnapshot(
      unreadQuery,
      (snap) => {
        setUnreadCount(snap.size);
        localStorage.setItem("wc_unread_count", String(snap.size));
      },
      () => setUnreadCount(0)
    );
  }, [user?.uid]);

  useEffect(() => {
    async function loadUiPreferences() {
      const settings = await getControlPanelSettings();
      document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
      document.documentElement.dataset.uiDensity = settings.uiDensity;
      document.documentElement.dataset.uiPalette = settings.uiPalette;
    }

    void loadUiPreferences().catch((error) => {
      console.error("[AppShell][loadUiPreferences]", error);
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    void runVehicleMaintenanceAlerts({
      userId: user.uid,
      userName: user.displayName || user.email || "WorkControl",
      userThemeKey: user.themeKey ?? null,
    }).catch((error) => {
      console.error("[AppShell][runVehicleMaintenanceAlerts]", error);
    });
  }, [user?.uid, user?.displayName, user?.email, user?.themeKey]);

  const currentItem =
    allItems.find((item) => location.pathname.startsWith(item.path)) || null;

  const pageTitle = currentItem?.label || "WorkControl";
  const pageSection = currentItem?.section || "";
  const PageIcon = currentItem?.Icon || LayoutDashboard;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth > 860) setMobileMenuOpen(false);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function handleLogout() {
    await logoutUser();
  }

  const initials = (user?.displayName || "A")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const timeStr = currentTime.toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = currentTime.toLocaleDateString("ro-RO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div className="shell">
      {/* ── DESKTOP SIDEBAR ── */}
      <aside className="sidebar desktop-sidebar">
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
          <button
            type="button"
            className="nav-item desktop-logout-btn"
            onClick={handleLogout}
            style={{
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--danger)",
            }}
          >
            <span
              className="nav-item-icon-wrap menu-icon-rose"
              style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            >
              <LogOut size={17} strokeWidth={2.2} className="nav-item-icon" />
            </span>
            <span className="nav-item-label">Deconectare</span>
          </button>
        </div>
      </aside>

      {/* ── MOBILE OVERLAY ── */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="mobile-menu-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Închide meniul"
        />
      )}

      {/* ── MOBILE DRAWER ── */}
      <aside className={`mobile-drawer ${mobileMenuOpen ? "mobile-drawer-open" : ""}`}>
        <div className="mobile-drawer-header">
          <div className="brand" style={{ border: "none", padding: "0", marginBottom: 0 }}>
            <div className="brand-badge">WC</div>
            <div>
              <div className="brand-title">WorkControl</div>
              <div className="brand-subtitle">Management firmă</div>
            </div>
          </div>
          <button
            type="button"
            className="mobile-menu-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Închide"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavItems
            onNavigate={() => setMobileMenuOpen(false)}
            unreadCount={unreadCount}
          />
        </nav>

        <div className="mobile-drawer-footer">
          <button
            type="button"
            className="secondary-btn mobile-logout-btn"
            onClick={handleLogout}
            style={{ gap: 8 }}
          >
            <LogOut size={15} strokeWidth={2.2} />
            Deconectare
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-main-row">
            {/* LEFT: hamburger + titlu + breadcrumb */}
            <div className="topbar-left">
              <button
                type="button"
                className="mobile-menu-button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Deschide meniul"
              >
                <Menu size={20} strokeWidth={2.2} />
              </button>

              <div className="topbar-heading">
                <h1
                  className="topbar-title"
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span className="page-title-icon-box">
                    <PageIcon size={17} strokeWidth={2.2} />
                  </span>
                  {pageTitle}
                </h1>

                {/* Breadcrumb dinamic */}
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

            {/* RIGHT: ora + user chip + logout */}
            <div className="topbar-right-cluster">
              {/* Ceas & dată */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  lineHeight: 1.2,
                }}
                className="desktop-logout-btn"
              >
                <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.3px", color: "var(--text)" }}>
                  {timeStr}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>
                  {dateStr}
                </span>
              </div>

              {/* User chip */}
              <div className="topbar-user">
                <div className="topbar-user-avatar">{initials}</div>
                <div className="topbar-user-meta">
                  <div className="topbar-user-name">{user?.displayName || "Admin"}</div>
                  <div className="topbar-user-role">{user?.email || "Administrator"}</div>
                </div>
                <button
                  type="button"
                  className="secondary-btn desktop-logout-btn"
                  onClick={handleLogout}
                  style={{ padding: "7px 12px", gap: 6 }}
                >
                  <LogOut size={15} strokeWidth={2.2} />
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
