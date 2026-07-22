const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVehicleReminderConfiguration,
  getAffectedVehicleIds,
  ruleMatchesVehicleReminderDay,
} = require('./vehicleExpiryNotificationRules');

function expiryRule(overrides = {}) {
  return {
    module: 'vehicles',
    eventType: 'vehicle_document_rovinieta_due_soon',
    entityId: 'vehicle-1',
    enabled: true,
    reminderDaysBefore: 7,
    ...overrides,
  };
}

test('configures the rovinieta reminder seven days before expiry', () => {
  const result = buildVehicleReminderConfiguration([expiryRule()]);

  assert.equal(result.vehicleDocumentReminderDays.rovinieta, 7);
  assert.deepEqual(result.vehicleDocumentReminderMilestones.rovinieta, [7]);
  assert.deepEqual(result.vehicleDocumentReminderMilestones.itp, []);
});

test('keeps multiple manual reminder days sorted and ignores disabled rules', () => {
  const result = buildVehicleReminderConfiguration([
    expiryRule({ reminderDaysBefore: 1 }),
    expiryRule({ reminderDaysBefore: 30 }),
    expiryRule({ reminderDaysBefore: 7 }),
    expiryRule({ reminderDaysBefore: 30 }),
    expiryRule({ enabled: false, reminderDaysBefore: 60 }),
  ]);

  assert.deepEqual(result.vehicleDocumentReminderMilestones.rovinieta, [30, 7, 1]);
  assert.equal(result.vehicleDocumentReminderDays.rovinieta, 30);
});

test('resynchronizes both vehicles when a rule is moved', () => {
  assert.deepEqual(
    getAffectedVehicleIds(expiryRule({ entityId: 'vehicle-old' }), expiryRule({ entityId: 'vehicle-new' })),
    ['vehicle-old', 'vehicle-new']
  );
});

test('dispatches a vehicle expiry rule only for its configured day', () => {
  const rule = expiryRule({ reminderDaysBefore: 7 });
  assert.equal(ruleMatchesVehicleReminderDay(rule, 7), true);
  assert.equal(ruleMatchesVehicleReminderDay(rule, 30), false);
  assert.equal(ruleMatchesVehicleReminderDay(rule, null), false);
  assert.equal(ruleMatchesVehicleReminderDay({ module: 'timesheets' }, null), true);
});
