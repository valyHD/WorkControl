import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  COMPANY_SCOPED_COLLECTIONS,
  cleanId,
  getUserCompanyIds,
  inferCompanyId,
  normalizeLegacyUser,
} from "./company-isolation-core.mjs";

const require = createRequire(import.meta.url);
const { buildVehicleOperationalView } = require("../functions/vehicleOperationalView.js");
const {
  buildUserOperationalView,
  userOperationalViewId,
} = require("../functions/userOperationalView.js");

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args.set(value, true);
    else {
      args.set(value, next);
      index += 1;
    }
  }
  return args;
}

async function readCollection(db, name) {
  if (name === "rapoarte") return (await db.collectionGroup(name).get()).docs;
  return (await db.collection(name).get()).docs;
}

function previousFields(data) {
  return {
    companyId: Object.hasOwn(data, "companyId") ? data.companyId : null,
    companyIds: Object.hasOwn(data, "companyIds") ? data.companyIds : null,
    primaryCompanyId: Object.hasOwn(data, "primaryCompanyId") ? data.primaryCompanyId : null,
    accessStatus: Object.hasOwn(data, "accessStatus") ? data.accessStatus : null,
  };
}

async function writeBatches(db, changes) {
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    changes.slice(offset, offset + 400).forEach((change) => batch.set(change.ref, change.update, { merge: true }));
    await batch.commit();
  }
}

async function rollback(db, backupPath, projectId) {
  const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
  if (backup.projectId !== projectId) throw new Error("Backup-ul apartine altui proiect Firebase.");
  const changes = backup.changes.map((change) => {
    const update = {};
    Object.entries(change.previous).forEach(([key, value]) => {
      update[key] = value === null ? FieldValue.delete() : value;
    });
    return { ref: db.doc(change.path), update };
  });
  await writeBatches(db, changes);
  return { restored: changes.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = cleanId(args.get("--project"));
  const mode = cleanId(args.get("--mode") || "dry-run");
  const defaultCompanyId = cleanId(args.get("--default-company"));
  const reportDirectory = path.resolve(cleanId(args.get("--output")) || "migration-reports");
  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!["dry-run", "backfill", "rollback"].includes(mode)) throw new Error("Mod --mode invalid.");
  if (mode !== "dry-run" && (args.get("--apply") !== true || args.get("--confirm-project") !== projectId)) {
    throw new Error("Scrierea necesita --apply si --confirm-project cu Project ID-ul exact.");
  }

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  if (mode === "rollback") {
    const backupPath = path.resolve(cleanId(args.get("--backup")));
    if (!backupPath) throw new Error("Rollback necesita --backup <fisier.json>.");
    console.log(JSON.stringify(await rollback(db, backupPath, projectId), null, 2));
    return;
  }

  const snapshots = new Map();
  for (const collectionName of COMPANY_SCOPED_COLLECTIONS) {
    snapshots.set(collectionName, await readCollection(db, collectionName));
  }
  snapshots.set("firmeMentenanta", await readCollection(db, "firmeMentenanta"));

  const references = {
    userCompanies: new Map(),
    vehicleCompanies: new Map(),
    toolCompanies: new Map(),
    clientCompanies: new Map(),
  };
  for (const userDoc of snapshots.get("users")) {
    references.userCompanies.set(userDoc.id, getUserCompanyIds(userDoc.data()));
  }
  for (const companyDoc of snapshots.get("firmeMentenanta")) {
    references.clientCompanies.set(companyDoc.id, companyDoc.id);
  }

  const pending = [];
  const processCollection = (collectionName) => {
    for (const document of snapshots.get(collectionName) || []) {
      const data = document.data() || {};
      const result = inferCompanyId({
        collectionName,
        documentId: document.id,
        path: document.ref.path,
        data,
        references,
        defaultCompanyId,
      });
      pending.push({ collectionName, document, data, result });
      if (result.companyId) {
        if (collectionName === "vehicles") references.vehicleCompanies.set(document.id, result.companyId);
        if (collectionName === "tools") references.toolCompanies.set(document.id, result.companyId);
        if (collectionName === "maintenanceClients") references.clientCompanies.set(document.id, result.companyId);
      }
    }
  };

  processCollection("users");
  for (const name of COMPANY_SCOPED_COLLECTIONS.filter((name) => name !== "users")) processCollection(name);

  const changes = [];
  const unresolved = [];
  for (const item of pending) {
    const { collectionName, document, data, result } = item;
    if (!result.companyId) {
      unresolved.push({ path: document.ref.path, reason: result.confidence, candidates: result.candidates || [] });
      continue;
    }
    if (collectionName === "vehicleOperationalViews" || collectionName === "userOperationalViews") continue;
    if (collectionName === "users") {
      const normalized = normalizeLegacyUser(data, result.companyId);
      normalized.companyIds.forEach((companyId) => {
        changes.push({
          ref: db.collection("userOperationalViews").doc(userOperationalViewId(companyId, document.id)),
          path: `userOperationalViews/${userOperationalViewId(companyId, document.id)}`,
          update: buildUserOperationalView(document.id, companyId, { ...data, ...normalized }),
          previous: {},
          generatedOperationalView: true,
        });
      });
    }
    const update = collectionName === "users"
      ? normalizeLegacyUser(data, result.companyId)
      : { companyId: result.companyId };
    if (collectionName === "vehicles") {
      changes.push({
        ref: db.collection("vehicleOperationalViews").doc(document.id),
        path: `vehicleOperationalViews/${document.id}`,
        update: buildVehicleOperationalView(document.id, { ...data, ...update }),
        previous: {},
        generatedOperationalView: true,
      });
    }
    if (cleanId(data.companyId) === result.companyId && collectionName !== "users") continue;
    changes.push({
      ref: document.ref,
      path: document.ref.path,
      update,
      previous: previousFields(data),
      confidence: result.confidence,
    });
  }

  await fs.mkdir(reportDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const reportPath = path.join(reportDirectory, `company-isolation-${mode}-${timestamp}.json`);
  const report = {
    projectId,
    mode,
    generatedAt: new Date().toISOString(),
    defaultCompanyId: defaultCompanyId || null,
    scanned: pending.length,
    eligibleChanges: changes.length,
    unresolved,
    byCollection: Object.fromEntries([...snapshots.entries()].map(([name, docs]) => [name, docs.length])),
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  if (mode === "backfill") {
    if (unresolved.length > 0 && args.get("--allow-unresolved") !== true) {
      throw new Error(`Backfill oprit: ${unresolved.length} documente nerezolvate. Verifica ${reportPath}.`);
    }
    const backupPath = path.join(reportDirectory, `company-isolation-backup-${timestamp}.json`);
    await fs.writeFile(backupPath, JSON.stringify({
      projectId,
      createdAt: new Date().toISOString(),
      changes: changes.filter((change) => !change.generatedOperationalView).map((change) => ({
        path: change.path,
        previous: change.previous,
      })),
    }, null, 2));
    await writeBatches(db, changes);
    report.backupPath = backupPath;
    report.applied = changes.length;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
