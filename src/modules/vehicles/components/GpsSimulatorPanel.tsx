/**
 * GpsSimulatorPanel
 * Panou GPS vizibil doar pentru emailul autorizat.
 * 
 * IMPORTANT: Toate hooks-urile React sunt la TOP-LEVEL, INAINTE de orice
 * return conditional. Aceasta este regula de aur a React hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigation, Pause, Play, Square, Route, MapPin,
  Clock, Gauge, ChevronDown, ChevronUp, Zap, Trash2, Save, RotateCcw,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import { canUseGpsSimulator, useGpsSimulator } from "../hooks/useGpsSimulator";
import type { VehicleGpsSimulationItem, VehicleItem, VehiclePositionItem } from "../../../types/vehicle";
import {
  clearGpsSimHistoryOnFirestore,
  deleteGpsSimHistoryEntryOnFirestore,
  restoreGpsRouteStateOnFirestore,
  updateGpsSimHistoryDistanceOnFirestore,
  type GpsRouteStateSnapshot,
  type SimulationConfig,
} from "../services/gpsSimulatorService";

const SIMULATION_UI_REFRESH_MS = 3_000;
const MAX_SIM_DISPLAY_SPEED_KMH = 63;
const SIM_DISPLAY_SPEED_SLOT_MS = 20_000;

interface Props {
  vehicle: VehicleItem;
  defaultExpanded?: boolean;
  onSimulationPositionsChange?: (positions: VehiclePositionItem[]) => void;
  onSimulationPlannedPositionsChange?: (positions: VehiclePositionItem[]) => void;
  onSimulationActiveChange?: (active: boolean) => void;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "0 min";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function getSimulationDisplaySpeed(
  speedKmh: number | undefined,
  timestamp: number | undefined,
  startedAt: number | undefined
) {
  if (!timestamp || !startedAt) {
    const fallbackSpeed = Number.isFinite(speedKmh) ? Number(speedKmh) : 0;
    return Math.min(MAX_SIM_DISPLAY_SPEED_KMH, Math.max(0, Math.round(fallbackSpeed)));
  }

  const slot = Math.max(0, Math.floor((timestamp - startedAt) / SIM_DISPLAY_SPEED_SLOT_MS));
  const minDisplaySpeed = 16;
  const maxDisplaySpeed = 62;
  const speedRange = maxDisplaySpeed - minDisplaySpeed + 1;
  const speed = minDisplaySpeed + ((slot * 17 + 43) % speedRange);

  return Math.min(MAX_SIM_DISPLAY_SPEED_KMH, Math.max(0, Math.round(speed)));
}

function formatDateTime(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function getSimulationId(simulation: VehicleGpsSimulationItem, index: number): string {
  return simulation.id || `sim-${simulation.startedAt || index}`;
}

function getSimulationTitle(simulation: VehicleGpsSimulationItem): string {
  const title =
    simulation.destinationDisplay ||
    simulation.destinationQuery ||
    (simulation.endLat && simulation.endLng
       ? `${simulation.endLat.toFixed(5)}, ${simulation.endLng.toFixed(5)}`
      : "");
  return title || "Traseu salvat";
}

function buildLocalRoutePositions(
  vehicle: VehicleItem,
  config: SimulationConfig,
  startedAt: number
): VehiclePositionItem[] {
  const lastIndex = config.route.length - 1;
  const displayImei = vehicle.gpsSnapshot?.imei || vehicle.tracker?.imei || vehicle.id;

  return config.route.map((point, index) => {
    const progress = config.route.length <= 1 ? 0 : index / (config.route.length - 1);
    const timestamp = Math.round(startedAt + progress * config.totalDurationMs);
    const isLast = index === lastIndex;

    return {
      id: `local-route-${startedAt}-${index}`,
      vehicleId: vehicle.id,
      imei: displayImei,
      lat: point.lat,
      lng: point.lng,
      speedKmh: isLast ? 0 : point.speedKmh,
      altitude: 120,
      angle: point.angle,
      satellites: 8,
      gpsTimestamp: timestamp,
      serverTimestamp: timestamp,
      ignitionOn: !isLast,
      odometerKm: Number((config.startOdometerKm + point.distanceFromStartKm).toFixed(2)),
      eventIoId: 0,
    };
  });
}

function getRoutePositionsUntil(
  positions: VehiclePositionItem[],
  startedAt: number,
  elapsedMs: number,
  totalDurationMs: number
) {
  if (!positions.length) return [];

  const safeElapsedMs =
    totalDurationMs > 0
      ? Math.min(Math.max(0, elapsedMs), totalDurationMs)
      : Math.max(0, elapsedMs);
  if (totalDurationMs > 0 && safeElapsedMs >= totalDurationMs) return positions;

  const cutoffTs = startedAt + safeElapsedMs;
  const prefix = positions.filter((point) => point.gpsTimestamp <= cutoffTs);
  return prefix.length ? prefix : [positions[0]!];
}

interface RouteUndoAction {
  id: string;
  label: string;
  snapshot: GpsRouteStateSnapshot;
}

const ROUTE_UNDO_STORAGE_VERSION = "v1";
const ROUTE_UNDO_LIMIT = 5;

function getRouteUndoStorageKey(vehicleId: string) {
  return `workcontrol:gps-sim-route-undo:${ROUTE_UNDO_STORAGE_VERSION}:${vehicleId}`;
}

function normalizeRouteUndoActions(value: unknown): RouteUndoAction[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is RouteUndoAction => {
      if (!item || typeof item !== "object") return false;
      const action = item as RouteUndoAction;
      return (
        typeof action.id === "string" &&
        typeof action.label === "string" &&
        Boolean(action.snapshot) &&
        typeof action.snapshot === "object"
      );
    })
    .slice(-ROUTE_UNDO_LIMIT);
}

function readRouteUndoStack(vehicleId: string): RouteUndoAction[] {
  if (!vehicleId || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getRouteUndoStorageKey(vehicleId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { actions?: unknown };
    return normalizeRouteUndoActions(parsed.actions);
  } catch {
    return [];
  }
}

function writeRouteUndoStack(vehicleId: string, actions: RouteUndoAction[]) {
  if (!vehicleId || typeof window === "undefined") return;

  try {
    const key = getRouteUndoStorageKey(vehicleId);
    const safeActions = normalizeRouteUndoActions(actions);
    if (!safeActions.length) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: ROUTE_UNDO_STORAGE_VERSION,
        actions: safeActions,
      })
    );
  } catch {
    //
  }
}

type SimNumberDraftKey = "customDurationMin" | "snapshotIntervalSec";

export default function GpsSimulatorPanel({
  vehicle,
  defaultExpanded = false,
  onSimulationPositionsChange,
  onSimulationPlannedPositionsChange,
  onSimulationActiveChange,
}: Props) {
  // ============================================================
  // TOATE HOOKS-URILE TREBUIE SA FIE AICI, INAINTE DE ORICE RETURN
  // ============================================================
  const { user } = useAuth();
  const {
    state,
    set,
    planRoute,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    resetSimulation,
  } = useGpsSimulator(vehicle);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [simNow, setSimNow] = useState(() => Date.now());
  const [savingHistoryId, setSavingHistoryId] = useState<string | null>(null);
  const [historyKmDrafts, setHistoryKmDrafts] = useState<Record<string, string>>({});
  const [simNumberDrafts, setSimNumberDrafts] = useState<Partial<Record<SimNumberDraftKey, string>>>({});
  const [undoStack, setUndoStack] = useState<RouteUndoAction[]>(() =>
    readRouteUndoStack(vehicle.id)
  );
  const [undoBusy, setUndoBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUndoStack(readRouteUndoStack(vehicle.id));
  }, [vehicle.id]);

  function getSimNumberValue(field: SimNumberDraftKey, value: number) {
    return simNumberDrafts[field] ?? String(value ?? "");
  }

  function handleSimNumberChange(
    field: SimNumberDraftKey,
    rawValue: string,
    fallback: number,
    min: number,
    max: number
  ) {
    setSimNumberDrafts((prev) => ({ ...prev, [field]: rawValue }));

    if (rawValue.trim() === "") {
      set({ [field]: fallback } as any);
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    set({ [field]: Math.min(max, Math.max(min, parsed)) } as any);
  }

  function commitSimNumber(field: SimNumberDraftKey) {
    setSimNumberDrafts((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const handlePlan = useCallback(async () => {
    const q = state.destinationQuery.trim();
    if (!q) return;
    await planRoute(q);
  }, [state.destinationQuery, planRoute]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") void handlePlan();
    },
    [handlePlan]
  );

  const persistedSimVisible =
    (vehicle.gpsSim?.points?.length ?? 0) > 0 && vehicle.gpsSim?.active !== false;
  const persistedTotalMs =
    vehicle.gpsSim?.totalDurationMs ||
    Math.max(
      0,
      (vehicle.gpsSim?.points?.[vehicle.gpsSim.points.length - 1]?.ts || 0) -
        (vehicle.gpsSim?.startedAt || 0)
    );
  const persistedElapsedMs = (() => {
    if (!persistedSimVisible || !vehicle.gpsSim) return 0;
    const baseElapsed = vehicle.gpsSim.elapsedBeforePauseMs || 0;
    if (vehicle.gpsSim.status === "paused") return Math.min(baseElapsed, persistedTotalMs || baseElapsed);
    const resumedAt = vehicle.gpsSim.resumedAt || vehicle.gpsSim.startedAt || simNow;
    return Math.min(
      baseElapsed + Math.max(0, simNow - resumedAt),
      persistedTotalMs || Number.MAX_SAFE_INTEGER
    );
  })();
  const persistedDone =
    persistedSimVisible && persistedTotalMs > 0 && persistedElapsedMs >= persistedTotalMs;
  const persistedPaused = persistedSimVisible && vehicle.gpsSim?.status === "paused";
  const persistedRunning = persistedSimVisible && !persistedPaused && !persistedDone;
  const persistedProgressRatio =
    persistedSimVisible && persistedTotalMs
       ? Math.min(1, Math.max(0, persistedElapsedMs / persistedTotalMs))
      : 0;
  const persistedPointIndex =
    persistedSimVisible && vehicle.gpsSim?.points?.length
       ? Math.min(
          vehicle.gpsSim.points.length - 1,
          Math.max(0, Math.floor(persistedProgressRatio * (vehicle.gpsSim.points.length - 1)))
        )
      : -1;
  const persistedCurrentPoint =
    persistedPointIndex >= 0 ? vehicle.gpsSim?.points?.[persistedPointIndex] : null;
  const simulationHistory = useMemo(
    () => [...(vehicle.gpsSimHistory ?? [])].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
    [vehicle.gpsSimHistory]
  );
  const realBaseKm = useMemo(
    () => Math.max(vehicle.gpsSnapshot?.odometerKm || 0, vehicle.initialRecordedKm || 0),
    [vehicle.gpsSnapshot?.odometerKm, vehicle.initialRecordedKm]
  );
  const plannedRoutePositions = useMemo(() => {
    if (!state.config) return [];
    return buildLocalRoutePositions(
      vehicle,
      state.config,
      state.localStartedAt || Date.now()
    );
  }, [
    state.config,
    state.localStartedAt,
    vehicle.gpsSnapshot?.imei,
    vehicle.id,
    vehicle.tracker?.imei,
  ]);
  const localRoutePositions = useMemo(() => {
    if (!state.config || !state.localStartedAt) return [];
    return buildLocalRoutePositions(vehicle, state.config, state.localStartedAt);
  }, [
    state.config,
    state.localStartedAt,
    vehicle.gpsSnapshot?.imei,
    vehicle.id,
    vehicle.tracker?.imei,
  ]);
  const localActiveRoutePositions = useMemo(() => {
    if (!state.config || !state.localStartedAt || !localRoutePositions.length) return [];
    if (!["running", "paused"].includes(state.status)) return [];

    const elapsedMs =
      state.status === "paused" && state.progress
        ? state.progress.elapsedMs
        : Math.max(0, simNow - state.localStartedAt);

    return getRoutePositionsUntil(
      localRoutePositions,
      state.localStartedAt,
      elapsedMs,
      state.config.totalDurationMs
    );
  }, [
    localRoutePositions,
    simNow,
    state.config,
    state.localStartedAt,
    state.status,
  ]);
  const localRouteRunning = state.status === "running" && Boolean(state.localStartedAt);

  useEffect(() => {
    setHistoryKmDrafts((current) => {
      const next: Record<string, string> = {};
      simulationHistory.forEach((simulation, index) => {
        const id = getSimulationId(simulation, index);
        next[id] = current[id] ?? String(Number(simulation.totalDistanceKm || 0).toFixed(2));
      });
      return next;
    });
  }, [simulationHistory]);

  useEffect(() => {
    if (!persistedRunning && !localRouteRunning) {
      setSimNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => setSimNow(Date.now()), SIMULATION_UI_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [localRouteRunning, persistedRunning]);

  useEffect(() => {
    onSimulationPlannedPositionsChange?.(
      state.status === "ready" ? plannedRoutePositions : []
    );
  }, [onSimulationPlannedPositionsChange, plannedRoutePositions, state.status]);

  useEffect(() => {
    onSimulationPositionsChange?.(localActiveRoutePositions);
  }, [localActiveRoutePositions, onSimulationPositionsChange]);

  useEffect(() => {
    return () => {
      onSimulationPositionsChange?.([]);
      onSimulationPlannedPositionsChange?.([]);
    };
  }, [onSimulationPlannedPositionsChange, onSimulationPositionsChange]);

  // Notifica parent-ul cand ruta de test este activa.
  useEffect(() => {
    const active =
      persistedRunning ||
      persistedPaused ||
      state.status === "running" ||
      state.status === "paused";
    onSimulationActiveChange?.(active);
  }, [onSimulationActiveChange, persistedPaused, persistedRunning, state.status]);

  useEffect(() => {
    return () => { onSimulationActiveChange?.(false); };
  }, [onSimulationActiveChange]);

  // ============================================================
  // Guard email - DUPA toate hooks-urile
  // ============================================================
  const isAllowed = canUseGpsSimulator(user?.email);

  if (!isAllowed) return null;

  // ============================================================
  // Render
  // ============================================================
  const isBusy = state.status === "geocoding" || state.status === "routing";
  const isRunning = persistedRunning || (state.status === "running" && !persistedDone);
  const isReady = state.status === "ready";
  const isDone = persistedDone || state.status === "done";
  const isPaused = persistedPaused || state.status === "paused";

  const progressPct =
    state.progress && state.progress.totalPoints > 0
       ? Math.round(
          (state.progress.currentPointIndex / state.progress.totalPoints) * 100
        )
      : 0;

  function createRouteSnapshot(): GpsRouteStateSnapshot {
    return {
      gpsSim: vehicle.gpsSim ? { ...vehicle.gpsSim } : null,
      gpsSimHistory: [...(vehicle.gpsSimHistory ?? [])],
      currentKm: vehicle.currentKm || realBaseKm,
    };
  }

  function pushRouteUndo(label: string) {
    const action: RouteUndoAction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label,
      snapshot: createRouteSnapshot(),
    };
    setUndoStack((current) => {
      const next = [...current.slice(-(ROUTE_UNDO_LIMIT - 1)), action];
      writeRouteUndoStack(vehicle.id, next);
      return next;
    });
  }

  async function handleUndoRouteAction() {
    const action = undoStack[undoStack.length - 1];
    if (!action || undoBusy) return;

    setUndoBusy(true);
    try {
      await restoreGpsRouteStateOnFirestore(vehicle.id, action.snapshot);
      resetSimulation();
      onSimulationPositionsChange?.([]);
      onSimulationPlannedPositionsChange?.([]);
      onSimulationActiveChange?.(
        Boolean(
          action.snapshot.gpsSim &&
            action.snapshot.gpsSim.active !== false &&
            (action.snapshot.gpsSim.points?.length ?? 0) > 0
        )
      );
      setUndoStack((current) => {
        const next = current.filter((item) => item.id !== action.id);
        writeRouteUndoStack(vehicle.id, next);
        return next;
      });
    } finally {
      setUndoBusy(false);
    }
  }

  async function handleStartRoute() {
    pushRouteUndo("Traseul pornit.");
    await startSimulation();
  }

  async function handlePauseRoute() {
    pushRouteUndo("Traseul pus pe pauza.");
    await pauseSimulation();
  }

  async function handleResumeRoute() {
    pushRouteUndo("Traseul reluat.");
    await resumeSimulation();
  }

  async function handleStopRoute() {
    pushRouteUndo("Traseul oprit.");
    await stopSimulation();
  }

  async function handleClearSimulationHistory() {
    if (!window.confirm("Stergi toate traseele salvate pentru masina aceasta?")) return;
    setSavingHistoryId("all");
    try {
      pushRouteUndo("Traseele au fost sterse.");
      await clearGpsSimHistoryOnFirestore(vehicle.id, realBaseKm);
      setHistoryKmDrafts({});
    } finally {
      setSavingHistoryId(null);
    }
  }

  async function handleDeleteSimulation(simulationId: string) {
    setSavingHistoryId(simulationId);
    try {
      pushRouteUndo("Traseul a fost sters.");
      await deleteGpsSimHistoryEntryOnFirestore(
        vehicle.id,
        vehicle.gpsSimHistory ?? [],
        simulationId,
        realBaseKm
      );
    } finally {
      setSavingHistoryId(null);
    }
  }

  async function handleSaveSimulationKm(simulationId: string) {
    const parsed = Number(String(historyKmDrafts[simulationId] ?? "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return;

    setSavingHistoryId(simulationId);
    try {
      pushRouteUndo("Km traseu actualizati.");
      await updateGpsSimHistoryDistanceOnFirestore(
        vehicle.id,
        vehicle.gpsSimHistory ?? [],
        simulationId,
        parsed,
        realBaseKm
      );
    } finally {
      setSavingHistoryId(null);
    }
  }

  return (
    <div
      className="gps-sim-panel"
      data-sim-active={isRunning || undefined}
    >
      {/* Header colapsibil */}
      <button
        type="button"
        className="gps-sim-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="gps-sim-header__left">
          <span className="gps-sim-badge">
            <Zap size={10} />
            GPS
          </span>
          <span className="gps-sim-title">Test traseu GPS</span>
          {isRunning && (
            <span className="gps-sim-live-dot" title="Activ" />
          )}
        </div>
        <div className="gps-sim-header__right">
          {isRunning && state.progress && (
            <span className="gps-sim-progress-label">{progressPct}%</span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="gps-sim-body">
          <div className="gps-sim-undo">
            <span>{undoStack[undoStack.length - 1]?.label ?? "Nu ai nicio actiune de anulat."}</span>
            <button
              type="button"
              className="gps-sim-btn gps-sim-btn--primary"
              disabled={!undoStack.length || undoBusy}
              onClick={() => void handleUndoRouteAction()}
            >
              <RotateCcw size={12} /> Undo
            </button>
          </div>

          {/* Bara progres ruta activa */}
          {(isRunning || isPaused || isDone) && (state.progress || persistedSimVisible) && (
            <div className="gps-sim-status-bar">
              <div className="gps-sim-progress-track">
                <div
                  className="gps-sim-progress-fill"
                  style={{
                    width: `${
                      persistedSimVisible && persistedTotalMs
                         ? Math.round((persistedElapsedMs / persistedTotalMs) * 100)
                        : progressPct
                    }%`,
                  }}
                />
              </div>
              <div className="gps-sim-stats">
                <span>
                  <Gauge size={11} />
                  {isPaused || isDone
                    ? 0
                    : getSimulationDisplaySpeed(
                        persistedCurrentPoint?.speedKmh ?? state.progress?.currentSpeedKmh,
                        persistedCurrentPoint?.ts,
                        vehicle.gpsSim?.startedAt
                      )} km/h
                </span>
                <span>
                  <Route size={11} />
                  {persistedSimVisible
                     ? `${((vehicle.gpsSim?.totalDistanceKm || 0) * (persistedTotalMs ? persistedElapsedMs / persistedTotalMs : 0)).toFixed(1)} / ${vehicle.gpsSim?.totalDistanceKm?.toFixed(1) ?? "0.0"} km`
                    : `${state.progress?.distanceCoveredKm.toFixed(1) ?? "0.0"} / ${state.config?.totalDistanceKm.toFixed(1)} km`}
                </span>
                <span>
                  <Clock size={11} />
                  {formatMs(
                    persistedSimVisible
                       ? Math.max(0, persistedTotalMs - persistedElapsedMs)
                      : state.progress?.remainingMs ?? 0
                  )} ramas
                </span>
              </div>
            </div>
          )}

          {isPaused && (
            <div className="gps-sim-done">
              Traseu pe pauza.
            </div>
          )}

          {isDone && (
            <div className="gps-sim-done">
              Traseu finalizat. Masina ramane la destinatie pana apesi Stop.
            </div>
          )}

          {state.error && (
            <div className="gps-sim-error">{state.error}</div>
          )}

          {/* Formular destinatie */}
          {(!persistedSimVisible || persistedDone) && !isRunning && (
            <div className="gps-sim-form">
              <div className="gps-sim-label">
                <MapPin size={12} />
                {persistedDone ? "Continua catre alta destinatie" : "Destinatie"}
              </div>

              <div className="gps-sim-input-row">
                <input
                  ref={inputRef}
                  className="gps-sim-input"
                  type="text"
                  placeholder="Ex: Piata Unirii, Bucuresti"
                  value={state.destinationQuery}
                  onChange={(e) => set({ destinationQuery: e.target.value })}
                  onKeyDown={handleKeyDown}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  className="gps-sim-btn gps-sim-btn--primary"
                  disabled={isBusy || !state.destinationQuery.trim()}
                  onClick={() => void handlePlan()}
                >
                  {isBusy ? (
                    "..."
                  ) : (
                    <>
                      <Navigation size={12} /> Calculeaza
                    </>
                  )}
                </button>
              </div>

              {state.destinationDisplay && (
                <div className="gps-sim-dest-found">
                  <MapPin size={10} />
                  {state.destinationDisplay.length > 80
                     ? state.destinationDisplay.slice(0, 80) + "…"
                    : state.destinationDisplay}
                </div>
              )}

              {/* Optiuni avansate */}
              <div className="gps-sim-options">
                <label className="gps-sim-option-row">
                  <input
                    type="checkbox"
                    checked={state.useCustomDuration}
                    onChange={(e) =>
                      set({ useCustomDuration: e.target.checked })
                    }
                  />
                  <span>Durata personalizata</span>
                </label>

                {state.useCustomDuration && (
                  <div className="gps-sim-option-field">
                    <div className="gps-sim-label">
                      <Clock size={11} /> Durata (minute)
                    </div>
                    <input
                      className="gps-sim-input gps-sim-input--sm"
                      type="number"
                      min={1}
                      max={480}
                      value={getSimNumberValue("customDurationMin", state.customDurationMin)}
                      onChange={(e) => handleSimNumberChange("customDurationMin", e.target.value, 30, 1, 480)}
                      onBlur={() => commitSimNumber("customDurationMin")}
                    />
                  </div>
                )}

                <div className="gps-sim-option-field">
                  <div className="gps-sim-label">
                    <Zap size={11} /> Interval trimitere (sec)
                  </div>
                  <input
                    className="gps-sim-input gps-sim-input--sm"
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={getSimNumberValue("snapshotIntervalSec", state.snapshotIntervalSec)}
                    onChange={(e) => handleSimNumberChange("snapshotIntervalSec", e.target.value, 2, 1, 300)}
                    onBlur={() => commitSimNumber("snapshotIntervalSec")}
                  />
                </div>
              </div>

              {/* Preview ruta calculata */}
              {isReady && state.config && (
                <div className="gps-sim-route-preview">
                  <div className="gps-sim-route-stat">
                    <Route size={12} />
                    <strong>{state.config.totalDistanceKm.toFixed(1)} km</strong>
                    <span>distanta</span>
                  </div>
                  <div className="gps-sim-route-stat">
                    <Clock size={12} />
                    <strong>{formatMs(state.config.totalDurationMs)}</strong>
                    <span>durata</span>
                  </div>
                  <div className="gps-sim-route-stat">
                    <MapPin size={12} />
                    <strong>{state.config.route.length}</strong>
                    <span>puncte GPS</span>
                  </div>
                </div>
              )}

              {isReady && (
                <div className="gps-sim-actions">
                  <button
                    type="button"
                    className="gps-sim-btn gps-sim-btn--go"
                    onClick={() => void handleStartRoute()}
                  >
                    <Play size={13} /> Porneste traseul
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="gps-sim-history">
            <div className="gps-sim-history__head">
              <div>
                <div className="gps-sim-label">
                  <Route size={12} /> Istoric trasee salvate
                </div>
                <div className="gps-sim-history__hint">
                  Modifici doar km din traseele de test; GPS-ul real ramane separat.
                </div>
              </div>
              {simulationHistory.length > 0 && (
                <button
                  type="button"
                  className="gps-sim-btn gps-sim-btn--stop"
                  disabled={savingHistoryId === "all"}
                  onClick={() => void handleClearSimulationHistory()}
                >
                  <Trash2 size={12} /> Sterge tot
                </button>
              )}
            </div>

            {simulationHistory.length === 0 ? (
              <div className="gps-sim-history__empty">Nu exista trasee salvate.</div>
            ) : (
              <div className="gps-sim-history__list">
                {simulationHistory.map((simulation, index) => {
                  const id = getSimulationId(simulation, index);
                  const busy = savingHistoryId === id;

                  return (
                    <div key={id} className="gps-sim-history__item">
                      <div className="gps-sim-history__text">
                        <strong>{getSimulationTitle(simulation)}</strong>
                        <span>
                          {formatDateTime(simulation.startedAt)} · {formatMs(simulation.totalDurationMs || 0)}
                        </span>
                      </div>

                      <div className="gps-sim-history__controls">
                        <label>
                          <span>Km traseu</span>
                          <input
                            className="gps-sim-input gps-sim-input--km"
                            type="number"
                            min={0}
                            step={0.01}
                            value={historyKmDrafts[id] ?? ""}
                            onChange={(event) =>
                              setHistoryKmDrafts((current) => ({
                                ...current,
                                [id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="gps-sim-btn gps-sim-btn--primary"
                          disabled={busy}
                          onClick={() => void handleSaveSimulationKm(id)}
                        >
                          <Save size={12} /> Salveaza
                        </button>
                        <button
                          type="button"
                          className="gps-sim-btn gps-sim-btn--stop"
                          disabled={busy}
                          onClick={() => void handleDeleteSimulation(id)}
                        >
                          <Trash2 size={12} /> Sterge
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Stop / reset */}
          {persistedSimVisible && (
            <div className="gps-sim-actions">
              {persistedPaused ? (
                <button
                  type="button"
                  className="gps-sim-btn gps-sim-btn--go"
                  onClick={() => void handleResumeRoute()}
                >
                  <Play size={13} /> Continua
                </button>
              ) : !persistedDone ? (
                <button
                  type="button"
                  className="gps-sim-btn gps-sim-btn--primary"
                  onClick={() => void handlePauseRoute()}
                >
                  <Pause size={13} /> Pauza
                </button>
              ) : null}
              <button
                type="button"
                className="gps-sim-btn gps-sim-btn--stop"
                onClick={() => void handleStopRoute()}
              >
                <Square size={12} />
                Stop si revino la GPS real
              </button>
            </div>
          )}

          {!persistedSimVisible && (isRunning || isDone) && (
            <div className="gps-sim-actions">
              <button
                type="button"
                className="gps-sim-btn gps-sim-btn--stop"
                onClick={() => void handleStopRoute()}
              >
                <Square size={12} />
                {isDone
                   ? "Inchide traseul"
                  : "Opreste si revino la realitate"}
              </button>
            </div>
          )}

          <div className="gps-sim-disclaimer">
            Panoul este vizibil doar pentru contul autorizat.
          </div>
        </div>
      )}
    </div>
  );
}
