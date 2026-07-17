import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-workcontrol-security";
let env;

const profiles = {
  global: {
    uid: "global",
    fullName: "Global Admin",
    role: "admin",
    active: true,
    accessStatus: "active",
    globalAdmin: true,
    primaryCompanyId: "company-a",
    companyIds: ["company-a", "company-b"],
  },
  legacyAdmin: {
    uid: "legacy-admin",
    fullName: "Legacy Admin",
    role: "admin",
    active: true,
    accessStatus: "active",
    companyIds: [],
  },
  adminA: {
    uid: "admin-a",
    fullName: "Admin A",
    role: "admin",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
  managerA: {
    uid: "manager-a",
    fullName: "Manager A",
    role: "manager",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
  employeeA: {
    uid: "employee-a",
    fullName: "Employee A",
    role: "angajat",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
  employeeA2: {
    uid: "employee-a2",
    fullName: "Employee A2",
    role: "angajat",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
  managerB: {
    uid: "manager-b",
    fullName: "Manager B",
    role: "manager",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-b",
    companyIds: ["company-b"],
  },
  employeeB: {
    uid: "employee-b",
    fullName: "Employee B",
    role: "angajat",
    active: true,
    accessStatus: "active",
    primaryCompanyId: "company-b",
    companyIds: ["company-b"],
  },
  pending: {
    uid: "pending",
    fullName: "Pending",
    role: "angajat",
    active: false,
    accessStatus: "pending",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
  disabled: {
    uid: "disabled",
    fullName: "Disabled",
    role: "angajat",
    active: false,
    accessStatus: "disabled",
    primaryCompanyId: "company-a",
    companyIds: ["company-a"],
  },
};

function firestore(uid) {
  return env.authenticatedContext(uid).firestore();
}

function storage(uid) {
  return env.authenticatedContext(uid).storage();
}

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const profile of Object.values(profiles)) {
      await setDoc(doc(db, "users", profile.uid), profile);
      for (const companyId of profile.companyIds) {
        await setDoc(doc(db, "userOperationalViews", `${companyId}__${profile.uid}`), {
          uid: profile.uid,
          companyId,
          fullName: profile.fullName,
          role: profile.role,
          active: profile.active,
          accessStatus: profile.accessStatus,
        });
      }
    }
    await setDoc(doc(db, "projects", "project-a"), { companyId: "company-a", name: "A" });
    await setDoc(doc(db, "projects", "project-b"), { companyId: "company-b", name: "B" });
    await setDoc(doc(db, "vehicles", "vehicle-a"), {
      companyId: "company-a",
      plateNumber: "B33LGR",
      ownerUserId: "employee-a",
      currentDriverUserId: "employee-a",
      pendingDriverUserId: "",
      currentKm: 6200,
      initialRecordedKm: 6000,
      tracker: { imei: "123456789012345", secret: "hidden" },
    });
    await setDoc(doc(db, "vehicles", "vehicle-a-unassigned"), {
      companyId: "company-a",
      plateNumber: "B44AAA",
      ownerUserId: "",
      currentDriverUserId: "employee-a2",
      pendingDriverUserId: "",
      currentKm: 100,
      initialRecordedKm: 50,
    });
    await setDoc(doc(db, "vehicles", "vehicle-b"), {
      companyId: "company-b",
      plateNumber: "B55BBB",
      ownerUserId: "employee-b",
      currentDriverUserId: "employee-b",
      pendingDriverUserId: "",
      currentKm: 200,
      initialRecordedKm: 100,
    });
    await setDoc(doc(db, "vehicleOperationalViews", "vehicle-a"), {
      vehicleId: "vehicle-a",
      companyId: "company-a",
      plateNumber: "B33LGR",
      ownerUserId: "employee-a",
      currentDriverUserId: "employee-a",
      pendingDriverUserId: "",
      gpsSnapshot: { lat: 44.4, lng: 26.1 },
    });
    await setDoc(doc(db, "vehicles", "vehicle-a", "positionDays", "2026-07-13", "points", "p1"), {
      lat: 44.4,
      lng: 26.1,
    });
    await setDoc(doc(db, "vehicles", "vehicle-a-unassigned", "positionDays", "2026-07-13", "points", "p1"), {
      lat: 44.5,
      lng: 26.2,
    });
    await setDoc(doc(db, "tools", "tool-a"), {
      companyId: "company-a",
      name: "Bosch",
      ownerUserId: "employee-a",
      currentHolderUserId: "employee-a",
      pendingHolderUserId: "",
    });
    await setDoc(doc(db, "tools", "tool-b"), {
      companyId: "company-b",
      name: "Makita",
      ownerUserId: "employee-b",
      currentHolderUserId: "employee-b",
      pendingHolderUserId: "",
    });
    await setDoc(doc(db, "maintenanceClients", "client-a"), { companyId: "company-a", name: "Client A" });
    await setDoc(doc(db, "maintenanceClients", "client-b"), { companyId: "company-b", name: "Client B" });
    await setDoc(doc(db, "maintenanceClients", "client-a", "rapoarte", "report-a"), {
      companyId: "company-a",
      clientId: "client-a",
      createdAt: 1000,
    });
    await setDoc(doc(db, "maintenanceClients", "client-b", "rapoarte", "report-b"), {
      companyId: "company-b",
      clientId: "client-b",
      createdAt: 1000,
    });
    await setDoc(doc(db, "timesheets", "time-a"), {
      companyId: "company-a",
      userId: "employee-a",
      status: "activ",
      startAt: 1000,
      workedMinutes: 0,
      createdAt: 1000,
    });
    await setDoc(doc(db, "timesheets", "time-a2"), {
      companyId: "company-a",
      userId: "employee-a2",
      status: "inchis",
      startAt: 1000,
      stopAt: 2000,
      workedMinutes: 1,
      createdAt: 1000,
    });
    await setDoc(doc(db, "auditLogs", "audit-a"), {
      companyId: "company-a",
      actorUserId: "employee-a",
      action: "seed",
    });
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seed();
});

after(async () => {
  await env.cleanup();
});

test("unknown, pending and disabled accounts cannot read internal projects", async () => {
  await assertFails(getDoc(doc(firestore("unknown"), "projects", "project-a")));
  await assertFails(getDoc(doc(firestore("pending"), "projects", "project-a")));
  await assertFails(getDoc(doc(firestore("disabled"), "projects", "project-a")));
});

test("an admin-created active employee can access only assigned company resources", async () => {
  await assertSucceeds(getDoc(doc(firestore("employee-a"), "vehicles", "vehicle-a")));
  await assertFails(getDoc(doc(firestore("employee-a"), "vehicles", "vehicle-a-unassigned")));
  await assertFails(getDoc(doc(firestore("employee-a"), "vehicles", "vehicle-b")));
});

test("users, tools and maintenance are isolated between companies", async () => {
  const db = firestore("manager-a");
  await assertSucceeds(getDoc(doc(db, "users", "employee-a")));
  await assertFails(getDoc(doc(db, "users", "employee-b")));
  await assertSucceeds(getDoc(doc(db, "tools", "tool-a")));
  await assertFails(getDoc(doc(db, "tools", "tool-b")));
  await assertSucceeds(getDoc(doc(db, "maintenanceClients", "client-a")));
  await assertFails(getDoc(doc(db, "maintenanceClients", "client-b")));
});

test("only a manager from the client company can change maintenance client status", async () => {
  await assertSucceeds(updateDoc(doc(firestore("manager-a"), "maintenanceClients", "client-a"), {
    status: "inactive",
  }));
  await assertFails(updateDoc(doc(firestore("employee-a"), "maintenanceClients", "client-a"), {
    status: "active",
  }));
  await assertFails(updateDoc(doc(firestore("manager-b"), "maintenanceClients", "client-a"), {
    status: "active",
  }));
});

test("maintenance report collection group requires company-scoped queries", async () => {
  const db = firestore("manager-a");
  await assertSucceeds(getDocs(query(
    collectionGroup(db, "rapoarte"),
    where("companyId", "==", "company-a")
  )));
  await assertFails(getDocs(collectionGroup(db, "rapoarte")));
  await assertFails(getDocs(query(
    collectionGroup(db, "rapoarte"),
    where("companyId", "==", "company-b")
  )));
});

test("company-scoped user query succeeds and an unscoped query is rejected", async () => {
  const db = firestore("manager-a");
  await assertSucceeds(getDocs(query(
    collection(db, "userOperationalViews"),
    where("companyId", "==", "company-a")
  )));
  await assertFails(getDocs(collection(db, "userOperationalViews")));
});

test("employee can read only their own operational user view", async () => {
  const db = firestore("employee-a");
  await assertSucceeds(getDoc(doc(db, "userOperationalViews", "company-a__employee-a")));
  await assertFails(getDoc(doc(db, "userOperationalViews", "company-a__manager-a")));
  await assertSucceeds(getDocs(query(
    collection(db, "userOperationalViews"),
    where("companyId", "==", "company-a"),
    where("uid", "==", "employee-a")
  )));
  await assertFails(getDocs(query(
    collection(db, "userOperationalViews"),
    where("companyId", "==", "company-a")
  )));
});

test("employee cannot change role, pending driver or vehicle mileage directly", async () => {
  const db = firestore("employee-a");
  await assertFails(updateDoc(doc(db, "users", "employee-a"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "vehicles", "vehicle-a"), { pendingDriverUserId: "employee-a2" }));
  await assertFails(updateDoc(doc(db, "vehicles", "vehicle-a"), { currentKm: -1 }));
  await assertFails(updateDoc(doc(db, "vehicles", "vehicle-a"), { currentKm: 6300 }));
});

test("manager cannot bypass server functions for assignments or mileage", async () => {
  const db = firestore("manager-a");
  await assertFails(updateDoc(doc(db, "vehicles", "vehicle-a"), {
    currentDriverUserId: "employee-a2",
  }));
  await assertFails(updateDoc(doc(db, "vehicles", "vehicle-a"), { currentKm: 6400 }));
  await assertSucceeds(updateDoc(doc(db, "vehicles", "vehicle-a"), {
    maintenanceNotes: "Revizie planificata",
  }));
});

test("global admin may persist GPS simulation mileage without opening normal GPS writes", async () => {
  await assertFails(updateDoc(doc(firestore("manager-a"), "vehicles", "vehicle-a"), {
    gpsSimHistory: [{
      id: "sim-1",
      startedAt: 1,
      stoppedAt: 2,
      totalDistanceKm: 10,
      points: [{ lat: 44.4, lng: 26.1, odometerKm: 6200, ts: 1, speedKmh: 0, angle: 0, ignitionOn: false }],
    }],
    currentKm: 6210,
    updatedAt: 2,
  }));

  await assertSucceeds(updateDoc(doc(firestore("global"), "vehicles", "vehicle-a"), {
    gpsSim: {
      active: true,
      status: "running",
      startedAt: 3,
      resumedAt: 3,
      points: [{ lat: 44.4, lng: 26.1, odometerKm: 6210, ts: 3, speedKmh: 20, angle: 0, ignitionOn: true }],
    },
    gpsSimHistory: [{
      id: "sim-1",
      startedAt: 1,
      stoppedAt: 2,
      totalDistanceKm: 10,
      points: [{ lat: 44.4, lng: 26.1, odometerKm: 6200, ts: 1, speedKmh: 0, angle: 0, ignitionOn: false }],
    }],
    currentKm: 6210,
    updatedAt: 3,
  }));

  const simulationState = {
    schemaVersion: 1,
    vehicleId: "vehicle-a",
    gpsSim: {
      active: true,
      status: "running",
      startedAt: 4,
      points: [{ lat: 44.4, lng: 26.1, odometerKm: 6210, ts: 4, speedKmh: 20, angle: 0, ignitionOn: true }],
    },
    gpsSimHistory: [],
    updatedAt: 4,
  };
  await assertFails(setDoc(
    doc(firestore("manager-a"), "vehicles", "vehicle-a", "positions", "_simulation"),
    simulationState
  ));
  await assertSucceeds(setDoc(
    doc(firestore("global"), "vehicles", "vehicle-a", "positions", "_simulation"),
    simulationState
  ));
  await assertSucceeds(getDoc(
    doc(firestore("employee-a"), "vehicles", "vehicle-a", "positions", "_simulation")
  ));
  await assertFails(updateDoc(
    doc(firestore("global"), "vehicles", "vehicle-a", "positions", "_simulation"),
    { gpsSimHistory: Array.from({ length: 251 }, (_, index) => ({ id: `sim-${index}` })) }
  ));
  await assertFails(updateDoc(doc(firestore("global"), "vehicles", "vehicle-a"), {
    currentKm: 6211,
    updatedAt: 5,
  }));
  const globalDb = firestore("global");
  const batch = writeBatch(globalDb);
  batch.update(doc(globalDb, "vehicles", "vehicle-a", "positions", "_simulation"), {
    updatedAt: 5,
  });
  batch.update(doc(globalDb, "vehicles", "vehicle-a"), {
    currentKm: 6211,
    updatedAt: 5,
  });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(
    doc(globalDb, "vehicles", "vehicle-a", "positions", "_simulation"),
    { updatedAt: 4 }
  ));

  await assertFails(setDoc(doc(firestore("global"), "vehicles", "vehicle-a", "positionDays", "2026-07-15", "points", "sim"), {
    lat: 44.4,
    lng: 26.1,
  }));
});

test("employee can update safe profile fields and manager cannot change roles", async () => {
  await assertSucceeds(updateDoc(doc(firestore("employee-a"), "users", "employee-a"), {
    fullName: "Employee A Updated",
  }));
  await assertFails(updateDoc(doc(firestore("employee-a"), "users", "employee-a"), {
    permissions: ["global-admin"],
  }));
  await assertFails(updateDoc(doc(firestore("manager-a"), "users", "employee-a"), {
    role: "admin",
  }));
  await assertSucceeds(updateDoc(doc(firestore("admin-a"), "users", "employee-a"), {
    role: "manager",
  }));
  await assertFails(updateDoc(doc(firestore("admin-a"), "users", "employee-a"), {
    companyIds: ["company-a", "company-b"],
  }));
});

test("timesheet identity and calculated fields cannot be rewritten by an employee", async () => {
  const db = firestore("employee-a");
  await assertFails(getDoc(doc(db, "timesheets", "time-a2")));
  await assertFails(updateDoc(doc(db, "timesheets", "time-a"), { workedMinutes: 9999 }));
  await assertFails(updateDoc(doc(db, "timesheets", "time-a"), { userId: "employee-a2" }));
});

test("manager may correct allowed timesheet fields but not identity or company", async () => {
  const db = firestore("manager-a");
  await assertSucceeds(updateDoc(doc(db, "timesheets", "time-a"), {
    workedMinutes: 60,
    status: "corectat",
  }));
  await assertFails(updateDoc(doc(db, "timesheets", "time-a"), { userId: "manager-a" }));
  await assertFails(updateDoc(doc(db, "timesheets", "time-a"), { companyId: "company-b" }));
});

test("clients cannot forge audit, AI, system logs or notifications", async () => {
  const db = firestore("manager-a");
  await assertFails(setDoc(doc(db, "auditLogs", "fake"), { companyId: "company-a" }));
  await assertFails(setDoc(doc(db, "aiCommandLogs", "fake"), { companyId: "company-a" }));
  await assertFails(setDoc(doc(db, "systemLogs", "fake"), { companyId: "company-a" }));
  await assertFails(setDoc(doc(db, "notifications", "fake"), {
    companyId: "company-a",
    userId: "manager-a",
    title: "spam",
  }));
  await assertFails(setDoc(doc(db, "notificationSchedules", "fake"), {
    companyId: "company-a",
    status: "scheduled",
    nextRunAt: Date.now(),
  }));
  await assertFails(setDoc(doc(db, "notificationDeliveries", "fake"), {
    companyId: "company-a",
    recipientCount: 1,
  }));
});

test("GPS points are readable only for assigned users and company managers", async () => {
  const assignedPath = ["vehicles", "vehicle-a", "positionDays", "2026-07-13", "points", "p1"];
  const unassignedPath = ["vehicles", "vehicle-a-unassigned", "positionDays", "2026-07-13", "points", "p1"];
  await assertSucceeds(getDoc(doc(firestore("employee-a"), ...assignedPath)));
  await assertFails(getDoc(doc(firestore("employee-a"), ...unassignedPath)));
  await assertSucceeds(getDoc(doc(firestore("manager-a"), ...unassignedPath)));
  await assertFails(getDoc(doc(firestore("manager-b"), ...assignedPath)));
});

test("global admin has explicit cross-company access while company managers do not", async () => {
  await assertSucceeds(getDoc(doc(firestore("global"), "vehicles", "vehicle-b")));
  await assertSucceeds(getDocs(collection(firestore("global"), "projects")));
  await assertFails(getDoc(doc(firestore("manager-a"), "vehicles", "vehicle-b")));
  await assertFails(getDocs(collection(firestore("manager-a"), "projects")));
});

test("legacy admin without company scope keeps global access", async () => {
  await assertSucceeds(getDocs(collection(firestore("legacy-admin"), "users")));
  await assertSucceeds(getDoc(doc(firestore("legacy-admin"), "vehicles", "vehicle-b")));
  await assertSucceeds(getDocs(collection(firestore("legacy-admin"), "projects")));
});

test("Storage enforces owner, company, type and size", async () => {
  const ownRef = ref(storage("employee-a"), "expenses/employee-a/receipt.jpg");
  await assertSucceeds(uploadBytes(ownRef, new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  await assertSucceeds(getBytes(ownRef));
  await assertFails(getBytes(ref(storage("employee-b"), "expenses/employee-a/receipt.jpg")));
  await assertFails(uploadBytes(
    ref(storage("employee-a"), "expenses/employee-a/script.html"),
    new Uint8Array([1]),
    { contentType: "text/html" }
  ));
  await assertFails(uploadBytes(
    ref(storage("employee-a"), "expenses/employee-a/too-large.pdf"),
    new Uint8Array(15 * 1024 * 1024 + 1),
    { contentType: "application/pdf" }
  ));
});

test("operational vehicle view does not grant access to an unassigned employee", async () => {
  const allowed = await assertSucceeds(getDoc(doc(firestore("employee-a"), "vehicleOperationalViews", "vehicle-a")));
  assert.equal(allowed.data().tracker, undefined);
  await assertFails(getDoc(doc(firestore("employee-a2"), "vehicleOperationalViews", "vehicle-a")));
});
