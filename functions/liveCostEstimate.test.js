const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FIRESTORE_STANDARD_PRICES_USD_PER_100K,
  ESTIMATED_EGRESS_BYTES_PER_READ,
  INTERNET_EGRESS_USD_PER_GIB,
  buildLiveCostEstimate,
  estimatedEgressCostUsd,
  operationCostUsd,
} = require("./liveCostEstimate");

function point(endTime, value) {
  return { interval: { endTime }, value: { int64Value: String(value) } };
}

test("calculates EUR per minute, hourly projection and reported last-hour cost", () => {
  const readPoints = [];
  const writePoints = [];
  const deletePoints = [];
  for (let minute = 1; minute <= 60; minute += 1) {
    const endTime = new Date(Date.UTC(2026, 6, 12, 11, minute)).toISOString();
    readPoints.push(point(endTime, 1_000));
    writePoints.push(point(endTime, 100));
    deletePoints.push(point(endTime, 10));
  }

  const result = buildLiveCostEstimate({
    readPoints,
    writePoints,
    deletePoints,
    usdPerEur: 1.2,
    rateDate: "2026-07-10",
    now: new Date("2026-07-12T12:04:00Z"),
  });

  const minuteCostUsd =
    operationCostUsd({ reads: 1_000, writes: 100, deletes: 10 }) + estimatedEgressCostUsd(1_000);
  assert.equal(result.status, "current");
  assert.equal(result.readsPerMinute, 1_000);
  assert.equal(result.writesPerMinute, 100);
  assert.equal(result.costPerMinuteEur, Number((minuteCostUsd / 1.2).toFixed(8)));
  assert.equal(result.projectedHourlyEur, Number(((minuteCostUsd / 1.2) * 60).toFixed(8)));
  assert.equal(result.estimatedLastHourEur, Number(((minuteCostUsd / 1.2) * 60).toFixed(8)));
  assert.equal(result.lagSeconds, 240);
  assert.equal(result.estimatedEgressMiBPerMinute, 3.691);
});

test("keeps the reported hourly cost based on the full 60 minute window during a short spike", () => {
  const readPoints = [];
  for (let minute = 1; minute <= 60; minute += 1) {
    const endTime = new Date(Date.UTC(2026, 6, 12, 11, minute)).toISOString();
    readPoints.push(point(endTime, minute > 55 ? 10_000 : 1_000));
  }

  const result = buildLiveCostEstimate({
    readPoints,
    writePoints: [],
    deletePoints: [],
    usdPerEur: 1,
    rateDate: "2026-07-10",
    now: new Date("2026-07-12T12:04:00Z"),
  });

  const expectedHourUsd =
    operationCostUsd({ reads: 105_000 }) + estimatedEgressCostUsd(105_000);
  assert.equal(result.sampledWindowMinutes, 15);
  assert.equal(result.readsLastHour, 105_000);
  assert.equal(result.estimatedLastHourEur, Number(expectedHourUsd.toFixed(8)));
  assert.ok(result.projectedHourlyEur > result.estimatedLastHourEur);
});

test("returns unavailable rather than a false zero when Monitoring has no points", () => {
  const result = buildLiveCostEstimate({
    readPoints: [],
    writePoints: [],
    deletePoints: [],
    usdPerEur: 1.2,
    rateDate: "2026-07-10",
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.costPerMinuteEur, null);
  assert.equal(result.estimatedLastHourEur, null);
});

test("uses the documented Belgium Standard operation prices", () => {
  assert.deepEqual(FIRESTORE_STANDARD_PRICES_USD_PER_100K, {
    reads: 0.03,
    writes: 0.09,
    deletes: 0.01,
  });
  assert.equal(ESTIMATED_EGRESS_BYTES_PER_READ, 3.78 * 1024);
  assert.equal(INTERNET_EGRESS_USD_PER_GIB, 0.12);
});
