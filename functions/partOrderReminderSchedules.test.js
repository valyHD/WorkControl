const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PART_ORDER_REMINDER_WORKER,
  buildPartOrderReminderSchedules,
  buildPartOrderScheduleAdvancePatch,
  buildPartOrderScheduleSyncPlan,
  buildPartOrderScheduleTerminalPatch,
  getPartOrderReminderNextRunAt,
  normalizePartOrder,
} = require('./partOrderReminderSchedules');

function order(overrides = {}) {
  return {
    companyId: 'company-1',
    title: 'Comanda usi',
    status: 'requested',
    clientName: 'Client Test',
    liftSerialNumber: '217379',
    requestedByUserId: 'requester-1',
    requestedByUserName: 'Ionut',
    notifyUserId: 'manager-1',
    notifyUserName: 'Manager',
    notificationSeenAt: null,
    nextReminderAt: Date.parse('2026-07-16T09:00:00.000Z'),
    reminderIntervalMinutes: 45,
    ...overrides,
  };
}

test('materializes an indexed schedule for active part order reminders', () => {
  const schedules = buildPartOrderReminderSchedules('order-1', order());
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].workerType, PART_ORDER_REMINDER_WORKER);
  assert.equal(schedules[0].scheduleKind, 'maintenance_part_order_reminder');
  assert.equal(schedules[0].sourceCollection, 'maintenancePartOrders');
  assert.equal(schedules[0].sourceId, 'order-1');
  assert.equal(schedules[0].nextRunAt, Date.parse('2026-07-16T09:00:00.000Z'));
});

test('does not schedule terminal, seen, missing recipient, or unscheduled orders', () => {
  assert.equal(buildPartOrderReminderSchedules('order-1', order({ status: 'installed' })).length, 0);
  assert.equal(buildPartOrderReminderSchedules('order-1', order({ status: 'cancelled' })).length, 0);
  assert.equal(buildPartOrderReminderSchedules('order-1', order({ notificationSeenAt: Date.now() })).length, 0);
  assert.equal(buildPartOrderReminderSchedules('order-1', order({ notifyUserId: '' })).length, 0);
  assert.equal(buildPartOrderReminderSchedules('order-1', order({ nextReminderAt: null })).length, 0);
});

test('sync plan updates only when reminder source changes', () => {
  assert.deepEqual(
    buildPartOrderScheduleSyncPlan('order-1', order({ notes: 'old' }), order({ notes: 'new' })),
    []
  );
  const changed = buildPartOrderScheduleSyncPlan(
    'order-1',
    order({ nextReminderAt: 1000 }),
    order({ nextReminderAt: 2000 })
  );
  assert.equal(changed.length, 1);
  assert.equal(changed[0].type, 'set');
  assert.equal(changed[0].value.nextRunAt, 2000);
});

test('sync plan deletes schedule when order becomes terminal or seen', () => {
  const terminalPlan = buildPartOrderScheduleSyncPlan('order-1', order(), order({ status: 'installed' }));
  assert.equal(terminalPlan.length, 1);
  assert.equal(terminalPlan[0].type, 'delete');

  const seenPlan = buildPartOrderScheduleSyncPlan(
    'order-1',
    order(),
    order({ notificationSeenAt: Date.parse('2026-07-16T10:00:00.000Z') })
  );
  assert.equal(seenPlan.length, 1);
  assert.equal(seenPlan[0].type, 'delete');
});

test('advance and terminal patches clear leases deterministically', () => {
  const now = Date.parse('2026-07-16T09:00:00.000Z');
  const normalized = normalizePartOrder('order-1', order({ reminderIntervalMinutes: 45 }));
  assert.equal(getPartOrderReminderNextRunAt(normalized, now), Date.parse('2026-07-16T09:45:00.000Z'));

  const advance = buildPartOrderScheduleAdvancePatch(normalized, now);
  assert.equal(advance.status, 'scheduled');
  assert.equal(advance.nextRunAt, Date.parse('2026-07-16T09:45:00.000Z'));
  assert.equal(advance.leaseOwner, '');
  assert.equal(advance.leaseUntil, 0);

  const terminal = buildPartOrderScheduleTerminalPatch('invalid_recipient');
  assert.equal(terminal.status, 'invalid');
  assert.equal(terminal.nextRunAt, null);
  assert.equal(terminal.lastErrorCode, 'invalid_recipient');
});
