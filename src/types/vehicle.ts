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


export const VEHICLE_DOCUMENT_CATEGORIES = [
  "service",
  "itp",
  "rca",
  "casco",
  "leasing_rate",
  "rovinieta",
  "amenda",
  "other",
] as const;

export type VehicleDocumentCategory = (typeof VEHICLE_DOCUMENT_CATEGORIES)[number];

export type VehicleDocumentIntelligenceStatus =
  | "queued"
  | "processing"
  | "needs_review"
  | "applied"
  | "rejected"
  | "failed";

export interface VehicleDocumentAnalysisField {
  value: string;
  confidence: number;
  validationErrors?: string[];
}

export interface VehicleDocumentExtractionResult {
  documentType: VehicleDocumentAnalysisField;
  expiryDate: VehicleDocumentAnalysisField;
  issueDate: VehicleDocumentAnalysisField;
  policyNumber: VehicleDocumentAnalysisField;
  providerName: VehicleDocumentAnalysisField;
  vehiclePlateNumber: VehicleDocumentAnalysisField;
  notes: string;
}

export interface VehicleDocumentIngestionJob {
  jobId: string;
  status: VehicleDocumentIntelligenceStatus;
  result: VehicleDocumentExtractionResult | null;
  model?: string;
  extractionVersion?: string;
  attempts: number;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  decision?: "applied" | "rejected" | "rolled_back" | "";
}

export interface VehicleDocumentItem {
  id: string;
  name: string;
  url: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  extension: string;
  category: VehicleDocumentCategory;
  expiryDate?: string;
  expirySource?: "manual" | "ai_confirmed" | "";
  intelligenceJobId?: string;
  intelligenceStatus?: VehicleDocumentIntelligenceStatus;
  intelligenceReviewedAt?: number;
  intelligenceReviewedByUserId?: string;
  aiAnalysis?: {
    documentType?: VehicleDocumentCategory | "unknown";
    expiryDate?: string;
    issueDate?: string;
    policyNumber?: string;
    providerName?: string;
    vehiclePlateNumber?: string;
    confidence?: number;
    fieldConfidence?: Partial<Record<
      "documentType" | "expiryDate" | "issueDate" | "policyNumber" | "providerName" | "vehiclePlateNumber",
      number
    >>;
    notes?: string;
    analyzedAt?: number;
  };
  createdAt: number;
}

export interface VehicleGpsSnapshot {
  lat: number;
  lng: number;
  speedKmh?: number;
  altitude?: number;
  angle?: number;
  satellites?: number;
  gpsTimestamp: number;
  serverTimestamp: number;
  expiresAt?: number;
  ignitionOn?: boolean;
  odometerKm?: number;
  tripOdometerKm?: number;
  imei?: string;
  online?: boolean;
  rawIo?: Record<string, unknown>;
}

export interface VehicleTrackerMeta {
  imei?: string;
  lastSeenAt?: number;
  updatedAt?: number;
  protocol?: string;
}

export interface VehicleGpsDataUsagePeriod {
  rxBytes?: number;
  txBytes?: number;
  totalBytes?: number;
  recordsCount?: number;
  frameCount?: number;
  lastRxBytes?: number;
  lastTxBytes?: number;
  lastTotalBytes?: number;
  updatedAt?: number;
}

export interface VehicleGpsDataUsage extends VehicleGpsDataUsagePeriod {
  currentMonthKey?: string;
  months?: Record<string, VehicleGpsDataUsagePeriod>;
}

export type VehicleLiveIoGroup =
  | "gps"
  | "obd"
  | "power"
  | "connectivity"
  | "input_output"
  | "bluetooth"
  | "system"
  | "unknown";

export interface VehicleLiveIoItem {
  id: number;
  key: string;
  label: string;
  group: VehicleLiveIoGroup;
  value: string | number | boolean | null;
  rawValue: unknown;
  displayValue: string;
  unit?: string;
  description?: string;
}

export interface VehicleLiveDiagnosticsGps {
  lat: number;
  lng: number;
  speedKmh?: number;
  altitude?: number;
  angle?: number;
  satellites?: number;
}

export interface VehicleLiveDiagnostics {
  source?: string;
  imei?: string;
  protocol?: string;
  online?: boolean;
  recordTimestamp?: number;
  serverTimestamp?: number;
  expiresAt?: number;
  eventIoId?: number;
  totalIo?: number;
  priority?: number;
  bluetoothObdConnected?: boolean | null;
  obdConnected?: boolean | null;
  gps?: VehicleLiveDiagnosticsGps;
  obd?: Record<string, unknown>;
  decodedIo?: VehicleLiveIoItem[];
  rawIo?: Record<string, unknown>;
}

export type VehicleDailyDiagnosticSeverity = "info" | "warning" | "critical";

export interface VehicleDailyDiagnosticEvent {
  id: string;
  key?: string;
  type: string;
  label: string;
  timestamp: number;
  severity: VehicleDailyDiagnosticSeverity;
  value?: number | string | boolean | null;
  unit?: string;
  details?: string;
}

export interface VehicleDailyDiagnosticSample {
  timestamp: number;
  speedKmh?: number | null;
  engineRpm?: number | null;
  totalOdometerKm?: number | null;
  tripOdometerKm?: number | null;
  coolantTemperatureC?: number | null;
  engineOilTemperatureC?: number | null;
  externalVoltageV?: number | null;
  batteryVoltageV?: number | null;
  fuelLevelPct?: number | null;
  fuelRateLh?: number | null;
  engineLoadPct?: number | null;
  throttlePositionPct?: number | null;
}

export interface VehicleDailyDiagnosticsSummary {
  id: string;
  companyId?: string;
  vehicleId: string;
  dayKey: string;
  imei?: string;
  firstRecordAt?: number;
  lastRecordAt?: number;
  updatedAt?: number;
  packetsCount: number;
  summaryText?: string;
  stats: Record<string, unknown>;
  latestObd?: Record<string, unknown>;
  availableSensorKeys?: string[];
  events: VehicleDailyDiagnosticEvent[];
  samples: VehicleDailyDiagnosticSample[];
}

export interface VehicleGpsSimulationPoint {
  lat: number;
  lng: number;
  speedKmh: number;
  angle: number;
  odometerKm: number;
  ts: number;
  ignitionOn: boolean;
}

export interface VehicleGpsSimulationItem {
  id?: string;
  active?: boolean;
  status?: "running" | "paused" | "done";
  destinationQuery?: string;
  destinationDisplay?: string;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
  points: VehicleGpsSimulationPoint[];
  startedAt: number;
  resumedAt?: number;
  pausedAt?: number | null;
  elapsedBeforePauseMs?: number;
  totalDurationMs?: number;
  totalDistanceKm: number;
  stoppedAt?: number;
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
  | "tracker_event"
  | "geo_fence_in"
  | "geo_fence_out";

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
  companyId?: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;
  initialRecordedKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;
  pendingDriverUserId?: string;
  pendingDriverUserName?: string;
  pendingDriverThemeKey?: string | null;
  pendingDriverRequestedAt?: number;

  maintenanceNotes: string;
  serviceStrategy: "interval" | "absolute";
  serviceIntervalKm: number;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;
  nextCascoDate: string;
  nextRovinietaDate: string;
  nextOilServiceKm: number;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];
  documents: VehicleDocumentItem[];

  gpsSnapshot?: VehicleGpsSnapshot | null;
  liveDiagnostics?: VehicleLiveDiagnostics | null;
  gpsDataUsage?: VehicleGpsDataUsage | null;
  tracker?: VehicleTrackerMeta | null;
  /** Ruta GPS activa - array de puncte stocat pe vehicul, real-time prin onSnapshot */
  gpsSim?: VehicleGpsSimulationItem | null;
  gpsSimHistory?: VehicleGpsSimulationItem[];

  createdAt: number;
  updatedAt?: number;
}

export interface VehicleFormValues {
  companyId?: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;
  initialRecordedKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;
  pendingDriverUserId?: string;
  pendingDriverUserName?: string;
  pendingDriverThemeKey?: string | null;
  pendingDriverRequestedAt?: number;

  maintenanceNotes: string;
  serviceStrategy: "interval" | "absolute";
  serviceIntervalKm: number;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;
  nextCascoDate: string;
  nextRovinietaDate: string;
  nextOilServiceKm: number;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];
  documents: VehicleDocumentItem[];
}

export type VehicleEventType =
  | "created"
  | "updated"
  | "driver_changed"
  | "images_updated"
  | "claimed"
  | "comment";

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
