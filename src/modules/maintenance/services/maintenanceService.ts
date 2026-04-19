import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import type { LiftUnit, LiftStatus, MaintenanceClient, MaintenanceDashboard, MaintenanceReport } from "../../../types/maintenance";

const clientsCollection = collection(db, "maintenanceClients");
const liftsCollection = collection(db, "maintenanceLifts");
const reportsCollection = collection(db, "maintenanceReports");

const warningThresholds = { yellow: 30, orange: 15, red: 7 };

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function toLiftStatus(value: unknown): LiftStatus {
  if (value === "stopped" || value === "repair" || value === "overdue") return value;
  return "active";
}

function toChecklist(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function mapClient(id: string, data: Record<string, unknown>): MaintenanceClient {
  return {
    id,
    name: toText(data.name),
    contactPerson: toText(data.contactPerson),
    phone: toText(data.phone),
    email: toText(data.email),
    mainAddress: toText(data.mainAddress),
    notes: toText(data.notes),
    internalCode: toText(data.internalCode),
    status: data.status === "inactive" ? "inactive" : "active",
    createdAt: toNumber(data.createdAt) || Date.now(),
    updatedAt: toNumber(data.updatedAt) || Date.now(),
  };
}

function mapLift(id: string, data: Record<string, unknown>): LiftUnit {
  return {
    id,
    clientId: toText(data.clientId),
    clientName: toText(data.clientName),
    liftNumber: toText(data.liftNumber),
    locationName: toText(data.locationName),
    exactAddress: toText(data.exactAddress),
    building: toText(data.building),
    serialNumber: toText(data.serialNumber),
    liftType: toText(data.liftType),
    manufacturer: toText(data.manufacturer),
    capacity: toText(data.capacity),
    floors: toText(data.floors),
    installYear: toText(data.installYear),
    commissioningDate: toText(data.commissioningDate),
    nextInspectionDate: toText(data.nextInspectionDate),
    contractExpiryDate: toText(data.contractExpiryDate),
    assignedTechnician: toText(data.assignedTechnician),
    status: toLiftStatus(data.status),
    notes: toText(data.notes),
    createdAt: toNumber(data.createdAt) || Date.now(),
    updatedAt: toNumber(data.updatedAt) || Date.now(),
  };
}

function mapReport(id: string, data: Record<string, unknown>): MaintenanceReport {
  return {
    id,
    clientId: toText(data.clientId),
    clientName: toText(data.clientName),
    liftId: toText(data.liftId),
    liftNumber: toText(data.liftNumber),
    reportType: data.reportType === "interventie" ? "interventie" : "revizie",
    createdAt: toNumber(data.createdAt) || Date.now(),
    dateText: toText(data.dateText),
    timeText: toText(data.timeText),
    gpsLat: typeof data.gpsLat === "number" ? data.gpsLat : null,
    gpsLng: typeof data.gpsLng === "number" ? data.gpsLng : null,
    gpsAddress: toText(data.gpsAddress),
    technicianName: toText(data.technicianName),
    status: data.status === "draft" ? "draft" : "final",
    observations: toText(data.observations),
    reviewChecklist: toChecklist(data.reviewChecklist),
    standardText: toText(data.standardText),
    complaint: toText(data.complaint),
    finding: toText(data.finding),
    workPerformed: toText(data.workPerformed),
    replacedParts: toText(data.replacedParts),
    recommendations: toText(data.recommendations),
    pdfUrl: toText(data.pdfUrl),
  };
}

export function getLiftUrgency(lift: LiftUnit): "normal" | "yellow" | "orange" | "red" {
  if (!lift.nextInspectionDate) return "normal";
  const diffDays = Math.ceil((new Date(lift.nextInspectionDate).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(diffDays)) return "normal";
  if (diffDays <= warningThresholds.red) return "red";
  if (diffDays <= warningThresholds.orange) return "orange";
  if (diffDays <= warningThresholds.yellow) return "yellow";
  return "normal";
}

export async function getMaintenanceData(): Promise<{
  clients: MaintenanceClient[];
  lifts: LiftUnit[];
  reports: MaintenanceReport[];
  dashboard: MaintenanceDashboard;
}> {
  const [clientSnap, liftSnap, reportSnap] = await Promise.all([
    getDocs(query(clientsCollection, orderBy("updatedAt", "desc"))),
    getDocs(query(liftsCollection, orderBy("updatedAt", "desc"))),
    getDocs(query(reportsCollection, orderBy("createdAt", "desc"))),
  ]);

  const clients = clientSnap.docs.map((item) => mapClient(item.id, item.data() as Record<string, unknown>));
  const lifts = liftSnap.docs.map((item) => mapLift(item.id, item.data() as Record<string, unknown>));
  const reports = reportSnap.docs.map((item) => mapReport(item.id, item.data() as Record<string, unknown>));

  const dashboard: MaintenanceDashboard = {
    totalClients: clients.length,
    totalLifts: lifts.length,
    activeLifts: lifts.filter((lift) => lift.status === "active").length,
    dueSoon30: lifts.filter((lift) => getLiftUrgency(lift) === "yellow").length,
    dueSoon15: lifts.filter((lift) => getLiftUrgency(lift) === "orange").length,
    dueSoon7: lifts.filter((lift) => getLiftUrgency(lift) === "red").length,
    expired: lifts.filter((lift) => lift.nextInspectionDate && new Date(lift.nextInspectionDate).getTime() < Date.now()).length,
    reportsLast7Days: reports.filter((item) => item.createdAt >= Date.now() - 7 * 86_400_000).length,
    latestReports: reports.slice(0, 8),
  };

  return { clients, lifts, reports, dashboard };
}

export async function createMaintenanceClient(input: Omit<MaintenanceClient, "id" | "createdAt" | "updatedAt">) {
  const now = Date.now();
  await addDoc(clientsCollection, {
    ...input,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function updateMaintenanceClient(id: string, input: Partial<MaintenanceClient>) {
  await updateDoc(doc(clientsCollection, id), {
    ...input,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function deleteMaintenanceClient(id: string) {
  await deleteDoc(doc(clientsCollection, id));
}

export async function createLift(input: Omit<LiftUnit, "id" | "createdAt" | "updatedAt">) {
  const now = Date.now();
  await addDoc(liftsCollection, {
    ...input,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function updateLift(id: string, input: Partial<LiftUnit>) {
  await updateDoc(doc(liftsCollection, id), {
    ...input,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function deleteLift(id: string) {
  await deleteDoc(doc(liftsCollection, id));
}

export async function createReport(input: Omit<MaintenanceReport, "id" | "pdfUrl">, pdfBlob: Blob) {
  const reportRef = await addDoc(reportsCollection, {
    ...input,
    pdfUrl: "",
    createdAtServer: serverTimestamp(),
  });

  const storageRef = ref(storage, `maintenanceReports/${reportRef.id}.pdf`);
  await uploadBytes(storageRef, pdfBlob, { contentType: "application/pdf" });
  const pdfUrl = await getDownloadURL(storageRef);

  await updateDoc(reportRef, { pdfUrl });
  return reportRef.id;
}

export async function getClientById(clientId: string) {
  const snapshot = await getDoc(doc(clientsCollection, clientId));
  if (!snapshot.exists()) return null;
  return mapClient(snapshot.id, snapshot.data() as Record<string, unknown>);
}
