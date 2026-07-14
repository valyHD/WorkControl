const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  computeConsolidatedMileage,
  normalizeRuntimeLiveConfig,
  shouldUseRuntimeLive,
  shouldWriteDayMetadata,
} = require("../gps-write-amplification-core.cjs");

test("runtime live rollout is disabled unless an explicit tracker is selected", () => {
  const disabled = normalizeRuntimeLiveConfig({});
  assert.equal(shouldUseRuntimeLive(disabled, "tracker-a"), false);

  const enabled = normalizeRuntimeLiveConfig({
    runtimeLive: { enabled: true, trackerImeis: ["tracker-a"] },
  });
  assert.equal(shouldUseRuntimeLive(enabled, "tracker-a"), true);
  assert.equal(shouldUseRuntimeLive(enabled, "tracker-b"), false);
  assert.equal(enabled.dualWriteRoot, true);

  const runtimeOnly = normalizeRuntimeLiveConfig({
    runtimeLive: { enabled: true, trackerImeis: ["tracker-a"], dualWriteRoot: false },
  });
  assert.equal(runtimeOnly.dualWriteRoot, false);
});

test("runtime consolidation keeps pending mileage exactly once", () => {
  assert.equal(computeConsolidatedMileage(6200, 6200, 1.25), 6201.25);
  assert.equal(computeConsolidatedMileage(6201.25, 6201.25, 0), 6201.25);
  assert.equal(computeConsolidatedMileage(6300, 6200, 1.25), 6301.25);
});

test("day metadata writes are throttled while point writes remain independent", () => {
  assert.equal(shouldWriteDayMetadata(0, 1000, 600), true);
  assert.equal(shouldWriteDayMetadata(1000, 1000 + 599_999, 600), false);
  assert.equal(shouldWriteDayMetadata(1000, 1000 + 600_000, 600), true);
});

test("gateway keeps legacy writes as rollback and gates runtime writes by configuration", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "index server de la gps pe server.cjs"),
    "utf8"
  );
  assert.match(source, /shouldUseRuntimeLive\(gpsCostConfig\.runtimeLive, imei\)/);
  assert.match(source, /writeVehicleRuntimeLiveSnapshot\(/);
  assert.match(source, /writeVehicleLiveSnapshot\(/);
  assert.match(source, /collection\("positions"\)\.doc\("_runtime"\)/);
  assert.doesNotMatch(source, /runtimeTrackerImeis:\s*\[["']\d+/);
});

test("runtime backfill never overwrites a valid document with pending mileage", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "scripts", "backfill-vehicle-runtime-live.mjs"),
    "utf8"
  );
  const guardIndex = source.indexOf(
    'if (runtime.exists && runtime.get("schemaVersion") === 1) continue;'
  );
  const candidateIndex = source.indexOf("candidates.push");
  assert.ok(guardIndex >= 0, "missing valid-runtime idempotency guard");
  assert.ok(candidateIndex > guardIndex, "runtime guard must run before scheduling a write");
});
