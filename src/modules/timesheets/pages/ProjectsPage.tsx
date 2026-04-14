import { useEffect, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { ProjectFormValues, ProjectItem } from "../../../types/timesheet";
import {
  createProject,
  getProjectsList,
  isProjectCodeUsed,
  updateProject,
} from "../services/timesheetsService";
import ProjectForm from "../components/ProjectForm";

export default function ProjectsPage() {
  const { role } = useAuth();

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingValues, setEditingValues] = useState<ProjectFormValues>({
    code: "",
    name: "",
    status: "activ",
  });

  async function load() {
    setLoading(true);
    try {
      const data = await getProjectsList();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(values: ProjectFormValues) {
    setSubmitting(true);
    setError("");

    try {
      if (!values.code.trim() || !values.name.trim()) {
        setError("Completeaza codul si numele proiectului.");
        return;
      }

      const exists = await isProjectCodeUsed(values.code);
      if (exists) {
        setError("Exista deja un proiect cu acest cod.");
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
      if (!editingValues.code.trim() || !editingValues.name.trim()) {
        setError("Completeaza codul si numele proiectului.");
        return;
      }

      const exists = await isProjectCodeUsed(editingValues.code, projectId);
      if (exists) {
        setError("Exista deja un proiect cu acest cod.");
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
      <div className="panel">
        <h2 className="panel-title">Proiecte</h2>
        <p className="tools-subtitle">
          Creeaza proiecte si schimba statusul lor.
        </p>

        {error && <div className="tool-message" style={{ marginTop: 16 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <ProjectForm
            initialValues={{
              code: "",
              name: "",
              status: "activ",
            }}
            submitting={submitting}
            onSubmit={handleCreate}
          />
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Lista proiecte</h2>

        {projects.length === 0 ? (
          <p className="tools-subtitle">Nu exista proiecte.</p>
        ) : (
          <div className="simple-list">
            {projects.map((project) => (
              <div key={project.id} className="simple-list-item">
                {editingId === project.id ? (
                  <div style={{ width: "100%" }}>
                    <div className="tool-form-grid">
                      <div className="tool-form-block">
                        <label className="tool-form-label">Cod</label>
                        <input
                          className="tool-input"
                          value={editingValues.code}
                          onChange={(e) =>
                            setEditingValues((prev) => ({ ...prev, code: e.target.value }))
                          }
                        />
                      </div>

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
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="simple-list-text">
                      <div className="simple-list-label">
                        {project.code} - {project.name}
                      </div>
                      <div className="simple-list-subtitle">
                        status: {project.status}
                      </div>
                    </div>

                    <div className="dashboard-inline-actions">
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => {
                          setEditingId(project.id);
                          setEditingValues({
                            code: project.code,
                            name: project.name,
                            status: project.status,
                          });
                        }}
                      >
                        Editeaza
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}