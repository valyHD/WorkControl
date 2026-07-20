import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Activity, Bell, Clock3, Filter, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import UserProfileLink from "../../../components/UserProfileLink";
import type { AuditLogCategory, AuditLogItem } from "../../../types/audit";
import { getAuditLogs } from "../services/auditLogService";
import { getAllUsers } from "../../users/services/usersService";
import type { AppUserItem } from "../../../types/user";

const categoryLabels: Record<AuditLogCategory, string> = {
  auth: "Autentificare",
  navigation: "Navigare",
  users: "Utilizatori",
  tools: "Scule",
  vehicles: "Masini",
  timesheets: "Pontaje",
  leave: "Concedii",
  projects: "Proiecte",
  notifications: "Notificari",
  maintenance: "Mentenanta",
  expenses: "Bonuri/Facturi",
  backup: "Backup",
  system: "Sistem",
  web: "Site",
  server: "Server",
  general: "General",
};

const AUDIT_LIMIT_OPTIONS = [10, 25, 50, 100, 200, 500, 1000] as const;

function formatDateTime(ts: number) {
  if (!ts) return "-";
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

function getUniqueValues(items: AuditLogItem[], picker: (item: AuditLogItem) => string) {
  return Array.from(new Set(items.map(picker).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ro"));
}

function matchesUser(item: AuditLogItem, userId: string) {
  if (!userId) return true;
  return item.actorUserId === userId || item.targetUserId === userId;
}

function getAuditDetailLines(item: AuditLogItem): string[] {
  const changes = item.metadata?.changesText;
  const fields = item.metadata?.fieldsText;
  const source = Array.isArray(changes) && changes.length > 0 ? changes : fields;
  if (!Array.isArray(source)) return [];
  return source.map((line) => String(line)).filter(Boolean).slice(0, 40);
}

export default function AuditLogPage() {
  const { role, user } = useAuth();
  const location = useLocation();
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestedLimit, setRequestedLimit] = useState<number>(10);
  const [loadedLimit, setLoadedLimit] = useState(10);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [path, setPath] = useState("");
  const deferredSearch = useDeferredValue(search);
  const canViewAll = role === "admin" || role === "manager";

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const assistantSearch = params.get("assistantSearch");
    const assistantUserId = params.get("assistantUserId");
    const assistantCategory = params.get("assistantCategory");
    const assistantAction = params.get("assistantAction");
    const assistantPath = params.get("assistantPath");

    if (assistantSearch !== null) setSearch(assistantSearch);
    if (assistantUserId !== null) {
      setUserId(assistantUserId);
      if (!assistantSearch) setSearch("");
    }
    if (assistantCategory !== null) setCategory(assistantCategory);
    if (assistantAction !== null) setAction(assistantAction);
    if (assistantPath !== null) setPath(assistantPath);
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    void getAuditLogs(10)
      .then((nextItems) => {
        if (!cancelled) setItems(nextItems);
      })
      .catch((err) => {
        console.error("[AuditLogPage][initial-load]", err);
        if (!cancelled) setError("Nu am putut incarca ultimele activitati.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadActivity() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const [nextItems, nextUsers] = await Promise.all([
        getAuditLogs(requestedLimit),
        users.length ? Promise.resolve(users) : getAllUsers(),
      ]);
      setItems(nextItems);
      setUsers(nextUsers);
      setLoadedLimit(requestedLimit);
    } catch (err) {
      console.error("[AuditLogPage][load]", err);
      setError("Nu am putut incarca istoricul.");
    } finally {
      setLoading(false);
    }
  }

  const categories = useMemo(() => getUniqueValues(items, (item) => item.category), [items]);
  const actions = useMemo(() => getUniqueValues(items, (item) => item.action), [items]);
  const paths = useMemo(() => getUniqueValues(items, (item) => item.path), [items]);

  const filteredItems = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (!canViewAll && user?.uid && item.actorUserId !== user.uid && item.targetUserId !== user.uid) return false;
      if (category && item.category !== category) return false;
      if (action && item.action !== action) return false;
      if (path && item.path !== path) return false;
      if (!matchesUser(item, userId)) return false;
      if (!needle) return true;
      return (
        item.searchableText.includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        item.message.toLowerCase().includes(needle)
      );
    });
  }, [action, canViewAll, category, deferredSearch, items, path, user?.uid, userId]);

  const notificationCount = useMemo(
    () => filteredItems.filter((item) => item.action === "notification_delivered").length,
    [filteredItems]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (loading || params.get("assistantLatest") !== "1" || filteredItems.length === 0) return;

    window.setTimeout(() => {
      document.getElementById(`audit-row-${filteredItems[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, [filteredItems, loading, location.search]);

  return (
    <section className="page-section audit-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Istoric activitate</h2>
            <p className="panel-subtitle">
              Sunt incarcate automat numai ultimele 10 activitati. Istoricul extins se citeste doar la cerere.
            </p>
          </div>
          <div className="audit-load-controls">
            <label>
              <span>Numar activitati</span>
              <select
                className="tool-input"
                value={requestedLimit}
                onChange={(event) => setRequestedLimit(Number(event.target.value))}
                disabled={loading}
              >
                {AUDIT_LIMIT_OPTIONS.map((limitValue) => (
                  <option key={limitValue} value={limitValue}>{limitValue}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-btn"
              type="button"
              disabled={loading}
              onClick={() => void loadActivity()}
              data-assistant-action="load-audit-activity"
            >
              <Activity size={16} />
              {loading ? "Se incarca..." : `Afiseaza ${requestedLimit}`}
            </button>
          </div>
        </div>

        <div className="expense-kpi-grid audit-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Evenimente incarcate</div>
            <div className="kpi-value">{items.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Rezultate filtrate</div>
            <div className="kpi-value">{filteredItems.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Notificari livrate</div>
            <div className="kpi-value">{notificationCount}</div>
          </div>
        </div>

        <div className="panel-body audit-filters">
          <div className="tool-form-grid">
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">
                <Search size={14} /> Cautare
              </label>
              <input
                className="tool-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cauta dupa user, notificare, pagina, scula, masina, bon, actiune..."
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">User</label>
              <select className="tool-input" value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="">Toti userii</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName || user.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Categorie</label>
              <select className="tool-input" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Toate categoriile</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabels[item as AuditLogCategory] || item}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Actiune</label>
              <select className="tool-input" value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="">Toate actiunile</option>
                {actions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Pagina</label>
              <select className="tool-input" value={path} onChange={(event) => setPath(event.target.value)}>
                <option value="">Toate paginile</option>
                {paths.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Evenimente</h2>
            <p className="panel-subtitle">Cele mai recente primele. Sunt incarcate {loadedLimit} de evenimente sau mai putine daca istoricul este mai scurt.</p>
          </div>
          <span className="badge badge-blue">
            <Filter size={13} /> {filteredItems.length}
          </span>
        </div>

        {error && <div className="tool-message">{error}</div>}
        {loading ? (
          <p className="tools-subtitle">Se incarca istoricul...</p>
        ) : filteredItems.length === 0 ? (
          <p className="tools-subtitle">Nu exista evenimente pentru filtrele selectate.</p>
        ) : (
          <div className="simple-list audit-list">
            {filteredItems.map((item) => (
              <article key={item.id} id={`audit-row-${item.id}`} className="simple-list-item audit-item">
                <div className="audit-item__icon">
                  {item.category === "notifications" ? <Bell size={17} /> : <Activity size={17} />}
                </div>
                <div className="simple-list-text">
                  <div className="simple-list-label audit-item__title">{item.title}</div>
                  <div className="simple-list-subtitle">{item.message}</div>
                  {getAuditDetailLines(item).length > 0 && (
                    <div className="audit-item__details">
                      {getAuditDetailLines(item).map((line, index) => (
                        <span key={`${item.id}-detail-${index}`}>{line}</span>
                      ))}
                    </div>
                  )}
                  <div className="audit-item__meta">
                    <span>
                      <Clock3 size={13} /> {formatDateTime(item.createdAt)}
                    </span>
                    <span>{categoryLabels[item.category] || item.category}</span>
                    <span>{item.action}</span>
                    {item.path && <span>{item.path}</span>}
                  </div>
                  <div className="audit-item__people">
                    {item.actorUserId ? (
                      <span>
                        Actor: <UserProfileLink userId={item.actorUserId} name={item.actorUserName || item.actorUserId} />
                      </span>
                    ) : (
                      <span>Actor: WorkControl</span>
                    )}
                    {item.targetUserId && (
                      <span>
                        Target: <UserProfileLink userId={item.targetUserId} name={item.targetUserName || item.targetUserId} />
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
