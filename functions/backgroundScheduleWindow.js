const BACKGROUND_ACTIVE_HOURS_CRON = '7-17';

function buildDaytimeBackgroundSchedule(intervalMinutes) {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 59) {
    throw new TypeError('intervalMinutes must be an integer between 1 and 59');
  }

  return `*/${intervalMinutes} ${BACKGROUND_ACTIVE_HOURS_CRON} * * *`;
}

module.exports = {
  BACKGROUND_ACTIVE_HOURS_CRON,
  buildDaytimeBackgroundSchedule,
};
