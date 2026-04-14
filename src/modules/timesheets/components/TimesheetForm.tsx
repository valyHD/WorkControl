import { useMemo, useState } from "react";
import type { ProjectItem, TimesheetItem, TimesheetLocation } from "../../../types/timesheet";
import { reverseGeocode } from "../services/geocodingService";

type Props = {
  projects: ProjectItem[];
  activeTimesheet: TimesheetItem | null;
  onStart: (projectId: string, location: TimesheetLocation) => Promise<void>;
  onStop: (explanation: string, location: TimesheetLocation) => Promise<void>;
  loading: boolean;
};

export default function TimesheetForm({
  projects,
  activeTimesheet,
  onStart,
  onStop,
  loading,
}: Props) {
  const [projectId, setProjectId] = useState("");
  const [explanation, setExplanation] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [message, setMessage] = useState("");

  const activeProject = useMemo(() => {
    return projects.find((project) => project.id === projectId) ?? null;
  }, [projects, projectId]);

  function getBrowserLocation(): Promise<TimesheetLocation> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({
          lat: null,
          lng: null,
          label: "Geolocatia nu este disponibila in browser",
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          const addressLabel = await reverseGeocode(lat, lng);

          resolve({
            lat,
            lng,
            label: addressLabel,
          });
        },
        () => {
          resolve({
            lat: null,
            lng: null,
            label: "Locatia nu a putut fi obtinuta",
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
        }
      );
    });
  }

  async function handleStart() {
    if (!projectId || !activeProject) {
      setMessage("Selecteaza proiectul.");
      return;
    }

    setGeoLoading(true);
    setMessage("");

    try {
      const location = await getBrowserLocation();
      await onStart(projectId, location);
      setProjectId("");
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Nu am putut porni pontajul.");
    } finally {
      setGeoLoading(false);
    }
  }

  async function handleStop() {
    setGeoLoading(true);
    setMessage("");

    try {
      const location = await getBrowserLocation();
      await onStop(explanation, location);
      setExplanation("");
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Nu am putut opri pontajul.");
    } finally {
      setGeoLoading(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Pontaj rapid</h2>

      {!activeTimesheet ? (
        <>
          <div className="tool-form-block">
            <label className="tool-form-label">Proiect</label>
            <select
              className="tool-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Selecteaza proiect</option>
              {projects
                .filter((project) => project.status === "activ")
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="tool-form-actions" style={{ marginTop: 16 }}>
            <button
              className="primary-btn"
              type="button"
              onClick={() => void handleStart()}
              disabled={loading || geoLoading}
            >
              {geoLoading ? "Se ia locatia..." : "Porneste pontaj"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="simple-list">
            <div className="simple-list-item">
              <div className="simple-list-text">
                <div className="simple-list-label">
                  {activeTimesheet.projectCode} - {activeTimesheet.projectName}
                </div>
                <div className="simple-list-subtitle">
                  Start: {new Date(activeTimesheet.startAt).toLocaleString("ro-RO")}
                </div>
                <div className="simple-list-subtitle">
                  Locatie start: {activeTimesheet.startLocation?.label || "-"}
                </div>
              </div>
              <span className="badge badge-orange">activ</span>
            </div>
          </div>

          <div className="tool-form-block" style={{ marginTop: 16 }}>
            <label className="tool-form-label">Explicatie (optional)</label>
            <textarea
              className="tool-input tool-textarea"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Ex: Lucrare prelungita, deplasare, situatie speciala"
            />
          </div>

          <div className="tool-form-actions" style={{ marginTop: 16 }}>
            <button
              className="primary-btn"
              type="button"
              onClick={() => void handleStop()}
              disabled={loading || geoLoading}
            >
              {geoLoading ? "Se ia locatia..." : "Opreste pontaj"}
            </button>
          </div>
        </>
      )}

      {message && <div className="tool-message" style={{ marginTop: 16 }}>{message}</div>}
    </div>
  );
}