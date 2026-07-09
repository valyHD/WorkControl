import { useEffect, useMemo, useState } from "react";
import {
  BatteryCharging,
  Database,
  Gauge,
  Radio,
  Waypoints,
} from "lucide-react";
import type { VehicleItem, VehiclePositionItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  odometerKmOverride?: number;
  livePositionOverride?: VehiclePositionItem | null;
  livePositionOverrideIsVirtual?: boolean;
};

const ONLINE_MS = 3 * 60 * 1000;
const RECENT_MS = 10 * 60 * 1000;
const FRESH_GPS_MOTION_MS = 90 * 1000;
const MOVING_SPEED_THRESHOLD_KMH = 4;

function getTrustedTotalOdometerKm(value: unknown, initialRecordedKm: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (initialRecordedKm > 0 && value < initialRecordedKm) return 0;
  return value;
}

function getLastSavedRouteEndTs(vehicle: VehicleItem) {
  let lastEndTs = 0;

  for (const route of vehicle.gpsSimHistory ?? []) {
    const lastPointTs = route.points?.[route.points.length - 1]?.ts || 0;
    const durationEndTs =
      route.startedAt && route.totalDurationMs ? route.startedAt + route.totalDurationMs : 0;
    lastEndTs = Math.max(lastEndTs, route.stoppedAt || 0, lastPointTs, durationEndTs);
  }

  return lastEndTs;
}

function formatDataBytes(value: unknown) {
  const bytes = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const formatter = new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (bytes >= 1024 * 1024 * 1024) {
    return `${formatter.format(bytes / (1024 * 1024 * 1024))} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${formatter.format(bytes / (1024 * 1024))} MB`;
  }

  if (bytes >= 1024) {
    return `${formatter.format(bytes / 1024)} KB`;
  }

  return `${formatter.format(bytes)} B`;
}

function getCurrentGpsDataUsageMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}_${month}`;
}

export default function VehicleGpsStatsCard({
  vehicle,
  odometerKmOverride,
  livePositionOverride,
  livePositionOverrideIsVirtual = false,
}: Props) {
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  const snapshot = livePositionOverride ?? vehicle.gpsSnapshot;

  const trackerPingAt = livePositionOverride && livePositionOverrideIsVirtual
     ? nowTs
    : vehicle.tracker?.lastSeenAt ||
      vehicle.tracker?.updatedAt ||
      snapshot?.serverTimestamp ||
      snapshot?.gpsTimestamp ||
      0;

  const ageMs = trackerPingAt
    ? Math.max(0, nowTs - trackerPingAt)
    : Number.POSITIVE_INFINITY;
  const gpsFixAgeMs = snapshot?.gpsTimestamp
     ? Math.max(0, nowTs - snapshot.gpsTimestamp)
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

  const isTrackerOnline = ageMs <= RECENT_MS;
  const lastSavedRouteEndTs = useMemo(() => getLastSavedRouteEndTs(vehicle), [vehicle]);
  const realSnapshotIsAfterSavedRoute =
    livePositionOverrideIsVirtual ||
    !lastSavedRouteEndTs ||
    (snapshot?.gpsTimestamp || 0) > lastSavedRouteEndTs;
  const canTrustMotionFromSnapshot =
    Boolean(livePositionOverride && livePositionOverrideIsVirtual) ||
    (isTrackerOnline && gpsFixAgeMs <= FRESH_GPS_MOTION_MS && realSnapshotIsAfterSavedRoute);
  const rawSpeedKmh = Number.isFinite(snapshot?.speedKmh) ? Number(snapshot?.speedKmh) : 0;
  const effectiveSpeedKmh =
    canTrustMotionFromSnapshot && snapshot?.ignitionOn !== false
       ? Math.max(0, Math.round(rawSpeedKmh))
      : 0;

  const ignitionFromGpsOn = useMemo(() => {
    if (!snapshot?.gpsTimestamp) return false;
    if (!canTrustMotionFromSnapshot) return false;
    if (typeof snapshot.ignitionOn === "boolean") {
      return snapshot.ignitionOn;
    }

    if (effectiveSpeedKmh > MOVING_SPEED_THRESHOLD_KMH) return true;

    return false;
  }, [
    canTrustMotionFromSnapshot,
    effectiveSpeedKmh,
    snapshot?.gpsTimestamp,
    snapshot?.ignitionOn,
  ]);

  const displayedSpeedKmh = useMemo(() => {
    if (!canTrustMotionFromSnapshot) return 0;
    if (snapshot?.ignitionOn === false) return 0;
    return effectiveSpeedKmh;
  }, [canTrustMotionFromSnapshot, effectiveSpeedKmh, snapshot?.ignitionOn]);

  const displayedTrackerIgnitionOn =
    livePositionOverrideIsVirtual
       ? Boolean(snapshot?.ignitionOn)
      : Boolean(isTrackerOnline && ignitionFromGpsOn);
  const dataUsageMonthKey =
    vehicle.gpsDataUsage?.currentMonthKey || getCurrentGpsDataUsageMonthKey();
  const currentMonthDataUsage = vehicle.gpsDataUsage?.months?.[dataUsageMonthKey];
  const dataUsageMonthlyBytes =
    currentMonthDataUsage?.totalBytes ||
    (currentMonthDataUsage?.rxBytes || 0) + (currentMonthDataUsage?.txBytes || 0);
  const lastDataPacketBytes =
    vehicle.gpsDataUsage?.lastTotalBytes ||
    (vehicle.gpsDataUsage?.lastRxBytes || 0) + (vehicle.gpsDataUsage?.lastTxBytes || 0);

  const displayedOdometerKm = useMemo(() => {
    const initialRecordedKm = vehicle.initialRecordedKm || 0;
    const candidates = [
      getTrustedTotalOdometerKm(vehicle.gpsSnapshot?.odometerKm, initialRecordedKm),
      livePositionOverrideIsVirtual
        ? 0
        : getTrustedTotalOdometerKm(snapshot?.odometerKm, initialRecordedKm),
      odometerKmOverride,
      getTrustedTotalOdometerKm(vehicle.currentKm, initialRecordedKm),
      initialRecordedKm,
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

    return candidates.length ? Math.max(...candidates) : 0;
  }, [
    livePositionOverrideIsVirtual,
    odometerKmOverride,
    snapshot?.odometerKm,
    vehicle.currentKm,
    vehicle.gpsSnapshot?.odometerKm,
    vehicle.initialRecordedKm,
  ]);

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
          <Waypoints size={16} />
          <strong>{ignitionFromGpsOn ? "Contact pornit" : "Contact oprit"}</strong>
          <span>Contact</span>
        </div>

        <div className="vehicle-info-item">
          <Gauge size={16} />
          <strong>{displayedSpeedKmh} km/h</strong>
          <span>Viteza curenta</span>
        </div>

        <div className="vehicle-info-item">
          <Gauge size={16} />
          <strong>{displayedOdometerKm.toFixed(2)} km</strong>
          <span>Odometru</span>
        </div>

        <div className="vehicle-info-item">
          <BatteryCharging size={16} />
          <strong>{displayedTrackerIgnitionOn ? "Pornit" : "Oprit"}</strong>
          <span>Ignitie tracker</span>
        </div>

        <div className="vehicle-info-item">
          <Database size={16} />
          <strong>{formatDataBytes(dataUsageMonthlyBytes)}</strong>
          <span>Consum luna GPS</span>
        </div>

        <div className="vehicle-info-item">
          <Database size={16} />
          <strong>{formatDataBytes(lastDataPacketBytes)}</strong>
          <span>Ultimul pachet</span>
        </div>
      </div>

    </div>
  );
}
