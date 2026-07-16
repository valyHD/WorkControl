const {
  addCalendarDays,
  getZonedParts,
  stableHash,
  zonedDateTimeToTimestamp,
} = require('./expiryAutomation');

const TIMESHEET_REMINDER_WORKER = 'timesheet_reminders_v1';
const TIMESHEET_REMINDER_SCHEDULE_VERSION = 1;
const TIMESHEET_REMINDER_TIME_ZONE = 'Europe/Bucharest';
const START_EVENT = 'timesheet_start_daily_reminder';
const STOP_EVENT = 'timesheet_stop_after_8h_reminder';
const INTERVAL_EVENT = 'timesheet_work_interval_reminder';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWeekdays(value) {
  const weekdays = Array.isArray(value)
    ? value
      .map((day) => Math.max(1, Math.min(7, Math.round(cleanNumber(day, 0)))))
      .filter(Boolean)
    : [];
  return weekdays.length > 0 ? Array.from(new Set(weekdays)).sort((left, right) => left - right) : [1, 2, 3, 4, 5];
}

function parseScheduleTime(value, fallback) {
  const safeValue = cleanText(value) || fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(safeValue);
  if (!match) return parseScheduleTime(fallback, '08:30');
  return {
    hour: Math.max(0, Math.min(23, Number(match[1]) || 0)),
    minute: Math.max(0, Math.min(59, Number(match[2]) || 0)),
  };
}

function getDayKey(date, timeZone = TIMESHEET_REMINDER_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getWeekday(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function getScheduleKinds(eventType) {
  if (eventType === START_EVENT) return ['start'];
  if (eventType === STOP_EVENT) return ['stop'];
  if (eventType === INTERVAL_EVENT) return ['start', 'stop'];
  return [];
}

function normalizeRule(ruleId, rule) {
  const recipients = rule?.recipients || {};
  return {
    id: cleanText(ruleId),
    companyId: cleanText(rule?.companyId),
    module: cleanText(rule?.module) || 'general',
    eventType: cleanText(rule?.eventType),
    entityId: cleanText(rule?.entityId),
    enabled: rule?.enabled !== false,
    scheduleTime: cleanText(rule?.scheduleTime) || '08:30',
    stopTime: cleanText(rule?.stopTime) || '17:00',
    weekdays: normalizeWeekdays(rule?.weekdays),
    reminderDelayHours: Math.max(1, Math.min(16, Math.round(cleanNumber(rule?.reminderDelayHours, 8)))),
    reminderRepeatMinutes: Math.max(5, Math.min(720, Math.round(cleanNumber(rule?.reminderRepeatMinutes, 60)))),
    reminderActiveMinutes: Math.max(0, Math.min(1440, Math.round(cleanNumber(rule?.reminderActiveMinutes, 120)))),
    soundEnabled: rule?.soundEnabled !== false,
    recipients: {
      notifyDirectUser: Boolean(recipients.notifyDirectUser),
      notifyOwner: Boolean(recipients.notifyOwner),
      notifyAdmins: Boolean(recipients.notifyAdmins),
      notifyManagers: Boolean(recipients.notifyManagers),
      specificUserIds: Array.isArray(recipients.specificUserIds)
        ? recipients.specificUserIds.map(cleanText).filter(Boolean).slice(0, 100)
        : [],
    },
  };
}

function getRuleTime(rule, kind) {
  return kind === 'stop'
    ? parseScheduleTime(rule.stopTime, '17:00')
    : parseScheduleTime(rule.scheduleTime, '08:30');
}

function getDaySlots(rule, kind, dateKey) {
  if (!rule.weekdays.includes(getWeekday(dateKey))) return [];
  const time = getRuleTime(rule, kind);
  const startAt = zonedDateTimeToTimestamp(
    dateKey,
    time.hour,
    time.minute,
    TIMESHEET_REMINDER_TIME_ZONE
  );
  if (!Number.isFinite(startAt)) return [];
  const repeatMs = rule.reminderRepeatMinutes * 60 * 1000;
  const maxSlot = Math.floor(rule.reminderActiveMinutes / rule.reminderRepeatMinutes);
  return Array.from({ length: maxSlot + 1 }, (_, slot) => ({
    dateKey,
    slot,
    scheduledAt: startAt + slot * repeatMs,
  }));
}

function findCurrentOrNextTiming(rule, kind, now = Date.now()) {
  const todayKey = getDayKey(new Date(now));
  for (let offset = 0; offset <= 8; offset += 1) {
    const dateKey = addCalendarDays(todayKey, offset);
    const slots = getDaySlots(rule, kind, dateKey);
    if (slots.length === 0) continue;
    if (offset > 0) return { ...slots[0], nextRunAt: slots[0].scheduledAt };

    const future = slots.find((slot) => slot.scheduledAt >= now);
    if (future) return { ...future, nextRunAt: future.scheduledAt };

    const lastSlot = slots.at(-1);
    const activeUntil = slots[0].scheduledAt + rule.reminderActiveMinutes * 60 * 1000;
    if (lastSlot && now <= activeUntil) {
      const elapsed = Math.max(0, now - slots[0].scheduledAt);
      const currentSlot = Math.min(
        Math.floor(elapsed / (rule.reminderRepeatMinutes * 60 * 1000)),
        slots.length - 1
      );
      return { ...slots[currentSlot], nextRunAt: now };
    }
  }
  return null;
}

function findNextTiming(rule, kind, afterTimestamp = Date.now()) {
  const todayKey = getDayKey(new Date(afterTimestamp));
  for (let offset = 0; offset <= 8; offset += 1) {
    const dateKey = addCalendarDays(todayKey, offset);
    const next = getDaySlots(rule, kind, dateKey).find((slot) => slot.scheduledAt > afterTimestamp);
    if (next) return { ...next, nextRunAt: next.scheduledAt };
  }
  return null;
}

function buildScheduleId(ruleId, kind) {
  return `timesheet_${stableHash(ruleId, 20)}_${kind}`;
}

function buildRuleRevision(rule, kind) {
  return stableHash(JSON.stringify({ ...rule, kind }));
}

function buildTimesheetReminderSchedules(ruleId, source, now = Date.now()) {
  const rule = normalizeRule(ruleId, source);
  if (!rule.id || !rule.companyId || !rule.enabled || rule.module !== 'timesheets') return [];

  return getScheduleKinds(rule.eventType).flatMap((kind) => {
    const timing = findCurrentOrNextTiming(rule, kind, now);
    if (!timing) return [];
    return [{
      id: buildScheduleId(rule.id, kind),
      schemaVersion: TIMESHEET_REMINDER_SCHEDULE_VERSION,
      workerType: TIMESHEET_REMINDER_WORKER,
      scheduleKind: kind === 'stop' ? 'timesheet_stop_reminder' : 'timesheet_start_reminder',
      sourceCollection: 'notificationRules',
      sourceId: rule.id,
      entityType: 'notification_rule',
      entityId: rule.entityId,
      companyId: rule.companyId,
      rule,
      deliveryDateKey: timing.dateKey,
      reminderSlot: timing.slot,
      scheduledAt: timing.scheduledAt,
      nextRunAt: timing.nextRunAt,
      status: 'scheduled',
      sourceRevision: buildRuleRevision(rule, kind),
      leaseUntil: 0,
      leaseOwner: '',
      failureCount: 0,
    }];
  });
}

function buildTimesheetScheduleSyncPlan(ruleId, beforeRule, afterRule, now = Date.now()) {
  const before = new Map(buildTimesheetReminderSchedules(ruleId, beforeRule, now).map((item) => [item.id, item]));
  const after = new Map(buildTimesheetReminderSchedules(ruleId, afterRule, now).map((item) => [item.id, item]));
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

function scheduleToRule(schedule) {
  return normalizeRule(cleanText(schedule?.sourceId), schedule?.rule || {});
}

function getNextTimesheetSchedulePatch(schedule, now = Date.now()) {
  const rule = scheduleToRule(schedule);
  const kind = cleanText(schedule?.scheduleKind) === 'timesheet_stop_reminder' ? 'stop' : 'start';
  const afterTimestamp = Math.max(now, cleanNumber(schedule?.scheduledAt, now));
  const timing = findNextTiming(rule, kind, afterTimestamp);
  if (!timing) {
    return {
      status: 'invalid',
      nextRunAt: null,
      leaseUntil: 0,
      leaseOwner: '',
      lastErrorCode: 'next_run_unavailable',
    };
  }
  return {
    status: 'scheduled',
    deliveryDateKey: timing.dateKey,
    reminderSlot: timing.slot,
    scheduledAt: timing.scheduledAt,
    nextRunAt: timing.nextRunAt,
    leaseUntil: 0,
    leaseOwner: '',
    failureCount: 0,
    lastErrorCode: '',
  };
}

function isStaleTimesheetSchedule(schedule, now = Date.now(), maximumDelayMs = 15 * 60 * 1000) {
  const scheduledAt = cleanNumber(schedule?.scheduledAt, 0);
  return !scheduledAt || now - scheduledAt > Math.max(60_000, maximumDelayMs);
}

module.exports = {
  INTERVAL_EVENT,
  START_EVENT,
  STOP_EVENT,
  TIMESHEET_REMINDER_SCHEDULE_VERSION,
  TIMESHEET_REMINDER_TIME_ZONE,
  TIMESHEET_REMINDER_WORKER,
  buildTimesheetReminderSchedules,
  buildTimesheetScheduleSyncPlan,
  findCurrentOrNextTiming,
  findNextTiming,
  getNextTimesheetSchedulePatch,
  isStaleTimesheetSchedule,
  normalizeRule,
  scheduleToRule,
};
