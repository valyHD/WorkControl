import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

async function main() {
  const projectId = readArg("--project");
  const mode = readArg("--mode", "dry-run");
  const confirmedProject = readArg("--confirm-project");
  if (!projectId) throw new Error("Foloseste --project <firebase-project-id>.");
  if (!["dry-run", "apply"].includes(mode)) throw new Error("Mod invalid; foloseste dry-run sau apply.");
  if (mode === "apply" && confirmedProject !== projectId) {
    throw new Error("Apply necesita --confirm-project cu Project ID-ul exact.");
  }

  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const vehicles = await db.collection("vehicles").limit(500).get();
  const candidates = [];

  for (const vehicle of vehicles.docs) {
    const data = vehicle.data() || {};
    if (!data.gpsSnapshot || typeof data.gpsSnapshot !== "object") continue;
    const runtimeRef = vehicle.ref.collection("positions").doc("_runtime");
    const runtime = await runtimeRef.get();
    // A valid runtime document can contain mileage that has not reached the root yet.
    // Never rewrite it during a repeated backfill; the gateway owns subsequent updates.
    if (runtime.exists && runtime.get("schemaVersion") === 1) continue;
    const legacyTimestamp = Math.max(
      Number(data.gpsSnapshot.serverTimestamp || 0),
      Number(data.gpsSnapshot.gpsTimestamp || 0)
    );
    candidates.push({ vehicle, runtimeRef, data, legacyTimestamp });
  }

  if (mode === "apply") {
    for (let offset = 0; offset < candidates.length; offset += 400) {
      const batch = db.batch();
      candidates.slice(offset, offset + 400).forEach(({
        vehicle,
        runtimeRef,
        data,
        legacyTimestamp,
      }) => {
        batch.set(runtimeRef, {
          schemaVersion: 1,
          vehicleId: vehicle.id,
          gpsSnapshot: data.gpsSnapshot,
          ...(data.liveDiagnostics ? { liveDiagnostics: data.liveDiagnostics } : {}),
          ...(data.gpsDataUsage ? { gpsDataUsage: data.gpsDataUsage } : {}),
          tracker: {
            imei: String(data.tracker?.imei || data.gpsSnapshot?.imei || ""),
            lastSeenAt: Number(data.tracker?.lastSeenAt || data.gpsSnapshot?.serverTimestamp || 0),
            updatedAt: Number(data.tracker?.updatedAt || data.gpsSnapshot?.serverTimestamp || 0),
            protocol: String(data.tracker?.protocol || "teltonika_codec_8e_tcp"),
          },
          mileageBaseKm: Math.max(0, Number(data.currentKm || 0)),
          pendingCurrentKm: 0,
          updatedAt: legacyTimestamp || Date.now(),
          backfilledAtServer: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
    }
  }

  console.log(JSON.stringify({
    projectId,
    mode,
    vehiclesScanned: vehicles.size,
    candidates: candidates.length,
    writesApplied: mode === "apply" ? candidates.length : 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
