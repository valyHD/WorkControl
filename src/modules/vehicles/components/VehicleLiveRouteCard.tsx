import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, RefreshCw } from "lucide-react";
import type {
  VehicleCommandItem,
  VehicleGeoEvent,
  VehicleItem,
  VehiclePositionItem,
  VehicleStopItem,
} from "../../../types/vehicle";
import {
  getVehiclePositionsRangeChunked,
  getVehicleTrackerEvents,
  pollVehiclePositionsRange,
  requestVehicleCommand,
  subscribeVehicleCommands,
} from "../services/vehiclesService";
import {
  buildDistanceHistory,
  calculateRouteDurationMs,
  buildTimelineEvents,
  calculateRouteDistanceKm,
  detectOverspeed,
  filterTrackableRoutePositions,
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
import { useAuth } from "../../../providers/AuthProvider";

const DEFAULT_OVERSPEED_THRESHOLD = 140;
const LIVE_REFRESH_MS = 15000;
const ROUTE_PAGE_SIZE = 2000;
const HISTORY_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const ROUTE_RENDER_POINTS = 180;
const ROUTE_ANALYSIS_POINTS = 300;
const CRUMB_POINTS = 24;
const OVERSPEED_RENDER_POINTS = 16;
const STOP_RENDER_LIMIT = 32;
const SIGNATURE_SAMPLE_POINTS = 16;
const HISTORY_INCREMENTAL_OVERLAP_MS = 60_000;

const currentIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--current",
  html: "<span>●</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const startIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--start",
  html: "<span>S</span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const endIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--end",
  html: "<span>F</span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const overspeedIcon = new L.DivIcon({
  className: "vehicle-map-pin vehicle-map-pin--overspeed",
  html: "<span>!</span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function formatDate(ts?: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidCoordPair(lat: unknown, lng: unknown) {
  if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function safeRoutePoints(items: VehiclePositionItem[]) {
  const clean = sanitizePositions(items).filter(
    (item) =>
      isFiniteCoord(item.lat) &&
      isFiniteCoord(item.lng) &&
      Math.abs(item.lat) <= 90 &&
      Math.abs(item.lng) <= 180
  );

  const deduped: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of clean) {
    const key = `${item.gpsTimestamp}_${item.lat}_${item.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function mergeHistoryRoutePoints(
  currentItems: VehiclePositionItem[],
  incomingItems: VehiclePositionItem[],
  minTimestamp: number
) {
  const merged = safeRoutePoints([...currentItems, ...incomingItems]).filter(
    (item) => item.gpsTimestamp >= minTimestamp
  );
  return merged;
}

function buildPositionsSignature(items: VehiclePositionItem[]) {
  if (!items.length) return "0";
  const first = items[0];
  const last = items[items.length - 1];
  const step = Math.max(1, Math.floor(items.length / SIGNATURE_SAMPLE_POINTS));

  let checksum = 0;
  for (let i = 0; i < items.length; i += step) {
    const item = items[i];
    checksum +=
      Math.round(item.lat * 1000) +
      Math.round(item.lng * 1000) +
      (item.speedKmh ?? 0) +
      (item.gpsTimestamp % 10000);
  }

  return `${items.length}:${first.gpsTimestamp}:${last.gpsTimestamp}:${checksum}`;
}

function FitRouteBounds({
  points,
  trigger,
}: {
  points: VehiclePositionItem[];
  trigger: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !points.length) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;

      try {
        const container = map.getContainer();
        if (!container || !container.isConnected) return;

        map.stop();
        map.invalidateSize(false);

        if (points.length === 1) {
          map.setView([points[0].lat, points[0].lng], 15, { animate: false });
          return;
        }

        const validLatLngs = points
          .map((item) => [item.lat, item.lng] as [number, number])
          .filter(
            ([lat, lng]) =>
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              Math.abs(lat) <= 90 &&
              Math.abs(lng) <= 180
          );

        if (!validLatLngs.length) return;

        const bounds = L.latLngBounds(validLatLngs);
        if (!bounds.isValid()) return;

        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 17,
          animate: false,
        });
      } catch (error) {
        console.error("[FitRouteBounds error]", error);
      }
    };

    const timer = window.setTimeout(run, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try {
        map.stop();
      } catch {
        //
      }
    };
  }, [map, trigger, points]);

  return null;
}

type Props = {
  vehicle: VehicleItem;
  showControlCard?: boolean;
  onKmEstimateChange?: (km: number) => void;
};

export default function VehicleLiveRouteCard({
  vehicle,
  showControlCard = true,
  onKmEstimateChange,
}: Props) {
  const { user } = useAuth();
  const authReady = true;

  const [preset, setPreset] = useState<DateRangePreset>("today");
  const initialRange = getPresetRange("today");
  const [fromTs, setFromTs] = useState<number>(initialRange.from);
  const [toTs, setToTs] = useState<number>(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<VehiclePositionItem[]>([]);
  const [stopItems, setStopItems] = useState<VehicleStopItem[]>([]);
  const [overspeedThreshold, setOverspeedThreshold] = useState<number>(
    DEFAULT_OVERSPEED_THRESHOLD
  );
  const [overspeedItems, setOverspeedItems] = useState<VehiclePositionItem[]>([]);
  const [timeline, setTimeline] = useState<VehicleGeoEvent[]>([]);
  const [externalEventsCount, setExternalEventsCount] = useState(0);
  const [commands, setCommands] = useState<VehicleCommandItem[]>([]);
  const [boundsTrigger, setBoundsTrigger] = useState(0);
  const [historyPositions, setHistoryPositions] = useState<VehiclePositionItem[]>([]);
  const [didInitialFit, setDidInitialFit] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const routeSignatureRef = useRef("");
  const historySignatureRef = useRef("");
  const historyPositionsRef = useRef<VehiclePositionItem[]>([]);
  const hasSnapshot = isValidCoordPair(vehicle.gpsSnapshot?.lat, vehicle.gpsSnapshot?.lng);
  async function loadMeta() {
    if (!authReady || !user) return;

    try {
      const extEvents = await getVehicleTrackerEvents(vehicle.id, fromTs, toTs).catch(() => []);

      if (!mountedRef.current) return;
      setExternalEventsCount(extEvents.length);
    } catch (error) {
      console.error("[VehicleLiveRouteCard][loadMeta]", error);
      if (!mountedRef.current) return;
      setExternalEventsCount(0);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    historyPositionsRef.current = historyPositions;
  }, [historyPositions]);

  useEffect(() => {
    const updateOnlineState = () => {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (!mountedRef.current) return;
      setIsOffline(offline);
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!vehicle.id) {
      setCommands([]);
      return;
    }

    const unsubscribe = subscribeVehicleCommands(vehicle.id, (items) => {
      if (!mountedRef.current) return;
      setCommands(items);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error("[VehicleLiveRouteCard][unsubscribeCommands]", error);
      }
    };
  }, [vehicle.id]);

  useEffect(() => {
    setDidInitialFit(false);
  }, [fromTs, toTs, vehicle.id]);

  useEffect(() => {
    if (!authReady) {
      setLoading(true);
      return;
    }

    if (!user) {
      setLoading(false);
      setPositions([]);
      setStopItems([]);
      setOverspeedItems([]);
      setTimeline([]);
      return;
    }

    if (!routeSignatureRef.current && !hasSnapshot) {
      setLoading(true);
    }

    const loadingGuard = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setLoading(false);
    }, 8000);

    const unsubscribe = pollVehiclePositionsRange(
      vehicle.id,
      fromTs,
      toTs,
      (route) => {
        const clean = safeRoutePoints(filterTrackableRoutePositions(route));
        const nextSignature = buildPositionsSignature(clean);

        if (!mountedRef.current) return;

        if (routeSignatureRef.current === nextSignature) {
          setLastDataAt(Date.now());
          setLoading(false);
          return;
        }

        routeSignatureRef.current = nextSignature;
        setPositions(clean);
        setLastDataAt(Date.now());
        setLoading(false);

        console.log("[VehicleLiveRouteCard][route loaded]", {
          vehicleId: vehicle.id,
          fromTs,
          toTs,
          points: clean.length,
        });
      },
      (error) => {
        console.error("[VehicleLiveRouteCard][pollRange]", error);
        if (!mountedRef.current) return;
        setLoading(false);
        setIsOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
      },
      LIVE_REFRESH_MS,
      ROUTE_PAGE_SIZE
    );

    return () => {
      window.clearTimeout(loadingGuard);
      try {
        unsubscribe?.();
      } catch (error) {
        console.error("[VehicleLiveRouteCard][unsubscribeRange]", error);
      }
    };
  }, [authReady, user, vehicle.id, fromTs, toTs, hasSnapshot]);
  useEffect(() => {
    if (!authReady || !user) return;
    void loadMeta();
  }, [authReady, user, vehicle.id, fromTs, toTs]);

  useEffect(() => {
    const refreshWindow = () => {
      if (preset === "custom") return;
      const range = getPresetRange(preset);
      setFromTs(range.from);
      setToTs(range.to);
    };

    refreshWindow();

    const interval = window.setInterval(refreshWindow, LIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [preset]);

  useEffect(() => {
    let interval: number | null = null;

    async function loadHistory() {
      if (!authReady || !user) return;

      try {
        const now = Date.now();
        const fromHistory = now - HISTORY_WINDOW_MS;
        const currentHistory = historyPositionsRef.current;
        const hasHistory = historySignatureRef.current.length > 0 && currentHistory.length > 0;
        const lastPointTs = hasHistory
          ? currentHistory[currentHistory.length - 1]?.gpsTimestamp ?? fromHistory
          : fromHistory;
        const fromTsIncremental = Math.max(
          fromHistory,
          lastPointTs - HISTORY_INCREMENTAL_OVERLAP_MS
        );

        const route = await getVehiclePositionsRangeChunked(
          vehicle.id,
          hasHistory ? fromTsIncremental : fromHistory,
          now,
          ROUTE_PAGE_SIZE
        ).catch(() => []);

        if (!mountedRef.current) return;
        const normalizedIncoming = filterTrackableRoutePositions(route);
        const normalizedHistory = hasHistory
          ? mergeHistoryRoutePoints(currentHistory, normalizedIncoming, fromHistory)
          : safeRoutePoints(normalizedIncoming);
        const signature = buildPositionsSignature(normalizedHistory);
        if (historySignatureRef.current === signature) return;
        historySignatureRef.current = signature;
        setHistoryPositions(normalizedHistory);
      } catch (error) {
        console.error("[VehicleLiveRouteCard][loadHistory]", error);
        if (!mountedRef.current) return;
        setHistoryPositions([]);
      }
    }

    void loadHistory();

    interval = window.setInterval(() => {
      void loadHistory();
    }, 60_000);

    return () => {
      if (interval !== null) window.clearInterval(interval);
    };
  }, [authReady, user, vehicle.id]);

  const deferredPositions = useDeferredValue(positions);

  const analysisPoints = useMemo(
    () => samplePositions(deferredPositions, ROUTE_ANALYSIS_POINTS),
    [deferredPositions]
  );

  useEffect(() => {
    const stops = detectStops(analysisPoints);
    const overspeed = detectOverspeed(analysisPoints, overspeedThreshold);
    setStopItems(stops);
    setOverspeedItems(overspeed);
    setTimeline(buildTimelineEvents(analysisPoints, stops, overspeed));
  }, [analysisPoints, overspeedThreshold]);

  useEffect(() => {
    if (!didInitialFit && positions.length > 0) {
      setBoundsTrigger((value) => value + 1);
      setDidInitialFit(true);
    }
  }, [positions.length, didInitialFit]);

  const routeStats = useMemo(() => {
    const start = positions[0] ?? null;
    const end = positions[positions.length - 1] ?? null;
    let maxSpeed = 0;
    for (const item of positions) {
      const speed = item.speedKmh ?? 0;
      if (speed > maxSpeed) maxSpeed = speed;
    }
    const distanceKm = calculateRouteDistanceKm(positions);

    const durationMs = calculateRouteDurationMs(positions);

    return {
      start,
      end,
      maxSpeed,
      distanceKm,
      duration: formatDuration(durationMs),
    };
  }, [positions]);

  const historyStats = useMemo(() => {
    const source = historyPositions.length ? historyPositions : positions;
    const normalized = samplePositions(filterTrackableRoutePositions(source), 5000);
    const dayBuckets = buildDistanceHistory(normalized, "day");
    const weekBuckets = buildDistanceHistory(normalized, "week");
    const monthBuckets = buildDistanceHistory(normalized, "month");

    const nowDate = new Date();
    const todayKey = `${nowDate.getFullYear()}-${String(
      nowDate.getMonth() + 1
    ).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;

    const todayKm = dayBuckets.find((item) => item.id === todayKey)?.distanceKm ?? 0;
    const totalTrackedKm = calculateRouteDistanceKm(positions);
    const estimatedCurrentKm = Number(
      Math.max(
        vehicle.currentKm || 0,
        vehicle.gpsSnapshot?.odometerKm || 0,
        (vehicle.initialRecordedKm || 0) + totalTrackedKm
      ).toFixed(2)
    );

    return {
      todayKm,
      totalTrackedKm: Number(totalTrackedKm.toFixed(2)),
      estimatedCurrentKm,
      dayBuckets,
      weekBuckets,
      monthBuckets,
    };
  }, [historyPositions, positions, vehicle.currentKm, vehicle.gpsSnapshot?.odometerKm, vehicle.initialRecordedKm]);

  useEffect(() => {
    if (!onKmEstimateChange) return;
    onKmEstimateChange(historyStats.estimatedCurrentKm);
  }, [historyStats.estimatedCurrentKm, onKmEstimateChange]);

  const routeRenderPositions = useMemo(
    () => samplePositions(deferredPositions, ROUTE_RENDER_POINTS),
    [deferredPositions]
  );

  const routePolyline = useMemo(
    () => routeRenderPositions.map((item) => [item.lat, item.lng] as [number, number]),
    [routeRenderPositions]
  );

  const renderedOverspeedItems = useMemo(
    () => samplePositions(overspeedItems, OVERSPEED_RENDER_POINTS),
    [overspeedItems]
  );

  const renderedStopItems = useMemo(() => {
    if (stopItems.length <= STOP_RENDER_LIMIT) return stopItems;
    const stride = Math.ceil(stopItems.length / STOP_RENDER_LIMIT);
    return stopItems.filter((_, index) => index % stride === 0);
  }, [stopItems]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (routeStats.end && isValidCoordPair(routeStats.end.lat, routeStats.end.lng)) {
      return [routeStats.end.lat, routeStats.end.lng];
    }
    const snapshot = vehicle.gpsSnapshot;
    if (snapshot && isValidCoordPair(snapshot.lat, snapshot.lng)) {
      return [snapshot.lat, snapshot.lng];
    }
    return [44.4268, 26.1025];
  }, [routeStats.end, vehicle.gpsSnapshot?.lat, vehicle.gpsSnapshot?.lng]);

  function applyPreset(nextPreset: DateRangePreset) {
    setPreset(nextPreset);

    if (nextPreset === "custom") return;

    const range = getPresetRange(nextPreset);
    setFromTs(range.from);
    setToTs(range.to);
  }

  function updateCustomRange(nextFrom: number, nextTo: number) {
    if (nextFrom >= nextTo) return;
    const maxRangeMs = 31 * 24 * 60 * 60 * 1000;
    if (nextTo - nextFrom > maxRangeMs) return;
    setFromTs(nextFrom);
    setToTs(nextTo);
  }

  async function handleRequestCommand(type: "pulse_dout1" | "block_start") {
    if (!user) return;

    await requestVehicleCommand(vehicle.id, {
      type,
      requestedBy:
        user.displayName ||
        user.email ||
        vehicle.currentDriverUserName ||
        vehicle.ownerUserName ||
        "dashboard_user",
      durationSec: type === "pulse_dout1" ? 60 : null,
    });
  }

  const crumbPositions = useMemo(
    () => samplePositions(deferredPositions, CRUMB_POINTS),
    [deferredPositions]
  );

  return (
    <div className="panel vehicle-live-route-card">
      <div className="vehicle-live-route-card__header">
        <div>
          <h3 className="panel-title">Harta mare live</h3>
          <p className="tools-subtitle">
            Traseu complet, stopuri, overspeed, timeline si control vehicul.
          </p>
        </div>

        <div className="vehicle-live-route-card__actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void loadMeta()}
            disabled={!authReady || !user}
          >
            <RefreshCw size={14} /> Refresh
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={() => setBoundsTrigger((value) => value + 1)}
            disabled={!positions.length}
          >
            <Crosshair size={14} /> Centreaza traseul
          </button>
        </div>
      </div>

      <div className="vehicle-range-toolbar">
        {(["today", "last24h", "last3d", "last7d", "custom"] as DateRangePreset[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`vehicle-filter-chip ${preset === item ? "active" : ""}`}
            onClick={() => applyPreset(item)}
          >
            {item === "today"
              ? "Azi"
              : item === "last24h"
                ? "Ultimele 24h"
                : item === "last3d"
                  ? "Ultimele 3 zile"
                : item === "last7d"
                  ? "Ultimele 7 zile"
                  : "Custom"}
          </button>
        ))}

        <input
          type="datetime-local"
          value={toDateTimeLocalValue(fromTs)}
          onChange={(event) => {
            setPreset("custom");
            const parsed = fromDateTimeLocalValue(event.target.value);
            if (parsed) updateCustomRange(parsed, toTs);
          }}
        />

        <input
          type="datetime-local"
          value={toDateTimeLocalValue(toTs)}
          onChange={(event) => {
            setPreset("custom");
            const parsed = fromDateTimeLocalValue(event.target.value);
            if (parsed) updateCustomRange(fromTs, parsed);
          }}
        />

        <label className="vehicle-threshold-label">
          Prag overspeed
          <input
            type="number"
            min={20}
            max={220}
            step={5}
            value={overspeedThreshold}
            onChange={(event) => {
              const next = Number(event.target.value || DEFAULT_OVERSPEED_THRESHOLD);
              setOverspeedThreshold(
                Number.isFinite(next)
                  ? Math.min(220, Math.max(20, next))
                  : DEFAULT_OVERSPEED_THRESHOLD
              );
            }}
          />
          <span className="tools-subtitle" style={{ marginLeft: 8 }}>
            implicit 140 km/h
          </span>
        </label>
      </div>

      <div className="vehicle-live-route-card__mapWrap">
        <MapContainer
          center={mapCenter}
          zoom={13}
          scrollWheelZoom
          preferCanvas
          className="vehicle-live-route-card__map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            updateWhenIdle
            keepBuffer={1}
          />

          {routeRenderPositions.length > 0 && (
            <FitRouteBounds points={routeRenderPositions} trigger={boundsTrigger} />
          )}

          {positions.length > 0 ? (
            <>
              <Pane name="route" style={{ zIndex: 410 }}>
                <Polyline
                  positions={routePolyline}
                  pathOptions={{ color: "#2563eb", weight: 5 }}
                />
              </Pane>

              {routeStats.start && (
                <Marker position={[routeStats.start.lat, routeStats.start.lng]} icon={startIcon}>
                  <Popup>Start: {formatDate(routeStats.start.gpsTimestamp)}</Popup>
                </Marker>
              )}

              {routeStats.end && (
                <>
                  <Marker position={[routeStats.end.lat, routeStats.end.lng]} icon={endIcon}>
                    <Popup>Final: {formatDate(routeStats.end.gpsTimestamp)}</Popup>
                  </Marker>

                  <Marker position={[routeStats.end.lat, routeStats.end.lng]} icon={currentIcon}>
                    <Popup>Pozitie curenta</Popup>
                  </Marker>
                </>
              )}

              {renderedStopItems.map((stop) => (
                <CircleMarker
                  key={stop.id}
                  center={[stop.lat, stop.lng]}
                  radius={7}
                  pathOptions={{
                    color: "#dc2626",
                    fillColor: "#ef4444",
                    fillOpacity: 0.85,
                    weight: 2,
                  }}
                >
                  <Popup>
                    Oprire {formatDuration(stop.durationMs)}
                    <br />
                    {formatDate(stop.start.gpsTimestamp)} - {formatDate(stop.end.gpsTimestamp)}
                  </Popup>
                </CircleMarker>
              ))}

              {renderedOverspeedItems.map((point) => (
                <Marker
                  key={`overspeed-${point.id || point.gpsTimestamp}`}
                  position={[point.lat, point.lng]}
                  icon={overspeedIcon}
                >
                  <Popup>
                    Depasire viteza: {point.speedKmh} km/h · {formatDate(point.gpsTimestamp)}
                  </Popup>
                </Marker>
              ))}

              <Pane name="crumbs" style={{ zIndex: 390 }}>
                {crumbPositions.map((item) => (
                  <CircleMarker
                    key={`crumb-${item.id || item.gpsTimestamp}`}
                    center={[item.lat, item.lng]}
                    radius={2.5}
                    pathOptions={{
                      color: "#60a5fa",
                      fillOpacity: 0.7,
                    }}
                  />
                ))}
              </Pane>
            </>
          ) : hasSnapshot ? (
            <Marker
              position={[
                vehicle.gpsSnapshot?.lat ?? mapCenter[0],
                vehicle.gpsSnapshot?.lng ?? mapCenter[1],
              ]}
              icon={currentIcon}
            >
              <Popup>
                Ultima pozitie disponibila: {formatDate(vehicle.gpsSnapshot?.gpsTimestamp)}
              </Popup>
            </Marker>
          ) : null}
        </MapContainer>

        {!authReady ? (
          <div className="vehicle-live-route-card__empty">
            Se initializeaza autentificarea...
          </div>
        ) : isOffline ? (
          <div className="vehicle-live-route-card__empty">
            Fara internet momentan. Pastram ultima ruta vizibila si reluam automat cand revine netul.
            {lastDataAt ? ` Ultima sincronizare: ${formatDate(lastDataAt)}.` : ""}
          </div>
        ) : loading && positions.length === 0 && !hasSnapshot ? (
          <div className="vehicle-live-route-card__empty">Se incarca datele GPS...</div>
        ) : !loading && positions.length === 0 && !hasSnapshot ? (
          <div className="vehicle-live-route-card__empty">
            Nu exista traseu sau date suficiente pentru intervalul ales.
          </div>
        ) : null}
      </div>

      <div className="vehicle-gps-stats-grid">
        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km perioada selectata</span>
          <strong>{routeStats.distanceKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km azi</span>
          <strong>{historyStats.todayKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km total monitorizat</span>
          <strong>{historyStats.totalTrackedKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Km total estimat masina</span>
          <strong>{historyStats.estimatedCurrentKm.toFixed(2)} km</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Puncte traseu</span>
          <strong>{positions.length}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Durata traseu</span>
          <strong>{routeStats.duration}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Viteza maxima</span>
          <strong>{routeStats.maxSpeed} km/h</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Opriri detectate</span>
          <strong>{stopItems.length}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Overspeed</span>
          <strong>{overspeedItems.length}</strong>
        </div>

        <div className="vehicle-gps-stat-card">
          <span className="vehicle-gps-stat-card__label">Evenimente tracker</span>
          <strong>{externalEventsCount}</strong>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <div className="panel vehicle-info-card">
          <h4 className="panel-title">Istoric km pe zile</h4>
          <div className="simple-list">
            {historyStats.dayBuckets.slice(0, 8).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {!historyStats.dayBuckets.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu exista date de istoric disponibile.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel vehicle-info-card">
          <h4 className="panel-title">Istoric km pe saptamani / luni</h4>
          <div className="simple-list">
            {historyStats.weekBuckets.slice(0, 4).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Saptamana: {item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {historyStats.monthBuckets.slice(0, 4).map((item) => (
              <div key={item.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Luna: {item.label}</div>
                  <div className="simple-list-subtitle">{item.distanceKm.toFixed(2)} km</div>
                </div>
              </div>
            ))}

            {!historyStats.weekBuckets.length && !historyStats.monthBuckets.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu exista date de istoric disponibile.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <VehicleGpsStatsCard
          vehicle={vehicle}
          odometerKmOverride={historyStats.estimatedCurrentKm}
        />

        <div className="panel vehicle-info-card">
          <h4 className="panel-title">Opriri & overspeed</h4>
          <div className="simple-list">
            {stopItems.slice(0, 6).map((stop) => (
              <div key={stop.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Oprire {formatDuration(stop.durationMs)}
                  </div>
                  <div className="simple-list-subtitle">
                    {formatDate(stop.start.gpsTimestamp)} · {formatCoords(stop.lat, stop.lng)}
                  </div>
                </div>
              </div>
            ))}

            {overspeedItems.slice(0, 6).map((point) => (
              <div
                key={`list-overspeed-${point.id || point.gpsTimestamp}`}
                className="simple-list-item"
              >
                <div className="simple-list-text">
                  <div className="simple-list-label">Depasire: {point.speedKmh} km/h</div>
                  <div className="simple-list-subtitle">
                    {formatDate(point.gpsTimestamp)} · {formatCoords(point.lat, point.lng)}
                  </div>
                </div>
              </div>
            ))}

            {!stopItems.length && !overspeedItems.length && (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    Nu au fost detectate opriri sau depasiri.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vehicle-gps-detail-grid">
        <VehicleTripTimeline items={timeline} />

        {showControlCard ? (
          <VehicleControlCard
            vehicle={vehicle}
            commands={commands}
            onRequestCommand={handleRequestCommand}
            loading={loading}
          />
        ) : (
          <div className="panel vehicle-info-card">
            <h4 className="panel-title">Control vehicul mutat sus</h4>
            <p className="tools-subtitle">
              Comenzile DOUT1 au fost mutate deasupra sectiunii „Date generale”.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
