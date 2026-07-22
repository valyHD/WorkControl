const crypto = require('node:crypto');

const EXPIRY_TIME_ZONE = 'Europe/Bucharest';
const EXPIRY_SCHEDULE_VERSION = 1;
const DOCUMENT_MILESTONES = [30, 14, 7, 1, 0];
const DOCUMENT_DEFINITIONS = [
  { key: 'itp', label: 'ITP', field: 'nextItpDate', eventType: 'vehicle_document_itp_due_soon' },
  { key: 'rca', label: 'RCA', field: 'nextRcaDate', eventType: 'vehicle_document_rca_due_soon' },
  { key: 'casco', label: 'CASCO', field: 'nextCascoDate', eventType: 'vehicle_document_casco_due_soon' },
  {
    key: 'rovinieta',
    label: 'Rovinieta',
    field: 'nextRovinietaDate',
    eventType: 'vehicle_document_rovinieta_due_soon',
  },
];
const SERVICE_DEFINITIONS = [
  { key: 'service', label: 'Revizie', field: 'nextServiceKm', eventType: 'vehicle_service_due_soon' },
  { key: 'oil', label: 'Revizie ulei', field: 'nextOilServiceKm', eventType: 'vehicle_oil_service_due_soon' },
];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanFirestoreDocumentId(value, maxLength = 160) {
  if (typeof value !== 'string' || value.length > maxLength || !value.trim()) return '';
  if (value.includes('/') || value === '.' || value === '..') return '';
  return value;
}

function cleanNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableHash(value, length = 32) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function isValidDateKey(value) {
  const dateKey = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateKeyToUtcDay(value) {
  if (!isValidDateKey(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function getDayKey(date = new Date(), timeZone = EXPIRY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(dateKey, days) {
  const timestamp = dateKeyToUtcDay(dateKey);
  if (timestamp === null) return '';
  return new Date(timestamp + Math.round(cleanNumber(days)) * 86400000).toISOString().slice(0, 10);
}

function diffCalendarDays(fromDateKey, toDateKey) {
  const from = dateKeyToUtcDay(fromDateKey);
  const to = dateKeyToUtcDay(toDateKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

function getZonedParts(date, timeZone = EXPIRY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function zonedDateTimeToTimestamp(dateKey, hour = 8, minute = 0, timeZone = EXPIRY_TIME_ZONE) {
  if (!isValidDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = getZonedParts(new Date(candidate), timeZone);
    const renderedAsUtc = Date.UTC(
      Number(rendered.year),
      Number(rendered.month) - 1,
      Number(rendered.day),
      Number(rendered.hour),
      Number(rendered.minute),
      Number(rendered.second)
    );
    const delta = renderedAsUtc - desiredAsUtc;
    if (delta === 0) return candidate;
    candidate -= delta;
  }

  return candidate;
}

function normalizeDocumentMilestones(milestones) {
  const normalized = (Array.isArray(milestones) ? milestones : DOCUMENT_MILESTONES)
    .map((value) => Math.round(cleanNumber(value, -1)))
    .filter((value) => value >= 0 && value <= 365)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => right - left);
  return normalized.length ? normalized : DOCUMENT_MILESTONES;
}

function selectCurrentMilestone(daysLeft, milestones = DOCUMENT_MILESTONES) {
  if (!Number.isFinite(daysLeft)) return null;
  if (daysLeft < 0) return 'expired';
  const safeMilestones = normalizeDocumentMilestones(milestones);
  if (daysLeft > safeMilestones[0]) return String(safeMilestones[0]);
  const threshold = [...safeMilestones]
    .sort((left, right) => left - right)
    .find((value) => value >= daysLeft);
  return String(threshold ?? 0);
}

function getMilestoneTriggerDate(expiryDate, milestone) {
  if (milestone === 'expired') return addCalendarDays(expiryDate, 1);
  const threshold = Number(milestone);
  if (!Number.isFinite(threshold)) return '';
  return addCalendarDays(expiryDate, -threshold);
}

function buildDocumentTiming(expiryDate, now = Date.now(), milestones = DOCUMENT_MILESTONES) {
  const nowDate = new Date(now);
  const todayKey = getDayKey(nowDate);
  const daysLeft = diffCalendarDays(todayKey, expiryDate);
  if (daysLeft === null) return null;
  const milestone = selectCurrentMilestone(daysLeft, milestones);
  if (!milestone) return null;
  const triggerDate = getMilestoneTriggerDate(expiryDate, milestone);
  const triggerAt = zonedDateTimeToTimestamp(triggerDate, 8, 0);
  return {
    daysLeft,
    milestone,
    nextRunAt: triggerAt !== null && triggerAt > now ? triggerAt : now,
    triggerDate,
  };
}

function getNextDocumentTiming(
  expiryDate,
  deliveredMilestone,
  now = Date.now(),
  milestones = DOCUMENT_MILESTONES
) {
  if (!isValidDateKey(expiryDate) || deliveredMilestone === 'expired') {
    return { status: 'completed', nextMilestone: '', nextRunAt: null };
  }
  const ordered = [...normalizeDocumentMilestones(milestones).map(String), 'expired'];
  const currentIndex = ordered.indexOf(String(deliveredMilestone));
  if (currentIndex < 0 || currentIndex >= ordered.length - 1) {
    return { status: 'completed', nextMilestone: '', nextRunAt: null };
  }

  const nextMilestone = ordered[currentIndex + 1];
  const triggerDate = getMilestoneTriggerDate(expiryDate, nextMilestone);
  const triggerAt = zonedDateTimeToTimestamp(triggerDate, 8, 0);
  return {
    status: 'scheduled',
    nextMilestone,
    nextRunAt: triggerAt !== null && triggerAt > now ? triggerAt : now,
  };
}

function getVehicleIdentity(vehicle) {
  const ownerUserId = cleanText(vehicle?.ownerUserId);
  return {
    companyId: cleanText(vehicle?.companyId),
    plateNumber: cleanText(vehicle?.plateNumber) || 'fara numar',
    ownerUserId,
    directUserId: cleanText(vehicle?.currentDriverUserId) || ownerUserId,
  };
}

function buildScheduleId(vehicleId, kind, targetKey) {
  return `vehicle_${stableHash(vehicleId, 20)}_${kind}_${targetKey}`;
}

function buildSourceRevision(source) {
  return stableHash(JSON.stringify(source));
}

function buildVehicleAlertScheduleSources(vehicleId, vehicle, now = Date.now()) {
  const safeVehicleId = cleanFirestoreDocumentId(vehicleId);
  const identity = getVehicleIdentity(vehicle);
  if (!safeVehicleId || !identity.companyId) return [];
  const schedules = [];

  DOCUMENT_DEFINITIONS.forEach((definition) => {
    const expiryDate = cleanText(vehicle?.[definition.field]);
    if (!isValidDateKey(expiryDate)) return;
    const configuredMilestones = vehicle?.vehicleDocumentReminderMilestones?.[definition.key];
    if (Array.isArray(configuredMilestones) && configuredMilestones.length === 0) return;
    const configuredReminderDay = cleanNumber(vehicle?.vehicleDocumentReminderDays?.[definition.key], -1);
    const milestones = Array.isArray(configuredMilestones)
      ? normalizeDocumentMilestones(configuredMilestones)
      : configuredReminderDay >= 0 && configuredReminderDay <= 365
        ? [Math.round(configuredReminderDay)]
        : DOCUMENT_MILESTONES;
    const timing = buildDocumentTiming(expiryDate, now, milestones);
    if (!timing) return;
    const sourceIdentity = {
      companyId: identity.companyId,
      directUserId: identity.directUserId,
      ownerUserId: identity.ownerUserId,
      plateNumber: identity.plateNumber,
      expiryDate,
      targetKey: definition.key,
      milestones,
    };
    schedules.push({
      id: buildScheduleId(safeVehicleId, 'document', definition.key),
      schemaVersion: EXPIRY_SCHEDULE_VERSION,
      workerType: 'vehicle_alerts_v1',
      scheduleKind: 'vehicle_document_expiry',
      sourceCollection: 'vehicles',
      sourceId: safeVehicleId,
      entityType: 'vehicle',
      entityId: safeVehicleId,
      companyId: identity.companyId,
      directUserId: identity.directUserId,
      ownerUserId: identity.ownerUserId,
      plateNumber: identity.plateNumber,
      targetKey: definition.key,
      targetLabel: definition.label,
      eventType: definition.eventType,
      expiryDate,
      milestones,
      status: 'scheduled',
      nextMilestone: timing.milestone,
      nextRunAt: timing.nextRunAt,
      sourceRevision: buildSourceRevision(sourceIdentity),
      leaseUntil: 0,
      leaseOwner: '',
      failureCount: 0,
    });
  });

  const effectiveKm = Math.max(
    cleanNumber(vehicle?.currentKm, 0),
    cleanNumber(vehicle?.gpsSnapshot?.odometerKm, 0)
  );
  SERVICE_DEFINITIONS.forEach((definition) => {
    const targetKm = cleanNumber(vehicle?.[definition.field], 0);
    const remainingKm = targetKm - effectiveKm;
    if (targetKm <= 0 || remainingKm > 500) return;
    const sourceIdentity = {
      companyId: identity.companyId,
      directUserId: identity.directUserId,
      ownerUserId: identity.ownerUserId,
      plateNumber: identity.plateNumber,
      targetKm,
      targetKey: definition.key,
    };
    schedules.push({
      id: buildScheduleId(safeVehicleId, 'service', definition.key),
      schemaVersion: EXPIRY_SCHEDULE_VERSION,
      workerType: 'vehicle_alerts_v1',
      scheduleKind: 'vehicle_service_mileage',
      sourceCollection: 'vehicles',
      sourceId: safeVehicleId,
      entityType: 'vehicle',
      entityId: safeVehicleId,
      companyId: identity.companyId,
      directUserId: identity.directUserId,
      ownerUserId: identity.ownerUserId,
      plateNumber: identity.plateNumber,
      targetKey: definition.key,
      targetLabel: definition.label,
      eventType: definition.eventType,
      targetKm,
      remainingKm: Math.round(remainingKm),
      status: 'scheduled',
      nextMilestone: 'within_500_km',
      nextRunAt: now,
      sourceRevision: buildSourceRevision(sourceIdentity),
      leaseUntil: 0,
      leaseOwner: '',
      failureCount: 0,
    });
  });

  return schedules;
}

function buildScheduleSyncPlan(vehicleId, beforeVehicle, afterVehicle, now = Date.now()) {
  const beforeSchedules = new Map(
    buildVehicleAlertScheduleSources(vehicleId, beforeVehicle, now).map((item) => [item.id, item])
  );
  const afterSchedules = new Map(
    buildVehicleAlertScheduleSources(vehicleId, afterVehicle, now).map((item) => [item.id, item])
  );
  const plan = [];
  const ids = new Set([...beforeSchedules.keys(), ...afterSchedules.keys()]);
  ids.forEach((id) => {
    const before = beforeSchedules.get(id);
    const after = afterSchedules.get(id);
    if (!after) {
      plan.push({ type: 'delete', id });
      return;
    }
    if (!before || before.sourceRevision !== after.sourceRevision) {
      plan.push({ type: 'set', id, value: after });
    }
  });
  return plan;
}

function resolveDocumentDelivery(schedule, now = Date.now()) {
  const todayKey = getDayKey(new Date(now));
  const daysLeft = diffCalendarDays(todayKey, cleanText(schedule?.expiryDate));
  if (daysLeft === null) return null;
  const milestone = selectCurrentMilestone(daysLeft, schedule?.milestones);
  if (!milestone) return null;
  return { daysLeft, milestone };
}

function buildNotificationForSchedule(schedule, now = Date.now()) {
  const kind = cleanText(schedule?.scheduleKind);
  const plateNumber = cleanText(schedule?.plateNumber) || 'fara numar';
  const targetLabel = cleanText(schedule?.targetLabel) || 'Document';
  if (kind === 'vehicle_document_expiry') {
    const delivery = resolveDocumentDelivery(schedule, now);
    if (!delivery) return null;
    let title = `${targetLabel} aproape de expirare`;
    let message = `Masina ${plateNumber}: ${targetLabel} expira in ${delivery.daysLeft} zile (${schedule.expiryDate}).`;
    if (delivery.milestone === 'expired') {
      title = `${targetLabel} expirat`;
      message = `Masina ${plateNumber}: ${targetLabel} a expirat la ${schedule.expiryDate}.`;
    } else if (delivery.daysLeft === 0) {
      title = `${targetLabel} expira astazi`;
      message = `Masina ${plateNumber}: ${targetLabel} expira astazi (${schedule.expiryDate}).`;
    } else if (delivery.daysLeft === 1) {
      title = `${targetLabel} expira maine`;
      message = `Masina ${plateNumber}: ${targetLabel} expira maine (${schedule.expiryDate}).`;
    }
    return {
      milestone: delivery.milestone,
      notification: {
        companyId: cleanText(schedule.companyId),
        module: 'vehicles',
        eventType: cleanText(schedule.eventType),
        entityId: cleanText(schedule.entityId),
        notificationPath: `/vehicles/${cleanText(schedule.entityId)}`,
        title,
        message,
        reminderDaysBefore: delivery.milestone === 'expired' ? null : Number(delivery.milestone),
        directUserId: cleanText(schedule.directUserId),
        ownerUserId: cleanText(schedule.ownerUserId),
        notifyAdminsByDefault: true,
      },
    };
  }

  if (kind === 'vehicle_service_mileage') {
    const remainingKm = Math.max(Math.round(cleanNumber(schedule?.remainingKm, 0)), 0);
    return {
      milestone: 'within_500_km',
      notification: {
        companyId: cleanText(schedule.companyId),
        module: 'vehicles',
        eventType: cleanText(schedule.eventType),
        entityId: cleanText(schedule.entityId),
        notificationPath: `/vehicles/${cleanText(schedule.entityId)}`,
        title: `${targetLabel} aproape scadenta`,
        message: `Masina ${plateNumber} se apropie de ${targetLabel.toLowerCase()} (mai sunt ${remainingKm} km).`,
        directUserId: cleanText(schedule.directUserId),
        ownerUserId: cleanText(schedule.ownerUserId),
        notifyAdminsByDefault: true,
      },
    };
  }

  return null;
}

function getScheduleAdvancePatch(schedule, deliveredMilestone, now = Date.now()) {
  if (cleanText(schedule?.scheduleKind) === 'vehicle_document_expiry') {
    const next = getNextDocumentTiming(
      cleanText(schedule.expiryDate),
      deliveredMilestone,
      now,
      schedule?.milestones
    );
    return {
      status: next.status,
      nextMilestone: next.nextMilestone,
      nextRunAt: next.nextRunAt,
      lastDeliveredMilestone: deliveredMilestone,
      lastDeliveredAt: now,
      leaseUntil: 0,
      leaseOwner: '',
      failureCount: 0,
    };
  }
  return {
    status: 'completed',
    nextMilestone: '',
    nextRunAt: null,
    lastDeliveredMilestone: deliveredMilestone,
    lastDeliveredAt: now,
    leaseUntil: 0,
    leaseOwner: '',
    failureCount: 0,
  };
}

function buildDeliveryKey(schedule, milestone) {
  return [
    'expiry-v1',
    cleanText(schedule?.companyId),
    cleanText(schedule?.scheduleKind),
    cleanText(schedule?.entityId),
    cleanText(schedule?.targetKey),
    cleanText(schedule?.expiryDate) || cleanNumber(schedule?.targetKm, 0),
    cleanText(milestone),
  ].join(':');
}

function canClaimSchedule(schedule, now = Date.now()) {
  return (
    cleanText(schedule?.status) === 'scheduled' &&
    cleanNumber(schedule?.nextRunAt, Number.MAX_SAFE_INTEGER) <= now &&
    cleanNumber(schedule?.leaseUntil, 0) <= now
  );
}

function buildScheduleLeasePatch(workerId, now = Date.now(), leaseMs = 2 * 60 * 1000) {
  return {
    leaseOwner: cleanText(workerId),
    leaseUntil: now + Math.max(1_000, cleanNumber(leaseMs, 2 * 60 * 1000)),
    lastAttemptAt: now,
    updatedAt: now,
  };
}

function resolveVehicleAlertRecipients(schedule, vehicle) {
  if (
    cleanText(schedule?.entityId) !== cleanText(vehicle?.id || schedule?.entityId) ||
    cleanText(schedule?.companyId) !== cleanText(vehicle?.companyId)
  ) {
    return {
      directUserId: cleanText(schedule?.directUserId),
      ownerUserId: cleanText(schedule?.ownerUserId),
    };
  }
  const ownerUserId = cleanText(vehicle?.ownerUserId) || cleanText(schedule?.ownerUserId);
  return {
    directUserId: cleanText(vehicle?.currentDriverUserId) || ownerUserId,
    ownerUserId,
  };
}

module.exports = {
  DOCUMENT_DEFINITIONS,
  DOCUMENT_MILESTONES,
  EXPIRY_SCHEDULE_VERSION,
  EXPIRY_TIME_ZONE,
  addCalendarDays,
  buildDeliveryKey,
  buildDocumentTiming,
  buildNotificationForSchedule,
  buildScheduleLeasePatch,
  buildScheduleSyncPlan,
  buildVehicleAlertScheduleSources,
  diffCalendarDays,
  getDayKey,
  getNextDocumentTiming,
  getScheduleAdvancePatch,
  getZonedParts,
  isValidDateKey,
  canClaimSchedule,
  cleanFirestoreDocumentId,
  resolveDocumentDelivery,
  resolveVehicleAlertRecipients,
  selectCurrentMilestone,
  stableHash,
  zonedDateTimeToTimestamp,
};
