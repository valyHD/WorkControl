import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const SCHEMA_VERSION = 1;

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    const next = value[key];
    if (next !== undefined) result[key] = canonicalize(next);
    return result;
  }, {});
}

function hashState(state) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      gpsSim: state?.gpsSim ?? null,
      gpsSimHistory: Array.isArray(state?.gpsSimHistory) ? state.gpsSimHistory : [],
    })))
    .digest("hex");
}

function rootHasSimulation(data) {
  return Object.hasOwn(data, "gpsSim") || Object.hasOwn(data, "gpsSimHistory");
}

function serializeState(data) {
  return {
    gpsSim: data?.gpsSim ?? null,
    gpsSimHistory: Array.isArray(data?.gpsSimHistory) ? data.gpsSimHistory : [],
  };
}

function backupPath(projectId) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve(process.cwd(), "..", "workcontrol-migration-backups", `${projectId}-vehicle-simulation-${timestamp}.json`);
}

async function writeBackup(projectId, records) {
  const path = backupPath(projectId);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({
    version: 1,
    projectId,
    createdAt: new Date().toISOString(),
    records,
  }, null, 2), "utf8");
  return path;
}

async function readBackup(path, projectId) {
  const backup = JSON.parse(await readFile(resolve(path), "utf8"));
  if (backup.projectId !== projectId || !Array.isArray(backup.records)) {
    throw new Error("Backup invalid sau destinat altui proiect Firebase.");
  }
  return backup;
}

async function commitInChunks(db, operations) {
  for (let offset = 0; offset < operations.length; offset += 350) {
    const batch = db.batch();
    operations.slice(offset, offset + 350).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function main() {
  const projectId = readArg("--project");
  const mode = readArg("--mode", "dry-run");
  const confirmedProject = readArg("--confirm-project");
  const backupFile = readArg("--backup-file");
  const writeModes = ["copy", "cleanup-root", "rollback"];
  const validModes = ["dry-run", "copy", "verify", ...writeModes.slice(1)];

  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!validModes.includes(mode)) {
    throw new Error(`Mod invalid: ${mode}. Foloseste ${validModes.join(", ")}.`);
  }
  if (writeModes.includes(mode) && confirmedProject !== projectId) {
    throw new Error("Operatia de scriere necesita --confirm-project cu Project ID-ul exact.");
  }
  if (["cleanup-root", "rollback"].includes(mode) && !backupFile) {
    throw new Error(`${mode} necesita --backup-file.`);
  }

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const vehicles = await db.collection("vehicles").limit(500).get();
  const records = [];

  for (const vehicle of vehicles.docs) {
    const rootData = vehicle.data() || {};
    const childRef = vehicle.ref.collection("positions").doc("_simulation");
    const child = await childRef.get();
    records.push({
      vehicleId: vehicle.id,
      rootHasSimulation: rootHasSimulation(rootData),
      rootState: serializeState(rootData),
      rootHash: hashState(rootData),
      childExists: child.exists,
      childState: child.exists ? serializeState(child.data() || {}) : null,
      childHash: child.exists ? hashState(child.data() || {}) : null,
    });
  }

  if (mode === "dry-run" || mode === "verify") {
    const candidates = records.filter((record) => record.rootHasSimulation);
    const mismatches = candidates.filter((record) => record.rootHash !== record.childHash);
    console.log(JSON.stringify({
      projectId,
      mode,
      vehiclesScanned: records.length,
      rootDocumentsWithSimulation: candidates.length,
      childDocuments: records.filter((record) => record.childExists).length,
      verifiedMatches: candidates.length - mismatches.length,
      mismatches: mismatches.map((record) => record.vehicleId),
    }, null, 2));
    if (mode === "verify" && mismatches.length > 0) process.exitCode = 2;
    return;
  }

  if (mode === "copy") {
    const candidates = records.filter((record) => record.rootHasSimulation);
    const backup = await writeBackup(projectId, candidates);
    const operations = candidates.map((record) => (batch) => {
      const ref = db.collection("vehicles").doc(record.vehicleId).collection("positions").doc("_simulation");
      batch.set(ref, {
        schemaVersion: SCHEMA_VERSION,
        vehicleId: record.vehicleId,
        ...record.rootState,
        updatedAt: Date.now(),
        migratedAtServer: FieldValue.serverTimestamp(),
      }, { merge: false });
    });
    await commitInChunks(db, operations);
    console.log(JSON.stringify({
      projectId,
      mode,
      vehiclesScanned: records.length,
      copied: candidates.length,
      backupFile: backup,
    }, null, 2));
    return;
  }

  const backup = await readBackup(backupFile, projectId);
  if (mode === "cleanup-root") {
    const safe = [];
    const skipped = [];
    for (const record of backup.records) {
      const vehicleRef = db.collection("vehicles").doc(record.vehicleId);
      const [root, child] = await Promise.all([
        vehicleRef.get(),
        vehicleRef.collection("positions").doc("_simulation").get(),
      ]);
      if (!root.exists || !child.exists || hashState(root.data()) !== record.rootHash || hashState(child.data()) !== record.rootHash) {
        skipped.push(record.vehicleId);
        continue;
      }
      safe.push(record.vehicleId);
    }
    if (skipped.length > 0) {
      throw new Error(`Cleanup oprit: starea s-a schimbat pentru ${skipped.join(", ")}.`);
    }
    await commitInChunks(db, safe.map((vehicleId) => (batch) => {
      batch.update(db.collection("vehicles").doc(vehicleId), {
        gpsSim: FieldValue.delete(),
        gpsSimHistory: FieldValue.delete(),
      });
    }));
    console.log(JSON.stringify({ projectId, mode, cleaned: safe.length, backupFile: resolve(backupFile) }, null, 2));
    return;
  }

  const operations = [];
  for (const record of backup.records) {
    const vehicleRef = db.collection("vehicles").doc(record.vehicleId);
    operations.push((batch) => {
      batch.update(vehicleRef, {
        gpsSim: record.rootState.gpsSim ?? FieldValue.delete(),
        gpsSimHistory: record.rootState.gpsSimHistory ?? [],
      });
      const childRef = vehicleRef.collection("positions").doc("_simulation");
      if (record.childExists) {
        batch.set(childRef, {
          schemaVersion: SCHEMA_VERSION,
          vehicleId: record.vehicleId,
          ...record.childState,
          updatedAt: Date.now(),
        }, { merge: false });
      } else {
        batch.delete(childRef);
      }
    });
  }
  await commitInChunks(db, operations);
  console.log(JSON.stringify({ projectId, mode, restored: backup.records.length, backupFile: resolve(backupFile) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
