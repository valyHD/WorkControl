import process from "node:process";
import { createRequire } from "node:module";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { buildTimesheetReminderSchedules } = require("../functions/timesheetReminderSchedules.js");

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

function clamp(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.round(parsed))) : fallback;
}

async function main() {
  const projectId = readArg("--project");
  const mode = readArg("--mode", "dry-run");
  const confirmedProject = readArg("--confirm-project");
  const pageSize = clamp(readArg("--page-size", "200"), 200, 300);
  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!["dry-run", "apply"].includes(mode)) throw new Error("Mod invalid; foloseste dry-run sau apply.");
  if (mode === "apply" && confirmedProject !== projectId) {
    throw new Error("Apply necesita --confirm-project cu Project ID-ul exact.");
  }

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const now = Date.now();
  let cursor = null;
  let rulesScanned = 0;
  let schedulesNeeded = 0;
  let schedulesUnchanged = 0;
  let writesApplied = 0;
  const schedulesByKind = {};

  do {
    let rulesQuery = db.collection("notificationRules").orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) rulesQuery = rulesQuery.startAfter(cursor);
    const rules = await rulesQuery.get();
    if (rules.empty) break;
    rulesScanned += rules.size;
    cursor = rules.docs.at(-1);

    const desiredSchedules = rules.docs.flatMap((ruleDoc) =>
      buildTimesheetReminderSchedules(ruleDoc.id, ruleDoc.data() || {}, now)
    );
    const currentSnapshots = desiredSchedules.length > 0
      ? await db.getAll(...desiredSchedules.map((schedule) => db.collection("notificationSchedules").doc(schedule.id)))
      : [];
    const pendingWrites = [];
    desiredSchedules.forEach((schedule, index) => {
      schedulesByKind[schedule.scheduleKind] = (schedulesByKind[schedule.scheduleKind] || 0) + 1;
      const current = currentSnapshots[index];
      if (
        current?.exists &&
        current.get("sourceRevision") === schedule.sourceRevision &&
        current.get("schemaVersion") === schedule.schemaVersion
      ) {
        schedulesUnchanged += 1;
        return;
      }
      schedulesNeeded += 1;
      pendingWrites.push({ ref: db.collection("notificationSchedules").doc(schedule.id), schedule });
    });

    if (mode === "apply") {
      for (let offset = 0; offset < pendingWrites.length; offset += 400) {
        const batch = db.batch();
        pendingWrites.slice(offset, offset + 400).forEach(({ ref, schedule }) => {
          batch.set(ref, {
            ...schedule,
            createdAt: now,
            createdAtServer: FieldValue.serverTimestamp(),
            updatedAt: now,
            updatedAtServer: FieldValue.serverTimestamp(),
          }, { merge: false });
        });
        await batch.commit();
        writesApplied += Math.min(400, pendingWrites.length - offset);
      }
    }

    if (rules.size < pageSize) break;
  } while (cursor);

  console.log(JSON.stringify({
    projectId,
    mode,
    pageSize,
    rulesScanned,
    schedulesByKind,
    schedulesNeeded,
    schedulesUnchanged,
    writesApplied,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
