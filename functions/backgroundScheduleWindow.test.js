const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKGROUND_ACTIVE_HOURS_CRON,
  buildDaytimeBackgroundSchedule,
} = require('./backgroundScheduleWindow');

test('keeps scheduled background work inactive from 18:00 until 07:00 Bucharest time', () => {
  assert.equal(BACKGROUND_ACTIVE_HOURS_CRON, '7-17');
  assert.equal(buildDaytimeBackgroundSchedule(5), '*/5 7-17 * * *');
  assert.equal(buildDaytimeBackgroundSchedule(15), '*/15 7-17 * * *');
});

test('rejects invalid background schedule intervals', () => {
  assert.throws(() => buildDaytimeBackgroundSchedule(0), TypeError);
  assert.throws(() => buildDaytimeBackgroundSchedule(60), TypeError);
  assert.throws(() => buildDaytimeBackgroundSchedule(2.5), TypeError);
});
