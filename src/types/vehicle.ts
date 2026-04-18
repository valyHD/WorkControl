export const VEHICLE_STATUSES = [
  "activa",
  "in_service",
  "indisponibila",
  "avariata",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export interface VehicleImageItem {
  id: string;
  url: string;
  path: string;
  fileName: string;
  createdAt: number;
  thumbUrl?: string;
  thumbPath?: string;
}

export interface VehicleGpsSnapshot {
  lat: number;
  lng: number;
  speedKmh: number;
  altitude?: number;
  angle?: number;
  satellites?: number;
  gpsTimestamp: number;
  serverTimestamp: number;
  ignitionOn?: boolean;
  odometerKm?: number;
  imei?: string;
  online?: boolean;
}

export interface VehicleTrackerMeta {
  imei?: string;
  lastSeenAt?: number;
  updatedAt?: number;
  protocol?: string;
}

export interface VehiclePositionItem {
  id: string;
  vehicleId: string;
  imei?: string;
  lat: number;
  lng: number;
  speedKmh: number;
  altitude?: number;
  angle?: number;
  satellites?: number;
  gpsTimestamp: number;
  serverTimestamp: number;
  eventIoId?: number;
  ignitionOn?: boolean;
  odometerKm?: number;
  rawIo?: Record<string, unknown>;
}

export type VehicleGeoEventType =
  | "ignition_on"
  | "ignition_off"
  | "moving"
  | "stop"
  | "overspeed"
  | "tracker_event";

export interface VehicleGeoEvent {
  id: string;
  type: VehicleGeoEventType;
  timestamp: number;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface VehicleStopItem {
  id: string;
  start: VehiclePositionItem;
  end: VehiclePositionItem;
  durationMs: number;
  lat: number;
  lng: number;
}

export interface VehicleTrackerEventItem {
  id: string;
  type: string;
  timestamp: number;
  lat?: number;
  lng?: number;
  speedKmh?: number;
  metadata?: Record<string, unknown>;
}

export const VEHICLE_COMMAND_TYPES = [
  "pulse_dout1",
  "allow_start",
  "block_start",
] as const;

export type VehicleCommandType = (typeof VEHICLE_COMMAND_TYPES)[number];

export const VEHICLE_COMMAND_STATUSES = [
  "requested",
  "pending",
  "completed",
  "failed",
] as const;

export type VehicleCommandStatus = (typeof VEHICLE_COMMAND_STATUSES)[number];

export interface VehicleCommandItem {
  id: string;
  type: VehicleCommandType;
  status: VehicleCommandStatus;
  requestedBy: string;
  requestedAt: number;
  completedAt?: number | null;
  providerMessage?: string;
  result?: string;
  durationSec?: number | null;
}

export interface VehicleItem {
  id: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;

  maintenanceNotes: string;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];

  gpsSnapshot?: VehicleGpsSnapshot | null;
  tracker?: VehicleTrackerMeta | null;

  createdAt: number;
  updatedAt: number;
}

export interface VehicleFormValues {
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;

  maintenanceNotes: string;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];
}

export type VehicleEventType =
  | "created"
  | "updated"
  | "driver_changed"
  | "images_updated"
  | "claimed";

export interface VehicleEventItem {
  id: string;
  vehicleId: string;
  type: VehicleEventType;
  message: string;
  createdAt: number;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
}