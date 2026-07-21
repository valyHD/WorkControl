import type { VehicleDailyDiagnosticEvent, VehicleLiveDiagnostics } from "../../../types/vehicle";

const NON_ACTIONABLE_EVENT_TYPES = new Set(["high_engine_load"]);

export function getActionableDiagnosticEvents(
  events: VehicleDailyDiagnosticEvent[]
): VehicleDailyDiagnosticEvent[] {
  return events.filter((event) => !NON_ACTIONABLE_EVENT_TYPES.has(event.type));
}

export function readLatestDiagnosticNumber(
  diagnostics: VehicleLiveDiagnostics | null | undefined,
  dailyFallback: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const primary = diagnostics?.obd?.[key];
  const fallback = dailyFallback?.[key];

  for (const value of [primary, fallback]) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

export function hasStoredObdValues(
  diagnostics: VehicleLiveDiagnostics | null | undefined,
  dailyFallback: Record<string, unknown> | null | undefined
): boolean {
  return (
    Object.keys(diagnostics?.obd ?? {}).length > 0 || Object.keys(dailyFallback ?? {}).length > 0
  );
}
