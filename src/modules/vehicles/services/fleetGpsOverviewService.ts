import { httpsCallable } from "firebase/functions";
import {
  DEFAULT_FIRESTORE_COST_CONTROL,
  normalizeFirestoreCostControl,
  type FirestoreCostControlConfig,
} from "../../../config/firestoreCostControl";
import { functions } from "../../../lib/firebase/firebase";
import { recordFirestoreQuery } from "../../../lib/firebase/firestoreQueryTelemetry";
import type { VehicleItem } from "../../../types/vehicle";

export type FleetGpsOverview = {
  config: FirestoreCostControlConfig;
  vehicles: VehicleItem[];
  generatedAtMs: number;
};

type FleetGpsOverviewPollerOptions = {
  load?: () => Promise<FleetGpsOverview>;
  onData: (value: FleetGpsOverview) => void;
  onError?: (error: unknown) => void;
  visibilityDocument?: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
};

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapFleetVehicle(value: unknown): VehicleItem | null {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = String(data.id || "").trim();
  if (!id) return null;

  return {
    id,
    plateNumber: String(data.plateNumber || ""),
    brand: String(data.brand || ""),
    model: String(data.model || ""),
    status: String(data.status || "activa") as VehicleItem["status"],
    currentDriverUserId: String(data.currentDriverUserId || ""),
    currentDriverUserName: String(data.currentDriverUserName || ""),
    currentDriverThemeKey: data.currentDriverThemeKey
      ? String(data.currentDriverThemeKey)
      : null,
    gpsSnapshot:
      data.gpsSnapshot && typeof data.gpsSnapshot === "object"
        ? (data.gpsSnapshot as VehicleItem["gpsSnapshot"])
        : null,
    tracker:
      data.tracker && typeof data.tracker === "object"
        ? (data.tracker as VehicleItem["tracker"])
        : null,
    gpsSim:
      data.gpsSim && typeof data.gpsSim === "object"
        ? (data.gpsSim as VehicleItem["gpsSim"])
        : null,
  } as VehicleItem;
}

export async function getFleetGpsOverview(): Promise<FleetGpsOverview> {
  const started = performance.now();
  const callable = httpsCallable<Record<string, never>, unknown>(functions, "getFleetGpsOverview");
  const result = await callable({});
  const data =
    result.data && typeof result.data === "object"
      ? (result.data as Record<string, unknown>)
      : {};
  const vehicles = Array.isArray(data.vehicles)
    ? data.vehicles.map(mapFleetVehicle).filter((item): item is VehicleItem => Boolean(item))
    : [];
  recordFirestoreQuery({
    module: "fleet",
    operation: "overview",
    documents: vehicles.length,
    durationMs: performance.now() - started,
    reason: "Payload slab cu snapshotul curent al flotei",
  });
  return {
    config: normalizeFirestoreCostControl(data.config),
    vehicles,
    generatedAtMs: finiteNumber(data.generatedAtMs, Date.now()),
  };
}

export function createFleetGpsOverviewPoller(
  options: FleetGpsOverviewPollerOptions
): { start: () => Promise<void>; stop: () => void; refresh: () => Promise<void> } {
  const visibilityDocument =
    options.visibilityDocument ?? (typeof document !== "undefined" ? document : undefined);
  const load = options.load ?? getFleetGpsOverview;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: number | null = null;
  let refreshSeconds = DEFAULT_FIRESTORE_COST_CONTROL.maxFleetSnapshotRefreshSeconds;

  const clearTimer = () => {
    if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
    timer = null;
  };
  const isHidden = () => visibilityDocument?.visibilityState === "hidden";
  const schedule = () => {
    clearTimer();
    if (stopped || isHidden() || typeof window === "undefined") return;
    timer = window.setTimeout(() => void refresh(), refreshSeconds * 1000);
  };
  const refresh = async () => {
    clearTimer();
    if (stopped || isHidden()) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = await load();
        if (stopped) return;
        refreshSeconds = value.config.maxFleetSnapshotRefreshSeconds;
        options.onData(value);
      } catch (error) {
        if (!stopped) options.onError?.(error);
      } finally {
        inFlight = null;
        schedule();
      }
    })();
    return inFlight;
  };
  const handleVisibility = () => {
    if (stopped) return;
    if (isHidden()) clearTimer();
    else void refresh();
  };

  return {
    async start() {
      if (stopped) return;
      visibilityDocument?.addEventListener("visibilitychange", handleVisibility);
      await refresh();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      visibilityDocument?.removeEventListener("visibilitychange", handleVisibility);
    },
    refresh,
  };
}
