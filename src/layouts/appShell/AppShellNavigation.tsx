import { useEffect, useState, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { getNavigationSectionsForRole, isNavigationItemActive } from "../../config/navigation";
import { prefetchNavigationPath } from "../../config/navigationPrefetch";
import type { PageChangeMap } from "./pageChanges";

function NavItems({
  onNavigate,
  unreadCount,
  pageChangeMap,
  role,
  globalAdmin,
  mobile = false,
}: {
  onNavigate?: () => void;
  unreadCount: number;
  pageChangeMap: PageChangeMap;
  role: string;
  globalAdmin: boolean;
  mobile?: boolean;
}) {
  const location = useLocation();
  const menuSections = getNavigationSectionsForRole(role || "angajat");

  return menuSections.map((section) => (
    <div
      key={section.id}
      className={section.compact ? "nav-section nav-section--compact" : "nav-section"}
    >
      <div className="nav-section-label">{section.label}</div>
      {[...section.items]
        .filter((item) => globalAdmin || item.path !== "/control-panel")
        .sort((left, right) => (mobile ? left.mobilePriority - right.mobilePriority : 0))
        .map(({ label, path, icon: Icon, colorClass }) => {
          const changeCount = pageChangeMap[path]?.items.length || 0;
          return (
            <NavLink
              key={path}
              to={path}
              onClick={onNavigate}
              onMouseEnter={() => prefetchNavigationPath(path)}
              onFocus={() => prefetchNavigationPath(path)}
              onTouchStart={() => prefetchNavigationPath(path)}
              className={({ isActive }) => {
                const active = isNavigationItemActive({
                  pathname: location.pathname,
                  search: location.search,
                  itemPath: path,
                  routerIsActive: isActive,
                });
                return active ? "nav-item nav-item-active" : "nav-item";
              }}
            >
              <span className={`nav-item-icon-wrap ${colorClass}`}>
                <Icon size={17} strokeWidth={2.2} className="nav-item-icon" />
              </span>
              <span className="nav-item-label">{label}</span>
              {changeCount > 0 ? (
                <span
                  className="nav-change-dot"
                  title={`${changeCount} modificari noi`}
                  aria-label={`${changeCount} modificari noi`}
                />
              ) : null}
              {path === "/notifications" && unreadCount > 0 ? (
                <span className="nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
              ) : null}
            </NavLink>
          );
        })}
    </div>
  ));
}

export function TopbarClock() {
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="topbar-clock desktop-logout-btn">
      <span>{currentTime.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}</span>
      <small>
        {currentTime.toLocaleDateString("ro-RO", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
      </small>
    </div>
  );
}

export function AppShellNavigation({
  mobileMenuOpen,
  sidebarCollapsed,
  loggingOut,
  unreadCount,
  pageChangeMap,
  role,
  globalAdmin,
  mobileDrawerRef,
  onCloseMobile,
  onToggleSidebar,
  onLogout,
}: {
  mobileMenuOpen: boolean;
  sidebarCollapsed: boolean;
  loggingOut: boolean;
  unreadCount: number;
  pageChangeMap: PageChangeMap;
  role: string;
  globalAdmin: boolean;
  mobileDrawerRef: RefObject<HTMLElement | null>;
  onCloseMobile: () => void;
  onToggleSidebar: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      <aside className="sidebar desktop-sidebar" aria-label="Navigare principala">
        <div className="brand">
          <div className="brand-badge">WC</div>
          <div>
            <div className="brand-title">WorkControl</div>
            <div className="brand-subtitle">Management firma</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavItems
            unreadCount={unreadCount}
            pageChangeMap={pageChangeMap}
            role={role}
            globalAdmin={globalAdmin}
          />
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item sidebar-collapse-button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Extinde meniul" : "Restrange meniul"}
            title={sidebarCollapsed ? "Extinde meniul" : "Restrange meniul"}
          >
            <span className="nav-item-icon-wrap menu-icon-cyan">
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </span>
            <span className="nav-item-label">Restrange meniul</span>
          </button>
          <button
            type="button"
            className="nav-item desktop-logout-btn sidebar-logout-button"
            onClick={onLogout}
            disabled={loggingOut}
          >
            <span className="nav-item-icon-wrap menu-icon-rose sidebar-logout-button__icon">
              <LogOut size={17} strokeWidth={2.2} className="nav-item-icon" />
            </span>
            <span className="nav-item-label">
              {loggingOut ? "Se deconecteaza..." : "Deconectare"}
            </span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen ? (
        <button
          type="button"
          className="mobile-menu-overlay"
          onClick={onCloseMobile}
          aria-label="Inchide meniul"
        />
      ) : null}

      <aside
        ref={mobileDrawerRef}
        className={`mobile-drawer ${mobileMenuOpen ? "mobile-drawer-open" : ""}`}
        aria-label="Meniu mobil"
        aria-hidden={!mobileMenuOpen}
        inert={!mobileMenuOpen}
      >
        <div className="mobile-drawer-header">
          <div className="brand mobile-drawer-brand">
            <div className="brand-badge">WC</div>
            <div>
              <div className="brand-title">WorkControl</div>
              <div className="brand-subtitle">Management firma</div>
            </div>
          </div>
          <button type="button" className="mobile-menu-close" onClick={onCloseMobile} aria-label="Inchide">
            <X size={16} />
          </button>
        </div>
        <nav className="sidebar-nav">
          <NavItems
            mobile
            onNavigate={onCloseMobile}
            unreadCount={unreadCount}
            pageChangeMap={pageChangeMap}
            role={role}
            globalAdmin={globalAdmin}
          />
        </nav>
        <div className="mobile-drawer-footer">
          <button
            type="button"
            className="secondary-btn mobile-logout-btn"
            onClick={onLogout}
            disabled={loggingOut}
          >
            <LogOut size={15} strokeWidth={2.2} />
            {loggingOut ? "Se deconecteaza..." : "Deconectare"}
          </button>
        </div>
      </aside>
    </>
  );
}
