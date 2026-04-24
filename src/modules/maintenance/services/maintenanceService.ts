import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  setDoc,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import type {
  ClientAddress,
  LiftUnit,
  MaintenanceClient,
  MaintenanceCompanyBranding,
} from "../../../types/maintenance";

const maintenanceClientsCollection = collection(db, "maintenanceClients");
const maintenanceBrandingCollection = collection(db, "maintenanceCompanyBranding");

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapLiftUnit(raw: unknown, index: number): LiftUnit {
  const item = (raw ?? {}) as Record<string, unknown>;
  return {
    id: toText(item.id) || `lift_${index}_${Date.now()}`,
    label: toText(item.label),
    serialNumber: toText(item.serialNumber),
    manufacturer: toText(item.manufacturer),
    installYear: toText(item.installYear),
    maintenanceCompany: toText(item.maintenanceCompany),
    maintenanceEmail: toText(item.maintenanceEmail),
    inspectionExpiryDate: toText(item.inspectionExpiryDate),
    notes: toText(item.notes),
  };
}

function mapAddress(raw: unknown, index: number): ClientAddress {
  const item = (raw ?? {}) as Record<string, unknown>;
  const liftsRaw = Array.isArray(item.lifts) ? item.lifts : [];
  return {
    id: toText(item.id) || `address_${index}_${Date.now()}`,
    label: toText(item.label),
    city: toText(item.city),
    street: toText(item.street),
    postalCode: toText(item.postalCode),
    contactPerson: toText(item.contactPerson),
    contactPhone: toText(item.contactPhone),
    lifts: liftsRaw.map((liftItem, liftIndex) => mapLiftUnit(liftItem, liftIndex)),
  };
}

function mapClient(id: string, data: Record<string, unknown>): MaintenanceClient {
  const addressesRaw = Array.isArray(data.addresses) ? data.addresses : [];
  const rawEmails = Array.isArray(data.emails) ? data.emails.map((item) => toText(item)).filter(Boolean) : [];
  const rawLiftNumbers = Array.isArray(data.liftNumbers)
    ? data.liftNumbers.map((item) => toText(item)).filter(Boolean)
    : [];
  const fallbackEmail = toText(data.email);
  const fallbackLiftNumber = toText(data.liftNumber);

  const emails = rawEmails.length > 0 ? rawEmails : fallbackEmail ? [fallbackEmail] : [];
  const liftNumbers = rawLiftNumbers.length > 0 ? rawLiftNumbers : fallbackLiftNumber ? [fallbackLiftNumber] : [];

  return {
    id,
    name: toText(data.name),
    email: fallbackEmail,
    emails,
    address: toText(data.address),
    liftNumber: fallbackLiftNumber,
    liftNumbers,
    expiryDate: toText(data.expiryDate),
    maintenanceCompany: toText(data.maintenanceCompany),
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
    addresses: addressesRaw.map((address, addressIndex) => mapAddress(address, addressIndex)),
  };
}

function normalizeCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapBranding(
  id: string,
  data: Record<string, unknown>
): MaintenanceCompanyBranding {
  const companyName = toText(data.companyName);
  return {
    id,
    companyName,
    companyKey: toText(data.companyKey) || normalizeCompanyKey(companyName) || id,
    logoUrl: toText(data.logoUrl),
    stampUrl: toText(data.stampUrl),
    logoPath: toText(data.logoPath),
    stampPath: toText(data.stampPath),
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

export async function getMaintenanceClients(): Promise<MaintenanceClient[]> {
  const snap = await getDocs(query(maintenanceClientsCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapClient(docItem.id, docItem.data() as Record<string, unknown>));
}

export function subscribeMaintenanceClients(
  onData: (clients: MaintenanceClient[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(maintenanceClientsCollection, orderBy("updatedAt", "desc")),
    (snap) => {
      onData(snap.docs.map((docItem) => mapClient(docItem.id, docItem.data() as Record<string, unknown>)));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function createMaintenanceClient(input: {
  name: string;
  email: string;
  address: string;
  liftNumber: string;
  expiryDate: string;
  maintenanceCompany: string;
}): Promise<string> {
  const now = Date.now();
  const docRef = await addDoc(maintenanceClientsCollection, {
    name: input.name.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    liftNumber: input.liftNumber.trim(),
    liftNumbers: input.liftNumber.trim() ? [input.liftNumber.trim()] : [],
    expiryDate: input.expiryDate.trim(),
    maintenanceCompany: input.maintenanceCompany.trim(),
    emails: input.email.trim() ? [input.email.trim()] : [],
    addresses: [],
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  return docRef.id;
}

export async function getMaintenanceClientById(clientId: string): Promise<MaintenanceClient | null> {
  const clientRef = doc(db, "maintenanceClients", clientId);
  const snap = await getDoc(clientRef);
  if (!snap.exists()) {
    return null;
  }

  return mapClient(snap.id, snap.data() as Record<string, unknown>);
}

export async function updateMaintenanceClient(clientId: string, payload: Partial<MaintenanceClient>): Promise<void> {
  const clientRef = doc(db, "maintenanceClients", clientId);
  const nextEmail = payload.emails?.[0] ?? payload.email ?? "";
  const nextLiftNumber = payload.liftNumbers?.[0] ?? payload.liftNumber ?? "";

  await updateDoc(clientRef, {
    ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
    ...(payload.address !== undefined ? { address: payload.address.trim() } : {}),
    ...(payload.expiryDate !== undefined ? { expiryDate: payload.expiryDate.trim() } : {}),
    ...(payload.maintenanceCompany !== undefined
      ? { maintenanceCompany: payload.maintenanceCompany.trim() }
      : {}),
    ...(payload.email !== undefined || payload.emails !== undefined
      ? {
          email: nextEmail.trim(),
          emails: (payload.emails ?? []).map((item) => item.trim()).filter(Boolean),
        }
      : {}),
    ...(payload.liftNumber !== undefined || payload.liftNumbers !== undefined
      ? {
          liftNumber: nextLiftNumber.trim(),
          liftNumbers: (payload.liftNumbers ?? []).map((item) => item.trim()).filter(Boolean),
        }
      : {}),
    ...(payload.addresses !== undefined ? { addresses: payload.addresses } : {}),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export function subscribeMaintenanceCompanyBranding(
  onData: (items: MaintenanceCompanyBranding[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(maintenanceBrandingCollection, orderBy("companyName", "asc")),
    (snap) => {
      onData(snap.docs.map((docItem) => mapBranding(docItem.id, docItem.data() as Record<string, unknown>)));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function uploadMaintenanceBrandingAsset(input: {
  companyName: string;
  assetType: "logo" | "stamp";
  file: File;
}): Promise<{ url: string; path: string }> {
  const companyKey = normalizeCompanyKey(input.companyName) || "firma";
  const ext = input.file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = ext.replace(/[^a-z0-9]/g, "") || "png";
  const fileName = `${input.assetType}_${Date.now()}.${safeExt}`;
  const path = `maintenance-branding/${companyKey}/${fileName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, input.file, {
    contentType: input.file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(fileRef);
  return { url, path };
}

export async function saveMaintenanceCompanyBranding(input: {
  companyName: string;
  logoUrl?: string;
  stampUrl?: string;
  logoPath?: string;
  stampPath?: string;
}): Promise<string> {
  const companyName = input.companyName.trim();
  const companyKey = normalizeCompanyKey(companyName);
  if (!companyName || !companyKey) {
    throw new Error("Compania este obligatorie.");
  }

  const docRef = doc(db, "maintenanceCompanyBranding", companyKey);
  const snap = await getDoc(docRef);
  const existing = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  const now = Date.now();

  await setDoc(
    docRef,
    {
      companyName,
      companyKey,
      logoUrl: input.logoUrl ?? toText(existing?.logoUrl),
      stampUrl: input.stampUrl ?? toText(existing?.stampUrl),
      logoPath: input.logoPath ?? toText(existing?.logoPath),
      stampPath: input.stampPath ?? toText(existing?.stampPath),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedAtServer: serverTimestamp(),
      ...(existing ? {} : { createdAtServer: serverTimestamp() }),
    },
    { merge: true }
  );

  return companyKey;
}
