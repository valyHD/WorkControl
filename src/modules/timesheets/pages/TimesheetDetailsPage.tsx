import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { TimesheetItem, TimesheetLocation } from "../../../types/timesheet";
import { deleteTimesheet, formatMinutes, getTimesheetById } from "../services/timesheetsService";
import TimesheetLocationPreviewMap from "../components/TimesheetLocationPreviewMap";
import { geocodeAddress } from "../services/geocodingService";
import { formatTimesheetLocation } from "../utils/timesheetLocation";
import UserProfileLink from "../../../components/UserProfileLink";
import { useAuth } from "../../../providers/AuthProvider";

function formatCoords(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null) return "-";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function getProjectDisplayName(item: TimesheetItem): string {
  const name = item.projectName?.trim();
  const code = item.projectCode?.trim();
  return name || code || "Fara proiect";
}

function getStartExplanationLabel(timesheet: TimesheetItem): string {
  return timesheet.startPolicyFlag === "late_start"
    ? "Explicatie start tarziu"
    : "Explicatie start";
}

function getStopExplanationLabel(timesheet: TimesheetItem): string {
  if (timesheet.stopPolicyFlag === "early_stop") return "Explicatie stop devreme";
  if (timesheet.stopPolicyFlag === "late_stop") return "Explicatie stop tarziu";
  return "Explicatie stop";
}

function hasSeparateExplanations(timesheet: TimesheetItem): boolean {
  return Boolean(timesheet.startExplanation?.trim() || timesheet.stopExplanation?.trim());
}

export default function TimesheetDetailsPage() {
  const { timesheetId = "" } = useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [timesheet, setTimesheet] = useState<TimesheetItem | null>(null);
  const [resolvedStartLocation, setResolvedStartLocation] = useState<TimesheetLocation | null>(null);
  const [resolvedStopLocation, setResolvedStopLocation] = useState<TimesheetLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getTimesheetById(timesheetId);
      setTimesheet(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [timesheetId]);

  useEffect(() => {
    let cancelled = false;
    setResolvedStartLocation(null);
    setResolvedStopLocation(null);

    async function resolveMissingLocation(
      location: TimesheetLocation | null | undefined,
      setter: (value: TimesheetLocation | null) => void
    ) {
      if (!location?.label || (location.lat != null && location.lng != null)) return;
      const resolved = await geocodeAddress(location.label);
      if (cancelled) return;
      if (resolved?.lat != null && resolved.lng != null) {
        setter(resolved);
      }
    }

    if (timesheet) {
      void resolveMissingLocation(timesheet.startLocation, setResolvedStartLocation);
      void resolveMissingLocation(timesheet.stopLocation, setResolvedStopLocation);
    }

    return () => {
      cancelled = true;
    };
  }, [
    timesheet?.id,
    timesheet?.startLocation?.label,
    timesheet?.startLocation?.lat,
    timesheet?.startLocation?.lng,
    timesheet?.stopLocation?.label,
    timesheet?.stopLocation?.lat,
    timesheet?.stopLocation?.lng,
  ]);

  async function handleDeleteTimesheet() {
    if (!timesheet || deleting) return;
    const ok = window.confirm(`Stergi pontajul pentru ${getProjectDisplayName(timesheet)} din ${timesheet.workDate || "-"}?`);
    if (!ok) return;

    setDeleting(true);
    try {
      await deleteTimesheet(timesheet);
      navigate("/timesheets");
    } catch (error) {
      console.error("[TimesheetDetailsPage][delete]", error);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca pontajul...</h2>
        <p>Preluam detaliile din Firebase.</p>
      </div>
    );
  }

  if (!timesheet) {
    return (
      <div className="placeholder-page">
        <h2>Pontajul nu a fost gasit</h2>
        <p>Verifica linkul.</p>
      </div>
    );
  }

  const startLocation = resolvedStartLocation ?? timesheet.startLocation;
  const stopLocation = resolvedStopLocation ?? timesheet.stopLocation;
  const canDeleteTimesheet = role === "admin" || role === "manager" || timesheet.userId === user?.uid;

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Detalii pontaj</h2>
            <p className="tools-subtitle">
              {getProjectDisplayName(timesheet)}
            </p>
          </div>

          <div className="tools-header-actions">
            {canDeleteTimesheet && (
              <button className="danger-btn" type="button" onClick={() => void handleDeleteTimesheet()} disabled={deleting}>
                {deleting ? "Se sterge..." : "Sterge pontaj"}
              </button>
            )}
            <Link to="/timesheets" className="secondary-btn">
              Inapoi la pontaje
            </Link>
          </div>
        </div>

        <div className="tool-details-grid">
          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Date generale</h3>

            <div className="tool-detail-line">
              <strong>Utilizator:</strong>{" "}
              <UserProfileLink userId={timesheet.userId} name={timesheet.userName} themeKey={timesheet.userThemeKey} />
            </div>
            <div className="tool-detail-line">
              <strong>Status:</strong> {timesheet.status}
            </div>
            <div className="tool-detail-line">
              <strong>Data:</strong> {timesheet.workDate}
            </div>
            <div className="tool-detail-line">
              <strong>Durata:</strong> {formatMinutes(timesheet.workedMinutes)}
            </div>
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Start</h3>

            <div className="tool-detail-line">
              <strong>Ora start:</strong> {new Date(timesheet.startAt).toLocaleString("ro-RO")}
            </div>
            <div className="tool-detail-line">
              <strong>Adresa start:</strong> {formatTimesheetLocation(startLocation)}
            </div>
            <div className="tool-detail-line">
              <strong>Coordonate start:</strong>{" "}
              {formatCoords(startLocation?.lat, startLocation?.lng)}
            </div>

            {startLocation?.lat != null &&
              startLocation?.lng != null && (
                <TimesheetLocationPreviewMap
                  lat={startLocation.lat}
                  lng={startLocation.lng}
                  label={formatTimesheetLocation(startLocation)}
                />
              )}
          </div>
        </div>

        <div className="panel tool-inner-panel" style={{ marginTop: 20 }}>
          <h3 className="panel-title">Stop</h3>

          <div className="tool-detail-line">
            <strong>Ora stop:</strong>{" "}
            ? {timesheet.stopAt
              ? new Date(timesheet.stopAt).toLocaleString("ro-RO")
              : "-"}
          </div>
          <div className="tool-detail-line">
            <strong>Adresa stop:</strong> {formatTimesheetLocation(stopLocation)}
          </div>
          <div className="tool-detail-line">
            <strong>Coordonate stop:</strong>{" "}
            {formatCoords(stopLocation?.lat, stopLocation?.lng)}
          </div>

          {stopLocation?.lat != null &&
            stopLocation?.lng != null && (
              <TimesheetLocationPreviewMap
                lat={stopLocation.lat}
                lng={stopLocation.lng}
                label={formatTimesheetLocation(stopLocation)}
              />
            )}
        </div>

        <div className="panel tool-inner-panel" style={{ marginTop: 20 }}>
          <h3 className="panel-title">Explicatii pontaj</h3>

          {hasSeparateExplanations(timesheet) ? (
            <>
              {timesheet.startExplanation?.trim() && (
                <div className="tool-detail-line">
                  <strong>{getStartExplanationLabel(timesheet)}:</strong>{" "}
                  <span style={{ whiteSpace: "pre-wrap" }}>{timesheet.startExplanation}</span>
                </div>
              )}

              {timesheet.stopExplanation?.trim() && (
                <div className="tool-detail-line">
                  <strong>{getStopExplanationLabel(timesheet)}:</strong>{" "}
                  <span style={{ whiteSpace: "pre-wrap" }}>{timesheet.stopExplanation}</span>
                </div>
              )}
            </>
          ) : (
            <div className="tool-detail-line" style={{ whiteSpace: "pre-wrap" }}>
              {timesheet.explanation || "-"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
