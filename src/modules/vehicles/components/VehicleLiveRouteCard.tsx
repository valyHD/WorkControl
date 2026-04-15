import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Crosshair, RefreshCw } from "lucide-react";
import type {
  VehicleCommandItem,
  VehicleGeoEvent,
  VehicleItem,
  VehiclePositionItem,
  VehicleStopItem,
} from "../../../types/vehicle";
import {
  getVehicleCommands,
  getVehiclePositionsRange,
  getVehicleTrackerEvents,
  requestVehicleCommand,
} from "../services/vehiclesService";
import {
  buildTimelineEvents,
  detectOverspeed,
  detectStops,
  formatDuration,
  fromDateTimeLocalValue,
  getPresetRange,
  samplePositions,
  sanitizePositions,
  toDateTimeLocalValue,
  type DateRangePreset,
} from "../utils/vehicleGps";
import VehicleGpsStatsCard from "./VehicleGpsStatsCard";
import VehicleTripTimeline from "./VehicleTripTimeline";
import VehicleControlCard from "./VehicleControlCard";

const currentIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--current",
  html: '<span>●</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const startIcon = new L.DivIcon({ className: "vehicle-map-pin vehicle-map-pin--start", html: "<span>S</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
const endIcon = new L.DivIcon({ className: "vehicle-map-pin vehicle-map-pin--end", html: "<span>F</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
const stopIcon = new L.DivIcon({ className: "vehicle-map-pin vehicle-map-pin--stop", html: "<span>P</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
const overspeedIcon = new L.DivIcon({ className: "vehicle-map-pin vehicle-map-pin--overspeed", html: "<span>!</span>", iconSize: [28, 28], iconAnchor: [14, 14] });

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function FitRouteBounds({ points, trigger }: { points: VehiclePositionItem[]; trigger: number }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(points.map((item) => [item.lat, item.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17, animate: true });
  }, [map, points, trigger]);

  return null;
}

type Props = { vehicle: VehicleItem };

export default function VehicleLiveRouteCard({ vehicle }: Props) {
  const [preset, setPreset] = useState<DateRangePreset>("today");
  const initialRange = getPresetRange("today");
  const [fromTs, setFromTs] = useState<number>(initialRange.from);
  const [toTs, setToTs] = useState<number>(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<VehiclePositionItem[]>([]);
  const [stopItems, setStopItems] = useState<VehicleStopItem[]>([]);
  const [overspeedThreshold, setOverspeedThreshold] = useState(50);
  const [overspeedItems, setOverspeedItems] = useState<VehiclePositionItem[]>([]);
  const [timeline, setTimeline] = useState<VehicleGeoEvent[]>([]);
  const [externalEventsCount, setExternalEventsCount] = useState(0);
  const [commands, setCommands] = useState<VehicleCommandItem[]>([]);
  const [boundsTrigger, setBoundsTrigger] = useState(0);

  async function loadData() {
    setLoading(true);
    try {
      const [route, extEvents, latestCommands] = await Promise.all([
        getVehiclePositionsRange(vehicle.id, fromTs, toTs),
        getVehicleTrackerEvents(vehicle.id, fromTs, toTs).catch(() => []),
        getVehicleCommands(vehicle.id).catch(() => []),
      ]);

      const clean = samplePositions(sanitizePositions(route));
      const stops = detectStops(clean);
      const overspeed = detectOverspeed(clean, overspeedThreshold);

      setPositions(clean);
      setStopItems(stops);
      setOverspeedItems(overspeed);
      setTimeline(buildTimelineEvents(clean, stops, overspeed));
      setExternalEventsCount(extEvents.length);
      setCommands(latestCommands);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [vehicle.id, fromTs, toTs, overspeedThreshold]);

  const routeStats = useMemo(() => {
    const start = positions[0];
    const end = positions[positions.length - 1];
    const maxSpeed = positions.length ? Math.max(...positions.map((item) => item.speedKmh ?? 0)) : 0;

    return {
      start,
      end,
      maxSpeed,
      duration: start && end ? formatDuration(end.gpsTimestamp - start.gpsTimestamp) : "-",
    };
  }, [positions]);

  function applyPreset(nextPreset: DateRangePreset) {
    setPreset(nextPreset);
    if (nextPreset === "custom") return;
    const range = getPresetRange(nextPreset);
    setFromTs(range.from);
    setToTs(range.to);
  }

  async function handleRequestCommand(type: "allow_start" | "block_start") {
    await requestVehicleCommand(vehicle.id, {
      type,
      requestedBy: vehicle.currentDriverUserName || vehicle.ownerUserName || "dashboard_user",
    });
    const latestCommands = await getVehicleCommands(vehicle.id).catch(() => []);
    setCommands(latestCommands);
  }

  return (
    <div className="panel vehicle-live-route-card">
      <div className="vehicle-live-route-card__header">
        <div>
          <h3 className="panel-title">Harta mare live</h3>
          <p className="tools-subtitle">Traseu complet, stopuri, overspeed, timeline si control vehicul.</p>
        </div>

        <div className="vehicle-live-route-card__actions">
          <button type="button" className="secondary-btn" onClick={() => void loadData()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button type="button" className="secondary-btn" onClick={() => setBoundsTrigger((value) => value + 1)}>
            <Crosshair size={14} /> Centreaza traseul
          </button>
        </div>
      </div>

      <div className="vehicle-range-toolbar">
        {(["today", "last24h", "last7d", "custom"] as DateRangePreset[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`vehicle-filter-chip ${preset === item ? "active" : ""}`}
            onClick={() => applyPreset(item)}
          >
            {item === "today" ? "Azi" : item === "last24h" ? "Ultimele 24h" : item === "last7d" ? "Ultimele 7 zile" : "Custom"}
          </button>
        ))}

        <input type="datetime-local" value={toDateTimeLocalValue(fromTs)} onChange={(event) => {
          setPreset("custom");
          const parsed = fromDateTimeLocalValue(event.target.value);
          if (parsed) setFromTs(parsed);
        }} />
        <input type="datetime-local" value={toDateTimeLocalValue(toTs)} onChange={(event) => {
          setPreset("custom");
          const parsed = fromDateTimeLocalValue(event.target.value);
          if (parsed) setToTs(parsed);
        }} />

        <label className="vehicle-threshold-label">
          Prag overspeed
          <input
            type="number"
            min={20}
            max={180}
            value={overspeedThreshold}
            onChange={(event) => setOverspeedThreshold(Number(event.target.value || 50))}
          />
        </label>
      </div>

      <div className="vehicle-live-route-card__mapWrap">
        {loading ? (
          <div className="vehicle-live-route-card__empty">Se incarca datele GPS...</div>
        ) : positions.length === 0 && vehicle.gpsSnapshot ? (
          <MapContainer center={[vehicle.gpsSnapshot.lat, vehicle.gpsSnapshot.lng]} zoom={15} className="vehicle-live-route-card__map">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[vehicle.gpsSnapshot.lat, vehicle.gpsSnapshot.lng]} icon={currentIcon}>
              <Popup>Ultima pozitie disponibila: {formatDate(vehicle.gpsSnapshot.gpsTimestamp)}</Popup>
            </Marker>
          </MapContainer>
        ) : positions.length === 0 ? (
          <div className="vehicle-live-route-card__empty">Nu exista traseu sau date suficiente pentru intervalul ales.</div>
        ) : (
          <MapContainer center={[positions[positions.length - 1].lat, positions[positions.length - 1].lng]} zoom={15} scrollWheelZoom className="vehicle-live-route-card__map">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitRouteBounds points={positions} trigger={boundsTrigger} />

            <Pane name="route" style={{ zIndex: 410 }}>
              <Polyline positions={positions.map((item) => [item.lat, item.lng] as [number, number])} pathOptions={{ color: "#2563eb", weight: 5 }} />
            </Pane>

            <Marker position={[routeStats.start!.lat, routeStats.start!.lng]} icon={startIcon}><Popup>Start: {formatDate(routeStats.start!.gpsTimestamp)}</Popup></Marker>
            <Marker position={[routeStats.end!.lat, routeStats.end!.lng]} icon={endIcon}><Popup>Final: {formatDate(routeStats.end!.gpsTimestamp)}</Popup></Marker>
            <Marker position={[routeStats.end!.lat, routeStats.end!.lng]} icon={currentIcon}><Popup>Pozitie curenta</Popup></Marker>

            {stopItems.map((stop) => (
              <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={stopIcon}>
                <Popup>
                  Oprire {formatDuration(stop.durationMs)}<br />
                  {formatDate(stop.start.gpsTimestamp)} - {formatDate(stop.end.gpsTimestamp)}
                </Popup>
              </Marker>
            ))}

            {overspeedItems.map((point) => (
              <Marker key={`overspeed-${point.id}`} position={[point.lat, point.lng]} icon={overspeedIcon}>
                <Popup>Depasire viteza: {point.speedKmh} km/h · {formatDate(point.gpsTimestamp)}</Popup>
              </Marker>
            ))}

            <Pane name="crumbs" style={{ zIndex: 390 }}>
              {positions.map((item) => (
                <CircleMarker key={item.id} center={[item.lat, item.lng]} radius={2.5} pathOptions={{ color: "#60a5fa", fillOpacity: 0.7 }} />
              ))}
            </Pane>
          </MapContainer>
        )}
      </div>

      <div className="vehicle-gps-stats-grid">
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Puncte traseu</span><strong>{positions.length}</strong></div>
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Durata traseu</span><strong>{routeStats.duration}</strong></div>
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Viteza maxima</span><strong>{routeStats.maxSpeed} km/h</strong></div>
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Opriri detectate</span><strong>{stopItems.length}</strong></div>
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Overspeed</span><strong>{overspeedItems.length}</strong></div>
        <div className="vehicle-gps-stat-card"><span className="vehicle-gps-stat-card__label">Evenimente tracker</span><strong>{externalEventsCount}</strong></div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <VehicleGpsStatsCard vehicle={vehicle} />

        <div className="panel vehicle-info-card">
          <h4 className="panel-title">Opriri & overspeed</h4>
          <div className="simple-list">
            {stopItems.slice(0, 6).map((stop) => (
              <div key={stop.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Oprire {formatDuration(stop.durationMs)}</div>
                  <div className="simple-list-subtitle">{formatDate(stop.start.gpsTimestamp)} · {formatCoords(stop.lat, stop.lng)}</div>
                </div>
              </div>
            ))}
            {overspeedItems.slice(0, 6).map((point) => (
              <div key={`list-overspeed-${point.id}`} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Depasire: {point.speedKmh} km/h</div>
                  <div className="simple-list-subtitle">{formatDate(point.gpsTimestamp)} · {formatCoords(point.lat, point.lng)}</div>
                </div>
              </div>
            ))}
            {!stopItems.length && !overspeedItems.length && (
              <div className="simple-list-item"><div className="simple-list-text"><div className="simple-list-label">Nu au fost detectate opriri sau depasiri.</div></div></div>
            )}
          </div>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <VehicleTripTimeline items={timeline} />
        <VehicleControlCard vehicle={vehicle} commands={commands} onRequestCommand={handleRequestCommand} loading={loading} />
      </div>
    </div>
  );
}
