import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccessBootstrapUpdate,
  inferCompanyId,
  legacyUserUpdateNeeded,
  migrationDefaultCompanyId,
  normalizeLegacyUser,
  requiresInitialCompanySelection,
  resolveUniqueCompany,
} from "./company-isolation-core.mjs";

function references() {
  return {
    userCompanies: new Map([
      ["user-a", ["company-a"]],
      ["user-b", ["company-b"]],
    ]),
    vehicleCompanies: new Map([["vehicle-a", "company-a"]]),
    toolCompanies: new Map([["tool-b", "company-b"]]),
    clientCompanies: new Map([["client-a", "company-a"]]),
  };
}

test("infers company from an assigned user", () => {
  const result = inferCompanyId({
    collectionName: "timesheets",
    documentId: "time-a",
    path: "timesheets/time-a",
    data: { userId: "user-a" },
    references: references(),
  });
  assert.equal(result.companyId, "company-a");
  assert.equal(result.confidence, "reference");
});

test("reports conflicting cross-company references instead of guessing", () => {
  const result = inferCompanyId({
    collectionName: "expenseDocuments",
    documentId: "expense-a",
    path: "expenseDocuments/expense-a",
    data: { uploadedByUserId: "user-a", assignedUserId: "user-b" },
    references: references(),
  });
  assert.equal(result.companyId, "");
  assert.equal(result.confidence, "conflict");
  assert.deepEqual(result.candidates, ["company-a", "company-b"]);
});

test("uses a parent maintenance client for nested reports", () => {
  const result = inferCompanyId({
    collectionName: "rapoarte",
    documentId: "report-a",
    path: "maintenanceClients/client-a/rapoarte/report-a",
    data: {},
    references: references(),
  });
  assert.equal(result.companyId, "company-a");
});

test("an explicit default is never confused with inferred data", () => {
  assert.deepEqual(resolveUniqueCompany([], "company-a"), {
    companyId: "company-a",
    confidence: "explicit-default",
  });
});

test("legacy users remain disabled unless they were explicitly active", () => {
  assert.deepEqual(normalizeLegacyUser({ active: false }, "company-a"), {
    companyId: "company-a",
    companyIds: ["company-a"],
    primaryCompanyId: "company-a",
    accessStatus: "disabled",
  });
});

test("access bootstrap activates legacy active users without assigning a company", () => {
  const admins = new Set(["owner@example.com", "backup@example.com"]);
  assert.deepEqual(buildAccessBootstrapUpdate({ active: true }, "worker@example.com", admins), {
    accessStatus: "active",
    globalAdmin: false,
  });
  assert.deepEqual(buildAccessBootstrapUpdate({ active: true }, "OWNER@example.com", admins), {
    accessStatus: "active",
    globalAdmin: true,
  });
});

test("resource default never assigns a company when the user must choose it", () => {
  assert.equal(migrationDefaultCompanyId({
    collectionName: "users",
    defaultResourceCompanyId: "company-a",
    allowUserCompanySelection: true,
  }), "");
  assert.equal(migrationDefaultCompanyId({
    collectionName: "vehicles",
    defaultResourceCompanyId: "company-a",
    allowUserCompanySelection: true,
  }), "company-a");
});

test("unassigned active users are reported for the initial company gate", () => {
  assert.equal(requiresInitialCompanySelection({
    collectionName: "users",
    data: { active: true, accessStatus: "active", companyIds: [] },
    result: { companyId: "" },
    allowUserCompanySelection: true,
  }), true);
  assert.equal(requiresInitialCompanySelection({
    collectionName: "users",
    data: { companyIds: ["company-a"] },
    result: { companyId: "company-a" },
    allowUserCompanySelection: true,
  }), false);
});

test("an already normalized legacy user is a migration no-op", () => {
  const data = {
    companyId: "company-a",
    companyIds: ["company-a"],
    primaryCompanyId: "company-a",
    accessStatus: "active",
  };
  assert.equal(legacyUserUpdateNeeded(data, normalizeLegacyUser(data, "company-a")), false);
  assert.equal(legacyUserUpdateNeeded(
    { ...data, companyIds: [] },
    normalizeLegacyUser({ ...data, companyIds: [] }, "company-a")
  ), true);
});
