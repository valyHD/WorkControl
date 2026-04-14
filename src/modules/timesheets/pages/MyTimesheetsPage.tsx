import { useEffect, useMemo, useState } from "react";
import type {
  ProjectItem,
  TimesheetItem,
  TimesheetLocation,
} from "../../../types/timesheet";
import { useAuth } from "../../../providers/AuthProvider";
import {
  computeTimesheetStats,
  createProject,
  formatMinutes,
  getActiveProjectsList,
  getActiveTimesheetForUser,
  getTimesheetsForUser,
  isProjectCodeUsed,
  startTimesheet,
  stopTimesheet,
} from "../services/timesheetsService";
import TimesheetForm from "../components/TimesheetForm";
import TimesheetStatsCards from "../components/TimesheetStatsCards";
import TimesheetCalendar from "../components/TimesheetCalendar";
import ProjectForm from "../components/ProjectForm";
import { Link } from "react-router-dom";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

export default function MyTimesheetsPage() {
  const { user, role } = useAuth();

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [activeTimesheet, setActiveTimesheet] = useState<TimesheetItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState("");

  async function load() {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const [projectsData, timesheetsData, activeData] = await Promise.all([
        getActiveProjectsList(),
        getTimesheetsForUser(user.uid),
        getActiveTimesheetForUser(user.uid),
      ]);

      setProjects(projectsData);
      setTimesheets(timesheetsData);
      setActiveTimesheet(activeData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [user?.uid]);

  async function handleStart(projectId: string, location: TimesheetLocation) {
    if (!user?.uid) return;

    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Proiectul selectat nu exista sau nu este activ.");
    }

    await startTimesheet({
      userId: user.uid,
      userName: user.displayName || user.email || "Utilizator",
      userThemeKey: (user as any)?.themeKey || null,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      startLocation: location,
    });

    await load();
  }

  async function handleStop(explanation: string, location: TimesheetLocation) {
    if (!activeTimesheet) {
      throw new Error("Nu exista pontaj activ.");
    }

    await stopTimesheet({
      timesheetId: activeTimesheet.id,
      explanation,
      stopLocation: location,
    });

    await load();
  }

  async function handleCreateProject(values: {
    code: string;
    name: string;
    status: "activ" | "inactiv" | "finalizat";
  }) {
    setProjectSubmitting(true);
    setProjectError("");

    try {
      if (!values.code.trim() || !values.name.trim()) {
        setProjectError("Completeaza codul si numele proiectului.");
        return;
      }

      const exists = await isProjectCodeUsed(values.code);
      if (exists) {
        setProjectError("Exista deja un proiect cu acest cod.");
        return;
      }

      await createProject(values);
      await load();
    } catch (error) {
      console.error(error);
      setProjectError("Nu am putut salva proiectul.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  const stats = useMemo(() => computeTimesheetStats(timesheets), [timesheets]);
  const recentTimesheets = useMemo(() => timesheets.slice(0, 10), [timesheets]);

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca pontajul meu...</h2>
        <p>Preluam datele personale din Firebase.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <TimesheetStatsCards
        todayMinutes={stats.todayMinutes}
        weekMinutes={stats.weekMinutes}
        monthMinutes={stats.monthMinutes}
        avgMinutesPerWorkedDayMonth={stats.avgMinutesPerWorkedDayMonth}
      />

      <div className="content-grid">
        <TimesheetForm
          projects={projects}
          activeTimesheet={activeTimesheet}
          onStart={handleStart}
          onStop={handleStop}
          loading={loading}
        />

        <div className="panel">
          <h2 className="panel-title">Proiecte active</h2>

          {(role === "admin" || role === "manager") && (
            <>
              {projectError && (
                <div className="tool-message" style={{ marginBottom: 16 }}>
                  {projectError}
                </div>
              )}

              <ProjectForm
                initialValues={{
                  code: "",
                  name: "",
                  status: "activ",
                }}
                submitting={projectSubmitting}
                onSubmit={handleCreateProject}
              />
            </>
          )}

          <div style={{ marginTop: 18 }}>
            <div className="simple-list">
              {projects.length === 0 ? (
                <p className="tools-subtitle">Nu exista proiecte active.</p>
              ) : (
                projects.map((project) => (
                  <div key={project.id} className="simple-list-item">
                    <div className="simple-list-text">
                      <div className="simple-list-label">
                        {project.code} - {project.name}
                      </div>
                      <div className="simple-list-subtitle">
                        status: {project.status}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <Link to="/projects" className="secondary-btn">
                Vezi toate proiectele
              </Link>
            </div>
          </div>
        </div>
      </div>

      <TimesheetCalendar timesheets={timesheets} />

      <div className="panel">
        <h2 className="panel-title">Istoricul meu de pontaje</h2>

        {recentTimesheets.length === 0 ? (
          <p className="tools-subtitle">Nu exista pontaje inregistrate.</p>
        ) : (
          <div className="simple-list">
            {recentTimesheets.map((item) => {
              const userThemeClass = getUserThemeClass((item as any).userThemeKey);

              return (
                <Link
                  to={`/timesheets/${item.id}`}
                  key={item.id}
                  className={`simple-list-item user-history-row ${userThemeClass}`}
                >
                  <div className="simple-list-text">
                    <div className="user-inline-meta">
                      <span className="user-accent-avatar">
                        {getUserInitials(item.userName || "Eu")}
                      </span>
                      <span className="simple-list-label user-accent-name">
                        {item.projectCode} - {item.projectName}
                      </span>
                    </div>

                    <div className="simple-list-subtitle">
                      Start: {new Date(item.startAt).toLocaleString("ro-RO")} · Stop:{" "}
                      {item.stopAt ? new Date(item.stopAt).toLocaleString("ro-RO") : "-"} · Durata:{" "}
                      {formatMinutes(item.workedMinutes)}
                    </div>

                    <div className="simple-list-subtitle">
                      Coordonate start:{" "}
                      {item.startLocation?.lat != null && item.startLocation?.lng != null
                        ? `${item.startLocation.lat.toFixed(6)}, ${item.startLocation.lng.toFixed(6)}`
                        : "-"}
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