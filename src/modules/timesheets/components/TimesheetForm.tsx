import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectItem, TimesheetItem, TimesheetLocation } from "../../../types/timesheet";
import { geocodeAddress, reverseGeocode } from "../services/geocodingService";
import { formatTimesheetLocation, simplifyTimesheetAddressLabel } from "../utils/timesheetLocation";

function getProjectDisplayName(projectName?: string, projectCode?: string): string {
  const name = String(projectName ?? "").trim();
  const code = String(projectCode ?? "").trim();
  return name || code || "Fara proiect";
}

const DEFAULT_WORKDAY_START_TIME = "08:00";
const EXPECTED_SHIFT_TOTAL_MINUTES = 9 * 60;
const START_EXPLANATION_AFTER_MINUTES = 8 * 60 + 15;
const STOP_ACCEPTED_FROM_MINUTES = 16 * 60;
const STOP_ACCEPTED_TO_MINUTES = 18 * 60;

type TimesheetPolicyModal = {
  kind: "start" | "stop";
  title: string;
  message: string;
  details: string;
  policyFlag: string;
  expectedStartTime?: string;
  expectedMinutes?: number;
};

function parseClockMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = String(value || "").split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 8 * 60;
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNowClockMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

type Props = {
  projects: ProjectItem[];
  activeTimesheet: TimesheetItem | null;
  onStart: (
    projectId: string,
    location: TimesheetLocation,
    startExplanation?: string,
    startPolicyFlag?: string,
    startExpectedTime?: string
  ) => Promise<string | void>;
  onStop: (
    explanation: string,
    location: TimesheetLocation,
    stopPolicyFlag?: string,
    stopExpectedMinutes?: number
  ) => Promise<void>;
  onLocationResolved?: (
    timesheetId: string,
    kind: "start" | "stop",
    location: TimesheetLocation
  ) => Promise<void>;
  loading: boolean;
  allowCustomLocation?: boolean;
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  workdayStartTime?: string;
  expectedShiftMinutes?: number;
  attentionActive?: boolean;
};

export default function TimesheetForm({
  projects,
  activeTimesheet,
  onStart,
  onStop,
  onLocationResolved,
  loading,
  allowCustomLocation = false,
  selectedProjectId = "",
  onProjectChange,
  workdayStartTime = DEFAULT_WORKDAY_START_TIME,
  expectedShiftMinutes = EXPECTED_SHIFT_TOTAL_MINUTES,
  attentionActive = false,
}: Props) {
  const [projectId, setProjectId] = useState(selectedProjectId);
  const [explanation, setExplanation] = useState("");
  const [startCustomAddress, setStartCustomAddress] = useState("");
  const [stopCustomAddress, setStopCustomAddress] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [policyModal, setPolicyModal] = useState<TimesheetPolicyModal | null>(null);
  const [policyExplanation, setPolicyExplanation] = useState("");
  const [policySubmitting, setPolicySubmitting] = useState(false);

  const activeProject = useMemo(() => {
    return projects.find((project) => project.id === projectId) ?? null;
  }, [projects, projectId]);

  const submitting = loading || actionSubmitting || policySubmitting;

  useEffect(() => {
    setProjectId(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!policyModal || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [policyModal]);

  function handleProjectChange(projectIdValue: string) {
    setProjectId(projectIdValue);
    onProjectChange?.(projectIdValue);
  }

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

  async function getCustomLocation(address: string): Promise<TimesheetLocation | null> {
    const label = simplifyTimesheetAddressLabel(address);
    if (!allowCustomLocation || !label) return null;
    return await geocodeAddress(label);
  }

  function pendingLocation(address: string): TimesheetLocation {
    const customLabel = simplifyTimesheetAddressLabel(address);
    return {
      lat: null,
      lng: null,
      label: customLabel || "Locatia se completeaza in fundal",
    };
  }

  function resolveLocationInBackground(address: string) {
    return getCustomLocation(address).then((customLocation) => customLocation ?? getBrowserLocation());
  }

  function enrichLocation(
    timesheetId: string,
    kind: "start" | "stop",
    locationPromise: Promise<TimesheetLocation>
  ) {
    if (!onLocationResolved) return;
    void locationPromise
      .then((location) => {
        if (location.lat === null || location.lng === null) return;
        return onLocationResolved(timesheetId, kind, location);
      })
      .catch((error) => console.warn("[TimesheetForm][background location]", error));
  }

  async function runStart(startExplanation = "", startPolicyFlag = ""): Promise<boolean> {
    setActionSubmitting(true);
    setMessage("");

    try {
      const locationPromise = resolveLocationInBackground(startCustomAddress);
      const timesheetId = await onStart(
        projectId,
        pendingLocation(startCustomAddress),
        startExplanation,
        startPolicyFlag,
        workdayStartTime
      );
      if (timesheetId) enrichLocation(timesheetId, "start", locationPromise);
      setStartCustomAddress("");
      setMessage("Pontaj pornit. Locatia se completeaza in fundal.");
      return true;
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Nu am putut porni pontajul.");
      return false;
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleStart() {
    if (!projectId || !activeProject) {
      setMessage("Selecteaza proiectul.");
      return;
    }

    const now = new Date();
    const lateStartLimit = Math.max(parseClockMinutes(workdayStartTime), START_EXPLANATION_AFTER_MINUTES);

    if (getNowClockMinutes(now) > lateStartLimit) {
      setPolicyExplanation("");
      setPolicyModal({
        kind: "start",
        title: "Explicatie pornire intarziata",
        message: `Pornesti pontajul la ${formatClock(now)}, dupa limita acceptata 08:15.`,
        details: "Intre 07:00 si 08:15 nu cerem explicatie. Dupa 08:15 completeaza motivul intarzierii.",
        policyFlag: "late_start",
        expectedStartTime: "08:15",
      });
      return;
    }

    await runStart();
  }

  function getStopPolicyModal(): TimesheetPolicyModal | null {
    if (!activeTimesheet) return null;

    const now = new Date();
    const currentMinutes = getNowClockMinutes(now);
    if (currentMinutes >= STOP_ACCEPTED_FROM_MINUTES && currentMinutes <= STOP_ACCEPTED_TO_MINUTES) {
      return null;
    }

    const policyFlag = currentMinutes < STOP_ACCEPTED_FROM_MINUTES ? "early_stop" : "late_stop";
    const directionText = currentMinutes < STOP_ACCEPTED_FROM_MINUTES ? "mai devreme" : "mai tarziu";

    return {
      kind: "stop",
      title: "Explicatie inchidere pontaj",
      message: `Opresti pontajul la ${formatClock(now)}, in afara intervalului acceptat 16:00-18:00.`,
      details: `Completeaza motivul pentru care pontajul se inchide ${directionText} decat intervalul normal.`,
      policyFlag,
      expectedMinutes: expectedShiftMinutes,
    };
  }

  async function runStop(stopExplanation: string, stopPolicyFlag = ""): Promise<boolean> {
    setActionSubmitting(true);
    setMessage("");

    try {
      if (!activeTimesheet) throw new Error("Nu exista pontaj activ.");
      const timesheetId = activeTimesheet.id;
      const locationPromise = resolveLocationInBackground(stopCustomAddress);
      await onStop(
        stopExplanation,
        pendingLocation(stopCustomAddress),
        stopPolicyFlag,
        expectedShiftMinutes
      );
      enrichLocation(timesheetId, "stop", locationPromise);
      setExplanation("");
      setStopCustomAddress("");
      setMessage("Pontaj oprit. Locatia se completeaza in fundal.");
      return true;
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Nu am putut opri pontajul.");
      return false;
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleStop() {
    const stopPolicy = getStopPolicyModal();

    if (stopPolicy) {
      setPolicyExplanation(explanation.trim());
      setPolicyModal(stopPolicy);
      return;
    }

    await runStop(explanation);
  }

  async function handlePolicyConfirm() {
    if (!policyModal) return;

    const cleanExplanation = policyExplanation.trim();
    if (!cleanExplanation) {
      setMessage("Completeaza explicatia pentru pontaj.");
      return;
    }

    setPolicySubmitting(true);
    setMessage("");

    try {
      const saved =
        policyModal.kind === "start"
          ? await runStart(cleanExplanation, policyModal.policyFlag)
          : await runStop(cleanExplanation, policyModal.policyFlag);

      if (saved) {
        setPolicyModal(null);
        setPolicyExplanation("");
      }
    } finally {
      setPolicySubmitting(false);
    }
  }

  const policyModalElement =
    policyModal && typeof document !== "undefined"
      ? createPortal(
          <div className="timesheet-policy-modal" role="dialog" aria-modal="true">
            <div className="timesheet-policy-modal__panel">
              <div className="timesheet-policy-modal__head">
                <h3>{policyModal.title}</h3>
                <p>{policyModal.message}</p>
              </div>

              <div className="timesheet-policy-modal__body">
                <label className="tool-form-label">Explicatie obligatorie</label>
                <textarea
                  className="tool-input tool-textarea"
                  value={policyExplanation}
                  onChange={(e) => setPolicyExplanation(e.target.value)}
                  placeholder="Scrie motivul intarzierii sau al inchiderii in afara programului"
                  autoFocus
                />
                <p className="timesheet-policy-modal__hint">{policyModal.details}</p>
              </div>

              <div className="timesheet-policy-modal__actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    setPolicyModal(null);
                    setPolicyExplanation("");
                  }}
                  disabled={submitting}
                >
                  Renunta
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void handlePolicyConfirm()}
                  disabled={submitting || !policyExplanation.trim()}
                >
                  {policySubmitting ? "Se salveaza..." : "Continua"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="panel">
      <h2 className="panel-title">Pontaj rapid</h2>

      {!activeTimesheet ? (
        <>
          <div className={`tool-form-block ${attentionActive ? "attention-pulse" : ""}`}>
            <label className="tool-form-label">Proiect</label>
            <select
              className="tool-input"
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              data-assistant-action="change-timesheet-project"
            >
              <option value="">Selecteaza proiect</option>
              {projects
                .filter((project) => project.status === "activ")
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || "Fara nume"}
                  </option>
                ))}
            </select>
          </div>

          {allowCustomLocation && (
            <div className="tool-form-block" style={{ marginTop: 16 }}>
              <label className="tool-form-label">Adresa start pontaj</label>
              <input
                className="tool-input"
                value={startCustomAddress}
                onChange={(e) => setStartCustomAddress(e.target.value)}
                placeholder="Ex: Str. Exemplu nr. 10, Bucuresti"
              />
            </div>
          )}

          <div className="tool-form-actions" style={{ marginTop: 16 }}>
            <button
              className={`primary-btn timesheet-main-action ${attentionActive ? "attention-pulse" : ""}`}
              type="button"
              onClick={() => void handleStart()}
              disabled={submitting}
              data-assistant-action="start-my-timesheet"
            >
              {actionSubmitting ? "Se porneste..." : "Porneste pontaj"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="simple-list">
            <div className="simple-list-item">
              <div className="simple-list-text">
                <div className="simple-list-label">
                  {getProjectDisplayName(activeTimesheet.projectName, activeTimesheet.projectCode)}
                </div>
                <div className="simple-list-subtitle">
                  Start: {new Date(activeTimesheet.startAt).toLocaleString("ro-RO")}
                </div>
                <div className="simple-list-subtitle">
                  Locatie start: {formatTimesheetLocation(activeTimesheet.startLocation)}
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
              data-assistant-action="add-timesheet-note"
            />
          </div>

          {allowCustomLocation && (
            <div className="tool-form-block" style={{ marginTop: 16 }}>
              <label className="tool-form-label">Adresa stop pontaj</label>
              <input
                className="tool-input"
                value={stopCustomAddress}
                onChange={(e) => setStopCustomAddress(e.target.value)}
                placeholder="Ex: Str. Exemplu nr. 10, Bucuresti"
              />
            </div>
          )}

          <div className="tool-form-actions" style={{ marginTop: 16 }}>
            <button
              className={`primary-btn timesheet-main-action ${attentionActive ? "attention-pulse" : ""}`}
              type="button"
              onClick={() => void handleStop()}
              disabled={submitting}
              data-assistant-action="stop-my-timesheet"
            >
              {actionSubmitting ? "Se opreste..." : "Opreste pontaj"}
            </button>
          </div>
        </>
      )}

      {policyModalElement}

      {message && <div className="tool-message" style={{ marginTop: 16 }}>{message}</div>}
    </div>
  );
}
