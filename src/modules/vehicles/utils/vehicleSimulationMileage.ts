export const SIMULATION_MILEAGE_REFRESH_MS = 30_000;

export function getSimulationMileageCheckpointElapsedMs(
  elapsedMs: number,
  totalDurationMs: number,
  completed: boolean
) {
  const safeTotal = Math.max(0, Number.isFinite(totalDurationMs) ? totalDurationMs : 0);
  const safeElapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const clampedElapsed = safeTotal > 0 ? Math.min(safeElapsed, safeTotal) : safeElapsed;

  if (completed) return clampedElapsed;
  return Math.floor(clampedElapsed / SIMULATION_MILEAGE_REFRESH_MS) * SIMULATION_MILEAGE_REFRESH_MS;
}

export function calculateSimulationMileageTotals(params: {
  historyTrackedKm: number;
  monitoredFromOdometerKm: number;
  absoluteCurrentKm: number;
  initialRecordedKm: number;
  mileageAdjustmentKm: number;
  activeSimulationDistanceKm: number;
}) {
  const activeDistanceKm = Math.max(0, params.activeSimulationDistanceKm || 0);
  const trackedFromOdometerKm = Math.max(0, params.monitoredFromOdometerKm || 0);
  const historyTrackedKm = Math.max(0, params.historyTrackedKm || 0);

  return {
    totalTrackedKm: Number(
      Math.max(historyTrackedKm, trackedFromOdometerKm + activeDistanceKm).toFixed(2)
    ),
    estimatedCurrentKm: Number(
      Math.max(
        Math.max(0, params.absoluteCurrentKm || 0) + activeDistanceKm,
        Math.max(0, params.initialRecordedKm || 0) +
          historyTrackedKm +
          (params.mileageAdjustmentKm || 0)
      ).toFixed(2)
    ),
  };
}
