const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTimesheetReminderSchedules,
  buildTimesheetScheduleSyncPlan,
  getNextTimesheetSchedulePatch,
  isStaleTimesheetSchedule,
} = require('./timesheetReminderSchedules');

function rule(overrides = {}) {
  return {
    companyId: 'company-1',
    module: 'timesheets',
    eventType: 'timesheet_work_interval_reminder',
    enabled: true,
    scheduleTime: '07:00',
    stopTime: '17:00',
    weekdays: [1, 2, 3, 4, 5],
    reminderRepeatMinutes: 60,
    reminderActiveMinutes: 120,
    recipients: { notifyDirectUser: true, specificUserIds: [] },
    ...overrides,
  };
}

test('creeaza doua programari indexate pentru regula de interval', () => {
  const now = Date.parse('2026-07-16T03:00:00.000Z'); // 06:00 Bucharest
  const schedules = buildTimesheetReminderSchedules('rule-1', rule(), now);
  assert.equal(schedules.length, 2);
  assert.deepEqual(schedules.map((item) => item.scheduleKind).sort(), [
    'timesheet_start_reminder',
    'timesheet_stop_reminder',
  ]);
  assert.ok(schedules.every((item) => item.workerType === 'timesheet_reminders_v1'));
});

test('programarea respecta ora Europe/Bucharest inclusiv dupa schimbarea DST', () => {
  const winter = buildTimesheetReminderSchedules(
    'winter-rule',
    rule({ eventType: 'timesheet_start_daily_reminder', scheduleTime: '08:30' }),
    Date.parse('2026-01-12T05:00:00.000Z')
  )[0];
  const summer = buildTimesheetReminderSchedules(
    'summer-rule',
    rule({ eventType: 'timesheet_start_daily_reminder', scheduleTime: '08:30' }),
    Date.parse('2026-07-13T04:00:00.000Z')
  )[0];
  assert.equal(new Date(winter.scheduledAt).toISOString(), '2026-01-12T06:30:00.000Z');
  assert.equal(new Date(summer.scheduledAt).toISOString(), '2026-07-13T05:30:00.000Z');
});

test('dupa livrare avanseaza direct la urmatorul slot, nu ruleaza scanari intre sloturi', () => {
  const now = Date.parse('2026-07-16T04:00:00.000Z'); // 07:00 Bucharest
  const current = buildTimesheetReminderSchedules(
    'rule-2',
    rule({ eventType: 'timesheet_start_daily_reminder' }),
    now
  )[0];
  const next = getNextTimesheetSchedulePatch(current, now + 60_000);
  assert.equal(new Date(next.nextRunAt).toISOString(), '2026-07-16T05:00:00.000Z');
  assert.equal(next.reminderSlot, 1);
});

test('dezactivarea sau stergerea regulii produce stergerea programarilor', () => {
  const now = Date.parse('2026-07-16T03:00:00.000Z');
  const plan = buildTimesheetScheduleSyncPlan('rule-3', rule(), { ...rule(), enabled: false }, now);
  assert.equal(plan.length, 2);
  assert.ok(plan.every((operation) => operation.type === 'delete'));
});

test('programarile ramase din noapte nu livreaza notificari vechi dimineata', () => {
  const scheduledAt = Date.parse('2026-07-15T18:55:00.000Z');
  assert.equal(
    isStaleTimesheetSchedule({ scheduledAt }, Date.parse('2026-07-16T02:00:00.000Z')),
    true
  );
});
