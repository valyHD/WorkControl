import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimesheetRecoveryPlan,
  parseAuditFields,
  summarizeRecoveryPlan,
} from "./timesheet-audit-recovery-core.mjs";

const users = [{ id: "user-1", uid: "user-1", fullName: "Ionut Test", themeKey: "u6", primaryCompanyId: "company-1" }];
const projects = [{ id: "project-1", name: "Mentenanta", code: "M1", companyId: "company-1" }];

function event(overrides = {}) {
  return {
    id: "audit-1",
    companyId: "company-1",
    action: "timesheet_started",
    title: "Pontaj pornit",
    actorUserId: "user-1",
    actorUserName: "Ionut Test",
    actorUserThemeKey: "u6",
    entityId: "timesheet-1",
    metadata: {},
    createdAt: Date.parse("2026-06-02T08:00:00+03:00"),
    ...overrides,
  };
}

test("parses rich audit fields without depending on diacritics", () => {
  const fields = parseAuditFields({ fieldsText: ["Proiect: Mentenanta", "Explicație start: Deplasare"] });
  assert.equal(fields.get("proiect"), "Mentenanta");
  assert.equal(fields.get("explicatie start"), "Deplasare");
});

test("recovers a deleted timesheet from rich start and stop audit events", () => {
  const plan = buildTimesheetRecoveryPlan({
    users,
    projects,
    auditLogs: [
      event({
        metadata: { fieldsText: ["User: Ionut Test", "Proiect: Mentenanta", "Locatie start: Bucuresti"] },
      }),
      event({
        id: "audit-2",
        action: "timesheet_stopped",
        title: "Pontaj oprit",
        createdAt: Date.parse("2026-06-02T17:30:00+03:00"),
        metadata: { fieldsText: ["Proiect: Mentenanta", "Minute lucrate: 570", "Status: inchis", "Locatie stop: Otopeni"] },
      }),
    ],
  });

  assert.equal(plan.recoverable.length, 1);
  assert.equal(plan.recoverable[0].document.workedMinutes, 570);
  assert.equal(plan.recoverable[0].document.workDate, "2026-06-02");
  assert.equal(plan.recoverable[0].document.projectId, "project-1");
  assert.equal(plan.recoverable[0].document.userThemeKey, "u6");
  assert.equal(plan.recoverable[0].document.startLocation.label, "Bucuresti");
});

test("prefers rich duplicate events and remains idempotent", () => {
  const plan = buildTimesheetRecoveryPlan({
    users,
    projects,
    existingTimesheets: [{ id: "already-there" }],
    auditLogs: [
      event({ entityId: "already-there" }),
      event({ id: "plain-start" }),
      event({ id: "rich-start", createdAt: Date.parse("2026-06-02T08:00:02+03:00"), metadata: { fieldsText: ["Proiect: Mentenanta"] } }),
      event({ id: "plain-stop", action: "timesheet_stopped", title: "Pontaj oprit", createdAt: Date.parse("2026-06-02T17:30:00+03:00"), metadata: { workedMinutes: 2 } }),
      event({ id: "rich-stop", action: "timesheet_stopped", title: "Pontaj oprit", createdAt: Date.parse("2026-06-02T17:30:02+03:00"), metadata: { fieldsText: ["Minute lucrate: 570", "Status: inchis"] } }),
    ],
  });
  assert.equal(plan.recoverable.length, 1);
  assert.deepEqual(plan.recoverable[0].sourceAuditIds, ["rich-start", "rich-stop"]);
  assert.equal(plan.recoverable[0].document.workedMinutes, 570);
});

test("does not invent a timesheet when start or stop is missing", () => {
  const plan = buildTimesheetRecoveryPlan({ users, projects, auditLogs: [event()] });
  assert.equal(plan.recoverable.length, 0);
  assert.deepEqual(plan.incomplete, [{ entityId: "timesheet-1", reason: "missing-stop" }]);
});

test("keeps explicit duration conflicts out of automatic recovery", () => {
  const plan = buildTimesheetRecoveryPlan({
    users,
    projects,
    auditLogs: [
      event({ metadata: { fieldsText: ["Proiect: Mentenanta"] } }),
      event({
        id: "audit-stop",
        action: "timesheet_stopped",
        title: "Pontaj oprit",
        createdAt: Date.parse("2026-06-02T18:00:00+03:00"),
        metadata: { fieldsText: ["Minute lucrate: 1"] },
      }),
    ],
  });
  assert.equal(plan.recoverable.length, 0);
  assert.equal(plan.manualReview.length, 1);
  assert.match(plan.manualReview[0].warnings[0], /^duration-mismatch:/);
  assert.equal(summarizeRecoveryPlan(plan).manualReview, 1);
});
