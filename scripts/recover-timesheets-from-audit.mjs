import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  buildTimesheetRecoveryPlan,
  summarizeRecoveryPlan,
} from "./timesheet-audit-recovery-core.mjs";

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function compactDocument(doc) {
  return { id: doc.id, ...doc.data() };
}

async function readCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map(compactDocument);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeManifest(projectId, candidates) {
  const folder = path.resolve(".firebase", "timesheet-recovery");
  await mkdir(folder, { recursive: true });
  const filePath = path.join(folder, `recovery-${timestampSlug()}.json`);
  await writeFile(filePath, JSON.stringify({
    projectId,
    createdAt: new Date().toISOString(),
    documentIds: candidates.map((candidate) => candidate.entityId),
    sourceAuditIds: Object.fromEntries(candidates.map((candidate) => [candidate.entityId, candidate.sourceAuditIds])),
  }, null, 2));
  return filePath;
}

async function recover(db, projectId, candidates) {
  const manifestPath = await writeManifest(projectId, candidates);
  const recoveredAt = Date.now();
  for (let offset = 0; offset < candidates.length; offset += 400) {
    const batch = db.batch();
    for (const candidate of candidates.slice(offset, offset + 400)) {
      const ref = db.collection("timesheets").doc(candidate.entityId);
      batch.create(ref, {
        ...candidate.document,
        recovery: { ...candidate.document.recovery, recoveredAt },
        recoveredAtServer: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return manifestPath;
}

async function rollback(db, projectId, manifestPath) {
  if (!manifestPath) throw new Error("Rollback necesita --backup <manifest.json>.");
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
  if (manifest.projectId !== projectId) throw new Error("Manifestul apartine altui proiect Firebase.");
  let deleted = 0;
  for (let offset = 0; offset < manifest.documentIds.length; offset += 400) {
    const batch = db.batch();
    for (const id of manifest.documentIds.slice(offset, offset + 400)) {
      const ref = db.collection("timesheets").doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists || snapshot.get("recovery.source") !== "auditLogs") continue;
      batch.delete(ref);
      deleted += 1;
    }
    await batch.commit();
  }
  return deleted;
}

const projectId = readArg("project");
const mode = readArg("mode", "dry-run");
const userId = readArg("user");
if (!projectId) throw new Error("Lipseste --project <firebase-project-id>.");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

if (mode === "rollback") {
  const deleted = await rollback(db, projectId, readArg("backup"));
  console.log(JSON.stringify({ mode, projectId, deleted }, null, 2));
  process.exit(0);
}

const [auditLogs, existingTimesheets, users, projects] = await Promise.all([
  readCollection(db, "auditLogs"),
  readCollection(db, "timesheets"),
  readCollection(db, "users"),
  readCollection(db, "projects"),
]);
const filteredAuditLogs = userId
  ? auditLogs.filter((event) => event.actorUserId === userId)
  : auditLogs;
const plan = buildTimesheetRecoveryPlan({
  auditLogs: filteredAuditLogs,
  existingTimesheets,
  users,
  projects,
});
const summary = summarizeRecoveryPlan(plan);

if (mode === "dry-run") {
  const warningDetails = [...plan.recoverable, ...plan.manualReview]
    .filter((candidate) => candidate.warnings.length)
    .map((candidate) => ({
      entityId: candidate.entityId,
      userName: candidate.document.userName,
      workDate: candidate.document.workDate,
      workedMinutes: candidate.document.workedMinutes,
      intervalMinutes: Math.max(1, Math.round((candidate.document.stopAt - candidate.document.startAt) / 60000)),
      warnings: candidate.warnings,
    }));
  console.log(JSON.stringify({ mode, projectId, userFilter: userId || null, summary, warningDetails }, null, 2));
  process.exit(0);
}
if (mode !== "recover") throw new Error(`Mod necunoscut: ${mode}`);
if (readArg("confirm") !== "RECOVER_TIMESHEETS_FROM_AUDIT") {
  throw new Error("Recuperarea necesita --confirm RECOVER_TIMESHEETS_FROM_AUDIT.");
}
const manifestPath = await recover(db, projectId, plan.recoverable);
console.log(JSON.stringify({ mode, projectId, recovered: plan.recoverable.length, manifestPath, summary }, null, 2));
