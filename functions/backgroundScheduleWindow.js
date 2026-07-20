const BACKGROUND_ACTIVE_HOURS_CRON = '7-17';
const BACKGROUND_ACTIVE_START_HOUR = 7;
const BACKGROUND_ACTIVE_END_HOUR = 17;

function buildDaytimeBackgroundSchedule(intervalMinutes) {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 59) {
    throw new TypeError('intervalMinutes must be an integer between 1 and 59');
  }

  return `*/${intervalMinutes} ${BACKGROUND_ACTIVE_HOURS_CRON} * * *`;
}

function buildDaytimeHourlySchedule(intervalHours) {
  if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 11) {
    throw new TypeError('intervalHours must be an integer between 1 and 11');
  }

  const hours = [];
  for (
    let hour = BACKGROUND_ACTIVE_START_HOUR;
    hour <= BACKGROUND_ACTIVE_END_HOUR;
    hour += intervalHours
  ) {
    hours.push(hour);
  }

  return `0 ${hours.join(',')} * * *`;
}

module.exports = {
  BACKGROUND_ACTIVE_HOURS_CRON,
  buildDaytimeBackgroundSchedule,
  buildDaytimeHourlySchedule,
};
