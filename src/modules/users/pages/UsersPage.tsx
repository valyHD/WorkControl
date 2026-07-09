import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { deleteUserProfile, getAllUsers, subscribeUsers } from "../services/usersService";
import type { AppUserItem } from "../../../types/user";
import { useAuth } from "../../../providers/AuthProvider";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { Search, UserPlus, Users, ShieldAlert, Trash2 } from "lucide-react";

function UserRowSkeleton() {
  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 13, width: "70%", marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 11, width: "90%" }} />
          </div>
        </div>
      </td>
      <td><div className="skeleton" style={{ height: 13, width: "85%" }} /></td>
      <td><div className="skeleton" style={{ height: 22, width: 60, borderRadius: "var(--radius-xs)" }} /></td>
      <td><div className="skeleton" style={{ height: 22, width: 55, borderRadius: "var(--radius-xs)" }} /></td>
      <td><div className="skeleton" style={{ height: 13, width: 120 }} /></td>
      <td><div className="skeleton" style={{ height: 30, width: 80, borderRadius: "var(--radius-sm)" }} /></td>
    </tr>
  );
}

function formatLastSeenAt(value?: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ro-RO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const USER_ONLINE_WINDOW_MS = 75_000;

function isUserOnline(user: AppUserItem) {
  const lastActivity = user.lastActiveAt || user.lastSeenAt || 0;
  return Boolean(user.isOnline && lastActivity && Date.now() - lastActivity <= USER_ONLINE_WINDOW_MS);
}

export default function UsersPage() {
  const { role, user } = useAuth();
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingUserId, setDeletingUserId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [onlineTick, setOnlineTick] = useState(Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setOnlineTick(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAllUsers();
      if (!mountedRef.current) return;
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("[UsersPage][load]", err);
      if (!mountedRef.current) return;
      setError("Nu am putut încărca utilizatorii. Verifică regulile Firebase.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeUsers(
      (data) => {
        if (!mountedRef.current) return;
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      },
      (err) => {
        console.error("[UsersPage][subscribeUsers]", err);
        if (!mountedRef.current) return;
        setError("Nu am putut incarca live utilizatorii. Verifica regulile Firebase.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [reloadToken]);

  const handleDeleteUser = useCallback(async (targetUser: AppUserItem) => {
    if (targetUser.id === user?.uid || targetUser.uid === user?.uid) {
      setError("Nu poti sterge propriul cont din pagina Utilizatori.");
      return;
    }

    const label = targetUser.fullName || targetUser.email || targetUser.uid || targetUser.id;
    const confirmed = window.confirm(
      `Sigur vrei sa stergi utilizatorul ${label} Actiunea nu poate fi anulata.`
    );
    if (!confirmed) return;

    setDeletingUserId(targetUser.id);
    setError("");

    try {
      await deleteUserProfile(targetUser.id);
      if (!mountedRef.current) return;
      setUsers((current) => current.filter((item) => item.id !== targetUser.id));
    } catch (err) {
      console.error("[UsersPage][deleteUser]", err);
      if (!mountedRef.current) return;
      setError("Nu am putut sterge utilizatorul. Verifica regulile Firebase si incearca din nou.");
    } finally {
      if (mountedRef.current) setDeletingUserId("");
    }
  }, [user?.uid]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.fullName || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const activeCount = useMemo(() => users.filter((u) => u.active !== false).length, [users]);
  const onlineCount = useMemo(() => users.filter(isUserOnline).length, [users, onlineTick]);

  // Non-admin guard
  if (role !== "admin") {
    return (
      <section className="page-section">
        <div className="panel" style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: "var(--radius-md)",
            background: "var(--danger-soft)", color: "var(--danger)", marginBottom: 16,
          }}>
            <ShieldAlert size={26} strokeWidth={1.8} />
          </div>
          <h2 style={{ margin: "0 0 8px", color: "var(--text)" }}>Acces restricționat</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Doar administratorii pot gestiona utilizatorii.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        {/* Header */}
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Utilizatori</h2>
            <p className="tools-subtitle">
              {loading
                ? "Se încarcă..."
                : `${users.length} conturi · ${activeCount} active · ${onlineCount} online`}
            </p>
          </div>
          <div className="tools-header-actions">
            <Link to="/users/new" className="primary-btn">
              <UserPlus size={15} /> Adaugă utilizator
            </Link>
          </div>
        </div>

        {/* Search */}
        <div className="tools-filters">
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={15}
              style={{
                position: "absolute", left: 11, top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)", pointerEvents: "none",
              }}
            />
            <input
              className="tool-input"
              style={{ paddingLeft: 34 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după nume, email sau rol"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="vc-feedback vc-feedback--error" style={{ margin: "0 0 16px" }}>
            {error}
            <button
              type="button"
              style={{ marginLeft: "auto", fontWeight: 700, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
              onClick={() => {
                setReloadToken((value) => value + 1);
                void load();
              }}
            >
              Reîncarcă
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Nume</th><th>Email</th><th>Rol</th><th>Status</th><th>Last seen</th><th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => <UserRowSkeleton key={i} />)}
              </tbody>
            </table>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={22} strokeWidth={1.6} /></div>
            <div className="empty-state-title">
              {search ? "Niciun utilizator nu corespunde căutării" : "Niciun utilizator adăugat"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {search ? "Modifică termenul de căutare." : "Apasă «Adaugă utilizator» pentru a crea primul cont."}
            </div>
          </div>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Nume</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const themeClass = getUserThemeClass(u.themeKey || null);
                  const online = isUserOnline(u);
                  return (
                    <tr key={u.id} className={`user-table-row ${themeClass}`}>
                      <td className="users-table-main-cell">
                        <div className="user-table-name">
                          <span className="user-accent-avatar">
                            {u.avatarThumbUrl || u.avatarUrl ? (
                              <img src={u.avatarThumbUrl || u.avatarUrl} alt="" />
                            ) : (
                              getUserInitials(u.fullName || u.email || "U")
                            )}
                          </span>
                          <div className="user-table-meta">
                            <Link to={`/users/${u.id}`} className="user-accent-name user-profile-name-link">
                              {u.fullName || "—"}
                            </Link>
                            <span className="simple-list-subtitle" style={{ fontSize: 11 }}>{u.uid}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-soft)" }}>{u.email || "—"}</td>
                      <td>
                        <span className="user-accent-chip" style={{ fontSize: 11 }}>{u.role || "—"}</span>
                      </td>
                      <td>
                        <span className={u.active !== false ? "badge badge-green" : "badge badge-red"}>
                          {u.active !== false ? "activ" : "inactiv"}
                        </span>
                        <span
                          className={online ? "badge badge-green" : "badge badge-muted"}
                          style={{ marginLeft: 6 }}
                        >
                          {online ? "online" : "offline"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-soft)", whiteSpace: "nowrap" }}>
                        Last seen at: {formatLastSeenAt(u.lastSeenAt)}
                      </td>
                      <td>
                        <Link to={`/users/${u.id}`} className="secondary-btn" style={{ fontSize: 12, padding: "6px 12px", marginRight: 8 }}>
                          Profil
                        </Link>
                        <Link to={`/users/${u.id}/edit`} className="secondary-btn" style={{ fontSize: 12, padding: "6px 12px" }}>
                          Editează
                        </Link>
                        <button
                          type="button"
                          className="danger-btn"
                          style={{ fontSize: 12, padding: "6px 10px", marginLeft: 8 }}
                          disabled={deletingUserId === u.id || u.id === user?.uid || u.uid === user?.uid}
                          onClick={() => void handleDeleteUser(u)}
                          title={u.id === user?.uid || u.uid === user?.uid ? "Nu poti sterge propriul cont" : "Sterge utilizator"}
                        >
                          <Trash2 size={13} />
                          {deletingUserId === u.id ? "Se sterge..." : "Sterge"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
