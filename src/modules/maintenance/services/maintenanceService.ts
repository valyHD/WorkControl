import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import type {
  LiftStatus,
  LiftUnit,
  MaintenanceBranding,
  MaintenanceClient,
  MaintenanceDashboard,
  MaintenanceLocationOption,
  MaintenanceReport,
  ReportType,
} from "../../../types/maintenance";
import { buildReportFolderDate, normalizeCompanyName, sanitizePathSegment } from "../utils/reportUtils";

const clientsCollection = collection(db, "maintenanceClients");
const liftsCollection = collection(db, "maintenanceLifts");
const reportsCollection = collection(db, "rapoarte");
const brandingCollection = collection(db, "firmeMentenanta");

const warningThresholds = { yellow: 30, orange: 15, red: 7 };

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toLiftStatus(value: unknown): LiftStatus {
  if (value === "stopped" || value === "repair" || value === "overdue") return value;
  return "active";
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
    liftNumber: toText(data.liftNumber || data.Lift),
    locationName: toText(data.locationName || data.locatie),
    exactAddress: toText(data.exactAddress || data.adresa),
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
    maintenanceCompany: toText(data.maintenanceCompany || data.firmaMentenanta || data["Firma Mentenanta"]),
    expDate: toText(data.expDate || data.expData),
    status: toLiftStatus(data.status),
    notes: toText(data.notes),
    createdAt: toNumber(data.createdAt) || Date.now(),
    updatedAt: toNumber(data.updatedAt) || Date.now(),
  };
}

function mapReport(id: string, data: Record<string, unknown>): MaintenanceReport {
  return {
    id,
    reportId: toText(data.reportId) || id,
    clientId: toText(data.clientId),
    clientName: toText(data.client),
    locatieId: toText(data.locatieId),
    locatieName: toText(data.locatieName),
    adresa: toText(data.adresa),
    email: toText(data.email),
    liftId: toText(data.lift),
    liftIdDocument: toText(data.liftIdDocument),
    liftNumber: toText(data.lift),
    reportType: data.tipLucrare === "interventie" ? "interventie" : "revizie",
    createdAt: toNumber(data.createdAt) || Date.now(),
    dateText: toText(data.data),
    timeText: toText(data.timeText),
    dataFolder: toText(data.dataFolder),
    gpsLat: typeof data.gpsLat === "number" ? data.gpsLat : null,
    gpsLng: typeof data.gpsLng === "number" ? data.gpsLng : null,
    gpsLocatie: toText(data.gpsLocatie),
    technicianName: toText(data.tehnician),
    status: "final",
    observations: toText(data.observations),
    standardText: toText(data.standardText),
    constatareInterventie: toText(data.constatareInterventie),
    continutRaport: toText(data.continutRaport),
    pdfUrl: toText(data.pdfUrl),
    images: toStringArray(data.images),
    firmaLogo: toText(data.firmaLogo),
    firmaMentenantaOriginala: toText(data.firmaMentenantaOriginala),
    brandingId: toText(data.brandingId),
    logoUrlFolosit: toText(data.logoUrlFolosit),
    stampilaUrlFolosita: toText(data.stampilaUrlFolosita),
    createdByUid: toText(data.createdByUid),
  };
}

function mapBranding(id: string, data: Record<string, unknown>): MaintenanceBranding {
  return {
    id,
    nume: toText(data.nume),
    key: toText(data.key),
    aliases: toStringArray(data.aliases),
    logoUrl: toText(data.logoUrl),
    stampilaUrl: toText(data.stampilaUrl),
    semnaturaUrl: toText(data.semnaturaUrl),
    emailDisplayName: toText(data.emailDisplayName),
    emailImplicitCc: toStringArray(data.emailImplicitCc),
    active: data.active !== false,
    createdAt: toNumber(data.createdAt) || Date.now(),
    updatedAt: toNumber(data.updatedAt) || Date.now(),
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
  branding: MaintenanceBranding[];
  dashboard: MaintenanceDashboard;
}> {
  const [clientSnap, liftSnap, reportSnap, brandingSnap] = await Promise.all([
    getDocs(query(clientsCollection, orderBy("updatedAt", "desc"))),
    getDocs(query(liftsCollection, orderBy("updatedAt", "desc"))),
    getDocs(query(reportsCollection, orderBy("createdAt", "desc"))),
    getDocs(query(brandingCollection, orderBy("nume", "asc"))),
  ]);

  const clients = clientSnap.docs.map((item) => mapClient(item.id, item.data() as Record<string, unknown>));
  const lifts = liftSnap.docs.map((item) => mapLift(item.id, item.data() as Record<string, unknown>));
  const reports = reportSnap.docs.map((item) => mapReport(item.id, item.data() as Record<string, unknown>));
  const branding = brandingSnap.docs.map((item) => mapBranding(item.id, item.data() as Record<string, unknown>));

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

  return { clients, lifts, reports, branding, dashboard };
}

export function resolveBrandingForCompany(companyName: string, branding: MaintenanceBranding[]): { branding: MaintenanceBranding | null; warning: string } {
  const normalized = normalizeCompanyName(companyName);
  const active = branding.filter((item) => item.active);
  const found = active.find((item) => {
    const keyList = [item.key, item.nume, ...item.aliases].map(normalizeCompanyName);
    return keyList.includes(normalized);
  });

  if (found) return { branding: found, warning: "" };
  const fallback = active[0] ?? null;
  return {
    branding: fallback,
    warning: companyName ? `Branding inexistent pentru firma \"${companyName}\". Folosesc fallback.` : "Firma de mentenanta lipsa pe lift. Folosesc fallback.",
  };
}

export function buildLiftLocations(clientId: string, lifts: LiftUnit[]): MaintenanceLocationOption[] {
  const grouped = new Map<string, MaintenanceLocationOption>();
  lifts
    .filter((lift) => lift.clientId === clientId)
    .forEach((lift) => {
      const key = lift.locationName || lift.exactAddress || "Locatie";
      const existing = grouped.get(key);
      if (existing) {
        existing.lifts.push(lift);
      } else {
        grouped.set(key, {
          id: key,
          label: key,
          address: lift.exactAddress || key,
          lifts: [lift],
        });
      }
    });
  return Array.from(grouped.values());
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

export async function upsertBranding(input: Omit<MaintenanceBranding, "createdAt" | "updatedAt">) {
  const now = Date.now();
  await setDoc(doc(brandingCollection, input.id), {
    ...input,
    updatedAt: now,
    createdAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });
}

export async function uploadBrandingAsset(brandingId: string, kind: "logo" | "stampila" | "semnatura", file: File): Promise<string> {
  const storageRef = ref(storage, `branding/${brandingId}/${kind}_${Date.now()}_${sanitizePathSegment(file.name)}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

export async function createReportWithAssets(params: {
  reportPayload: Omit<MaintenanceReport, "id" | "pdfUrl">;
  pdfBlob: Blob;
  images: File[];
  clientId: string;
  reportType: ReportType;
  clientName: string;
  adresa: string;
  liftNumber: string;
  dataFolder: string;
}) {
  const { reportPayload, pdfBlob, images, clientId, reportType, clientName, adresa, liftNumber, dataFolder } = params;
  const baseFolder = `${reportType === "interventie" ? "INTERVENTII" : "REVIZII"}/${sanitizePathSegment(clientName)}/${sanitizePathSegment(adresa)}/${sanitizePathSegment(liftNumber)}/${dataFolder}`;

  const imageUrls: string[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const ext = images[i].name.split(".").pop() || "jpg";
    const imgRef = ref(storage, `${baseFolder}/img_${i}.${ext}`);
    await uploadBytes(imgRef, images[i], { contentType: images[i].type });
    imageUrls.push(await getDownloadURL(imgRef));
  }

  const pdfRef = ref(storage, `${baseFolder}/${reportType === "interventie" ? "raport_interventie.pdf" : "raport_revizie.pdf"}`);
  await uploadBytes(pdfRef, pdfBlob, { contentType: "application/pdf" });
  const pdfUrl = await getDownloadURL(pdfRef);

  const docData = {
    ...reportPayload,
    pdfUrl,
    images: imageUrls,
    createdAtServer: serverTimestamp(),
  };

  await setDoc(doc(reportsCollection, reportPayload.reportId), docData, { merge: true });
  await setDoc(doc(db, `maintenanceClients/${clientId}/rapoarte/${reportPayload.reportId}`), docData, { merge: true });
  return { pdfUrl, imageUrls, path: baseFolder };
}

export async function deleteReportFully(report: MaintenanceReport) {
  await Promise.all([
    deleteDoc(doc(reportsCollection, report.id)),
    deleteDoc(doc(db, `maintenanceClients/${report.clientId}/rapoarte/${report.id}`)),
  ]);

  const files = [report.pdfUrl, ...report.images].filter(Boolean);
  await Promise.all(
    files.map(async (url) => {
      try {
        await deleteObject(ref(storage, url));
      } catch {
        // ignore broken links
      }
    }),
  );
}

export async function deleteBranding(id: string) {
  await deleteDoc(doc(brandingCollection, id));
  try {
    const folderRef = ref(storage, `branding/${id}`);
    const list = await listAll(folderRef);
    await Promise.all(list.items.map((item) => deleteObject(item)));
  } catch {
    // ignore
  }
}

export function nowFolderString(): string {
  return buildReportFolderDate(new Date());
}
