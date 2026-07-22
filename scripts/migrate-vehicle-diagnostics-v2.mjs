import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  decodeFirestoreBackupValue,
  encodeFirestoreBackupValue,
} from "./firestore-backup-codec.mjs";

const require = createRequire(import.meta.url);
const {
  compactDiagnosticEvents,
  compactDiagnosticSamples,
} = require("../gps-diagnostics-compaction.cjs");

const SCHEMA_VERSION = 2;
const BATCH_SIZE = 350;
const MAX_TRANSACTION_WRITES = 450;
const RECENT_EVENT_LIMIT = 12;
const RECENT_SAMPLE_LIMIT = 6;

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

function backupPath(projectId) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve(
    process.cwd(),
    "..",
    "workcontrol-migration-backups",
    `${projectId}-vehicle-diagnostics-v2-${timestamp}.json`
  );
}

function toRecord(dayDoc, samples, events) {
  const vehicleRef = dayDoc.ref.parent.parent;
  return {
    path: dayDoc.ref.path,
    vehicleId: vehicleRef?.id || "",
    dayKey: dayDoc.id,
    data: dayDoc.data() || {},
    sampleDocuments: samples.docs
      .map((item) => ({ id: item.id, data: item.data() || {} }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    eventDocuments: events.docs
      .map((item) => ({ id: item.id, data: item.data() || {} }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function sourceFingerprint(record) {
  return fingerprint({
    data: record.data,
    sampleDocuments: record.sampleDocuments,
    eventDocuments: record.eventDocuments,
  });
}

function isCandidate(record) {
  return Number(record.data?.schemaVersion || 1) < SCHEMA_VERSION ||
    Array.isArray(record.data?.samples) ||
    Array.isArray(record.data?.events);
}

function legacySamples(record) {
  if (Array.isArray(record.data?.samples)) return record.data.samples;
  return Array.isArray(record.data?.recentSamples) ? record.data.recentSamples : [];
}

function legacyEvents(record) {
  if (Array.isArray(record.data?.events)) return record.data.events;
  return Array.isArray(record.data?.recentEvents) ? record.data.recentEvents : [];
}

function recentPayloads(documents, limit) {
  return documents
    .slice(-limit)
    .map((document) => {
      const { expiresAt: _expiresAt, ...payload } = document.payload;
      return payload;
    })
    .reverse();
}

async function scanDiagnostics(db) {
  const dayDocs = await db.collectionGroup("diagnosticDays").limit(5000).get();
  const records = [];
  for (const dayDoc of dayDocs.docs) {
    const [samples, events] = await Promise.all([
      dayDoc.ref.collection("diagnosticSamples").limit(500).get(),
      dayDoc.ref.collection("diagnosticEvents").limit(500).get(),
    ]);
    records.push(toRecord(dayDoc, samples, events));
  }
  return records;
}

async function writeBackup(projectId, migrationId, records) {
  const path = backupPath(projectId);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(encodeFirestoreBackupValue({
    version: 2,
    projectId,
    migrationId,
    createdAt: new Date().toISOString(),
    records: records.map((record) => ({ ...record, sourceFingerprint: sourceFingerprint(record) })),
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

async function commitOperations(db, operations) {
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function verifyRecords(db, records) {
  const failures = [];
  for (const record of records) {
    const dayRef = db.doc(record.path);
    const [day, samples, events] = await Promise.all([
      dayRef.get(),
      dayRef.collection("diagnosticSamples").limit(500).get(),
      dayRef.collection("diagnosticEvents").limit(500).get(),
    ]);
    const data = day.exists ? day.data() || {} : {};
    const expectedSamples = compactDiagnosticSamples(legacySamples(record), Number.MAX_SAFE_INTEGER).length;
    const expectedEvents = compactDiagnosticEvents(legacyEvents(record), Number.MAX_SAFE_INTEGER).length;
    if (
      Number(data.schemaVersion || 0) !== SCHEMA_VERSION ||
      Object.hasOwn(data, "samples") ||
      Object.hasOwn(data, "events") ||
      samples.size < expectedSamples ||
      events.size < expectedEvents
    ) {
      failures.push({
        path: record.path,
        schemaVersion: Number(data.schemaVersion || 0),
        samples: samples.size,
        expectedSamples,
        events: events.size,
        expectedEvents,
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
      const dayRef = db.doc(record.path);
      const current = await dayRef.get();
      const currentData = current.exists ? current.data() || {} : {};
      if (
        currentData.migrationId !== backup.migrationId ||
        Number(currentData.updatedAt || 0) > Number(currentData.migrationAppliedAt || 0)
      ) {
        throw new Error(`Rollback oprit: ${record.path} a primit date noi dupa migrare.`);
      }
      const [currentSamples, currentEvents] = await Promise.all([
        dayRef.collection("diagnosticSamples").limit(500).get(),
        dayRef.collection("diagnosticEvents").limit(500).get(),
      ]);
      await commitOperations(db, [
        ...currentSamples.docs.map((item) => (batch) => batch.delete(item.ref)),
        ...currentEvents.docs.map((item) => (batch) => batch.delete(item.ref)),
      ]);
      await commitOperations(db, [
        ...record.sampleDocuments.map((item) => (batch) => {
          batch.set(dayRef.collection("diagnosticSamples").doc(item.id), item.data, { merge: false });
        }),
        ...record.eventDocuments.map((item) => (batch) => {
          batch.set(dayRef.collection("diagnosticEvents").doc(item.id), item.data, { merge: false });
        }),
      ]);
      await dayRef.set(record.data, { merge: false });
    }
    console.log(JSON.stringify({ projectId, mode, restored: backup.records.length }, null, 2));
    return;
  }

  const records = await scanDiagnostics(db);
  const candidates = records.filter(isCandidate);
  if (mode === "dry-run") {
    const writeCounts = candidates.map((record) => {
      const samples = compactDiagnosticSamples(legacySamples(record), Number.MAX_SAFE_INTEGER);
      const events = compactDiagnosticEvents(legacyEvents(record), Number.MAX_SAFE_INTEGER);
      return {
        path: record.path,
        writes: samples.length + events.length + 1,
      };
    });
    const oversizedDays = writeCounts.filter((item) => item.writes > MAX_TRANSACTION_WRITES);
    console.log(JSON.stringify({
      projectId,
      mode,
      daysScanned: records.length,
      candidates: candidates.length,
      legacySamples: candidates.reduce((sum, record) => sum + legacySamples(record).length, 0),
      compactSamples: candidates.reduce(
        (sum, record) => sum + compactDiagnosticSamples(legacySamples(record), Number.MAX_SAFE_INTEGER).length,
        0
      ),
      legacyEvents: candidates.reduce((sum, record) => sum + legacyEvents(record).length, 0),
      compactEvents: candidates.reduce(
        (sum, record) => sum + compactDiagnosticEvents(legacyEvents(record), Number.MAX_SAFE_INTEGER).length,
        0
      ),
      maxWritesForOneDay: writeCounts.reduce((max, item) => Math.max(max, item.writes), 0),
      oversizedDays,
    }, null, 2));
    return;
  }

  if (mode === "verify") {
    const schema2Records = records.filter((record) => Number(record.data?.schemaVersion) === 2);
    const failures = await verifyRecords(db, schema2Records);
    console.log(JSON.stringify({ projectId, mode, verified: schema2Records.length - failures.length, failures }, null, 2));
    if (failures.length) process.exitCode = 2;
    return;
  }

  const migrationId = randomUUID();
  const backup = await writeBackup(projectId, migrationId, candidates);
  for (const record of candidates) {
    const dayRef = db.doc(record.path);
    const expectedSourceFingerprint = sourceFingerprint(record);
    const samples = compactDiagnosticSamples(legacySamples(record), Number.MAX_SAFE_INTEGER);
    const events = compactDiagnosticEvents(legacyEvents(record), Number.MAX_SAFE_INTEGER);
    const transactionWrites = samples.length + events.length + 1;
    if (transactionWrites > MAX_TRANSACTION_WRITES) {
      throw new Error(
        `Migrare oprita inainte de scriere: ${record.path} necesita ${transactionWrites} operatii atomice.`
      );
    }
    const appliedAt = Date.now();
    await db.runTransaction(async (transaction) => {
      const [day, existingSamples, existingEvents] = await Promise.all([
        transaction.get(dayRef),
        transaction.get(dayRef.collection("diagnosticSamples").limit(500)),
        transaction.get(dayRef.collection("diagnosticEvents").limit(500)),
      ]);
      const currentRecord = toRecord(day, existingSamples, existingEvents);
      if (sourceFingerprint(currentRecord) !== expectedSourceFingerprint) {
        throw new Error(`Migrare oprita: ${record.path} s-a schimbat dupa backup.`);
      }
      samples.forEach((document) => {
        transaction.set(dayRef.collection("diagnosticSamples").doc(document.id), document.payload, { merge: true });
      });
      events.forEach((document) => {
        transaction.set(dayRef.collection("diagnosticEvents").doc(document.id), document.payload, { merge: true });
      });
      transaction.set(dayRef, {
        schemaVersion: SCHEMA_VERSION,
        recentSamples: recentPayloads(samples, RECENT_SAMPLE_LIMIT),
        recentEvents: recentPayloads(events, RECENT_EVENT_LIMIT),
        samplesCount: Math.max(Number(record.data?.samplesCount || 0), samples.length),
        eventsCount: Math.max(Number(record.data?.eventsCount || 0), events.length),
        events: FieldValue.delete(),
        samples: FieldValue.delete(),
        migrationId,
        migrationAppliedAt: appliedAt,
        migratedAtServer: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
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
