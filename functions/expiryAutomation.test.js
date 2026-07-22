const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addCalendarDays,
  buildScheduleLeasePatch,
  buildDeliveryKey,
  buildNotificationForSchedule,
  buildScheduleSyncPlan,
  buildVehicleAlertScheduleSources,
  canClaimSchedule,
  diffCalendarDays,
  getNextDocumentTiming,
  getZonedParts,
  isValidDateKey,
  resolveVehicleAlertRecipients,
  selectCurrentMilestone,
  zonedDateTimeToTimestamp,
} = require('./expiryAutomation');

function vehicle(overrides = {}) {
  return {
    companyId: 'company-a',
    plateNumber: 'B 33 LGR',
    ownerUserId: 'owner-1',
    currentDriverUserId: 'driver-1',
    currentKm: 6_000,
    nextServiceKm: 7_000,
    nextOilServiceKm: 0,
    nextItpDate: '2026-08-31',
    nextRcaDate: '',
    nextCascoDate: '',
    nextRovinietaDate: '',
    ...overrides,
  };
}

test('validates calendar dates without JavaScript rollover', () => {
  assert.equal(isValidDateKey('2028-02-29'), true);
  assert.equal(isValidDateKey('2026-02-29'), false);
  assert.equal(isValidDateKey('2026-02-31'), false);
  assert.equal(isValidDateKey('2026-08-32'), false);
  assert.equal(isValidDateKey('00.08.2026'), false);
});

test('uses calendar-day arithmetic across Bucharest DST changes', () => {
  assert.equal(addCalendarDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addCalendarDays('2026-03-29', 1), '2026-03-30');
  assert.equal(diffCalendarDays('2026-03-28', '2026-03-30'), 2);

  const beforeDst = zonedDateTimeToTimestamp('2026-03-28', 8, 0);
  const afterDst = zonedDateTimeToTimestamp('2026-03-29', 8, 0);
  assert.deepEqual(getZonedParts(new Date(beforeDst)), {
    year: '2026',
    month: '03',
    day: '28',
    hour: '08',
    minute: '00',
    second: '00',
  });
  assert.deepEqual(getZonedParts(new Date(afterDst)), {
    year: '2026',
    month: '03',
    day: '29',
    hour: '08',
    minute: '00',
    second: '00',
  });
  assert.equal(afterDst - beforeDst, 23 * 60 * 60 * 1000);
});

test('selects the nearest useful reminder threshold', () => {
  assert.equal(selectCurrentMilestone(45), '30');
  assert.equal(selectCurrentMilestone(20), '30');
  assert.equal(selectCurrentMilestone(10), '14');
  assert.equal(selectCurrentMilestone(3), '7');
  assert.equal(selectCurrentMilestone(1), '1');
  assert.equal(selectCurrentMilestone(0), '0');
  assert.equal(selectCurrentMilestone(-1), 'expired');
});

test('materializes document schedules without touching GPS payloads', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  const source = vehicle({
    nextRcaDate: '2026-07-25',
    gpsSnapshot: { odometerKm: 6_100, lat: 44.4, lng: 26.1 },
  });
  const schedules = buildVehicleAlertScheduleSources('vehicle-1', source, now);
  const itp = schedules.find((item) => item.targetKey === 'itp');
  const rca = schedules.find((item) => item.targetKey === 'rca');

  assert.equal(itp.scheduleKind, 'vehicle_document_expiry');
  assert.equal(rca.nextMilestone, '14');
  assert.equal('gpsSnapshot' in rca, false);
  assert.equal('lat' in rca, false);
  assert.equal('lng' in rca, false);
});

test('creates service schedule only after entering the 500 km window', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  assert.equal(
    buildVehicleAlertScheduleSources('vehicle-1', vehicle({ currentKm: 6_499 }), now)
      .some((item) => item.scheduleKind === 'vehicle_service_mileage'),
    false
  );
  const due = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({ currentKm: 6_500 }),
    now
  ).find((item) => item.scheduleKind === 'vehicle_service_mileage');
  assert.equal(due.remainingKm, 500);
});

test('does not reset schedules when an unrelated vehicle field changes', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  const before = vehicle({ brand: 'Dacia' });
  const after = vehicle({ brand: 'Dacia', maintenanceNotes: 'nota noua' });
  assert.deepEqual(buildScheduleSyncPlan('vehicle-1', before, after, now), []);
});

test('replaces only the changed document schedule', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  const before = vehicle({ nextRcaDate: '2026-07-25' });
  const after = vehicle({ nextRcaDate: '2026-08-25' });
  const plan = buildScheduleSyncPlan('vehicle-1', before, after, now);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].type, 'set');
  assert.equal(plan[0].value.targetKey, 'rca');
});

test('advances from one threshold to the next and completes after expired', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  const next = getNextDocumentTiming('2026-08-31', '30', now);
  assert.equal(next.status, 'scheduled');
  assert.equal(next.nextMilestone, '14');
  assert.equal(getNextDocumentTiming('2026-08-31', 'expired', now).status, 'completed');
});

test('builds deterministic delivery keys for idempotent retries', () => {
  const schedule = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({ nextRcaDate: '2026-07-25' }),
    Date.UTC(2026, 6, 15, 9)
  ).find((item) => item.targetKey === 'rca');
  const first = buildDeliveryKey(schedule, '14');
  assert.equal(first, buildDeliveryKey(schedule, '14'));
  assert.notEqual(first, buildDeliveryKey(schedule, '7'));
  assert.notEqual(first, buildDeliveryKey({ ...schedule, companyId: 'company-b' }, '14'));
});

test('lease prevents two workers from claiming the same due schedule concurrently', () => {
  const now = Date.UTC(2026, 6, 15, 9);
  const due = { status: 'scheduled', nextRunAt: now - 1, leaseUntil: 0 };
  assert.equal(canClaimSchedule(due, now), true);
  const claimed = { ...due, ...buildScheduleLeasePatch('worker-a', now, 120_000) };
  assert.equal(canClaimSchedule(claimed, now), false);
  assert.equal(canClaimSchedule(claimed, now + 120_001), true);
});

test('uses expired messaging but preserves the existing notification event contract', () => {
  const schedule = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({ nextItpDate: '2026-07-01' }),
    Date.UTC(2026, 6, 15, 9)
  ).find((item) => item.targetKey === 'itp');
  const result = buildNotificationForSchedule(schedule, Date.UTC(2026, 6, 15, 9));
  assert.equal(result.milestone, 'expired');
  assert.equal(result.notification.eventType, 'vehicle_document_itp_due_soon');
  assert.match(result.notification.title, /expirat/i);
});

test('uses exactly the configured seven-day rovinieta milestone', () => {
  const now = Date.UTC(2026, 6, 22, 9);
  const schedule = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({
      nextItpDate: '',
      nextRovinietaDate: '2026-08-31',
      vehicleDocumentReminderDays: { rovinieta: 7 },
    }),
    now
  ).find((item) => item.targetKey === 'rovinieta');

  assert.deepEqual(schedule.milestones, [7]);
  assert.equal(schedule.nextMilestone, '7');
  assert.equal(getNextDocumentTiming('2026-08-31', '7', now, schedule.milestones).nextMilestone, 'expired');
});

test('supports multiple manually configured reminder days', () => {
  const now = Date.UTC(2026, 6, 22, 9);
  const schedule = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({
      nextItpDate: '',
      nextRcaDate: '2026-08-31',
      vehicleDocumentReminderMilestones: { rca: [30, 7, 1] },
    }),
    now
  ).find((item) => item.targetKey === 'rca');

  assert.deepEqual(schedule.milestones, [30, 7, 1]);
  assert.equal(schedule.nextMilestone, '30');
});

test('does not schedule a document with an explicit empty reminder list', () => {
  const schedules = buildVehicleAlertScheduleSources(
    'vehicle-1',
    vehicle({ vehicleDocumentReminderMilestones: { itp: [] } }),
    Date.UTC(2026, 6, 22, 9)
  );

  assert.equal(schedules.some((item) => item.targetKey === 'itp'), false);
});

test('resolves the driver again when the alert is delivered', () => {
  const schedule = {
    entityId: 'vehicle-1',
    companyId: 'company-a',
    directUserId: 'old-driver',
    ownerUserId: 'owner-1',
  };
  assert.deepEqual(
    resolveVehicleAlertRecipients(schedule, {
      id: 'vehicle-1',
      companyId: 'company-a',
      currentDriverUserId: 'driver-at-expiry',
      ownerUserId: 'owner-1',
    }),
    { directUserId: 'driver-at-expiry', ownerUserId: 'owner-1' }
  );
});
