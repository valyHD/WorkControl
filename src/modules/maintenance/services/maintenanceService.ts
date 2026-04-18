import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from "firebase/firestore";
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
  return {
    id,
    name: toText(data.name),
    email: toText(data.email),
    phone: toText(data.phone),
    cif: toText(data.cif),
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
  phone: string;
  cif: string;
}): Promise<string> {
  const now = Date.now();
  const docRef = await addDoc(maintenanceClientsCollection, {
    name: input.name.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    cif: input.cif.trim(),
    addresses: [],
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  return docRef.id;
}
