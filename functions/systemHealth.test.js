const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('health callable validates admin before returning runtime details', () => {
  const start = source.indexOf('exports.getWorkControlHealth = onCall');
  const end = source.indexOf('exports.sendPushOnNotificationCreated', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const authCheck = body.indexOf('await assertAdminRequest(request)');
  const response = body.indexOf("status: 'ok'");
  assert.ok(authCheck >= 0 && response > authCheck);
  assert.doesNotMatch(body, /openaiApiKey\.value|process\.env\.OPENAI_API_KEY/);
});
