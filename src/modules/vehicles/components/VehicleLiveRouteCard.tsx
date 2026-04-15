import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { VehicleItem, VehiclePositionItem } from "../../../types/vehicle";
import { subscribeVehiclePositions } from "../services/vehiclesService";

const defaultMarkerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const startIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--start",
  html: '<span>S</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const stopIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--stop",
  html: '<span>P</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const overspeedIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--overspeed",
  html: '<span>!</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat?: number, lng?: number) {
  if (typeof lat !== "number" || typeof lng !== "number") return "-";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function fitPadding(count: number): [number, number] {
  if (count <= 1) return [40, 40];
  if (count <= 20) return [48, 48];
  return [64, 64];
}

function FitRouteBounds({ positions }: { positions: VehiclePositionItem[] }) {
  const map = useMap();

  useEffect(() => {
    if (!positions.length) return;

    if (positions.length === 1) {
      map.setView([positions[0].lat, positions[0].lng], 16, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(positions.map((item) => [item.lat, item.lng] as [number, number]));
    map.fitBounds(bounds, {
      padding: fitPadding(positions.length),
      animate: true,
      maxZoom: 17,
    });
  }, [map, positions]);

  return null;
}

function buildStopMarkers(positions: VehiclePositionItem[]) {
  const stops: VehiclePositionItem[] = [];
  let lastStopTs = 0;

  for (const item of positions) {
    const isStopped = (item.speedKmh ?? 0) <= 3;
    if (!isStopped) continue;
    if (!lastStopTs || item.gpsTimestamp - lastStopTs > 10 * 60 * 1000) {
      stops.push(item);
      lastStopTs = item.gpsTimestamp;
    }
  }

  return stops;
}

function buildOverspeedMarkers(positions: VehiclePositionItem[], threshold: number) {
  const markers: VehiclePositionItem[] = [];
  let lastTs = 0;

  for (const item of positions) {
    if ((item.speedKmh ?? 0) < threshold) continue;
    if (!lastTs || item.gpsTimestamp - lastTs > 5 * 60 * 1000) {
      markers.push(item);
      lastTs = item.gpsTimestamp;
    }
  }

  return markers;
}

function formatDuration(ms: number) {
  if (!ms || ms < 0) return "0 min";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

function buildStats(positions: VehiclePositionItem[]) {
  if (!positions.length) {
    return {
      totalPoints: 0,
      maxSpeed: 0,
      avgSpeed: 0,
      tripWindow: "-",
      startLabel: "-",
      endLabel: "-",
      lastSeen: "-",
      stopCount: 0,
      overspeedCount: 0,
      routePoints: [] as [number, number][],
      startPoint: null as VehiclePositionItem | null,
      endPoint: null as VehiclePositionItem | null,
      stopMarkers: [] as VehiclePositionItem[],
      overspeedMarkers: [] as VehiclePositionItem[],
    };
  }

  const sorted = [...positions].sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);
  const validSpeeds = sorted.map((item) => item.speedKmh ?? 0).filter((value) => value >= 0);
  const maxSpeed = validSpeeds.length ? Math.max(...validSpeeds) : 0;
  const avgSpeed = validSpeeds.length
    ? Math.round(validSpeeds.reduce((sum, value) => sum + value, 0) / validSpeeds.length)
    : 0;

  const startPoint = sorted[0] ?? null;
  const endPoint = sorted[sorted.length - 1] ?? null;
  const stopMarkers = buildStopMarkers(sorted);
  const overspeedMarkers = buildOverspeedMarkers(sorted, 90);

  return {
    totalPoints: sorted.length,
    maxSpeed,
    avgSpeed,
    tripWindow:
      startPoint && endPoint
        ? formatDuration((endPoint.gpsTimestamp ?? 0) - (startPoint.gpsTimestamp ?? 0))
        : "-",
    startLabel: startPoint ? formatDate(startPoint.gpsTimestamp) : "-",
    endLabel: endPoint ? formatDate(endPoint.gpsTimestamp) : "-",
    lastSeen: endPoint ? formatDate(endPoint.serverTimestamp ?? endPoint.gpsTimestamp) : "-",
    stopCount: stopMarkers.length,
    overspeedCount: overspeedMarkers.length,
    routePoints: sorted.map((item) => [item.lat, item.lng] as [number, number]),
    startPoint,
    endPoint,
    stopMarkers,
    overspeedMarkers,
  };
}

type Props = {
  vehicle: VehicleItem;
};

export default function VehicleLiveRouteCard({ vehicle }: Props) {
  const [positions, setPositions] = useState<VehiclePositionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    setLoading(true);

    const unsubscribe = subscribeVehiclePositions(
      vehicle.id,
      (items) => {
        if (!isMounted.current) return;
        setPositions(items);
        setLoading(false);
      },
      300
    );

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [vehicle.id]);

  const stats = useMemo(() => buildStats(positions), [positions]);
  const mapCenter = useMemo<[number, number]>(() => {
    if (stats.endPoint) return [stats.endPoint.lat, stats.endPoint.lng];
    if (vehicle.gpsSnapshot?.lat && vehicle.gpsSnapshot?.lng) {
      return [vehicle.gpsSnapshot.lat, vehicle.gpsSnapshot.lng];
    }
    return [44.4268, 26.1025];
  }, [stats.endPoint, vehicle.gpsSnapshot]);

  return (
    <div className="panel vehicle-live-route-card">
      <div className="vehicle-live-route-card__header">
        <div>
          <h3 className="panel-title">Harta GPS live + traseu</h3>
          <p className="tools-subtitle">
            Urmaresti pozitia curenta, traseul, opririle si punctele rapide direct din istoricul GPS.
          </p>
        </div>

        <div className="vehicle-gps-live-badges">
          <span className={`vehicle-gps-chip ${vehicle.gpsSnapshot?.online ? "is-online" : "is-offline"}`}>
            {vehicle.gpsSnapshot?.online ? "Online" : "Offline"}
          </span>
          <span className="vehicle-gps-chip">Puncte: {stats.totalPoints}</span>
          <span className="vehicle-gps-chip">Ultima vedere: {stats.lastSeen}</span>
        </div>
      </div>

      <div className="vehicle-live-route-card__mapWrap">
        {loading ? (
          <div className="vehicle-live-route-card__empty">Se incarca traseul GPS...</div>
        ) : !positions.length ? (
          <div className="vehicle-live-route-card__empty">
            Nu exista pozitii GPS valide inca. Dupa ce trackerul prinde semnal si trimite date, traseul va aparea aici.
          </div>
        ) : (
          <MapContainer
            center={mapCenter}
            zoom={15}
            scrollWheelZoom
            className="vehicle-live-route-card__map"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitRouteBounds positions={positions} />

            <Pane name="route" style={{ zIndex: 410 }}>
              <Polyline positions={stats.routePoints} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9 }} />
            </Pane>

            {stats.startPoint && (
              <Marker position={[stats.startPoint.lat, stats.startPoint.lng]} icon={startIcon}>
                <Popup>
                  <strong>Pornire traseu</strong>
                  <br />
                  {formatDate(stats.startPoint.gpsTimestamp)}
                  <br />
                  {formatCoords(stats.startPoint.lat, stats.startPoint.lng)}
                </Popup>
              </Marker>
            )}

            {stats.endPoint && (
              <Marker position={[stats.endPoint.lat, stats.endPoint.lng]} icon={defaultMarkerIcon}>
                <Popup>
                  <strong>Pozitie curenta / ultima pozitie</strong>
                  <br />
                  {formatDate(stats.endPoint.gpsTimestamp)}
                  <br />
                  {formatCoords(stats.endPoint.lat, stats.endPoint.lng)}
                  <br />
                  Viteza: {stats.endPoint.speedKmh ?? 0} km/h
                </Popup>
              </Marker>
            )}

            {stats.stopMarkers.map((item) => (
              <Marker key={`stop-${item.id}`} position={[item.lat, item.lng]} icon={stopIcon}>
                <Popup>
                  <strong>Oprire</strong>
                  <br />
                  {formatDate(item.gpsTimestamp)}
                  <br />
                  {formatCoords(item.lat, item.lng)}
                </Popup>
              </Marker>
            ))}

            {stats.overspeedMarkers.map((item) => (
              <Marker key={`speed-${item.id}`} position={[item.lat, item.lng]} icon={overspeedIcon}>
                <Popup>
                  <strong>Depasire viteza</strong>
                  <br />
                  {formatDate(item.gpsTimestamp)}
                  <br />
                  Viteza: {item.speedKmh ?? 0} km/h
                </Popup>
              </Marker>
            ))}

            {stats.routePoints.length > 2 && (
              <Pane name="crumbs" style={{ zIndex: 390 }}>
                {positions.map((item) => (
                  <CircleMarker
                    key={`crumb-${item.id}`}
                    center={[item.lat, item.lng]}
                    radius={3}
                    pathOptions={{ color: "#60a5fa", fillColor: "#60a5fa", fillOpacity: 0.65 }}
                  />
                ))}
              </Pane>
            )}
          </MapContainer>
        )}
      </div>

      <div className="vehicle-gps-stats-grid">
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Ultima pozitie</span>
          <strong>{formatCoords(vehicle.gpsSnapshot?.lat, vehicle.gpsSnapshot?.lng)}</strong>
        </div>
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Viteza curenta</span>
          <strong>{vehicle.gpsSnapshot?.speedKmh ?? 0} km/h</strong>
        </div>
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Viteza maxima</span>
          <strong>{stats.maxSpeed} km/h</strong>
        </div>
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Viteza medie</span>
          <strong>{stats.avgSpeed} km/h</strong>
        </div>
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Fereastra traseu</span>
          <strong>{stats.tripWindow}</strong>
        </div>
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Ultima actualizare server</span>
          <strong>{formatDate(vehicle.gpsSnapshot?.serverTimestamp)}</strong>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <div className="panel tool-inner-panel">
          <h4 className="panel-title">Detalii GPS</h4>
          <div className="tool-detail-line"><strong>IMEI tracker:</strong> {vehicle.tracker?.imei || "-"}</div>
          <div className="tool-detail-line"><strong>Protocol:</strong> {vehicle.tracker?.protocol || "-"}</div>
          <div className="tool-detail-line"><strong>Ultimul pachet:</strong> {formatDate(vehicle.tracker?.lastSeenAt)}</div>
          <div className="tool-detail-line"><strong>Altitudine:</strong> {vehicle.gpsSnapshot?.altitude ?? 0} m</div>
          <div className="tool-detail-line"><strong>Unghi:</strong> {vehicle.gpsSnapshot?.angle ?? 0}°</div>
          <div className="tool-detail-line"><strong>Sateliti:</strong> {vehicle.gpsSnapshot?.satellites ?? 0}</div>
          <div className="tool-detail-line"><strong>Ignition:</strong> {vehicle.gpsSnapshot?.ignitionOn ? "Pornit" : "Oprit"}</div>
          <div className="tool-detail-line"><strong>Odometru GPS:</strong> {vehicle.gpsSnapshot?.odometerKm ?? 0} km</div>
          <div className="tool-detail-line"><strong>Timestamp GPS:</strong> {formatDate(vehicle.gpsSnapshot?.gpsTimestamp)}</div>
        </div>

        <div className="panel tool-inner-panel">
          <h4 className="panel-title">Evenimente pe harta</h4>
          <div className="tool-detail-line"><strong>Start traseu:</strong> {stats.startLabel}</div>
          <div className="tool-detail-line"><strong>Ultimul punct:</strong> {stats.endLabel}</div>
          <div className="tool-detail-line"><strong>Opriri marcate:</strong> {stats.stopCount}</div>
          <div className="tool-detail-line"><strong>Depasiri viteza:</strong> {stats.overspeedCount}</div>
          <div className="tool-detail-line"><strong>Puncte traseu:</strong> {stats.totalPoints}</div>
          <div className="tool-detail-line"><strong>Google Maps:</strong>{" "}
            {vehicle.gpsSnapshot?.lat && vehicle.gpsSnapshot?.lng ? (
              <a
                href={`https://www.google.com/maps?q=${vehicle.gpsSnapshot.lat},${vehicle.gpsSnapshot.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Deschide pozitia curenta
              </a>
            ) : (
              "-"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
