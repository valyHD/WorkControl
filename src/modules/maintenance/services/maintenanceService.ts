import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  setDoc,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import type {
  ClientAddress,
  LiftUnit,
  MaintenanceClient,
  MaintenanceCompanyBranding,
  MaintenanceReportAttachment,
  MaintenanceReportHistoryItem,
} from "../../../types/maintenance";

const maintenanceClientsCollection = collection(db, "maintenanceClients");
const maintenanceBrandingCollection = collection(db, "firmeMentenanta");

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
    revisionType: toText(item.revisionType) || "R2",
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
  const liftExpiryDatesRaw = data.liftExpiryDates && typeof data.liftExpiryDates === "object"
     ? (data.liftExpiryDates as Record<string, unknown>)
    : {};
  const liftRevisionTypesRaw = data.liftRevisionTypes && typeof data.liftRevisionTypes === "object"
     ? (data.liftRevisionTypes as Record<string, unknown>)
    : {};
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
    liftExpiryDates: Object.fromEntries(
      Object.entries(liftExpiryDatesRaw)
        .map(([key, value]) => [key, toText(value)])
        .filter(([key, value]) => Boolean(key) && Boolean(value))
    ),
    liftRevisionTypes: Object.fromEntries(
      Object.entries(liftRevisionTypesRaw)
        .map(([key, value]) => [key, toText(value) || "R2"])
        .filter(([key]) => Boolean(key))
    ),
    expiryDate: toText(data.expiryDate),
    maintenanceCompany: toText(data.maintenanceCompany),
    contactPerson: toText(data.contactPerson),
    contactPhone: toText(data.contactPhone),
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

function mapReportHistory(id: string, data: Record<string, unknown>): MaintenanceReportHistoryItem {
  const imagesRaw = Array.isArray(data.images) ? data.images : [];
  return {
    id,
    clientId: toText(data.clientId),
    clientName: toText(data.clientName),
    reportType: toText(data.reportType),
    address: toText(data.address),
    lift: toText(data.lift),
    technicianName: toText(data.technicianName),
    comments: toText(data.comments),
    pdfUrl: toText(data.pdfUrl),
    pdfPath: toText(data.pdfPath),
    images: imagesRaw.map((item) => {
      const raw = (item ?? {}) as Record<string, unknown>;
      return {
        name: toText(raw.name),
        url: toText(raw.url),
        path: toText(raw.path),
        contentType: toText(raw.contentType),
      };
    }),
    fileName: toText(data.fileName),
    createdAt: Number(data.createdAt ?? Date.now()),
    dateText: toText(data.dateText),
    timeText: toText(data.timeText),
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
  contactPerson?: string;
  contactPhone?: string;
  addresses?: Array<{
    label: string;
    lifts: Array<{
      serialNumber: string;
      expiryDate: string;
      revisionType?: string;
    }>;
  }>;
}): Promise<string> {
  const now = Date.now();
  const addressRows = (input.addresses || [])
    .map((address) => ({
      label: address.label.trim(),
      lifts: address.lifts
        .map((lift) => ({
          serialNumber: lift.serialNumber.trim(),
          expiryDate: lift.expiryDate.trim(),
          revisionType: (lift.revisionType || "R2").trim() || "R2",
        }))
        .filter((lift) => lift.serialNumber),
    }))
    .filter((address) => address.label || address.lifts.length);
  const primaryAddress = addressRows[0]?.label || input.address.trim();
  const primaryLifts = addressRows[0]?.lifts || (input.liftNumber.trim()
    ? [{ serialNumber: input.liftNumber.trim(), expiryDate: input.expiryDate.trim() }]
    : []);
  const secondaryAddresses = addressRows.slice(1);
  const allLiftNumbers = Array.from(
    new Set(
      (addressRows.length ? addressRows : [{ label: primaryAddress, lifts: primaryLifts }])
        .flatMap((address) => address.lifts.map((lift) => lift.serialNumber))
        .filter(Boolean)
    )
  );
  const liftExpiryDates = Object.fromEntries(
    (addressRows.length ? addressRows : [{ label: primaryAddress, lifts: primaryLifts }])
      .flatMap((address) => address.lifts)
      .map((lift) => [lift.serialNumber, lift.expiryDate || input.expiryDate.trim()])
      .filter(([lift]) => Boolean(lift))
  );
  const liftRevisionTypes = Object.fromEntries(
    (addressRows.length ? addressRows : [{ label: primaryAddress, lifts: primaryLifts }])
      .flatMap((address) => address.lifts)
      .map((lift) => [lift.serialNumber, lift.revisionType || "R2"])
      .filter(([lift]) => Boolean(lift))
  );
  const firstLift = allLiftNumbers[0] || input.liftNumber.trim();
  const firstExpiryDate = (firstLift ? liftExpiryDates[firstLift] : "") || input.expiryDate.trim();

  const docRef = await addDoc(maintenanceClientsCollection, {
    name: input.name.trim(),
    email: input.email.trim(),
    address: primaryAddress,
    liftNumber: firstLift,
    liftNumbers: allLiftNumbers,
    expiryDate: firstExpiryDate,
    liftExpiryDates,
    liftRevisionTypes,
    maintenanceCompany: input.maintenanceCompany.trim(),
    contactPerson: (input.contactPerson || "").trim(),
    contactPhone: (input.contactPhone || "").trim(),
    emails: input.email.trim() ? [input.email.trim()] : [],
    addresses: secondaryAddresses.map((address, addressIndex) => ({
      id: `address_${now}_${addressIndex}`,
      label: address.label,
      city: "",
      street: address.label,
      postalCode: "",
      contactPerson: "",
      contactPhone: "",
      lifts: address.lifts.map((lift, liftIndex) => ({
        id: `lift_${now}_${addressIndex}_${liftIndex}`,
        label: `Lift ${lift.serialNumber}`,
        serialNumber: lift.serialNumber,
        manufacturer: "",
        installYear: "",
        maintenanceCompany: input.maintenanceCompany.trim(),
        maintenanceEmail: input.email.trim(),
        inspectionExpiryDate: lift.expiryDate,
        revisionType: lift.revisionType || "R2",
        notes: "",
      })),
    })),
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_client_created",
    entityId: docRef.id,
    title: "Client mentenanta adaugat",
    message: `A fost adaugat clientul ${input.name.trim()}.`,
    notificationPath: `/maintenance/${docRef.id}`,
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

export async function getMaintenanceReportHistory(clientId: string): Promise<MaintenanceReportHistoryItem[]> {
  const snap = await getDocs(query(collection(db, "maintenanceClients", clientId, "rapoarte"), orderBy("createdAt", "desc")));
  return snap.docs.map((docItem) => mapReportHistory(docItem.id, docItem.data() as Record<string, unknown>));
}

export async function updateMaintenanceClient(clientId: string, payload: Partial<MaintenanceClient>): Promise<void> {
  const clientRef = doc(db, "maintenanceClients", clientId);
  const existingSnap = await getDoc(clientRef);
  const existing = existingSnap.exists() ? mapClient(existingSnap.id, existingSnap.data() as Record<string, unknown>) : null;
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
    ...(payload.liftExpiryDates !== undefined ? { liftExpiryDates: payload.liftExpiryDates } : {}),
    ...(payload.liftRevisionTypes !== undefined ? { liftRevisionTypes: payload.liftRevisionTypes } : {}),
    ...(payload.addresses !== undefined ? { addresses: payload.addresses } : {}),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  const liftRelatedChange =
    payload.liftNumber !== undefined ||
    payload.liftNumbers !== undefined ||
    payload.liftExpiryDates !== undefined ||
    payload.liftRevisionTypes !== undefined ||
    payload.addresses !== undefined;

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: liftRelatedChange ? "maintenance_lift_updated" : "maintenance_client_updated",
    entityId: clientId,
    title: liftRelatedChange ? "Lift mentenanta actualizat" : "Client mentenanta actualizat",
    message: `Datele clientului ${payload.name || existing?.name || clientId} au fost actualizate.`,
    notificationPath: `/maintenance/${clientId}`,
  });
}

export async function deleteMaintenanceClient(clientId: string): Promise<void> {
  const snap = await getDoc(doc(db, "maintenanceClients", clientId));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  await deleteDoc(doc(db, "maintenanceClients", clientId));

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_client_deleted",
    entityId: clientId,
    title: "Client mentenanta sters",
    message: `Clientul ${toText(data?.name) || clientId} a fost sters.`,
    notificationPath: "/maintenance",
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

  const docRef = doc(db, "firmeMentenanta", companyKey);
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

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_branding_updated",
    entityId: companyKey,
    title: "Branding mentenanta actualizat",
    message: `Brandingul firmei ${companyName} a fost actualizat.`,
    notificationPath: "/maintenance",
  });

  return companyKey;
}

export async function saveMaintenanceReportHistory(input: {
  client: MaintenanceClient;
  reportType: "revizie" | "interventie" | string;
  address: string;
  lift: string;
  technicianName: string;
  comments: string;
  pdfBlob: Blob;
  imageFiles?: File[];
  fileName: string;
  createdAt: number;
  dateText: string;
  timeText: string;
}): Promise<MaintenanceReportHistoryItem> {
  const pdfPath = `maintenance-reports/${input.client.id}/${input.fileName}`;
  const pdfRef = ref(storage, pdfPath);
  await uploadBytes(pdfRef, input.pdfBlob, {
    contentType: "application/pdf",
  });
  const pdfUrl = await getDownloadURL(pdfRef);
  const images: MaintenanceReportAttachment[] = [];

  for (const [index, imageFile] of (input.imageFiles || []).entries()) {
    const ext = imageFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const safeName = imageFile.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-") || `imagine-${index + 1}.${ext}`;
    const imagePath = `maintenance-reports/${input.client.id}/${input.createdAt}/images/${index + 1}-${safeName}`;
    const imageRef = ref(storage, imagePath);
    await uploadBytes(imageRef, imageFile, {
      contentType: imageFile.type || "image/jpeg",
    });
    images.push({
      name: imageFile.name || safeName,
      url: await getDownloadURL(imageRef),
      path: imagePath,
      contentType: imageFile.type || "image/jpeg",
    });
  }

  const reportRef = await addDoc(collection(db, "maintenanceClients", input.client.id, "rapoarte"), {
    clientId: input.client.id,
    clientName: input.client.name || "",
    reportType: input.reportType,
    address: input.address,
    lift: input.lift,
    technicianName: input.technicianName,
    comments: input.comments,
    pdfUrl,
    pdfPath,
    images,
    fileName: input.fileName,
    createdAt: input.createdAt,
    dateText: input.dateText,
    timeText: input.timeText,
    createdAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_report_created",
    entityId: input.client.id,
    title: "Raport mentenanta generat",
    message: `Raport ${input.reportType} generat pentru ${input.client.name || "client"} - lift ${input.lift || "-"}.`,
    notificationPath: `/maintenance/${input.client.id}`,
  });

  return {
    id: reportRef.id,
    clientId: input.client.id,
    clientName: input.client.name || "",
    reportType: input.reportType,
    address: input.address,
    lift: input.lift,
    technicianName: input.technicianName,
    comments: input.comments,
    pdfUrl,
    pdfPath,
    images,
    fileName: input.fileName,
    createdAt: input.createdAt,
    dateText: input.dateText,
    timeText: input.timeText,
  };
}

export function subscribeMaintenanceReportHistory(
  clientId: string,
  onData: (items: MaintenanceReportHistoryItem[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(
      collection(db, "maintenanceClients", clientId, "rapoarte"),
      orderBy("createdAt", "desc"),
      limit(100)
    ),
    (snap) => {
      onData(snap.docs.map((docItem) => mapReportHistory(docItem.id, docItem.data() as Record<string, unknown>)));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeMaintenanceReportsOverview(
  onData: (items: MaintenanceReportHistoryItem[]) => void,
  onError?: (error: Error) => void,
  maxItems = 300
): () => void {
  const safeLimit = Math.max(25, Math.min(500, Math.floor(maxItems)));
  return onSnapshot(
    query(collectionGroup(db, "rapoarte"), orderBy("createdAt", "desc"), limit(safeLimit)),
    (snap) => {
      onData(
        snap.docs.map((docItem) =>
          mapReportHistory(docItem.id, docItem.data() as Record<string, unknown>)
        )
      );
    },
    (error) => {
      onError?.(error);
    }
  );
}
