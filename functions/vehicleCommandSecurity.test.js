const assert = require('node:assert/strict');
const { beforeEach, describe, test } = require('node:test');
const { createSecurityHandlers } = require('./securityActions');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readNested(data, field) {
  return field.split('.').reduce((value, key) => value?.[key], data);
}

class FakeDocumentSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this._data = data;
    this.exists = data !== undefined;
  }

  data() {
    return this._data;
  }

  get(field) {
    return readNested(this._data, field);
  }
}

class FakeDocumentRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').at(-1);
  }

  async get() {
    return new FakeDocumentSnapshot(this, this.db.store.get(this.path));
  }

  collection(name) {
    return new FakeCollectionRef(this.db, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentRef(this.db, `${this.path}/${id || `auto_${++this.db.autoId}`}`);
  }
}

class FakeFirestore {
  constructor(seed) {
    this.store = new Map(Object.entries(seed));
    this.autoId = 0;
  }

  collection(name) {
    return new FakeCollectionRef(this, name);
  }

  async runTransaction(callback) {
    const transaction = {
      get: (ref) => ref.get(),
      create: (ref, data) => {
        if (this.store.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
        this.store.set(ref.path, data);
      },
      set: (ref, data) => {
        this.store.set(ref.path, data);
      },
      update: (ref, data) => {
        const current = this.store.get(ref.path) || {};
        this.store.set(ref.path, { ...current, ...data });
      },
    };
    return callback(transaction);
  }
}

function createFixture(overrides = {}) {
  const db = new FakeFirestore({
    'users/global-admin': {
      role: 'admin',
      active: true,
      accessStatus: 'active',
      globalAdmin: true,
      fullName: 'Administrator global',
      companyIds: [],
    },
    'users/company-admin': {
      role: 'admin',
      active: true,
      accessStatus: 'active',
      fullName: 'Administrator firma doi',
      primaryCompanyId: 'company-2',
      companyIds: ['company-2'],
    },
    'users/company-admin-1': {
      role: 'admin',
      active: true,
      accessStatus: 'active',
      fullName: 'Administrator firma unu',
      primaryCompanyId: 'company-1',
      companyIds: ['company-1'],
    },
    'users/manager-1': {
      role: 'manager',
      active: true,
      accessStatus: 'active',
      fullName: 'Manager Test',
      primaryCompanyId: 'company-1',
      companyIds: ['company-1'],
    },
    'users/employee-1': {
      role: 'angajat',
      active: true,
      accessStatus: 'active',
      fullName: 'Angajat Test',
      primaryCompanyId: 'company-1',
      companyIds: ['company-1'],
    },
    'vehicles/vehicle-1': {
      companyId: 'company-1',
      plateNumber: 'B33LGR',
      tracker: { imei: '123456789012345' },
    },
    'trackerBindings/123456789012345': { vehicleId: 'vehicle-1' },
    ...overrides,
  });
  const handlers = createSecurityHandlers({
    db,
    authAdmin: {},
    fieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
  });
  return { db, handler: handlers.requestVehicleCommand };
}

function commandRequest(uid, data = {}) {
  return {
    auth: { uid },
    data: {
      vehicleId: 'vehicle-1',
      type: 'block_start',
      durationSec: 30,
      requestId: 'request_12345678',
      ...data,
    },
  };
}

describe('secured requestVehicleCommand callable', () => {
  let fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  test('allows only an administrator with access to the vehicle company', async () => {
    await assert.rejects(
      fixture.handler(commandRequest('employee-1')),
      (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
      fixture.handler(commandRequest('manager-1')),
      (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
      fixture.handler(commandRequest('company-admin')),
      (error) => error.code === 'permission-denied'
    );

    const result = await fixture.handler(commandRequest('company-admin-1'));
    assert.equal(result.status, 'requested');
    assert.equal(result.duplicate, false);
  });

  test('creates one gateway-compatible command, lock and server-owned audit record', async () => {
    const result = await fixture.handler(commandRequest('global-admin'));
    const command = fixture.db.store.get(`vehicles/vehicle-1/commands/${result.commandId}`);
    const lock = fixture.db.store.get('vehicleCommandLocks/vehicle-1_block_start');
    const audits = [...fixture.db.store.entries()].filter(([path]) => path.startsWith('auditLogs/'));

    assert.equal(command.actorUid, 'global-admin');
    assert.equal(command.actorRole, 'admin');
    assert.equal(command.companyId, 'company-1');
    assert.equal(command.trackerImei, '123456789012345');
    assert.equal(command.type, 'block_start');
    assert.equal(command.status, 'requested');
    assert.equal(lock.commandId, result.commandId);
    assert.equal(lock.status, 'active');
    assert.equal(audits.length, 1);
    assert.equal(audits[0][1].action, 'vehicle_command_requested');
    assert.equal(audits[0][1].actorUserId, 'global-admin');
  });

  test('rejects invalid commands, durations and tracker bindings', async () => {
    await assert.rejects(
      fixture.handler(commandRequest('global-admin', { type: 'unknown_command' })),
      (error) => error.code === 'invalid-argument'
    );
    await assert.rejects(
      fixture.handler(commandRequest('global-admin', { durationSec: 301 })),
      (error) => error.code === 'invalid-argument'
    );

    const mismatch = createFixture({
      'trackerBindings/123456789012345': { vehicleId: 'another-vehicle' },
    });
    await assert.rejects(
      mismatch.handler(commandRequest('global-admin')),
      (error) => error.code === 'failed-precondition'
    );
  });

  test('returns the existing command for an idempotent retry without duplicating audit', async () => {
    const first = await fixture.handler(commandRequest('global-admin'));
    const second = await fixture.handler(commandRequest('global-admin'));
    const commands = [...fixture.db.store.keys()].filter((path) => path.includes('/commands/'));
    const audits = [...fixture.db.store.keys()].filter((path) => path.startsWith('auditLogs/'));

    assert.equal(second.commandId, first.commandId);
    assert.equal(second.duplicate, true);
    assert.equal(commands.length, 1);
    assert.equal(audits.length, 1);
  });

  test('rejects a second active command of the same type', async () => {
    await fixture.handler(commandRequest('global-admin'));

    await assert.rejects(
      fixture.handler(commandRequest('global-admin', { requestId: 'request_87654321' })),
      (error) => error.code === 'already-exists'
    );
  });
});
