const VEHICLE_OPERATIONAL_VIEW_VERSION = 2;
const SAFE_SIM_POINT_FIELDS = [
  'lat', 'lng', 'speedKmh', 'angle', 'odometerKm', 'ts', 'ignitionOn',
];
const SAFE_SIM_FIELDS = [
  'id', 'active', 'status', 'startedAt', 'stoppedAt', 'resumedAt', 'pausedAt',
  'elapsedBeforePauseMs', 'totalDurationMs', 'totalDistanceKm', 'destinationDisplay',
  'startLat', 'startLng', 'endLat', 'endLng',
];

function pick(source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const result = {};
  fields.forEach((field) => {
    const value = source[field];
    if (value !== undefined) result[field] = value;
  });
  return Object.keys(result).length > 0 ? result : null;
}

function sanitizeSimulation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = pick(value, SAFE_SIM_FIELDS) || {};
  result.points = Array.isArray(value.points)
    ? value.points.map((point) => pick(point, SAFE_SIM_POINT_FIELDS)).filter(Boolean)
    : [];
  return result;
}

function sanitizeSimulationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeSimulation).filter(Boolean);
}

function sanitizeDocuments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((document) => pick(document, [
    'id', 'name', 'category', 'expiryDate', 'createdAt',
  ])).filter(Boolean);
}

function buildVehicleOperationalView(vehicleId, source) {
  const data = source || {};
  return {
    vehicleId,
    companyId: String(data.companyId || ''),
    plateNumber: String(data.plateNumber || ''),
    brand: String(data.brand || ''),
    model: String(data.model || ''),
    year: String(data.year || ''),
    fuelType: String(data.fuelType || ''),
    status: String(data.status || 'activa'),
    currentKm: Number.isFinite(Number(data.currentKm)) ? Number(data.currentKm) : 0,
    initialRecordedKm: Number.isFinite(Number(data.initialRecordedKm))
      ? Number(data.initialRecordedKm)
      : 0,
    ownerUserId: String(data.ownerUserId || ''),
    ownerUserName: String(data.ownerUserName || ''),
    ownerThemeKey: data.ownerThemeKey || null,
    currentDriverUserId: String(data.currentDriverUserId || ''),
    currentDriverUserName: String(data.currentDriverUserName || ''),
    currentDriverThemeKey: data.currentDriverThemeKey || null,
    pendingDriverUserId: String(data.pendingDriverUserId || ''),
    pendingDriverUserName: String(data.pendingDriverUserName || ''),
    pendingDriverThemeKey: data.pendingDriverThemeKey || null,
    pendingDriverRequestedAt: Number(data.pendingDriverRequestedAt || 0),
    maintenanceNotes: String(data.maintenanceNotes || ''),
    serviceStrategy: data.serviceStrategy === 'absolute' ? 'absolute' : 'interval',
    serviceIntervalKm: Number(data.serviceIntervalKm || 0),
    nextServiceKm: Number(data.nextServiceKm || 0),
    nextItpDate: String(data.nextItpDate || ''),
    nextRcaDate: String(data.nextRcaDate || ''),
    nextCascoDate: String(data.nextCascoDate || ''),
    nextRovinietaDate: String(data.nextRovinietaDate || ''),
    nextOilServiceKm: Number(data.nextOilServiceKm || 0),
    coverImageUrl: String(data.coverImageUrl || ''),
    coverThumbUrl: String(data.coverThumbUrl || ''),
    documents: sanitizeDocuments(data.documents),
    gpsSim: sanitizeSimulation(data.gpsSim),
    gpsSimHistory: sanitizeSimulationHistory(data.gpsSimHistory),
    documentCount: Array.isArray(data.documents) ? data.documents.length : 0,
    createdAt: Number(data.createdAt || 0),
  };
}

module.exports = {
  buildVehicleOperationalView,
  sanitizeSimulation,
  sanitizeSimulationHistory,
  VEHICLE_OPERATIONAL_VIEW_VERSION,
};
