const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { createSecurityHandlers } = require('./securityActions');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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
    return this._data?.[field];
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
  constructor(seed = {}) {
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
      update: (ref, data) => {
        const current = this.store.get(ref.path) || {};
        this.store.set(ref.path, { ...current, ...data });
      },
    };
    return callback(transaction);
  }
}

class FakeAuthAdmin {
  constructor(users = []) {
    this.usersByUid = new Map();
    this.usersByEmail = new Map();
    this.updatedUsers = [];
    for (const user of users) this.save(user);
  }

  save(user) {
    this.usersByUid.set(user.uid, { ...user });
    this.usersByEmail.set(user.email.toLowerCase(), { ...user });
  }

  async getUser(uid) {
    const user = this.usersByUid.get(uid);
    if (!user) throw Object.assign(new Error('missing user'), { code: 'auth/user-not-found' });
    return { ...user };
  }

  async getUserByEmail(email) {
    const user = this.usersByEmail.get(email.toLowerCase());
    if (!user) throw Object.assign(new Error('missing user'), { code: 'auth/user-not-found' });
    return { ...user };
  }

  async createUser(input) {
    if (this.usersByEmail.has(input.email.toLowerCase())) {
      throw Object.assign(new Error('duplicate email'), { code: 'auth/email-already-exists' });
    }
    const user = { uid: `uid-${this.usersByUid.size + 1}`, ...input };
    this.save(user);
    return { ...user };
  }

  async updateUser(uid, input) {
    const current = await this.getUser(uid);
    const next = { ...current, ...input };
    this.save(next);
    this.updatedUsers.push({ uid, input });
    return next;
  }

  async deleteUser(uid) {
    const current = this.usersByUid.get(uid);
    if (!current) return;
    this.usersByUid.delete(uid);
    this.usersByEmail.delete(current.email.toLowerCase());
  }
}

function createFixture({ documents = {}, authUsers = [] } = {}) {
  const db = new FakeFirestore({
    'users/admin-1': {
      uid: 'admin-1',
      fullName: 'Admin Test',
      email: 'admin@example.test',
      role: 'admin',
      active: true,
      accessStatus: 'active',
      primaryCompanyId: 'company-1',
      companyIds: ['company-1'],
    },
    ...documents,
  });
  const authAdmin = new FakeAuthAdmin(authUsers);
  const handlers = createSecurityHandlers({
    db,
    authAdmin,
    fieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
  });
  return { db, authAdmin, handlers };
}

describe('internal account creation security', () => {
  test('self registration requires an authenticated Firebase account', async () => {
    const { handlers } = createFixture();
    await assert.rejects(
      handlers.registerInternalAccount({ data: { fullName: 'User Test' } }),
      (error) => error.code === 'unauthenticated'
    );
  });

  test('self registration creates only an unassigned employee profile', async () => {
    const authUser = { uid: 'new-user', email: 'new@example.test', disabled: false };
    const { db, handlers } = createFixture({ authUsers: [authUser] });

    const result = await handlers.registerInternalAccount({
      auth: { uid: authUser.uid, token: { email: authUser.email } },
      data: {
        fullName: 'Utilizator Nou',
        role: 'admin',
        globalAdmin: true,
        companyId: 'company-1',
      },
    });
    const profile = db.store.get('users/new-user');

    assert.equal(result.created, true);
    assert.equal(profile.role, 'angajat');
    assert.equal(profile.globalAdmin, false);
    assert.equal(profile.active, true);
    assert.equal(profile.accessStatus, 'active');
    assert.deepEqual(profile.companyIds, []);
    assert.equal(profile.primaryCompanyId, '');
  });

  test('self registration is idempotent for the same authenticated account', async () => {
    const authUser = { uid: 'new-user', email: 'new@example.test', disabled: false };
    const { db, handlers } = createFixture({ authUsers: [authUser] });
    const request = {
      auth: { uid: authUser.uid, token: { email: authUser.email } },
      data: { fullName: 'Utilizator Nou' },
    };

    const first = await handlers.registerInternalAccount(request);
    const second = await handlers.registerInternalAccount(request);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal([...db.store.keys()].filter((path) => path === 'users/new-user').length, 1);
  });

  test('admin creation recovers an Auth account that has no internal profile', async () => {
    const orphan = { uid: 'orphan-user', email: 'orphan@example.test', disabled: false };
    const { db, authAdmin, handlers } = createFixture({ authUsers: [orphan] });

    const result = await handlers.adminCreateUser({
      auth: { uid: 'admin-1' },
      data: {
        fullName: 'Cont Recuperat',
        email: orphan.email,
        password: 'password123',
        role: 'angajat',
        companyId: 'company-1',
      },
    });

    assert.equal(result.userId, orphan.uid);
    assert.equal(db.store.get('users/orphan-user').fullName, 'Cont Recuperat');
    assert.equal(db.store.get('users/orphan-user').companyId, 'company-1');
    assert.equal(authAdmin.updatedUsers.length, 1);
    assert.equal(authAdmin.updatedUsers[0].input.password, 'password123');
  });

  test('admin creation never overwrites an existing internal profile', async () => {
    const existing = { uid: 'existing-user', email: 'existing@example.test', disabled: false };
    const { authAdmin, handlers } = createFixture({
      authUsers: [existing],
      documents: {
        'users/existing-user': {
          uid: existing.uid,
          email: existing.email,
          fullName: 'Utilizator Existent',
          role: 'angajat',
          active: true,
          accessStatus: 'active',
          companyIds: ['company-1'],
        },
      },
    });

    await assert.rejects(
      handlers.adminCreateUser({
        auth: { uid: 'admin-1' },
        data: {
          fullName: 'Nume Suprascris',
          email: existing.email,
          password: 'password123',
          role: 'angajat',
          companyId: 'company-1',
        },
      }),
      (error) => error.code === 'already-exists'
    );
    assert.equal(authAdmin.updatedUsers.length, 0);
  });
});
