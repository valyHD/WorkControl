/**
 * useGpsSimulator
 *
 * Cum functioneaza:
 * 1. La pornire: scrie tot traseul pe vehicles/{id}.gpsSim (un singur updateDoc)
 * 2. Progresul se calculeaza din timp, deci continua si daca pagina este inchisa
 * 3. Pauza/Resume/Stop modifica doar gpsSim, fara sa atinga gpsSnapshot real
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VehicleItem } from '../../../types/vehicle';
import {
  buildSimulationConfig,
  fetchRouteFromOSRM,
  geocodeAddress,
  pauseGpsSimOnFirestore,
  resumeGpsSimOnFirestore,
  startGpsSimOnFirestore,
  stopGpsSimOnFirestore,
  type SimulationConfig,
  type SimulationProgress,
} from '../services/gpsSimulatorService';
import { getLatestVehiclePosition } from '../services/vehiclesService';

export const SIMULATOR_ALLOWED_EMAIL = 'ionut.matura23@gmail.com';

export function canUseGpsSimulator(email?: string | null): boolean {
  return !!email && email.trim().toLowerCase() === SIMULATOR_ALLOWED_EMAIL.toLowerCase();
}

type SimStatus = 'idle' | 'geocoding' | 'routing' | 'ready' | 'running' | 'paused' | 'done' | 'error';

export interface SimulatorState {
  status: SimStatus;
  error: string | null;
  destinationQuery: string;
  destinationDisplay: string;
  config: SimulationConfig | null;
  progress: SimulationProgress | null;
  customDurationMin: number;
  useCustomDuration: boolean;
  snapshotIntervalSec: number;
  localStartedAt: number | null;
}

const INITIAL_STATE: SimulatorState = {
  status: 'idle',
  error: null,
  destinationQuery: '',
  destinationDisplay: '',
  config: null,
  progress: null,
  customDurationMin: 30,
  useCustomDuration: false,
  snapshotIntervalSec: 4,
  localStartedAt: null,
};

function getActiveSimulationElapsedMs(simulation: VehicleItem["gpsSim"], now = Date.now()) {
  if (!simulation || simulation.active === false) return 0;

  const totalDurationMs =
    simulation.totalDurationMs ||
    Math.max(
      0,
      (simulation.points?.[simulation.points.length - 1]?.ts || 0) - (simulation.startedAt || 0)
    );
  const baseElapsed = simulation.elapsedBeforePauseMs || 0;
  if (simulation.status === "paused") {
    return Math.min(baseElapsed, totalDurationMs || baseElapsed);
  }

  const resumedAt = simulation.resumedAt || simulation.startedAt || now;
  return Math.min(
    baseElapsed + Math.max(0, now - resumedAt),
    totalDurationMs || Number.MAX_SAFE_INTEGER
  );
}

function getActiveSimulationCurrentPoint(vehicle: VehicleItem | null, forceRealStart: boolean) {
  if (forceRealStart || !vehicle?.gpsSim || vehicle.gpsSim.active === false) return null;

  const activePoints = vehicle.gpsSim.points ?? [];
  if (!activePoints.length) return null;

  const startedAt = vehicle.gpsSim.startedAt || activePoints[0]?.ts || 0;
  const cutoffTs = startedAt + getActiveSimulationElapsedMs(vehicle.gpsSim);
  let currentPoint = activePoints[0] ?? null;

  for (const point of activePoints) {
    if ((point.ts || 0) > cutoffTs) break;
    currentPoint = point;
  }

  return currentPoint ?? activePoints[activePoints.length - 1] ?? null;
}

function coordinatesStartAt(
  coordinates: Array<[number, number]>,
  lat: number,
  lng: number
): boolean {
  const first = coordinates[0];
  if (!first) return false;
  return Math.abs(first[0] - lat) < 0.00005 && Math.abs(first[1] - lng) < 0.00005;
}

export function useGpsSimulator(vehicle: VehicleItem | null) {
  const [state, setState] = useState<SimulatorState>(INITIAL_STATE);
  const intervalRef = useRef<number | null>(null);
  const pointIndexRef = useRef(0);
  const configRef = useRef<SimulationConfig | null>(null);
  const forceRealStartRef = useRef(false);
  const hadPersistedSimulationRef = useRef(
    Boolean(
      vehicle?.gpsSim &&
        vehicle.gpsSim.active !== false &&
        (vehicle.gpsSim.points?.length ?? 0) > 0
    )
  );

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, []);

  const set = useCallback((partial: Partial<SimulatorState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetSimulation = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    forceRealStartRef.current = true;
    configRef.current = null;
    pointIndexRef.current = 0;
    setState(INITIAL_STATE);
  }, []);

  const persistedSimulationActive = Boolean(
    vehicle?.gpsSim &&
      vehicle.gpsSim.active !== false &&
      (vehicle.gpsSim.points?.length ?? 0) > 0
  );

  useEffect(() => {
    const persistedSimulationStopped =
      hadPersistedSimulationRef.current && !persistedSimulationActive;
    hadPersistedSimulationRef.current = persistedSimulationActive;

    if (persistedSimulationStopped) {
      resetSimulation();
    }
  }, [persistedSimulationActive, resetSimulation]);

  const planRoute = useCallback(async (query: string) => {
    if (!vehicle) return;
    set({ status: 'geocoding', error: null, destinationQuery: query });

    const geo = await geocodeAddress(query);
    if (!geo) {
      set({ status: 'error', error: 'Nu am gasit adresa. Incearca format: "Strada X, Oras".' });
      return;
    }
    set({ destinationDisplay: geo.displayName, status: 'routing' });

    const currentSimulationPoint = getActiveSimulationCurrentPoint(vehicle, forceRealStartRef.current);
    const latestRealPosition = currentSimulationPoint
       ? null
      : await getLatestVehiclePosition(vehicle).catch((error) => {
          console.warn('[gps-route] nu am putut citi ultima pozitie reala, folosesc gpsSnapshot', error);
          return null;
        });
    const startLat = currentSimulationPoint?.lat ?? latestRealPosition?.lat ?? vehicle.gpsSnapshot?.lat ?? 44.4268;
    const startLng = currentSimulationPoint?.lng ?? latestRealPosition?.lng ?? vehicle.gpsSnapshot?.lng ?? 26.1025;
    const startOdometerKm = currentSimulationPoint
       ? Math.max(0, currentSimulationPoint.odometerKm ?? 0)
      : Math.max(
          latestRealPosition?.odometerKm ?? 0,
          vehicle.currentKm ?? 0,
          vehicle.gpsSnapshot?.odometerKm ?? 0
        );

    const route = await fetchRouteFromOSRM(startLat, startLng, geo.lat, geo.lng);
    if (!route) {
      set({ status: 'error', error: 'Nu am putut calcula ruta. Verifica conexiunea.' });
      return;
    }

    setState((prev) => {
      const customDurationMs = prev.useCustomDuration ? prev.customDurationMin * 60 * 1000 : undefined;
      const routeCoordinates = coordinatesStartAt(route.coordinates, startLat, startLng)
         ? route.coordinates
        : [[startLat, startLng] as [number, number], ...route.coordinates];
      const config = buildSimulationConfig(
        vehicle.id, vehicle.plateNumber,
        routeCoordinates, route.distanceKm, route.durationSec,
        startOdometerKm, customDurationMs,
        query,
        geo.displayName,
      );
      configRef.current = config;
      return { ...prev, config, status: 'ready', error: null, progress: null, localStartedAt: null };
    });
  }, [vehicle, set]);

  const startSimulation = useCallback(async () => {
    const config = configRef.current;
    if (!config?.route.length) return;

    forceRealStartRef.current = false;
    pointIndexRef.current = 0;
    const optimisticStartedAt = Date.now();
    const firstPt = config.route[0]!;
    setState((prev) => {
      const totalPoints = config.route.length;
      return {
        ...prev,
        status: 'running' as SimStatus,
        error: null,
        localStartedAt: optimisticStartedAt,
        progress: {
          currentPointIndex: 0, totalPoints,
          currentLat: firstPt.lat, currentLng: firstPt.lng,
          currentSpeedKmh: 0, elapsedMs: 0,
          remainingMs: config.totalDurationMs, distanceCoveredKm: 0,
        },
      };
    });

    try {
      // Scrie tot traseul pe Firestore imediat (un singur write)
      const persistedRoute = await startGpsSimOnFirestore(config);
      const startedAt = persistedRoute.startedAt || Date.now();
      setState((prev) => {
        const totalPoints = config.route.length;
        return {
          ...prev,
          status: 'running' as SimStatus,
          error: null,
          localStartedAt: startedAt,
          progress: {
            currentPointIndex: 0, totalPoints,
            currentLat: firstPt.lat, currentLng: firstPt.lng,
            currentSpeedKmh: 0, elapsedMs: 0,
            remainingMs: config.totalDurationMs, distanceCoveredKm: 0,
          },
        };
      });
    } catch (err) {
      console.error('[gps-route] EROARE start:', err);
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: `Eroare Firestore: ${String(err)}`,
        localStartedAt: null,
        progress: null,
      }));
      return;
    }
  }, []);

  const pauseSimulation = useCallback(async () => {
    if (!vehicle?.gpsSim) return;
    await pauseGpsSimOnFirestore(
      vehicle.id,
      vehicle.gpsSim.totalDurationMs || 0,
      vehicle.gpsSim.resumedAt || vehicle.gpsSim.startedAt || Date.now(),
      vehicle.gpsSim.elapsedBeforePauseMs || 0,
    );
    setState((prev) => ({ ...prev, status: 'paused' }));
  }, [vehicle]);

  const resumeSimulation = useCallback(async () => {
    if (!vehicle?.id) return;
    await resumeGpsSimOnFirestore(vehicle.id);
    setState((prev) => ({ ...prev, status: 'running' }));
  }, [vehicle?.gpsSim, vehicle?.id]);

  const stopSimulation = useCallback(async () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const vehicleId = vehicle?.id || configRef.current?.vehicleId;
    // Clear the optimistic route immediately. Firestore remains the source of truth,
    // but a delayed/lost acknowledgement must not leave the current tab in test mode.
    resetSimulation();
    if (vehicleId) {
      await stopGpsSimOnFirestore(vehicleId);
    }
  }, [resetSimulation, vehicle?.id]);

  return {
    state,
    set,
    planRoute,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    resetSimulation,
  };
}
