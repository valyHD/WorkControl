import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { ClientAddress, LiftUnit, MaintenanceClient } from "../../../types/maintenance";

const maintenanceClientsCollection = collection(db, "maintenanceClients");

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

export async function getMaintenanceClients(): Promise<MaintenanceClient[]> {
  const snap = await getDocs(query(maintenanceClientsCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapClient(docItem.id, docItem.data() as Record<string, unknown>));
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
