const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IGNITION_OFF_SNAPSHOT_INTERVAL_MS,
  IGNITION_ON_SNAPSHOT_INTERVAL_MS,
  advanceRealPositionRetentionState,
  evaluateRealPositionRetention,
  shouldWriteLiveSnapshot24h,
} = require('../gps-stationary-write-policy.cjs');

function point(overrides = {}) {
  return {
    lat: 44.4,
    lng: 26.1,
    speedKmh: 0,
    gpsTimestamp: 1_000,
    eventIoId: 0,
    io: { 239: 0 },
    ...overrides,
  };
}

function apply(state, record) {
  const decision = evaluateRealPositionRetention(state, record);
  return { decision, state: advanceRealPositionRetentionState(state, record, decision) };
}

test('stores one stationary route point and drops later duplicate points all day', () => {
  let result = apply(null, point());
  assert.equal(result.decision.keep, true);

  result = apply(result.state, point({ gpsTimestamp: 30 * 60 * 1000 }));
  assert.equal(result.decision.keep, false);
  result = apply(result.state, point({ gpsTimestamp: 12 * 60 * 60 * 1000 }));
  assert.equal(result.decision.keep, false);
});

test('retains motion boundaries, ignition changes and tracker events', () => {
  let result = apply(null, point());
  result = apply(result.state, point({ lng: 26.101, speedKmh: 18, gpsTimestamp: 5_000, io: { 239: 1 } }));
  assert.equal(result.decision.keep, true);
  assert.equal(result.decision.motionChanged, true);
  assert.equal(result.decision.ignitionChanged, true);

  result = apply(result.state, point({ lng: 26.102, speedKmh: 0, gpsTimestamp: 10_000, io: { 239: 1 } }));
  assert.equal(result.decision.keep, true);
  assert.equal(result.decision.motionChanged, true);

  result = apply(result.state, point({ lng: 26.102, gpsTimestamp: 15_000, eventIoId: 239, io: { 239: 0 } }));
  assert.equal(result.decision.keep, true);
  assert.equal(result.decision.importantEvent, true);
});

test('keeps slow real movement but rejects zero-speed GPS drift', () => {
  let result = apply(null, point({ io: { 239: 1 } }));
  result = apply(result.state, point({ lng: 26.1003, speedKmh: 2, gpsTimestamp: 10_000, io: { 239: 1 } }));
  assert.equal(result.decision.keep, true);
  assert.equal(result.decision.moving, true);

  let drift = apply(null, point({ io: { 239: 1 } }));
  drift = apply(drift.state, point({ lng: 26.1003, speedKmh: 0, gpsTimestamp: 10_000, io: { 239: 1 } }));
  assert.equal(drift.decision.keep, false);
  assert.equal(drift.decision.moving, false);
});

test('keeps moving point density compatible with the existing route', () => {
  let result = apply(null, point({ speedKmh: 20, io: { 239: 1 } }));
  result = apply(result.state, point({ lng: 26.10001, speedKmh: 20, gpsTimestamp: 2_000, io: { 239: 1 } }));
  assert.equal(result.decision.keep, false);
  result = apply(result.state, point({ lng: 26.1001, speedKmh: 20, gpsTimestamp: 4_000, io: { 239: 1 } }));
  assert.equal(result.decision.keep, true);
});

test('throttles stationary snapshots and always writes movement or important changes', () => {
  const base = 1_000_000;
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: 0, now: base, moving: false, ignitionOn: false }), true);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + IGNITION_OFF_SNAPSHOT_INTERVAL_MS - 1, moving: false, ignitionOn: false }), false);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + IGNITION_OFF_SNAPSHOT_INTERVAL_MS, moving: false, ignitionOn: false }), true);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + IGNITION_ON_SNAPSHOT_INTERVAL_MS - 1, moving: false, ignitionOn: true }), false);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + IGNITION_ON_SNAPSHOT_INTERVAL_MS, moving: false, ignitionOn: true }), true);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + 1, moving: true, ignitionOn: true }), true);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + 1, moving: false, ignitionOn: false, immediate: true }), true);
  assert.equal(shouldWriteLiveSnapshot24h({ lastWriteAt: base, now: base + 1, moving: false, ignitionOn: false, currentKmIncrement: 0.1 }), true);
});

test('policy is real-GPS only and has no simulation contract', () => {
  const policy = require('../gps-stationary-write-policy.cjs');
  assert.equal(Object.keys(policy).some((key) => /sim/i.test(key)), false);
});
