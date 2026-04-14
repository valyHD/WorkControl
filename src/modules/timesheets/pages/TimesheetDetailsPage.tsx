import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TimesheetItem } from "../../../types/timesheet";
import { formatMinutes, getTimesheetById } from "../services/timesheetsService";
import TimesheetLocationPreviewMap from "../components/TimesheetLocationPreviewMap";

function formatCoords(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null) return "-";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export default function TimesheetDetailsPage() {
  const { timesheetId = "" } = useParams();
  const [timesheet, setTimesheet] = useState<TimesheetItem | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Detalii pontaj</h2>
            <p className="tools-subtitle">
              {timesheet.projectCode} - {timesheet.projectName}
            </p>
          </div>

          <Link to="/timesheets" className="secondary-btn">
            Inapoi la pontaje
          </Link>
        </div>

        <div className="tool-details-grid">
          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Date generale</h3>

            <div className="tool-detail-line">
              <strong>Utilizator:</strong> {timesheet.userName}
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
              <strong>Adresa start:</strong> {timesheet.startLocation?.label || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Coordonate start:</strong>{" "}
              {formatCoords(timesheet.startLocation?.lat, timesheet.startLocation?.lng)}
            </div>

            {timesheet.startLocation?.lat != null &&
              timesheet.startLocation?.lng != null && (
                <TimesheetLocationPreviewMap
                  lat={timesheet.startLocation.lat}
                  lng={timesheet.startLocation.lng}
                  label={timesheet.startLocation.label || "Locatie start"}
                />
              )}
          </div>
        </div>

        <div className="panel tool-inner-panel" style={{ marginTop: 20 }}>
          <h3 className="panel-title">Stop</h3>

          <div className="tool-detail-line">
            <strong>Ora stop:</strong>{" "}
            {timesheet.stopAt
              ? new Date(timesheet.stopAt).toLocaleString("ro-RO")
              : "-"}
          </div>
          <div className="tool-detail-line">
            <strong>Adresa stop:</strong> {timesheet.stopLocation?.label || "-"}
          </div>
          <div className="tool-detail-line">
            <strong>Coordonate stop:</strong>{" "}
            {formatCoords(timesheet.stopLocation?.lat, timesheet.stopLocation?.lng)}
          </div>

          {timesheet.stopLocation?.lat != null &&
            timesheet.stopLocation?.lng != null && (
              <TimesheetLocationPreviewMap
                lat={timesheet.stopLocation.lat}
                lng={timesheet.stopLocation.lng}
                label={timesheet.stopLocation.label || "Locatie stop"}
              />
            )}
        </div>

        <div className="panel tool-inner-panel" style={{ marginTop: 20 }}>
          <h3 className="panel-title">Explicatie</h3>
          <div className="tool-detail-line">{timesheet.explanation || "-"}</div>
        </div>
      </div>
    </section>
  );
}