import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { ProjectFormValues, ProjectItem, TimesheetItem } from "../../../types/timesheet";
import {
  createProject,
  deleteProject,
  formatMinutes,
  getProjectsList,
  getTimesheetsList,
  updateProject,
} from "../services/timesheetsService";
import ProjectForm from "../components/ProjectForm";
import UserProfileLink from "../../../components/UserProfileLink";
import { ProductPageHeader } from "../../../components/product/ProductPage";

type TimesheetGroupMode = "day" | "week" | "month";

type ProjectTimesheetGroup = {
  key: string;
  label: string;
  totalMinutes: number;
  entries: TimesheetItem[];
};

type ProjectUserTimesheets = {
  userId: string;
  userName: string;
  totalMinutes: number;
  groups: ProjectTimesheetGroup[];
};

function formatDateLabel(value: string): string {
  if (!value) return "Fara data";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMonthLabel(value: string): string {
  if (!value) return "Fara luna";
  const parsed = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ro-RO", {
    month: "long",
    year: "numeric",
  });
}

function getGroupKey(item: TimesheetItem, mode: TimesheetGroupMode): string {
  if (mode === "month") return item.yearMonth || "fara-luna";
  if (mode === "week") return item.weekKey || "fara-saptamana";
  return item.workDate || "fara-data";
}

function getGroupLabel(key: string, mode: TimesheetGroupMode): string {
  if (mode === "month") return formatMonthLabel(key);
  if (mode === "week") return key === "fara-saptamana" ? "Fara saptamana" : `Saptamana ${key}`;
  return formatDateLabel(key);
}

function buildProjectUsers(
  items: TimesheetItem[],
  mode: TimesheetGroupMode
): ProjectUserTimesheets[] {
  const users = new Map<string, ProjectUserTimesheets>();

  for (const item of items) {
    const userKey = item.userId || item.userName || "unknown";
    const userName = item.userName || "Utilizator";
    const existingUser =
      users.get(userKey) ??
      ({
        userId: userKey,
        userName,
        totalMinutes: 0,
        groups: [],
      } satisfies ProjectUserTimesheets);

    existingUser.totalMinutes += item.workedMinutes;

    const groupKey = getGroupKey(item, mode);
    let group = existingUser.groups.find((entry) => entry.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        label: getGroupLabel(groupKey, mode),
        totalMinutes: 0,
        entries: [],
      };
      existingUser.groups.push(group);
    }

    group.totalMinutes += item.workedMinutes;
    group.entries.push(item);
    users.set(userKey, existingUser);
  }

  return Array.from(users.values())
    .map((userGroup) => ({
      ...userGroup,
      groups: userGroup.groups
        .map((group) => ({
          ...group,
          entries: group.entries.sort((a, b) => b.startAt - a.startAt),
        }))
        .sort((a, b) => b.key.localeCompare(a.key)),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export default function ProjectsPage() {
  const { role } = useAuth();

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [groupMode, setGroupMode] = useState<TimesheetGroupMode>("day");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingValues, setEditingValues] = useState<ProjectFormValues>({
    name: "",
    status: "activ",
  });

  async function load() {
    setLoading(true);
    try {
      const [projectsData, timesheetsData] = await Promise.all([
        getProjectsList(),
        getTimesheetsList(),
      ]);
      setProjects(projectsData);
      setTimesheets(timesheetsData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const timesheetsByProject = useMemo(() => {
    const grouped = new Map<string, TimesheetItem[]>();

    for (const item of timesheets) {
      const existing = grouped.get(item.projectId) ?? [];
      existing.push(item);
      grouped.set(item.projectId, existing);
    }

    return grouped;
  }, [timesheets]);

  async function handleCreate(values: ProjectFormValues) {
    setSubmitting(true);
    setError("");

    try {
      if (!values.name.trim()) {
        setError("Completeaza numele proiectului.");
        return;
      }

      await createProject(values);
      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut crea proiectul.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(projectId: string) {
    setSubmitting(true);
    setError("");

    try {
      if (!editingValues.name.trim()) {
        setError("Completeaza numele proiectului.");
        return;
      }

      await updateProject(projectId, editingValues);
      setEditingId("");
      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva modificarile.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProject(project: ProjectItem) {
    if (deletingProjectId || submitting) return;
    const linkedTimesheets = timesheetsByProject.get(project.id)?.length ?? 0;
    const ok = window.confirm(
      linkedTimesheets > 0
        ? `Stergi proiectul "${project.name || project.code || project.id}"? Pontajele existente (${linkedTimesheets}) raman in istoric cu numele proiectului salvat pe ele.`
        : `Stergi proiectul "${project.name || project.code || project.id}"?`
    );
    if (!ok) return;

    setDeletingProjectId(project.id);
    setError("");
    try {
      await deleteProject(project);
      if (editingId === project.id) {
        setEditingId("");
      }
      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut sterge proiectul.");
    } finally {
      setDeletingProjectId("");
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restrictionat</h2>
        <p>Doar adminul sau managerul pot gestiona proiectele.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca proiectele...</h2>
        <p>Preluam proiectele din Firebase.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <ProductPageHeader
        eyebrow="Echipă și pontaje"
        title="Proiecte"
        description="Creează proiecte, urmărește orele și păstrează starea lucrărilor într-un singur loc."
        actions={[{ id: "timesheets", label: "Vezi pontaje", to: "/timesheets", assistantAction: "open-timesheets" }]}
      />

      <div className="panel" data-assistant-section="project-create-form">
        <h2 className="panel-title">Proiect nou</h2>
        <p className="tools-subtitle">Completează datele esențiale și proiectul devine disponibil imediat în pontaj.</p>

        {error && <div className="tool-message" style={{ marginTop: 16 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <ProjectForm
            initialValues={{
              name: "",
              status: "activ",
            }}
            submitting={submitting}
            onSubmit={handleCreate}
          />
        </div>
      </div>

      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Lista proiecte si pontaje</h2>
            <p className="tools-subtitle">
              Sub fiecare proiect vezi pontajele grupate pe user si perioada.
            </p>
          </div>

          <div className="tools-header-actions">
            <select
              className="tool-input project-timesheet-mode"
              value={groupMode}
              onChange={(event) => setGroupMode(event.target.value as TimesheetGroupMode)}
              aria-label="Grupeaza pontajele"
            >
              <option value="day">Pe zile</option>
              <option value="week">Pe saptamani</option>
              <option value="month">Pe luni</option>
            </select>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="tools-subtitle">Nu exista proiecte.</p>
        ) : (
          <div className="project-timesheet-list">
            {projects.map((project) => {
              const projectTimesheets = timesheetsByProject.get(project.id) ?? [];
              const userGroups = buildProjectUsers(projectTimesheets, groupMode);
              const totalMinutes = projectTimesheets.reduce(
                (sum, item) => sum + item.workedMinutes,
                0
              );

              return (
                <details key={project.id} className="project-timesheet-card">
                  <summary className="project-timesheet-summary">
                    <div className="simple-list-text">
                      <div className="simple-list-label">
                        {project.name || "Fara nume"}
                      </div>
                      <div className="simple-list-subtitle">
                        status: {project.status} · {projectTimesheets.length} pontaje ·{" "}
                        {formatMinutes(totalMinutes)}
                      </div>
                    </div>

                    <span className="project-summary-hint">Click pentru detalii</span>
                    <span className="badge">{project.status}</span>
                  </summary>

                  <div className="project-timesheet-body">
                    {editingId === project.id ? (
                      <div className="project-edit-box">
                        <div className="tool-form-grid">
                          <div className="tool-form-block">
                            <label className="tool-form-label">Nume</label>
                            <input
                              className="tool-input"
                              value={editingValues.name}
                              onChange={(e) =>
                                setEditingValues((prev) => ({ ...prev, name: e.target.value }))
                              }
                            />
                          </div>

                          <div className="tool-form-block">
                            <label className="tool-form-label">Status</label>
                            <select
                              className="tool-input"
                              value={editingValues.status}
                              onChange={(e) =>
                                setEditingValues((prev) => ({
                                  ...prev,
                                  status: e.target.value as ProjectFormValues["status"],
                                }))
                              }
                            >
                              <option value="activ">activ</option>
                              <option value="inactiv">inactiv</option>
                              <option value="finalizat">finalizat</option>
                            </select>
                          </div>
                        </div>

                        <div className="tool-form-actions" style={{ marginTop: 12 }}>
                          <button
                            className="primary-btn"
                            type="button"
                            onClick={() => void handleSaveEdit(project.id)}
                            disabled={submitting}
                          >
                            Salveaza
                          </button>

                          <button
                            className="secondary-btn"
                            type="button"
                            onClick={() => setEditingId("")}
                          >
                            Renunta
                          </button>

                          <button
                            className="danger-btn"
                            type="button"
                            onClick={() => void handleDeleteProject(project)}
                            disabled={deletingProjectId === project.id || submitting}
                          >
                            {deletingProjectId === project.id ? "Se sterge..." : "Sterge proiect"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="dashboard-inline-actions project-card-actions">
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => {
                            setEditingId(project.id);
                            setEditingValues({
                              name: project.name,
                              status: project.status,
                            });
                          }}
                        >
                          Editeaza proiect
                        </button>
                        <button
                          className="danger-btn"
                          type="button"
                          onClick={() => void handleDeleteProject(project)}
                          disabled={deletingProjectId === project.id || submitting}
                        >
                          {deletingProjectId === project.id ? "Se sterge..." : "Sterge proiect"}
                        </button>
                      </div>
                    )}

                    {userGroups.length === 0 ? (
                      <p className="tools-subtitle project-empty-timesheets">
                        Nu exista pontaje pe acest proiect.
                      </p>
                    ) : (
                      <div className="project-user-timesheets">
                        {userGroups.map((userGroup) => (
                          <details
                            key={userGroup.userId}
                            className="project-user-timesheet-card"
                          >
                            <summary>
                              <UserProfileLink userId={userGroup.userId} name={userGroup.userName} className="user-profile-link--plain" />
                              <small>
                                {userGroup.groups.length} perioade ·{" "}
                                {formatMinutes(userGroup.totalMinutes)}
                              </small>
                              <span className="project-summary-hint">detalii</span>
                            </summary>

                            <div className="project-period-list">
                              {userGroup.groups.map((group) => (
                                <div key={group.key} className="project-period-card">
                                  <div className="project-period-head">
                                    <strong>{group.label}</strong>
                                    <span>{formatMinutes(group.totalMinutes)}</span>
                                  </div>

                                  <div className="project-entry-list">
                                    {group.entries.map((entry) => (
                                      <Link
                                        key={entry.id}
                                        className="project-entry-row"
                                        to={`/timesheets/${entry.id}`}
                                      >
                                        <span>
                                          {new Date(entry.startAt).toLocaleTimeString("ro-RO", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                          {" - "}
                                          {entry.stopAt
                                             ? new Date(entry.stopAt).toLocaleTimeString("ro-RO", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })
                                            : "activ"}
                                        </span>
                                        <span>{formatMinutes(entry.workedMinutes)}</span>
                                        <span className="badge badge-orange">{entry.status}</span>
                                      </Link>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
