import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import { getCurrentCompanyAccessContext } from "../../../lib/firebase/companyAccess";
import type { MaintenancePartOrderPreferences } from "../../../types/maintenance";

const COLLECTION = "maintenancePartOrderPreferences";
const STORAGE_PREFIX = "workcontrol.maintenancePartOrderPreferences.v1";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function normalizePreferences(
  userId: string,
  value: Partial<MaintenancePartOrderPreferences> | null | undefined
): MaintenancePartOrderPreferences {
  return {
    userId,
    companyId: cleanText(value?.companyId),
    supplierName: cleanText(value?.supplierName),
    supplierContact: cleanText(value?.supplierContact),
    supplierEmail: cleanText(value?.supplierEmail).toLowerCase(),
    lineSupplier: cleanText(value?.lineSupplier),
    lastPartName: cleanText(value?.lastPartName),
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value?.updatedAt) : 0,
  };
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

export function readLocalPartOrderPreferences(userId: string): MaintenancePartOrderPreferences {
  if (typeof window === "undefined") return normalizePreferences(userId, null);
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return normalizePreferences(userId, raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePreferences(userId, null);
  }
}

export function writeLocalPartOrderPreferences(
  userId: string,
  value: Partial<MaintenancePartOrderPreferences>
): MaintenancePartOrderPreferences {
  const normalized = normalizePreferences(userId, { ...value, updatedAt: Date.now() });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
  }
  return normalized;
}

export async function loadPartOrderPreferences(userId: string): Promise<MaintenancePartOrderPreferences> {
  const local = readLocalPartOrderPreferences(userId);
  const snap = await getDoc(doc(db, COLLECTION, userId));
  if (!snap.exists()) return local;
  const cloud = normalizePreferences(userId, snap.data() as Partial<MaintenancePartOrderPreferences>);
  const selected = cloud.updatedAt >= local.updatedAt ? cloud : local;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(selected));
  }
  return selected;
}

export async function savePartOrderPreferences(
  userId: string,
  value: Partial<MaintenancePartOrderPreferences>
): Promise<MaintenancePartOrderPreferences> {
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== userId) throw new Error("Preferintele pot fi salvate numai pentru utilizatorul autentificat.");
  const normalized = writeLocalPartOrderPreferences(userId, {
    ...value,
    companyId: value.companyId || context.primaryCompanyId || context.companyIds[0] || "",
  });
  await setDoc(
    doc(db, COLLECTION, userId),
    {
      ...normalized,
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
  return normalized;
}
