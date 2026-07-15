import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback).trim() : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanText(item)).filter(Boolean))]
    : [];
}

function userCompanyIds(data) {
  const primaryCompanyId = cleanText(data.primaryCompanyId || data.companyId);
  const ids = cleanList(data.companyIds);
  if (primaryCompanyId && !ids.includes(primaryCompanyId)) ids.unshift(primaryCompanyId);
  return ids;
}

function buildCompanyNameMap(companies) {
  const names = new Map();
  for (const company of companies.docs) {
    const data = company.data() || {};
    names.set(
      company.id,
      cleanText(data.companyName || data.name || company.id)
    );
  }
  return names;
}

function buildPatch(data, companyNamesById) {
  const companyIds = userCompanyIds(data);
  if (companyIds.length === 0) return null;

  const existingCompanyNames = cleanList(data.companyNames);
  const nextCompanyNames = [...existingCompanyNames];
  for (const companyId of companyIds) {
    const companyName = companyNamesById.get(companyId);
    if (companyName && !nextCompanyNames.includes(companyName)) nextCompanyNames.push(companyName);
  }

  const primaryCompanyId = cleanText(data.primaryCompanyId || data.companyId || companyIds[0]);
  const currentPrimaryCompanyName = cleanText(data.primaryCompanyName);
  const nextPrimaryCompanyName =
    currentPrimaryCompanyName ||
    companyNamesById.get(primaryCompanyId) ||
    nextCompanyNames[0] ||
    "";

  const patch = {};
  if (primaryCompanyId && cleanText(data.primaryCompanyId) !== primaryCompanyId) {
    patch.primaryCompanyId = primaryCompanyId;
  }
  if (nextPrimaryCompanyName && currentPrimaryCompanyName !== nextPrimaryCompanyName) {
    patch.primaryCompanyName = nextPrimaryCompanyName;
  }
  if (JSON.stringify(existingCompanyNames) !== JSON.stringify(nextCompanyNames)) {
    patch.companyNames = nextCompanyNames;
  }
  if (JSON.stringify(cleanList(data.companyIds)) !== JSON.stringify(companyIds)) {
    patch.companyIds = companyIds;
  }

  return Object.keys(patch).length > 0 ? patch : null;
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
  const [companies, users] = await Promise.all([
    db.collection("firmeMentenanta").limit(500).get(),
    db.collection("users").limit(1000).get(),
  ]);
  const companyNamesById = buildCompanyNameMap(companies);
  const writes = [];

  for (const user of users.docs) {
    const patch = buildPatch(user.data() || {}, companyNamesById);
    if (!patch) continue;
    writes.push({
      ref: user.ref,
      userId: user.id,
      patch: {
        ...patch,
        updatedAt: Date.now(),
        updatedAtServer: FieldValue.serverTimestamp(),
      },
    });
  }

  if (mode === "apply") {
    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = db.batch();
      writes.slice(offset, offset + 400).forEach(({ ref, patch }) => batch.set(ref, patch, { merge: true }));
      await batch.commit();
    }
  }

  console.log(JSON.stringify({
    projectId,
    mode,
    companiesScanned: companies.size,
    usersScanned: users.size,
    usersNeedingCompanyNameBackfill: writes.length,
    writesApplied: mode === "apply" ? writes.length : 0,
    sampleUserIds: writes.slice(0, 10).map((item) => item.userId),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
