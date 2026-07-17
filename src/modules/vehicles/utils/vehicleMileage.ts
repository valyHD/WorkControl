export function toVehicleMileageAdjustmentKm(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function applyVehicleMileageAdjustment(
  odometerKm: unknown,
  mileageAdjustmentKm: unknown
): number {
  const numeric = Number(odometerKm);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, numeric + toVehicleMileageAdjustmentKm(mileageAdjustmentKm));
}

export function getTrustedVehicleOdometerKm(
  odometerKm: unknown,
  initialRecordedKm: unknown,
  mileageAdjustmentKm: unknown
): number {
  const adjusted = applyVehicleMileageAdjustment(odometerKm, mileageAdjustmentKm);
  const initial = Number(initialRecordedKm);
  if (Number.isFinite(initial) && initial > 0 && adjusted < initial) return 0;
  return adjusted;
}
