import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  decodeFirestoreBackupValue,
  encodeFirestoreBackupValue,
} from "./firestore-backup-codec.mjs";

const SCHEMA_VERSION = 2;
// Route documents can approach Firestore's per-document limit. Keep migration
// batches well under the 10 MiB request limit without changing route payloads.
const BATCH_SIZE = 8;
const HISTORY_LIMIT = 250;

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function sanitizeRouteId(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 240);
  return normalized || fallback;
}

function routeId(simulation, index) {
  return sanitizeRouteId(simulation?.id, `sim-${Number(simulation?.startedAt || index)}-${index}`);
}

function withoutPoints(simulation, index) {
  const { points: _points, ...metadata } = simulation || {};
  return {
    ...metadata,
    id: routeId(simulation, index),
    active: false,
    status: "done",
  };
}

function backupPath(projectId) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve(
    process.cwd(),
    "..",
    "workcontrol-migration-backups",
    `${projectId}-simulation-routes-v2-${timestamp}.json`
  );
}

async function commitOperations(db, operations) {
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function scanStates(db) {
  const vehicles = await db.collection("vehicles").limit(500).get();
  const records = [];
  for (const vehicle of vehicles.docs) {
    const stateRef = vehicle.ref.collection("positions").doc("_simulation");
    const [stateSnap, routesSnap] = await Promise.all([
      stateRef.get(),
      vehicle.ref.collection("simulationRoutes").limit(HISTORY_LIMIT).get(),
    ]);
    if (!stateSnap.exists && routesSnap.empty) continue;
    records.push({
      vehicleId: vehicle.id,
      stateExists: stateSnap.exists,
      state: stateSnap.exists ? stateSnap.data() || {} : null,
      routes: routesSnap.docs
        .map((item) => ({ id: item.id, data: item.data() || {} }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }
  return records;
}

function isCandidate(record) {
  const history = Array.isArray(record.state?.gpsSimHistory) ? record.state.gpsSimHistory : [];
  return Number(record.state?.schemaVersion || 1) < SCHEMA_VERSION ||
    history.some((simulation) => Array.isArray(simulation?.points) && simulation.points.length > 0);
}

function buildAppliedState(record, migrationId, appliedAt) {
  const state = record.state || {};
  const history = Array.isArray(state.gpsSimHistory) ? state.gpsSimHistory : [];
  const normalizedHistory = history
    .slice(-HISTORY_LIMIT)
    .map((simulation, index) => withoutPoints(simulation, index));
  return {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    vehicleId: record.vehicleId,
    gpsSim: state.gpsSim ?? null,
    gpsSimHistory: normalizedHistory,
    historyCount: normalizedHistory.length,
    migrationId,
    migratedAt: appliedAt,
    migratedAtServer: FieldValue.serverTimestamp(),
    updatedAt: Math.max(Number(state.updatedAt || 0), appliedAt),
  };
}

function buildRouteDocuments(record, appliedAt) {
  const history = Array.isArray(record.state?.gpsSimHistory) ? record.state.gpsSimHistory : [];
  return history.slice(-HISTORY_LIMIT).map((simulation, index) => {
    const id = routeId(simulation, index);
    return {
      id,
      data: {
        schemaVersion: SCHEMA_VERSION,
        vehicleId: record.vehicleId,
        routeId: id,
        ...simulation,
        id,
        active: false,
        status: "done",
        updatedAt: appliedAt,
      },
    };
  });
}

async function writeBackup(projectId, migrationId, records) {
  const path = backupPath(projectId);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(encodeFirestoreBackupValue({
    version: 2,
    projectId,
    migrationId,
    createdAt: new Date().toISOString(),
    records: records.map((record) => ({
      ...record,
      sourceFingerprint: fingerprint({ state: record.state, routes: record.routes }),
    })),
  }), null, 2), "utf8");
  return path;
}

async function readBackup(path, projectId) {
  const parsed = decodeFirestoreBackupValue(JSON.parse(await readFile(resolve(path), "utf8")));
  if (parsed.projectId !== projectId || !parsed.migrationId || !Array.isArray(parsed.records)) {
    throw new Error("Backup invalid sau destinat altui proiect Firebase.");
  }
  return parsed;
}

async function verifyRecords(db, records) {
  const failures = [];
  for (const record of records) {
    const vehicleRef = db.collection("vehicles").doc(record.vehicleId);
    const [stateSnap, routesSnap] = await Promise.all([
      vehicleRef.collection("positions").doc("_simulation").get(),
      vehicleRef.collection("simulationRoutes").limit(HISTORY_LIMIT).get(),
    ]);
    const state = stateSnap.exists ? stateSnap.data() || {} : {};
    const routeIds = new Set(routesSnap.docs.map((item) => item.id));
    const metadata = Array.isArray(state.gpsSimHistory) ? state.gpsSimHistory : [];
    const missingRoutes = metadata
      .map((simulation, index) => routeId(simulation, index))
      .filter((id) => !routeIds.has(id));
    const embeddedPoints = metadata.filter(
      (simulation) => Array.isArray(simulation?.points) && simulation.points.length > 0
    ).length;
    if (Number(state.schemaVersion || 0) !== SCHEMA_VERSION || embeddedPoints || missingRoutes.length) {
      failures.push({
        vehicleId: record.vehicleId,
        schemaVersion: Number(state.schemaVersion || 0),
        embeddedPoints,
        missingRoutes,
      });
    }
  }
  return failures;
}

async function main() {
  const projectId = readArg("--project");
  const mode = readArg("--mode", "dry-run");
  const confirmedProject = readArg("--confirm-project");
  const backupFile = readArg("--backup-file");
  const validModes = ["dry-run", "apply", "verify", "rollback"];
  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!validModes.includes(mode)) throw new Error(`Mod invalid: ${mode}.`);
  if (["apply", "rollback"].includes(mode) && confirmedProject !== projectId) {
    throw new Error("Scrierea necesita --confirm-project cu Project ID-ul exact.");
  }
  if (mode === "rollback" && !backupFile) throw new Error("Rollback necesita --backup-file.");

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  if (mode === "rollback") {
    const backup = await readBackup(backupFile, projectId);
    for (const record of backup.records) {
      const vehicleRef = db.collection("vehicles").doc(record.vehicleId);
      const stateRef = vehicleRef.collection("positions").doc("_simulation");
      const currentState = await stateRef.get();
      if (currentState.exists && currentState.data()?.migrationId !== backup.migrationId) {
        throw new Error(`Rollback oprit: ${record.vehicleId} a fost modificat dupa migrare.`);
      }
      const currentRoutes = await vehicleRef.collection("simulationRoutes").limit(500).get();
      await commitOperations(db, currentRoutes.docs.map((item) => (batch) => batch.delete(item.ref)));
      await commitOperations(db, record.routes.map((route) => (batch) => {
        batch.set(vehicleRef.collection("simulationRoutes").doc(route.id), route.data, { merge: false });
      }));
      if (record.stateExists) await stateRef.set(record.state, { merge: false });
      else await stateRef.delete();
    }
    console.log(JSON.stringify({ projectId, mode, restored: backup.records.length }, null, 2));
    return;
  }

  const records = await scanStates(db);
  const candidates = records.filter(isCandidate);
  if (mode === "dry-run") {
    console.log(JSON.stringify({
      projectId,
      mode,
      statesScanned: records.length,
      candidates: candidates.length,
      embeddedRoutes: candidates.reduce(
        (sum, record) => sum + (record.state?.gpsSimHistory || []).filter(
          (simulation) => Array.isArray(simulation?.points) && simulation.points.length > 0
        ).length,
        0
      ),
      vehicleIds: candidates.map((record) => record.vehicleId),
    }, null, 2));
    return;
  }

  if (mode === "verify") {
    const failures = await verifyRecords(db, records.filter((record) => Number(record.state?.schemaVersion) === 2));
    console.log(JSON.stringify({ projectId, mode, verified: records.length - failures.length, failures }, null, 2));
    if (failures.length) process.exitCode = 2;
    return;
  }

  const migrationId = randomUUID();
  const backup = await writeBackup(projectId, migrationId, candidates);
  const appliedAt = Date.now();
  for (const record of candidates) {
    const vehicleRef = db.collection("vehicles").doc(record.vehicleId);
    const stateRef = vehicleRef.collection("positions").doc("_simulation");
    const current = await stateRef.get();
    const currentRoutes = await vehicleRef.collection("simulationRoutes").limit(HISTORY_LIMIT).get();
    const currentFingerprint = fingerprint({
      state: current.exists ? current.data() || {} : null,
      routes: currentRoutes.docs
        .map((item) => ({ id: item.id, data: item.data() || {} }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
    const sourceFingerprint = fingerprint({ state: record.state, routes: record.routes });
    if (currentFingerprint !== sourceFingerprint) {
      throw new Error(`Migrare oprita: ${record.vehicleId} s-a schimbat dupa backup.`);
    }
    const routeDocuments = buildRouteDocuments(record, appliedAt);
    await commitOperations(db, routeDocuments.map((route) => (batch) => {
      batch.set(vehicleRef.collection("simulationRoutes").doc(route.id), route.data, { merge: true });
    }));
    await stateRef.set(buildAppliedState(record, migrationId, appliedAt), { merge: false });
  }

  const failures = await verifyRecords(db, candidates);
  console.log(JSON.stringify({
    projectId,
    mode,
    migrated: candidates.length,
    backupFile: backup,
    verificationFailures: failures,
  }, null, 2));
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
