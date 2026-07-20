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

test("billing read, refresh and settings callables validate every active admin before accessing data", () => {
  const refreshBody = callableBody("refreshBillingMetricsNow", "getBillingControlPanelData");
  const readBody = callableBody("getBillingControlPanelData", "getLiveFirebaseCostEstimate");
  const liveBody = callableBody("getLiveFirebaseCostEstimate", "saveBillingCostSettings");
  const saveBody = callableBody("saveBillingCostSettings", "sendPushOnNotificationCreated");

  for (const body of [refreshBody, readBody, liveBody, saveBody]) {
    const authCheck = body.indexOf("await assertBillingAdminRequest(request)");
    assert.ok(authCheck >= 0);
    const firstDatabaseAccess = body.search(
      /db\.collection|refreshBillingMetricsCache|await getEcbRates|return await getLiveFirebaseCostEstimate/
    );
    assert.ok(firstDatabaseAccess > authCheck);
  }
});

test("billing admin validation checks the role without requiring the legacy globalAdmin flag", () => {
  const start = source.indexOf("async function assertBillingAdminRequest");
  const end = source.indexOf("async function assertActiveInternalRequest", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = source.slice(start, end);
  assert.match(body, /context\.role !== 'admin'/);
  assert.doesNotMatch(body, /context\.globalAdmin/);
});

test("private cost documents are never exposed through a direct client rule", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "..", "firestore.rules"), "utf8");
  for (const collectionName of ["systemMetrics", "systemPrivateSettings", "systemCostSettings"]) {
    assert.match(
      rules,
      new RegExp(
        `match \\/${collectionName}\\/\\{[^}]+\\} \\{\\s+allow read: if globalAdmin\\(\\);\\s+allow write: if false;\\s+\\}`
      )
    );
  }
});

test("fleet overview and cost-control writes require global admin validation", () => {
  const fleetBody = callableBody("getFleetGpsOverview", "saveFirestoreCostControl");
  const saveBody = callableBody("saveFirestoreCostControl", "refreshBillingMetrics");
  assert.ok(fleetBody.indexOf("await assertAdminRequest(request)") >= 0);
  assert.ok(
    fleetBody.indexOf("return loadFleetGpsOverview()") >
      fleetBody.indexOf("await assertAdminRequest(request)")
  );
  assert.ok(saveBody.indexOf("await assertAdminRequest(request)") >= 0);
  assert.ok(
    saveBody.indexOf("saveFirestoreCostControl(db") >
      saveBody.indexOf("await assertAdminRequest(request)")
  );
});
