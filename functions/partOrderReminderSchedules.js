const { stableHash } = require('./expiryAutomation');

const PART_ORDER_REMINDER_WORKER = 'part_order_reminders_v1';
const PART_ORDER_REMINDER_SCHEDULE_VERSION = 1;
const PART_ORDER_REMINDER_KIND = 'maintenance_part_order_reminder';
const TERMINAL_STATUSES = new Set(['installed', 'cancelled']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampReminderMinutes(value) {
  const parsed = cleanNumber(value, 30);
  return Math.max(5, Math.min(1440, Math.round(parsed)));
}

function normalizePartOrder(orderId, source) {
  return {
    id: cleanText(orderId),
    companyId: cleanText(source?.companyId),
    title: cleanText(source?.title),
    status: cleanText(source?.status) || 'requested',
    clientName: cleanText(source?.clientName),
    liftSerialNumber: cleanText(source?.liftSerialNumber),
    requestedByUserId: cleanText(source?.requestedByUserId),
    requestedByUserName: cleanText(source?.requestedByUserName),
    notifyUserId: cleanText(source?.notifyUserId),
    notifyUserName: cleanText(source?.notifyUserName),
    notificationSeenAt: cleanNumber(source?.notificationSeenAt, 0),
    nextReminderAt: cleanNumber(source?.nextReminderAt, 0),
    reminderIntervalMinutes: clampReminderMinutes(source?.reminderIntervalMinutes),
  };
}

function isPartOrderReminderEligible(order) {
  return Boolean(
    order.id &&
      order.companyId &&
      order.notifyUserId &&
      order.nextReminderAt > 0 &&
      order.notificationSeenAt <= 0 &&
      !TERMINAL_STATUSES.has(order.status)
  );
}

function buildPartOrderScheduleId(orderId) {
  return `part_order_${stableHash(orderId, 20)}_notify`;
}

function buildPartOrderSourceRevision(order) {
  return stableHash(JSON.stringify({
    companyId: order.companyId,
    title: order.title,
    status: order.status,
    clientName: order.clientName,
    liftSerialNumber: order.liftSerialNumber,
    requestedByUserId: order.requestedByUserId,
    requestedByUserName: order.requestedByUserName,
    notifyUserId: order.notifyUserId,
    notifyUserName: order.notifyUserName,
    notificationSeen: order.notificationSeenAt > 0,
    nextReminderAt: order.nextReminderAt,
    reminderIntervalMinutes: order.reminderIntervalMinutes,
  }));
}

function buildPartOrderReminderSchedules(orderId, source) {
  const order = normalizePartOrder(orderId, source);
  if (!isPartOrderReminderEligible(order)) return [];

  return [{
    id: buildPartOrderScheduleId(order.id),
    schemaVersion: PART_ORDER_REMINDER_SCHEDULE_VERSION,
    workerType: PART_ORDER_REMINDER_WORKER,
    scheduleKind: PART_ORDER_REMINDER_KIND,
    sourceCollection: 'maintenancePartOrders',
    sourceId: order.id,
    entityType: 'maintenance_part_order',
    entityId: order.id,
    companyId: order.companyId,
    notifyUserId: order.notifyUserId,
    notifyUserName: order.notifyUserName,
    requestedByUserId: order.requestedByUserId,
    requestedByUserName: order.requestedByUserName,
    title: order.title,
    clientName: order.clientName,
    liftSerialNumber: order.liftSerialNumber,
    reminderIntervalMinutes: order.reminderIntervalMinutes,
    status: 'scheduled',
    nextRunAt: order.nextReminderAt,
    sourceRevision: buildPartOrderSourceRevision(order),
    leaseUntil: 0,
    leaseOwner: '',
    failureCount: 0,
  }];
}

function buildPartOrderScheduleSyncPlan(orderId, beforeOrder, afterOrder) {
  const before = new Map(buildPartOrderReminderSchedules(orderId, beforeOrder).map((item) => [item.id, item]));
  const after = new Map(buildPartOrderReminderSchedules(orderId, afterOrder).map((item) => [item.id, item]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const plan = [];

  ids.forEach((id) => {
    const previous = before.get(id);
    const next = after.get(id);
    if (!next) {
      plan.push({ type: 'delete', id });
      return;
    }
    if (!previous || previous.sourceRevision !== next.sourceRevision) {
      plan.push({ type: 'set', id, value: next });
    }
  });

  return plan;
}

function getPartOrderReminderNextRunAt(orderOrSchedule, now = Date.now()) {
  return now + clampReminderMinutes(orderOrSchedule?.reminderIntervalMinutes) * 60 * 1000;
}

function buildPartOrderScheduleAdvancePatch(schedule, now = Date.now()) {
  return {
    status: 'scheduled',
    nextRunAt: getPartOrderReminderNextRunAt(schedule, now),
    leaseUntil: 0,
    leaseOwner: '',
    failureCount: 0,
    lastErrorCode: '',
    lastDeliveredAt: now,
  };
}

function buildPartOrderScheduleTerminalPatch(errorCode = '') {
  return {
    status: errorCode ? 'invalid' : 'completed',
    nextRunAt: null,
    leaseUntil: 0,
    leaseOwner: '',
    failureCount: 0,
    lastErrorCode: cleanText(errorCode),
  };
}

module.exports = {
  PART_ORDER_REMINDER_KIND,
  PART_ORDER_REMINDER_SCHEDULE_VERSION,
  PART_ORDER_REMINDER_WORKER,
  buildPartOrderReminderSchedules,
  buildPartOrderScheduleAdvancePatch,
  buildPartOrderScheduleSyncPlan,
  buildPartOrderScheduleTerminalPatch,
  getPartOrderReminderNextRunAt,
  isPartOrderReminderEligible,
  normalizePartOrder,
};
