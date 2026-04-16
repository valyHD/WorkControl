import { Gauge, MapPin, Radio, Satellite, Smartphone, Waypoints } from "lucide-react";
import type { VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
};

const TRACKER_ONLINE_WINDOW_MS = 10 * 60 * 1000;

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat?: number, lng?: number) {
  if (typeof lat !== "number" || typeof lng !== "number") return "-";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export default function VehicleGpsStatsCard({ vehicle }: Props) {
  const snapshot = vehicle.gpsSnapshot;
  const lastTrackerUpdateAt =
    snapshot?.serverTimestamp || vehicle.tracker?.lastSeenAt || snapshot?.gpsTimestamp || 0;
  const isFreshPing = lastTrackerUpdateAt > 0 && Date.now() - lastTrackerUpdateAt <= TRACKER_ONLINE_WINDOW_MS;
  const isTrackerOnline = Boolean(snapshot?.online) && isFreshPing;
  const mapsHref =
    typeof snapshot?.lat === "number" && typeof snapshot?.lng === "number"
      ? `https://www.google.com/maps?q=${snapshot.lat},${snapshot.lng}`
      : "";

  return (
    <div className="panel vehicle-info-card">
      <h4 className="panel-title">Detalii GPS live</h4>
      <div className="vehicle-info-grid">
        <div className="vehicle-info-item">
          <Radio size={16} />
          <strong>{isTrackerOnline ? "Online" : "Offline"}</strong>
          <span>Status tracker</span>
        </div>
        <div className="vehicle-info-item">
          <MapPin size={16} />
          <strong>{formatCoords(snapshot?.lat, snapshot?.lng)}</strong>
          <span>Ultima locatie</span>
        </div>
        <div className="vehicle-info-item">
          <Waypoints size={16} />
          <strong>{snapshot?.ignitionOn ? "Contact pornit" : "Contact oprit"}</strong>
          <span>Contact</span>
        </div>
        <div className="vehicle-info-item">
          <Gauge size={16} />
          <strong>{snapshot?.speedKmh ?? 0} km/h</strong>
          <span>Viteza curenta</span>
        </div>
        <div className="vehicle-info-item">
          <Gauge size={16} />
          <strong>{snapshot?.odometerKm ?? vehicle.currentKm ?? 0} km</strong>
          <span>Odometru</span>
        </div>
        <div className="vehicle-info-item">
          <Satellite size={16} />
          <strong>{snapshot?.satellites ?? 0}</strong>
          <span>Sateliti</span>
        </div>
        <div className="vehicle-info-item">
          <Smartphone size={16} />
          <strong>{vehicle.tracker?.imei || snapshot?.imei || "-"}</strong>
          <span>IMEI</span>
        </div>
        <div className="vehicle-info-item">
          <Smartphone size={16} />
          <strong>{vehicle.tracker?.protocol || "-"}</strong>
          <span>Protocol</span>
        </div>
      </div>

      <div className="tool-detail-line"><strong>Ultima actualizare:</strong> {formatDate(lastTrackerUpdateAt)}</div>
      <div className="tool-detail-line"><strong>Altitudine:</strong> {snapshot?.altitude ?? 0} m</div>

      <div className="tool-form-actions" style={{ marginTop: 14 }}>
        <a
          href={mapsHref || undefined}
          className="secondary-btn"
          target="_blank"
          rel="noreferrer"
          aria-disabled={!mapsHref}
          onClick={(event) => {
            if (!mapsHref) event.preventDefault();
          }}
        >
          Deschide in Google Maps
        </a>
      </div>
    </div>
  );
}
