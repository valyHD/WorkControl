const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { createSecurityHandlers } = require("./securityActions");

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
    this.id = path.split("/").at(-1);
  }

  async get() {
    return new FakeDocumentSnapshot(this, this.db.store.get(this.path));
  }
}

class FakeQuery {
  constructor(db, collectionPath, filters = [], maxItems = Infinity) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.filters = filters;
    this.maxItems = maxItems;
  }

  where(field, op, value) {
    return new FakeQuery(
      this.db,
      this.collectionPath,
      [...this.filters, { field, op, value }],
      this.maxItems
    );
  }

  limit(maxItems) {
    return new FakeQuery(this.db, this.collectionPath, this.filters, maxItems);
  }

  async get() {
    const prefix = `${this.collectionPath}/`;
    const docs = [];
    for (const [path, data] of this.db.store.entries()) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      const matches = this.filters.every((filter) => {
        if (filter.op !== "==") return false;
        return data?.[filter.field] === filter.value;
      });
      if (matches) docs.push(new FakeDocumentSnapshot(new FakeDocumentRef(this.db, path), data));
      if (docs.length >= this.maxItems) break;
    }
    return { empty: docs.length === 0, docs };
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

  where(field, op, value) {
    return new FakeQuery(this.db, this.path).where(field, op, value);
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
      set: (ref, data) => {
        this.store.set(ref.path, data);
      },
      update: (ref, data) => {
        const current = this.store.get(ref.path) || {};
        this.store.set(ref.path, { ...current, ...data });
      },
      delete: (ref) => {
        this.store.delete(ref.path);
      },
    };
    return callback(transaction);
  }
}

function withMockedNow(nowMs, callback) {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Date.now = originalNow;
    });
}

function createFixture(documents = {}) {
  const db = new FakeFirestore({
    "users/user-test": {
      uid: "user-test",
      fullName: "Utilizator Test",
      email: "user@example.test",
      role: "angajat",
      active: true,
      accessStatus: "active",
      primaryCompanyId: "company-1",
      companyIds: ["company-1"],
      themeKey: "blue",
    },
    "projects/project-1": {
      companyId: "company-1",
      name: "Service si Mentenanta",
      code: "",
      status: "activ",
    },
    ...documents,
  });
  const handlers = createSecurityHandlers({
    db,
    authAdmin: {},
    fieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
  });
  return { db, handlers };
}

describe("timesheet secure start", () => {
  test("marks a stale active timesheet incomplete and starts a fresh current-day timesheet", async () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const staleStart = new Date("2026-07-14T07:18:00+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/stale-active": {
        companyId: "company-1",
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        startAt: staleStart,
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-14",
        yearMonth: "2026-07",
        weekKey: "2026-W29",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "stale-active",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Bucuresti" },
          occurredAt: now,
          startSource: "web",
        },
      })
    );

    assert.equal(result.duplicate, false);
    assert.notEqual(result.timesheetId, "stale-active");
    assert.equal(db.store.get("timesheets/stale-active").status, "neinchis");
    assert.equal(db.store.get("timesheets/stale-active").stopPolicyFlag, "stale_active_replaced");
    assert.equal(db.store.get(`timesheets/${result.timesheetId}`).workDate, "2026-07-15");
    assert.equal(db.store.get(`timesheets/${result.timesheetId}`).status, "activ");
    assert.equal(db.store.get("activeTimesheets/user-test").timesheetId, result.timesheetId);
  });

  test("marks a legacy active timesheet with only workDate as incomplete", async () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/legacy-active": {
        companyId: "company-1",
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-14",
        yearMonth: "2026-07",
        weekKey: "2026-W29",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "legacy-active",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Bucuresti" },
          occurredAt: now,
        },
      })
    );

    assert.equal(result.duplicate, false);
    assert.notEqual(result.timesheetId, "legacy-active");
    assert.equal(db.store.get("timesheets/legacy-active").status, "neinchis");
    assert.equal(db.store.get(`timesheets/${result.timesheetId}`).workDate, "2026-07-15");
  });

  test("uses server time for live web starts when the client sends a stale timestamp", async () => {
    const now = new Date("2026-07-15T07:18:39+03:00").getTime();
    const staleClientTime = new Date("2026-07-14T18:59:41+03:00").getTime();
    const { db, handlers } = createFixture();

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Splaiul Unirii" },
          occurredAt: staleClientTime,
          startSource: "web",
        },
      })
    );

    const created = db.store.get(`timesheets/${result.timesheetId}`);
    assert.equal(created.workDate, "2026-07-15");
    assert.equal(created.startAt, now);
    assert.equal(created.startSource, "web");
  });

  test("keeps the queued offline start timestamp only when offline replay is explicit", async () => {
    const now = new Date("2026-07-15T12:00:00+03:00").getTime();
    const offlineStart = new Date("2026-07-14T18:59:41+03:00").getTime();
    const { db, handlers } = createFixture();

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Offline" },
          occurredAt: offlineStart,
          offlineReplay: true,
          startSource: "web",
        },
      })
    );

    const created = db.store.get(`timesheets/${result.timesheetId}`);
    assert.equal(created.workDate, "2026-07-14");
    assert.equal(created.startAt, offlineStart);
  });

  test("replaces a previous-day active timesheet after twelve hours", async () => {
    const now = new Date("2026-07-15T07:18:39+03:00").getTime();
    const previousEveningStart = new Date("2026-07-14T18:59:41+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/previous-evening-active": {
        companyId: "company-1",
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        startAt: previousEveningStart,
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-14",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "previous-evening-active",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Splaiul Unirii" },
          startSource: "web",
        },
      })
    );

    assert.equal(result.duplicate, false);
    assert.equal(db.store.get("timesheets/previous-evening-active").status, "neinchis");
    assert.equal(db.store.get(`timesheets/${result.timesheetId}`).workDate, "2026-07-15");
  });

  test("closes every stale active timesheet returned by the active query", async () => {
    const now = new Date("2026-07-15T12:36:00+03:00").getTime();
    const staleStart = new Date("2026-07-14T07:18:00+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/stale-active-a": {
        companyId: "company-1",
        userId: "user-test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        startAt: staleStart,
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-14",
      },
      "timesheets/stale-active-b": {
        companyId: "company-1",
        userId: "user-test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-13",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "stale-active-a",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Bucuresti" },
          occurredAt: now,
        },
      })
    );

    assert.equal(result.duplicate, false);
    assert.equal(db.store.get("timesheets/stale-active-a").status, "neinchis");
    assert.equal(db.store.get("timesheets/stale-active-b").status, "neinchis");
    assert.equal(db.store.get(`timesheets/${result.timesheetId}`).status, "activ");
  });

  test("keeps a legitimate overnight active timesheet as the duplicate active record", async () => {
    const now = new Date("2026-07-15T06:00:00+03:00").getTime();
    const overnightStart = new Date("2026-07-14T23:00:00+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/overnight-active": {
        companyId: "company-1",
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        startAt: overnightStart,
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-14",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "overnight-active",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.startTimesheet({
        auth: { uid: "user-test" },
        data: {
          companyId: "company-1",
          projectId: "project-1",
          startLocation: { label: "Bucuresti" },
          occurredAt: now,
        },
      })
    );

    assert.equal(result.duplicate, true);
    assert.equal(result.timesheetId, "overnight-active");
    assert.equal(db.store.get("timesheets/overnight-active").status, "activ");
  });
});

describe("timesheet secure stop", () => {
  test("uses server time when the client stop timestamp is not after start", async () => {
    const now = new Date("2026-07-15T17:20:00+03:00").getTime();
    const startAt = new Date("2026-07-15T15:03:18+03:00").getTime();
    const { db, handlers } = createFixture({
      "timesheets/stale-stop": {
        companyId: "company-1",
        userId: "user-test",
        userName: "Utilizator Test",
        projectId: "project-1",
        projectName: "Service si Mentenanta",
        status: "activ",
        startAt,
        stopAt: null,
        workedMinutes: 0,
        workDate: "2026-07-15",
      },
      "activeTimesheets/user-test": {
        companyId: "company-1",
        userId: "user-test",
        timesheetId: "stale-stop",
      },
    });

    const result = await withMockedNow(now, () =>
      handlers.stopTimesheet({
        auth: { uid: "user-test" },
        data: {
          timesheetId: "stale-stop",
          occurredAt: startAt,
        },
      })
    );
    const saved = db.store.get("timesheets/stale-stop");

    assert.equal(result.duplicate, false);
    assert.equal(saved.stopAt, now);
    assert.equal(saved.workedMinutes, 137);
    assert.equal(db.store.has("activeTimesheets/user-test"), false);
  });
});
