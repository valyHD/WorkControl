import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { createSecurityHandlers } = require("../../functions/securityActions.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const app = initializeApp({ projectId: "demo-workcontrol-security" }, "security-actions-tests");
const db = getFirestore(app);
const handlers = createSecurityHandlers({
  db,
  authAdmin: {
    async createUser(input) {
      return { uid: `created-${input.email.split("@")[0]}` };
    },
    async deleteUser() {},
  },
  fieldValue: FieldValue,
  HttpsError: TestHttpsError,
  logger: { error() {}, warn() {}, info() {} },
});

async function clearFirestore() {
  await db.recursiveDelete(db.collection("users"));
  for (const name of [
    "projects",
    "timesheets",
    "activeTimesheets",
    "auditLogs",
    "notifications",
    "notificationRules",
    "notificationDispatchLimits",
    "notificationDispatchMarkers",
    "vehicles",
    "firmeMentenanta",
  ]) {
    await db.recursiveDelete(db.collection(name));
  }
}

async function seed() {
  await Promise.all([
    db.collection("users").doc("employee-a").set({
      uid: "employee-a",
      fullName: "Employee A",
      role: "angajat",
      active: true,
      accessStatus: "active",
      primaryCompanyId: "company-a",
      companyIds: ["company-a"],
    }),
    db.collection("users").doc("employee-b").set({
      uid: "employee-b",
      fullName: "Employee B",
      role: "angajat",
      active: true,
      accessStatus: "active",
      primaryCompanyId: "company-b",
      companyIds: ["company-b"],
    }),
    db.collection("users").doc("employee-a2").set({
      uid: "employee-a2",
      fullName: "Employee A2",
      role: "angajat",
      active: true,
      accessStatus: "active",
      primaryCompanyId: "company-a",
      companyIds: ["company-a"],
    }),
    db.collection("users").doc("manager-a").set({
      uid: "manager-a",
      fullName: "Manager A",
      role: "manager",
      active: true,
      accessStatus: "active",
      primaryCompanyId: "company-a",
      companyIds: ["company-a"],
    }),
    db.collection("users").doc("global-admin").set({
      uid: "global-admin",
      fullName: "Global Admin",
      email: "admin@example.test",
      role: "admin",
      active: true,
      accessStatus: "active",
      globalAdmin: true,
      primaryCompanyId: "company-a",
      companyIds: ["company-a", "company-b"],
    }),
    db.collection("users").doc("unassigned-user").set({
      uid: "unassigned-user",
      fullName: "Unassigned User",
      role: "angajat",
      active: true,
      accessStatus: "active",
      companyIds: [],
    }),
    db.collection("firmeMentenanta").doc("company-a").set({
      companyKey: "company-a",
      companyName: "Company A",
    }),
    db.collection("firmeMentenanta").doc("company-b").set({
      companyKey: "company-b",
      companyName: "Company B",
    }),
    db.collection("firmeMentenanta").doc("company-a-legacy").set({
      companyName: "Company A",
    }),
    db.collection("firmeMentenanta").doc("company-inactive").set({
      companyName: "Company Inactive",
      active: false,
    }),
    db.collection("projects").doc("project-a").set({
      companyId: "company-a",
      name: "Project A",
      code: "A",
      status: "activ",
    }),
    db.collection("vehicles").doc("vehicle-a").set({
      companyId: "company-a",
      plateNumber: "B33LGR",
      ownerUserId: "employee-a",
      currentDriverUserId: "employee-a",
      currentKm: 6200,
    }),
  ]);
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Testul necesita Firestore Emulator.");
});

beforeEach(async () => {
  await clearFirestore();
  await seed();
});

after(async () => {
  await clearFirestore();
  await deleteApp(app);
});

test("two concurrent start commands create exactly one active timesheet", async () => {
  const request = {
    auth: { uid: "employee-a" },
    data: { companyId: "company-a", projectId: "project-a", startSource: "web" },
  };
  const results = await Promise.all([
    handlers.startTimesheet(request),
    handlers.startTimesheet(request),
  ]);
  const timesheets = await db.collection("timesheets").get();
  const lock = await db.collection("activeTimesheets").doc("employee-a").get();

  assert.equal(timesheets.size, 1);
  assert.equal(lock.exists, true);
  assert.equal(results.filter((result) => result.duplicate === false).length, 1);
  assert.equal(results.filter((result) => result.duplicate === true).length, 1);
  assert.equal(results[0].timesheetId, results[1].timesheetId);
});

test("stop is idempotent and server calculates protected duration fields", async () => {
  const started = await handlers.startTimesheet({
    auth: { uid: "employee-a" },
    data: { companyId: "company-a", projectId: "project-a", occurredAt: Date.now() - 120_000 },
  });
  const first = await handlers.stopTimesheet({
    auth: { uid: "employee-a" },
    data: { timesheetId: started.timesheetId },
  });
  const second = await handlers.stopTimesheet({
    auth: { uid: "employee-a" },
    data: { timesheetId: started.timesheetId },
  });
  const saved = await db.collection("timesheets").doc(started.timesheetId).get();

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(saved.get("workedMinutes"), first.workedMinutes);
  assert.ok(first.workedMinutes >= 1);
});

test("negative mileage and cross-company vehicle changes are rejected", async () => {
  await assert.rejects(
    handlers.updateVehicleMileage({
      auth: { uid: "employee-a" },
      data: { vehicleId: "vehicle-a", currentKm: -1 },
    }),
    (error) => error.code === "invalid-argument"
  );
  await assert.rejects(
    handlers.requestVehicleTransfer({
      auth: { uid: "employee-a" },
      data: { vehicleId: "vehicle-a", nextDriverUserId: "employee-b" },
    }),
    (error) => error.code === "permission-denied"
  );
});

test("vehicle assignments and administrative mileage are transactionally controlled", async () => {
  await handlers.setVehicleAssignments({
    auth: { uid: "manager-a" },
    data: {
      vehicleId: "vehicle-a",
      ownerUserId: "employee-a",
      currentDriverUserId: "employee-a2",
    },
  });
  await handlers.updateVehicleMileage({
    auth: { uid: "manager-a" },
    data: { vehicleId: "vehicle-a", currentKm: 6300, initialRecordedKm: 6000 },
  });
  const vehicle = await db.collection("vehicles").doc("vehicle-a").get();
  assert.equal(vehicle.get("currentDriverUserId"), "employee-a2");
  assert.equal(vehicle.get("pendingDriverUserId"), "");
  assert.equal(vehicle.get("currentKm"), 6300);
  assert.equal(vehicle.get("initialRecordedKm"), 6000);

  await assert.rejects(
    handlers.setVehicleAssignments({
      auth: { uid: "manager-a" },
      data: {
        vehicleId: "vehicle-a",
        ownerUserId: "employee-a",
        currentDriverUserId: "employee-b",
      },
    }),
    (error) => error.code === "permission-denied"
  );
  const audit = await db.collection("auditLogs")
    .where("action", "==", "vehicle_assignments_updated")
    .limit(1)
    .get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].get("actorUserId"), "manager-a");
  assert.equal(audit.docs[0].get("before.currentDriverUserId"), "employee-a");
  assert.equal(audit.docs[0].get("after.currentDriverUserId"), "employee-a2");
});

test("client audit allowlist rejects arbitrary fake audit actions", async () => {
  await assert.rejects(
    handlers.recordAuditEvent({
      auth: { uid: "employee-a" },
      data: {
        companyId: "company-a",
        category: "users",
        action: "user_role_changed",
        title: "fake",
        message: "fake",
      },
    }),
    (error) => error.code === "invalid-argument"
  );
});

test("client audit presentation and identity are server-owned", async () => {
  const result = await handlers.recordAuditEvent({
    auth: { uid: "employee-a" },
    data: {
      companyId: "company-a",
      category: "navigation",
      action: "page_view",
      title: "Titlu fals",
      message: "Mesaj fals",
      path: "/vehicles",
      pageTitle: "Masini",
      actorUserId: "global-admin",
      before: { role: "admin" },
      after: { role: "angajat" },
    },
  });
  const audit = await db.collection("auditLogs").doc(result.auditId).get();
  assert.equal(audit.get("actorUserId"), "employee-a");
  assert.equal(audit.get("title"), "Pagina accesata");
  assert.equal(audit.get("message"), "Employee A a accesat Masini.");
  assert.deepEqual(audit.get("before"), {});
  assert.deepEqual(audit.get("after"), {});
});

test("primary company selection and assignments are server validated", async () => {
  const selected = await handlers.setPrimaryCompany({
    auth: { uid: "employee-a" },
    data: { companyId: "company-a" },
  });
  assert.equal(selected.companyId, "company-a");
  await assert.rejects(
    handlers.setPrimaryCompany({
      auth: { uid: "employee-a" },
      data: { companyId: "company-b" },
    }),
    (error) => error.code === "permission-denied"
  );

  const assigned = await handlers.assignUsersToCompany({
    auth: { uid: "global-admin" },
    data: { companyId: "company-b", userIds: ["unassigned-user"] },
  });
  const user = await db.collection("users").doc("unassigned-user").get();
  assert.equal(assigned.assignedCount, 1);
  assert.deepEqual(user.get("companyIds"), ["company-b"]);
  assert.equal(user.get("primaryCompanyId"), "company-b");
});

test("initial company choice is minimal, deduplicated and can be claimed only once", async () => {
  const choices = await handlers.listCompanyChoices({ auth: { uid: "unassigned-user" } });
  assert.deepEqual(choices.companies, [
    { companyId: "company-a", companyName: "Company A" },
    { companyId: "company-b", companyName: "Company B" },
  ]);

  const claimed = await handlers.claimInitialCompany({
    auth: { uid: "unassigned-user" },
    data: { companyId: "company-b" },
  });
  assert.deepEqual(claimed, { companyId: "company-b", companyName: "Company B" });

  const user = await db.collection("users").doc("unassigned-user").get();
  assert.equal(user.get("companyId"), "company-b");
  assert.deepEqual(user.get("companyIds"), ["company-b"]);
  assert.equal(user.get("primaryCompanyId"), "company-b");

  const audit = await db.collection("auditLogs")
    .where("action", "==", "user_initial_company_claimed")
    .where("actorUserId", "==", "unassigned-user")
    .limit(1)
    .get();
  assert.equal(audit.size, 1);

  await assert.rejects(
    handlers.claimInitialCompany({
      auth: { uid: "unassigned-user" },
      data: { companyId: "company-a" },
    }),
    (error) => error.code === "failed-precondition"
  );
});

test("notification dispatch has server-side idempotency and rate limiting", async () => {
  const request = (index) => ({
    auth: { uid: "employee-a" },
    data: {
      companyId: "company-a",
      module: "users",
      eventType: "user_site_entered",
      entityId: "employee-a",
      title: "Activitate",
      message: "Utilizator activ.",
      directUserId: "employee-a",
      idempotencyKey: `notification-${index}`,
    },
  });
  const first = await handlers.dispatchNotificationEvent(request(0));
  const duplicate = await handlers.dispatchNotificationEvent(request(0));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  const notification = await db.collection("notifications").limit(1).get();
  assert.equal(notification.docs[0].get("title"), "Actualizare WorkControl");
  assert.notEqual(notification.docs[0].get("message"), "Utilizator activ.");

  for (let index = 1; index < 19; index += 1) {
    await handlers.dispatchNotificationEvent(request(index));
  }
  await assert.rejects(
    handlers.dispatchNotificationEvent(request(20)),
    (error) => error.code === "resource-exhausted"
  );
});

test("employee cannot dispatch system events or unverifiable resource notifications", async () => {
  await assert.rejects(
    handlers.dispatchNotificationEvent({
      auth: { uid: "employee-a" },
      data: {
        companyId: "company-a",
        module: "users",
        eventType: "vehicle_updated",
        entityId: "employee-a",
        title: "Mesaj arbitrar",
        message: "Eveniment cu modul fals.",
      },
    }),
    (error) => error.code === "invalid-argument"
  );
  await assert.rejects(
    handlers.dispatchNotificationEvent({
      auth: { uid: "employee-a" },
      data: {
        companyId: "company-a",
        module: "backup",
        eventType: "backup_requested",
        title: "Mesaj arbitrar",
        message: "Trimite acest mesaj administratorilor.",
      },
    }),
    (error) => error.code === "permission-denied"
  );
  await assert.rejects(
    handlers.dispatchNotificationEvent({
      auth: { uid: "manager-a" },
      data: {
        companyId: "company-a",
        module: "vehicles",
        eventType: "vehicle_deleted",
        entityId: "vehicle-inexistent",
        title: "Mesaj arbitrar",
        message: "Masina a fost stearsa.",
      },
    }),
    (error) => error.code === "permission-denied"
  );
});

test("admin-created employee receives a server-owned active profile", async () => {
  const result = await handlers.adminCreateUser({
    auth: { uid: "global-admin" },
    data: {
      companyId: "company-a",
      fullName: "New Employee",
      email: "new.employee@example.test",
      password: "secure-test-password",
      role: "angajat",
    },
  });
  const profile = await db.collection("users").doc(result.userId).get();
  assert.equal(profile.get("active"), true);
  assert.equal(profile.get("accessStatus"), "active");
  assert.equal(profile.get("role"), "angajat");
  assert.equal(profile.get("companyId"), "company-a");
  assert.equal(profile.get("createdByUserId"), "global-admin");
});

test("manager cannot create an internal user", async () => {
  await assert.rejects(
    handlers.adminCreateUser({
      auth: { uid: "manager-a" },
      data: {
        companyId: "company-a",
        fullName: "Unauthorized Employee",
        email: "unauthorized.employee@example.test",
        password: "secure-test-password",
        role: "angajat",
      },
    }),
    (error) => error.code === "permission-denied"
  );
});
