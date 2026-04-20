import { useEffect, useMemo, useState } from "react";
import {
  BatteryCharging,
  Gauge,
  MapPin,
  Radio,
  Satellite,
  ShieldCheck,
  Smartphone,
  Waypoints,
} from "lucide-react";
import type { VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
};

const ONLINE_MS = 3 * 60 * 1000;
const RECENT_MS = 10 * 60 * 1000;
const MOVING_SPEED_THRESHOLD_KMH = 4;
const IGNITION_OFF_IDLE_MS = 10 * 60 * 1000;

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat?: number, lng?: number) {
  if (typeof lat !== "number" || typeof lng !== "number") return "-";
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "-";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function formatRelative(msAgo: number) {
  const sec = Math.max(0, Math.floor(msAgo / 1000));

  if (sec < 60) return `${sec}s in urma`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min in urma`;

  const hours = Math.floor(min / 60);
  const restMin = min % 60;

  if (!restMin) return `${hours}h in urma`;
  return `${hours}h ${restMin}m in urma`;
}

export default function VehicleGpsStatsCard({ vehicle }: Props) {
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  const snapshot = vehicle.gpsSnapshot;

  const trackerPingAt =
    vehicle.tracker?.lastSeenAt ||
    vehicle.tracker?.updatedAt ||
    snapshot?.serverTimestamp ||
    snapshot?.gpsTimestamp ||
    0;

  const ageMs = trackerPingAt
    ? Math.max(0, nowTs - trackerPingAt)
    : Number.POSITIVE_INFINITY;

  const trackerState = useMemo(() => {
    if (!trackerPingAt) {
      return {
        label: "Fara semnal",
        className: "vehicle-gps-chip is-offline",
      };
    }

    if (ageMs <= ONLINE_MS) {
      return {
        label: "Online",
        className: "vehicle-gps-chip is-online",
      };
    }

    if (ageMs <= RECENT_MS) {
      return {
        label: "Recent",
        className: "vehicle-gps-chip is-recent",
      };
    }

    return {
      label: "Offline",
      className: "vehicle-gps-chip is-offline",
    };
  }, [ageMs, trackerPingAt]);

  const mapsHref =
    typeof snapshot?.lat === "number" && typeof snapshot?.lng === "number"
      ? `https://www.google.com/maps?q=${snapshot.lat},${snapshot.lng}`
      : "";

  const ignitionFromGpsOn = useMemo(() => {
    if (!snapshot?.gpsTimestamp) return false;

    const speed = Number.isFinite(snapshot.speedKmh) ? Number(snapshot.speedKmh) : 0;
    if (speed > MOVING_SPEED_THRESHOLD_KMH) return true;

    return nowTs - snapshot.gpsTimestamp < IGNITION_OFF_IDLE_MS;
  }, [nowTs, snapshot?.gpsTimestamp, snapshot?.speedKmh]);

  return (
    <div className="panel vehicle-info-card">
      <div className="vehicle-control-card__header">
        <h4 className="panel-title">Tracker live</h4>
        <span className={trackerState.className}>{trackerState.label}</span>
      </div>

      <div className="vehicle-info-grid">
        <div className="vehicle-info-item">
          <Radio size={16} />
          <strong>{trackerState.label}</strong>
          <span>Status tracker</span>
        </div>

        <div className="vehicle-info-item">
          <ShieldCheck size={16} />
          <strong>{trackerPingAt ? formatRelative(ageMs) : "-"}</strong>
          <span>Ultimul ping</span>
        </div>

        <div className="vehicle-info-item">
          <MapPin size={16} />
          <strong>{formatCoords(snapshot?.lat, snapshot?.lng)}</strong>
          <span>Ultima locatie</span>
        </div>

        <div className="vehicle-info-item">
          <Waypoints size={16} />
          <strong>{ignitionFromGpsOn ? "Contact pornit" : "Contact oprit"}</strong>
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
          <BatteryCharging size={16} />
          <strong>{snapshot?.altitude ?? 0} m</strong>
          <span>Altitudine</span>
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

      <div className="tool-detail-line">
        <strong>Ultima actualizare tracker:</strong> {formatDate(trackerPingAt)}
      </div>

      <div className="tool-detail-line">
        <strong>Ultimul GPS timestamp:</strong> {formatDate(snapshot?.gpsTimestamp)}
      </div>

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
