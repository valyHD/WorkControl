const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_FIRESTORE_COST_CONTROL,
  getFirestoreCostControl,
  normalizeFirestoreCostControl,
  resetFirestoreCostControlCacheForTests,
} = require('./firestoreCostControl');

test('defaults to the reversible emergency configuration', () => {
  assert.deepEqual(normalizeFirestoreCostControl(null), DEFAULT_FIRESTORE_COST_CONTROL);
});

test('clamps unsafe limits', () => {
  assert.deepEqual(
    normalizeFirestoreCostControl({
      maxFleetSnapshotRefreshSeconds: 1,
      maxRoutePointsPerRequest: 50_000,
      billingRefreshMinutes: 2,
    }),
    {
      ...DEFAULT_FIRESTORE_COST_CONTROL,
      maxFleetSnapshotRefreshSeconds: 30,
      maxRoutePointsPerRequest: 2000,
      billingRefreshMinutes: 15,
    }
  );
});

test('reads the private configuration once while the cache is fresh', async () => {
  resetFirestoreCostControlCacheForTests();
  let reads = 0;
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => {
          reads += 1;
          return {
            exists: true,
            data: () => ({ emergencyMode: false, fleetRoutesOnDemandOnly: false }),
          };
        },
      }),
    }),
  };

  const first = await getFirestoreCostControl(db);
  const second = await getFirestoreCostControl(db);

  assert.equal(first.emergencyMode, false);
  assert.equal(second.fleetRoutesOnDemandOnly, false);
  assert.equal(reads, 1);
});
