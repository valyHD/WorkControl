import process from "node:process";
import { createRequire } from "node:module";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const {
  buildVehicleOperationalView,
  VEHICLE_OPERATIONAL_VIEW_VERSION,
} = require("../functions/vehicleOperationalView.js");
const {
  buildUserOperationalView,
  cleanIds,
  userOperationalViewId,
  USER_OPERATIONAL_VIEW_VERSION,
} = require("../functions/userOperationalView.js");
const { buildProjectionEnvelope } = require("../functions/projectionPayload.js");

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

function projectionChanged(snapshot, next) {
  return !snapshot.exists || snapshot.get("projectionHash") !== next.projectionHash;
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
  const [vehicles, users] = await Promise.all([
    db.collection("vehicles").limit(500).get(),
    db.collection("users").limit(500).get(),
  ]);
  const writes = [];

  for (const vehicle of vehicles.docs) {
    const payload = buildVehicleOperationalView(vehicle.id, vehicle.data() || {});
    const next = buildProjectionEnvelope(payload, VEHICLE_OPERATIONAL_VIEW_VERSION, Date.now());
    const ref = db.collection("vehicleOperationalViews").doc(vehicle.id);
    const current = await ref.get();
    if (!projectionChanged(current, next)) continue;
    writes.push({ ref, next });
  }

  for (const user of users.docs) {
    const data = user.data() || {};
    const companyIds = cleanIds(data.companyIds, data.primaryCompanyId);
    for (const companyId of companyIds) {
      const payload = buildUserOperationalView(user.id, companyId, data);
      const next = buildProjectionEnvelope(payload, USER_OPERATIONAL_VIEW_VERSION, Date.now());
      const ref = db.collection("userOperationalViews").doc(userOperationalViewId(companyId, user.id));
      const current = await ref.get();
      if (!projectionChanged(current, next)) continue;
      writes.push({ ref, next });
    }
  }

  if (mode === "apply") {
    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = db.batch();
      writes.slice(offset, offset + 400).forEach(({ ref, next }) => {
        batch.set(ref, {
          ...next,
          updatedAtServer: FieldValue.serverTimestamp(),
        }, { merge: false });
      });
      await batch.commit();
    }
  }

  console.log(JSON.stringify({
    projectId,
    mode,
    vehiclesScanned: vehicles.size,
    usersScanned: users.size,
    projectionWritesNeeded: writes.length,
    writesApplied: mode === "apply" ? writes.length : 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
