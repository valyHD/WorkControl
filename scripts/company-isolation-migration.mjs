import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  COMPANY_SCOPED_COLLECTIONS,
  buildAccessBootstrapUpdate,
  cleanId,
  getUserCompanyIds,
  inferCompanyId,
  migrationDefaultCompanyId,
  normalizeLegacyUser,
  requiresInitialCompanySelection,
} from "./company-isolation-core.mjs";

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
    globalAdmin: Object.hasOwn(data, "globalAdmin") ? data.globalAdmin : null,
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
  const defaultResourceCompanyId = cleanId(
    args.get("--default-resource-company") || args.get("--default-company")
  );
  const allowUserCompanySelection = args.get("--allow-user-company-selection") === true;
  const reportDirectory = path.resolve(cleanId(args.get("--output")) || "migration-reports");
  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!["dry-run", "backfill", "rollback", "access-bootstrap-dry-run", "access-bootstrap"].includes(mode)) {
    throw new Error("Mod --mode invalid.");
  }
  if (!["dry-run", "access-bootstrap-dry-run"].includes(mode) &&
      (args.get("--apply") !== true || args.get("--confirm-project") !== projectId)) {
    throw new Error("Scrierea necesita --apply si --confirm-project cu Project ID-ul exact.");
  }

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  if (defaultResourceCompanyId) {
    const defaultCompanySnap = await db.collection("firmeMentenanta").doc(defaultResourceCompanyId).get();
    if (!defaultCompanySnap.exists || defaultCompanySnap.get("active") === false) {
      throw new Error("Firma implicita pentru resurse nu exista sau este inactiva.");
    }
  }
  if (mode === "rollback") {
    const backupPath = path.resolve(cleanId(args.get("--backup")));
    if (!backupPath) throw new Error("Rollback necesita --backup <fisier.json>.");
    console.log(JSON.stringify(await rollback(db, backupPath, projectId), null, 2));
    return;
  }


  if (mode === "access-bootstrap" || mode === "access-bootstrap-dry-run") {
    const requestedAdmins = new Set(
      cleanId(args.get("--global-admin-emails"))
        .split(",")
        .map((value) => cleanId(value).toLowerCase())
        .filter(Boolean)
    );
    if (requestedAdmins.size === 0) {
      throw new Error("Foloseste --global-admin-emails cu cel putin un email explicit.");
    }
    const usersSnap = await db.collection("users").get();
    const matchedAdmins = new Set();
    const changes = [];
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data() || {};
      const email = cleanId(data.email).toLowerCase();
      const update = buildAccessBootstrapUpdate(data, email, requestedAdmins);
      if (update.globalAdmin) {
        matchedAdmins.add(email);
        if (data.role !== "admin" || data.active !== true) {
          throw new Error("Administratorii globali solicitati trebuie sa fie conturi admin active.");
        }
      }
      if (data.accessStatus === update.accessStatus && data.globalAdmin === update.globalAdmin) continue;
      changes.push({
        ref: userDoc.ref,
        path: userDoc.ref.path,
        previous: previousFields(data),
        update: {
          ...update,
          updatedAt: Date.now(),
          updatedAtServer: FieldValue.serverTimestamp(),
        },
      });
    }
    const missingAdmins = [...requestedAdmins].filter((email) => !matchedAdmins.has(email));
    if (missingAdmins.length > 0) throw new Error("Unul dintre conturile global admin nu exista.");
    await fs.mkdir(reportDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const reportPath = path.join(reportDirectory, `company-isolation-${mode}-${timestamp}.json`);
    const report = {
      projectId,
      mode,
      generatedAt: new Date().toISOString(),
      scannedUsers: usersSnap.size,
      eligibleChanges: changes.length,
      requestedGlobalAdmins: requestedAdmins.size,
      matchedGlobalAdmins: matchedAdmins.size,
      applied: 0,
    };
    if (mode === "access-bootstrap") {
      const backupPath = path.join(reportDirectory, `company-isolation-backup-${timestamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify({
        projectId,
        createdAt: new Date().toISOString(),
        changes: changes.map((change) => ({ path: change.path, previous: change.previous })),
      }, null, 2));
      await writeBatches(db, changes);
      report.applied = changes.length;
      report.backupPath = backupPath;
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
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
        defaultCompanyId: migrationDefaultCompanyId({
          collectionName,
          defaultResourceCompanyId,
          allowUserCompanySelection,
        }),
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
  const selectionRequiredUsers = [];
  for (const item of pending) {
    const { collectionName, document, data, result } = item;
    if (!result.companyId) {
      if (requiresInitialCompanySelection({
        collectionName,
        data,
        result,
        allowUserCompanySelection,
      })) {
        selectionRequiredUsers.push({ path: document.ref.path });
        continue;
      }
      unresolved.push({ path: document.ref.path, reason: result.confidence, candidates: result.candidates || [] });
      continue;
    }
    if (collectionName === "vehicleOperationalViews" || collectionName === "userOperationalViews") continue;
    const update = collectionName === "users"
      ? normalizeLegacyUser(data, result.companyId)
      : { companyId: result.companyId };
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
    defaultResourceCompanyId: defaultResourceCompanyId || null,
    allowUserCompanySelection,
    selectionRequiredUsers,
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
      changes: changes.map((change) => ({
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
