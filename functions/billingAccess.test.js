const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

function callableBody(exportName, nextExportName) {
  const start = source.indexOf(`exports.${exportName} = onCall`);
  const end = source.indexOf(`exports.${nextExportName}`, start + 1);
  assert.ok(start >= 0, `${exportName} must exist`);
  assert.ok(end > start, `${exportName} must end before ${nextExportName}`);
  return source.slice(start, end);
}

test("billing read, refresh and settings callables validate admin before accessing data", () => {
  const refreshBody = callableBody("refreshBillingMetricsNow", "getBillingControlPanelData");
  const readBody = callableBody("getBillingControlPanelData", "saveBillingCostSettings");
  const saveBody = callableBody("saveBillingCostSettings", "sendPushOnNotificationCreated");

  for (const body of [refreshBody, readBody, saveBody]) {
    const authCheck = body.indexOf("await assertAdminRequest(request)");
    assert.ok(authCheck >= 0);
    const firstDatabaseAccess = body.search(/db\.collection|refreshBillingMetricsCache/);
    assert.ok(firstDatabaseAccess > authCheck);
  }
});

test("private cost documents are never exposed through a direct client rule", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "..", "firestore.rules"), "utf8");
  assert.doesNotMatch(rules, /match \/systemMetrics\//);
  assert.doesNotMatch(rules, /match \/systemPrivateSettings\//);
  assert.doesNotMatch(rules, /match \/systemCostSettings\//);
});
