import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { TimesheetItem } from "../../../types/timesheet";
import { formatMinutes, getTimesheetsList } from "../services/timesheetsService";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

export default function TimesheetsPage() {
  const { role } = useAuth();

  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await getTimesheetsList();
      setTimesheets(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeTimesheets = useMemo(() => {
    return timesheets.filter((item) => item.status === "activ");
  }, [timesheets]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();

    return timesheets.filter((item) => {
      if (!q) return true;

      return (
        item.userName.toLowerCase().includes(q) ||
        item.projectCode.toLowerCase().includes(q) ||
        item.projectName.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q)
      );
    });
  }, [timesheets, search]);

  const totalWorkedToday = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;

    return timesheets
      .filter((item) => item.workDate === todayKey)
      .reduce((sum, item) => sum + item.workedMinutes, 0);
  }, [timesheets]);

  const activeUsersCount = useMemo(() => {
    return new Set(activeTimesheets.map((item) => item.userId)).size;
  }, [activeTimesheets]);

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restrictionat</h2>
        <p>Dashboard-ul global de pontaje este disponibil doar pentru admin sau manager.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca dashboard-ul de pontaje...</h2>
        <p>Preluam pontajele din Firebase.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Pontaje active acum</div>
          <div className="kpi-value">{activeTimesheets.length}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Useri activi acum</div>
          <div className="kpi-value">{activeUsersCount}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Ore totale azi</div>
          <div className="kpi-value">{formatMinutes(totalWorkedToday)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Pontaje totale</div>
          <div className="kpi-value">{timesheets.length}</div>
        </div>
      </div>

      <div className="content-grid">
        <div className="panel">
          <h2 className="panel-title">Pontaje active live</h2>

          {activeTimesheets.length === 0 ? (
            <p className="tools-subtitle">Nu exista pontaje active acum.</p>
          ) : (
            <div className="simple-list">
              {activeTimesheets.map((item) => {
                const userThemeClass = getUserThemeClass((item as any).userThemeKey);

                return (
                  <Link
                    to={`/timesheets/${item.id}`}
                    key={item.id}
                    className={`simple-list-item user-history-row ${userThemeClass}`}
                  >
                    <div className="simple-list-text">
                      <div className="user-inline-meta">
                        <span className="user-accent-avatar">{getUserInitials(item.userName)}</span>
                        <span className="simple-list-label user-accent-name">
                          {item.userName} · {item.projectCode} – {item.projectName}
                        </span>
                      </div>

                      <div className="simple-list-subtitle">
                        Start: {new Date(item.startAt).toLocaleString("ro-RO")} ·{" "}
                        {item.startLocation?.label || "–"}
                      </div>
                    </div>

                    <span className="badge badge-orange">activ</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Actiuni rapide</h2>

          <div className="quick-actions-grid">
            <Link to="/my-timesheets" className="quick-action-card">
              <div className="quick-action-title">Pontajul meu</div>
              <div className="quick-action-subtitle">
                Start / stop, statistici si calendar personal
              </div>
            </Link>

            <Link to="/projects" className="quick-action-card">
              <div className="quick-action-title">Proiecte</div>
              <div className="quick-action-subtitle">
                Lista proiecte si schimbare status
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Istoric global pontaje</h2>
            <p className="tools-subtitle">
              Toate pontajele utilizatorilor.
            </p>
          </div>
        </div>

        <div className="tools-filters">
          <input
            className="tool-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cauta dupa user, proiect sau status"
          />
          <div />
        </div>

        {filteredHistory.length === 0 ? (
          <p className="tools-subtitle">Nu exista pontaje.</p>
        ) : (
          <div className="simple-list">
            {filteredHistory.map((item) => {
              const userThemeClass = getUserThemeClass((item as any).userThemeKey);

              return (
                <Link
                  to={`/timesheets/${item.id}`}
                  key={item.id}
                  className={`simple-list-item user-history-row ${userThemeClass}`}
                >
                  <div className="simple-list-text">
                    <div className="user-inline-meta">
                      <span className="user-accent-avatar">{getUserInitials(item.userName)}</span>
                      <span className="simple-list-label user-accent-name">
                        {item.userName} · {item.projectCode} - {item.projectName}
                      </span>
                    </div>

                    <div className="simple-list-subtitle">
                      Start: {new Date(item.startAt).toLocaleString("ro-RO")} · Stop:{" "}
                      {item.stopAt ? new Date(item.stopAt).toLocaleString("ro-RO") : "-"} · Durata:{" "}
                      {formatMinutes(item.workedMinutes)} · Status: {item.status}
                    </div>
                  </div>

                  <span className="badge badge-orange">{item.status}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}