const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProjectionEnvelope,
  hashProjection,
  shouldWriteProjection,
  writeProjectionIfChanged,
} = require('./projectionPayload');

test('projection hash is stable regardless of object key order', () => {
  assert.equal(
    hashProjection({ plate: 'B33LGR', driver: { id: 'user-a', name: 'A' } }, 2),
    hashProjection({ driver: { name: 'A', id: 'user-a' }, plate: 'B33LGR' }, 2)
  );
});

test('identical projection payload is a no-op even when the source timestamp changes', () => {
  const current = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 100);
  const retry = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 200);
  assert.equal(shouldWriteProjection(current, retry), false);
});

test('stale trigger retry cannot overwrite a newer projection', () => {
  const current = buildProjectionEnvelope({ plate: 'B44ABC' }, 2, 200);
  const stale = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 100);
  assert.equal(shouldWriteProjection(current, stale), false);
});

test('a relevant newer payload is written once', () => {
  const current = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 100);
  const next = buildProjectionEnvelope({ plate: 'B44ABC' }, 2, 200);
  assert.equal(shouldWriteProjection(current, next), true);
});

test('idempotent retry performs zero writes', async () => {
  const current = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 100);
  let writes = 0;
  const db = {
    runTransaction: async (handler) => handler({
      get: async () => ({ exists: true, data: () => current }),
      set: () => { writes += 1; },
    }),
  };
  const result = await writeProjectionIfChanged({
    db,
    ref: {},
    payload: { plate: 'B33LGR' },
    version: 2,
    sourceUpdatedAtMs: 200,
    serverTimestamp: () => 'server-time',
  });
  assert.equal(result, false);
  assert.equal(writes, 0);
});

test('relevant projection update performs one write', async () => {
  const current = buildProjectionEnvelope({ plate: 'B33LGR' }, 2, 100);
  let writes = 0;
  const db = {
    runTransaction: async (handler) => handler({
      get: async () => ({ exists: true, data: () => current }),
      set: () => { writes += 1; },
    }),
  };
  const result = await writeProjectionIfChanged({
    db,
    ref: {},
    payload: { plate: 'B44ABC' },
    version: 2,
    sourceUpdatedAtMs: 200,
    serverTimestamp: () => 'server-time',
  });
  assert.equal(result, true);
  assert.equal(writes, 1);
});
