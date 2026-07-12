const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gatewayPath = path.resolve(__dirname, "..", "index server de la gps pe server.cjs");
const source = fs.readFileSync(gatewayPath, "utf8");

test("gateway cost optimization is disabled by default and requires an explicit canary IMEI", () => {
  assert.match(source, /enabled:\s*false/);
  assert.match(
    source,
    /gpsCostConfig\.enabled\s*&&\s*gpsCostConfig\.canaryTrackerImeis\.has\(String\(imei\)\)/
  );
  assert.doesNotMatch(source, /canaryTrackerImeis:\s*new Set\(\[["']\d+/);
});

test("canary batching leaves GPS point storage and live snapshots on their existing flow", () => {
  assert.match(source, /if \(recordsForStorage\.length > 0\)/);
  assert.match(source, /batch\.set\(\s*pointRef,\s*pointPayload/);
  assert.match(
    source,
    /writeVehicleLiveSnapshot\([\s\S]*useGpsCostCanary \? null : dataUsageDelta/
  );
  assert.match(source, /liveDiagnostics:\s*latestDiagnostics/);
  assert.match(source, /currentKmIncrement/);
});

test("canary buffers diagnostic and usage writes and flushes on disconnect and shutdown", () => {
  assert.match(source, /queueGpsCostAggregation\(/);
  assert.match(source, /flushGpsCostBuffer\(session\.imei, "disconnect"\)/);
  assert.match(source, /flushAllGpsCostBuffers\("shutdown"\)/);
  assert.match(source, /GPS_COST_MIN_FLUSH_SECONDS = 30/);
  assert.match(source, /GPS_COST_MAX_FLUSH_SECONDS = 60/);
});

test("gateway retries only flush operations that were not already committed", () => {
  assert.match(source, /await updateDailyDiagnostics\([\s\S]*recordsByDay\.delete\(dayKey\)/);
  assert.match(
    source,
    /await writeVehicleDataUsageOnly\([\s\S]*dataUsageDelta = null;[\s\S]*restoreGpsCostBuffer\(buffer, recordsByDay, dataUsageDelta\)/
  );
});
