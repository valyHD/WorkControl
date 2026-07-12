const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('feedback rules restrict ownership, categories and payload size', () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/appFeedback\/\{feedbackId\}/);
  assert.match(rules, /request\.resource\.data\.ownerUserId == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.message\.size\(\) <= 1500/);
  assert.match(rules, /allow read, update, delete: if isAdminUser\(\)/);
});
