const VEHICLE_EXPIRY_EVENT_TARGETS = Object.freeze({
  vehicle_document_itp_due_soon: 'itp',
  vehicle_document_rca_due_soon: 'rca',
  vehicle_document_casco_due_soon: 'casco',
  vehicle_document_rovinieta_due_soon: 'rovinieta',
});

const VEHICLE_EXPIRY_TARGETS = Object.freeze(Object.values(VEHICLE_EXPIRY_EVENT_TARGETS));

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReminderDaysBefore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, Math.min(365, Math.round(parsed)));
}

function getVehicleExpiryTarget(rule) {
  if (cleanText(rule?.module) !== 'vehicles') return '';
  return VEHICLE_EXPIRY_EVENT_TARGETS[cleanText(rule?.eventType)] || '';
}

function isVehicleExpiryRule(rule) {
  return Boolean(getVehicleExpiryTarget(rule) && cleanText(rule?.entityId));
}

function getAffectedVehicleIds(beforeRule, afterRule) {
  return [...new Set(
    [beforeRule, afterRule]
      .filter(isVehicleExpiryRule)
      .map((rule) => cleanText(rule.entityId))
      .filter(Boolean)
  )];
}

function buildVehicleReminderConfiguration(rules) {
  const milestones = Object.fromEntries(VEHICLE_EXPIRY_TARGETS.map((target) => [target, []]));

  (Array.isArray(rules) ? rules : []).forEach((rule) => {
    if (rule?.enabled === false || !isVehicleExpiryRule(rule)) return;
    const target = getVehicleExpiryTarget(rule);
    milestones[target].push(normalizeReminderDaysBefore(rule.reminderDaysBefore));
  });

  VEHICLE_EXPIRY_TARGETS.forEach((target) => {
    milestones[target] = [...new Set(milestones[target])].sort((left, right) => right - left);
  });

  return {
    vehicleDocumentReminderDays: Object.fromEntries(
      VEHICLE_EXPIRY_TARGETS
        .filter((target) => milestones[target].length > 0)
        .map((target) => [target, milestones[target][0]])
    ),
    vehicleDocumentReminderMilestones: milestones,
  };
}

function ruleMatchesVehicleReminderDay(rule, reminderDaysBefore) {
  if (!getVehicleExpiryTarget(rule)) return true;
  if (reminderDaysBefore === null || reminderDaysBefore === undefined) return false;
  return normalizeReminderDaysBefore(rule.reminderDaysBefore) === Number(reminderDaysBefore);
}

module.exports = {
  VEHICLE_EXPIRY_EVENT_TARGETS,
  VEHICLE_EXPIRY_TARGETS,
  buildVehicleReminderConfiguration,
  getAffectedVehicleIds,
  getVehicleExpiryTarget,
  isVehicleExpiryRule,
  normalizeReminderDaysBefore,
  ruleMatchesVehicleReminderDay,
};
