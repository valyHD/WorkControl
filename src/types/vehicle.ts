export type VehicleStatus =
  | "activa"
  | "in_service"
  | "indisponibila"
  | "avariata";

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

export type VehicleCommandType = "pulse_dout1" | "allow_start" | "block_start";
export type VehicleCommandStatus = "requested" | "pending" | "completed" | "failed";

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

export interface VehicleEventItem {
  id: string;
  vehicleId: string;
  type:
    | "created"
    | "updated"
    | "driver_changed"
    | "images_updated"
    | "claimed";
  message: string;
  createdAt: number;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
}
