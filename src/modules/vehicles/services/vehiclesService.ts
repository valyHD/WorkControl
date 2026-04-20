import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import type {
  VehicleCommandItem,
  VehicleCommandStatus,
  VehicleCommandType,
  VehicleEventItem,
  VehicleFormValues,
  VehicleImageItem,
  VehicleItem,
  VehiclePositionItem,
  VehicleStatus,
  VehicleTrackerEventItem,
} from "../../../types/vehicle";
import type { AppUser } from "../../../types/tool";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const vehiclesCollection = collection(db, "vehicles");
const vehicleEventsCollection = collection(db, "vehicleEvents");
const usersCollection = collection(db, "users");

const VEHICLE_STATUSES = ["activa", "in_service", "indisponibila", "avariata"] as const;
const VEHICLE_COMMAND_TYPES = ["pulse_dout1", "allow_start", "block_start"] as const;
const VEHICLE_COMMAND_STATUSES = ["requested", "pending", "completed", "failed"] as const;

const MAX_TOTAL_ROUTE_POINTS = 250000;
const DEFAULT_ROUTE_PAGE_SIZE = 2000;
const DEFAULT_ROUTE_MAX_PAGES = 500;
const ROUTE_INCREMENTAL_OVERLAP_MS = 60_000;
export function subscribeVehicleCommands(
  vehicleId: string,
  callback: (items: VehicleCommandItem[]) => void,
  maxItems = 20
) {
  if (!vehicleId) {
    callback([]);
    return () => undefined;
  }

  const commandsQuery = query(
    collection(db, "vehicles", vehicleId, "commands"),
    orderBy("requestedAt", "desc"),
    limit(maxItems)
  );

  return onSnapshot(
    commandsQuery,
    (snap) => {
      callback(
        snap.docs.map((docItem) =>
          mapVehicleCommandDoc(docItem.id, docItem.data())
        )
      );
    },
    (error) => {
      console.error("[subscribeVehicleCommands]", error);
      callback([]);
    }
  );
}
function toSafeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toSafeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toSafeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function normalizePlateNumber(value: string): string {
  return value.trim().toUpperCase();
}

function toVehicleStatus(value: unknown): VehicleStatus {
  return VEHICLE_STATUSES.includes(value as VehicleStatus)
    ? (value as VehicleStatus)
    : "activa";
}

function toVehicleCommandType(value: unknown): VehicleCommandType {
  return VEHICLE_COMMAND_TYPES.includes(value as VehicleCommandType)
    ? (value as VehicleCommandType)
    : "allow_start";
}

function toVehicleCommandStatus(value: unknown): VehicleCommandStatus {
  return VEHICLE_COMMAND_STATUSES.includes(value as VehicleCommandStatus)
    ? (value as VehicleCommandStatus)
    : "requested";
}

function sortPositionsAsc(items: VehiclePositionItem[]): VehiclePositionItem[] {
  return [...items].sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);
}

function dedupePositions(items: VehiclePositionItem[]): VehiclePositionItem[] {
  const result: VehiclePositionItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key =
      item.id || `${item.gpsTimestamp}_${item.lat}_${item.lng}_${item.speedKmh ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function mergePositionItems(
  existing: VehiclePositionItem[],
  incoming: VehiclePositionItem[]
): VehiclePositionItem[] {
  return dedupePositions(sortPositionsAsc([...existing, ...incoming]));
}

function normalizePositionItems(items: VehiclePositionItem[]): VehiclePositionItem[] {
  return dedupePositions(
    sortPositionsAsc(items.filter((item) => isValidLatLng(item.lat, item.lng)))
  );
}

function getDayKeyFromTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function getDayStartTs(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getTime();
}

function addDays(dayKey: string, days: number): string {
  const ts = getDayStartTs(dayKey) + days * 24 * 60 * 60 * 1000;
  return new Date(ts).toISOString().slice(0, 10);
}

function enumerateDayKeys(fromTs: number, toTs: number): string[] {
  const startKey = getDayKeyFromTs(fromTs);
  const endKey = getDayKeyFromTs(toTs);

  const result: string[] = [];
  let current = startKey;

  while (current <= endKey) {
    result.push(current);
    current = addDays(current, 1);
  }

  return result;
}

function mapVehicleDoc(id: string, data: Record<string, any>): VehicleItem {
  const gpsSnapshotRaw = data.gpsSnapshot ? toSafeObject(data.gpsSnapshot) : null;
  const trackerRaw = data.tracker ? toSafeObject(data.tracker) : null;
  const imagesRaw = Array.isArray(data.images) ? data.images : [];
  const gpsOdometerKm = gpsSnapshotRaw ? toOptionalNumber(gpsSnapshotRaw.odometerKm) : undefined;
  const storedCurrentKm = toSafeNumber(data.currentKm, 0);
  const currentKm = Math.max(storedCurrentKm, gpsOdometerKm ?? 0);
  const initialRecordedKm = toSafeNumber(data.initialRecordedKm, storedCurrentKm || currentKm);
  const serviceStrategy = data.serviceStrategy === "absolute" ? "absolute" : "interval";
  const serviceIntervalKm = toSafeNumber(data.serviceIntervalKm, 15000);

  return {
    id,
    plateNumber: toSafeString(data.plateNumber),
    brand: toSafeString(data.brand),
    model: toSafeString(data.model),
    year: toSafeString(data.year),
    vin: toSafeString(data.vin),
    fuelType: toSafeString(data.fuelType),
    ownerThemeKey: data.ownerThemeKey ?? null,
    currentDriverThemeKey: data.currentDriverThemeKey ?? null,
    status: toVehicleStatus(data.status),
    currentKm,
    initialRecordedKm,

    ownerUserId: toSafeString(data.ownerUserId),
    ownerUserName: toSafeString(data.ownerUserName),

    currentDriverUserId: toSafeString(data.currentDriverUserId),
    currentDriverUserName: toSafeString(data.currentDriverUserName),

    maintenanceNotes: toSafeString(data.maintenanceNotes),
    serviceStrategy,
    serviceIntervalKm,
    nextServiceKm: toSafeNumber(data.nextServiceKm, 0),
    nextItpDate: toSafeString(data.nextItpDate),
    nextRcaDate: toSafeString(data.nextRcaDate),
    nextCascoDate: toSafeString(data.nextCascoDate),

    coverImageUrl: toSafeString(data.coverImageUrl),
    coverThumbUrl: toSafeString(data.coverThumbUrl),
    images: imagesRaw.map((item: any) => ({
      id: toSafeString(item?.id, `${Date.now()}_${Math.random().toString(36).slice(2)}`),
      url: toSafeString(item?.url),
      path: toSafeString(item?.path),
      fileName: toSafeString(item?.fileName),
      createdAt: toSafeNumber(item?.createdAt, Date.now()),
      thumbUrl: toSafeString(item?.thumbUrl),
      thumbPath: toSafeString(item?.thumbPath),
    })),

    gpsSnapshot: gpsSnapshotRaw
      ? {
          lat: toSafeNumber(gpsSnapshotRaw.lat, 0),
          lng: toSafeNumber(gpsSnapshotRaw.lng, 0),
          speedKmh: toSafeNumber(gpsSnapshotRaw.speedKmh, 0),
          altitude: toOptionalNumber(gpsSnapshotRaw.altitude),
          angle: toOptionalNumber(gpsSnapshotRaw.angle),
          satellites: toOptionalNumber(gpsSnapshotRaw.satellites),
          gpsTimestamp: toSafeNumber(gpsSnapshotRaw.gpsTimestamp, 0),
          serverTimestamp: toSafeNumber(gpsSnapshotRaw.serverTimestamp, 0),
          ignitionOn: toSafeBoolean(gpsSnapshotRaw.ignitionOn, false),
          odometerKm: toOptionalNumber(gpsSnapshotRaw.odometerKm),
          imei: toSafeString(gpsSnapshotRaw.imei),
          online: toSafeBoolean(gpsSnapshotRaw.online, false),
        }
      : null,

    tracker: trackerRaw
      ? {
          imei: toSafeString(trackerRaw.imei),
          lastSeenAt: toSafeNumber(trackerRaw.lastSeenAt, 0),
          updatedAt: toSafeNumber(trackerRaw.updatedAt, 0),
          protocol: toSafeString(trackerRaw.protocol),
        }
      : null,

    createdAt: toSafeNumber(data.createdAt, Date.now()),
    updatedAt: toSafeNumber(data.updatedAt, Date.now()),
  };
}

async function resizeImage(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.src = String(reader.result);
    };

    reader.onerror = () => reject(new Error("Nu am putut citi fisierul."));
    image.onerror = () => reject(new Error("Nu am putut incarca imaginea."));

    image.onload = () => {
      let { width, height } = image;

      if (width <= 0 || height <= 0) {
        reject(new Error("Dimensiuni imagine invalide."));
        return;
      }

      if (width > options.maxWidth) {
        height = Math.round((height * options.maxWidth) / width);
        width = options.maxWidth;
      }

      if (height > options.maxHeight) {
        width = Math.round((width * options.maxHeight) / height);
        height = options.maxHeight;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Nu am putut crea canvas."));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Nu am putut genera imaginea."));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        options.quality
      );
    };

    reader.readAsDataURL(file);
  });
}

export async function getVehicleUsers(): Promise<AppUser[]> {
  const snap = await getDocs(query(usersCollection, orderBy("fullName", "asc")));

  return snap.docs.map((docItem) => ({
    id: docItem.id,
    uid: toSafeString(docItem.data().uid),
    themeKey: docItem.data().themeKey ?? null,
    fullName: toSafeString(docItem.data().fullName, "Utilizator fara nume"),
    email: toSafeString(docItem.data().email),
    active: docItem.data().active ?? true,
    role: toSafeString(docItem.data().role),
  }));
}

export async function getVehiclesList(): Promise<VehicleItem[]> {
  const snap = await getDocs(query(vehiclesCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapVehicleDoc(docItem.id, docItem.data()));
}

export function subscribeVehiclesList(onData: (items: VehicleItem[]) => void): () => void {
  return onSnapshot(
    query(vehiclesCollection, orderBy("updatedAt", "desc")),
    (snap) => {
      onData(snap.docs.map((docItem) => mapVehicleDoc(docItem.id, docItem.data())));
    },
    (error) => {
      console.error("[subscribeVehiclesList]", error);
      onData([]);
    }
  );
}

export async function getVehicleById(vehicleId: string): Promise<VehicleItem | null> {
  if (!vehicleId) return null;

  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  if (!snap.exists()) return null;

  return mapVehicleDoc(snap.id, snap.data());
}

export async function getMyVehicleForUser(userId: string): Promise<VehicleItem | null> {
  if (!userId) return null;

  const [driverSnap, ownerSnap] = await Promise.all([
    getDocs(
      query(
        vehiclesCollection,
        where("currentDriverUserId", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(1)
      )
    ),
    getDocs(
      query(
        vehiclesCollection,
        where("ownerUserId", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(1)
      )
    ),
  ]);

  const preferredDoc = driverSnap.docs[0] || ownerSnap.docs[0];
  if (!preferredDoc) return null;

  return mapVehicleDoc(preferredDoc.id, preferredDoc.data());
}

export function subscribeVehicleById(
  vehicleId: string,
  onData: (item: VehicleItem | null) => void
): () => void {
  if (!vehicleId) {
    onData(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, "vehicles", vehicleId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }

      onData(mapVehicleDoc(snap.id, snap.data()));
    },
    (error) => {
      console.error("[subscribeVehicleById]", error);
      onData(null);
    }
  );
}

export async function isPlateNumberUsed(
  plateNumber: string,
  excludeVehicleId?: string
): Promise<boolean> {
  const clean = normalizePlateNumber(plateNumber);
  if (!clean) return false;

  const snap = await getDocs(
    query(vehiclesCollection, where("plateNumber", "==", clean), limit(10))
  );

  if (snap.empty) return false;
  return snap.docs.some((docItem) => docItem.id !== excludeVehicleId);
}

export async function createVehicle(values: VehicleFormValues): Promise<string> {
  const now = Date.now();

  const refDoc = await addDoc(vehiclesCollection, {
    ...values,
    plateNumber: normalizePlateNumber(values.plateNumber),
    initialRecordedKm: values.initialRecordedKm || values.currentKm || 0,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    refDoc.id,
    "created",
    `Masina ${values.plateNumber} a fost creata.`
  );

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_created",
    entityId: refDoc.id,
    title: "Masina adaugata",
    message: `A fost adaugata masina ${normalizePlateNumber(values.plateNumber)}.`,
    directUserId: values.currentDriverUserId || "",
    ownerUserId: values.ownerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
  });

  return refDoc.id;
}

export async function updateVehicle(
  vehicleId: string,
  values: VehicleFormValues
): Promise<void> {
  const existingSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const previousStatus = toVehicleStatus(existingData?.status);
  const previousOwnerUserId = toSafeString(existingData?.ownerUserId);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    ...values,
    plateNumber: normalizePlateNumber(values.plateNumber),
    initialRecordedKm: values.initialRecordedKm || values.currentKm || 0,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "updated",
    `Masina ${values.plateNumber} a fost actualizata.`
  );

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_updated",
    entityId: vehicleId,
    title: "Masina actualizata",
    message: `Datele masinii ${normalizePlateNumber(values.plateNumber)} au fost actualizate.`,
    directUserId: values.currentDriverUserId || "",
    ownerUserId: values.ownerUserId || previousOwnerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
  });

  if (previousStatus !== values.status) {
    await addVehicleEvent(
      vehicleId,
      "updated",
      `Statusul masinii ${values.plateNumber} a fost schimbat din "${previousStatus || "-"}" in "${values.status}".`
    );

    await dispatchNotificationEvent({
      module: "vehicles",
      eventType: "vehicle_status_changed",
      entityId: vehicleId,
      title: "Status masina schimbat",
      message: `Masina ${values.plateNumber} are acum statusul ${values.status}.`,
      directUserId: values.currentDriverUserId || "",
      ownerUserId: values.ownerUserId || previousOwnerUserId || "",
      actorUserId: values.ownerUserId || "",
      actorUserName: values.ownerUserName || "Responsabil",
      actorUserThemeKey: values.ownerThemeKey ?? null,
    });
  }
}

export async function addVehicleEvent(
  vehicleId: string,
  type: VehicleEventItem["type"],
  message: string,
  actor?: {
    actorUserId?: string;
    actorUserName?: string;
    actorUserThemeKey?: string | null;
  }
): Promise<void> {
  await addDoc(vehicleEventsCollection, {
    vehicleId,
    type,
    message,
    actorUserId: actor?.actorUserId ?? "",
    actorUserName: actor?.actorUserName ?? "",
    actorUserThemeKey: actor?.actorUserThemeKey ?? null,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}

function toVehicleEventType(value: unknown): VehicleEventItem["type"] {
  return value === "created" ||
    value === "updated" ||
    value === "driver_changed" ||
    value === "images_updated" ||
    value === "claimed"
    ? value
    : "updated";
}

export async function getVehicleEvents(vehicleId: string): Promise<VehicleEventItem[]> {
  if (!vehicleId) return [];

  const snap = await getDocs(
    query(vehicleEventsCollection, where("vehicleId", "==", vehicleId))
  );

  const events = snap.docs.map((docItem) => ({
    id: docItem.id,
    vehicleId: toSafeString(docItem.data().vehicleId),
    type: toVehicleEventType(docItem.data().type),
    message: toSafeString(docItem.data().message),
    createdAt: toSafeNumber(docItem.data().createdAt, Date.now()),
    actorUserId: toSafeString(docItem.data().actorUserId),
    actorUserName: toSafeString(docItem.data().actorUserName),
    actorUserThemeKey: docItem.data().actorUserThemeKey ?? null,
  }));

  return events.sort((a, b) => b.createdAt - a.createdAt);
}

export async function uploadVehicleImages(
  vehicleId: string,
  files: File[]
): Promise<VehicleImageItem[]> {
  const uploadedItems: VehicleImageItem[] = [];

  for (const file of files) {
    const safeBaseName = `${Date.now()}_${file.name
      .replace(/\s+/g, "_")
      .replace(/[^\w.-]/g, "")
      .replace(/\.[^/.]+$/, "")}`;

    const fullPath = `vehicles/${vehicleId}/images/${safeBaseName}.jpg`;
    const thumbPath = `vehicles/${vehicleId}/images/thumb_${safeBaseName}.jpg`;

    const fullRef = ref(storage, fullPath);
    const thumbRef = ref(storage, thumbPath);

    const fullBlob = await resizeImage(file, {
      maxWidth: 1400,
      maxHeight: 1400,
      quality: 0.82,
    });

    const thumbBlob = await resizeImage(file, {
      maxWidth: 240,
      maxHeight: 240,
      quality: 0.72,
    });

    await uploadBytes(fullRef, fullBlob, { contentType: "image/jpeg" });
    await uploadBytes(thumbRef, thumbBlob, { contentType: "image/jpeg" });

    const fullUrl = await getDownloadURL(fullRef);
    const thumbUrl = await getDownloadURL(thumbRef);

    uploadedItems.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      url: fullUrl,
      path: fullPath,
      fileName: file.name,
      createdAt: Date.now(),
      thumbUrl,
      thumbPath,
    });
  }

  return uploadedItems;
}

export async function saveVehicleImages(
  vehicleId: string,
  currentImages: VehicleImageItem[],
  newImages: VehicleImageItem[]
): Promise<void> {
  const merged = [...currentImages, ...newImages];
  const coverImageUrl = merged[0]?.url ?? "";
  const coverThumbUrl = merged[0]?.thumbUrl ?? merged[0]?.url ?? "";

  await updateDoc(doc(db, "vehicles", vehicleId), {
    images: merged,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "images_updated",
    "Imaginile masinii au fost actualizate."
  );
}

export async function setVehicleCoverImage(
  vehicleId: string,
  imageUrl: string
): Promise<void> {
  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  if (!snap.exists()) return;

  const data = snap.data();
  const images = Array.isArray(data.images) ? data.images : [];
  const selected = images.find((img: any) => img.url === imageUrl);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    coverImageUrl: imageUrl,
    coverThumbUrl: selected?.thumbUrl ?? imageUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "images_updated",
    "Poza principala a masinii a fost schimbata."
  );
}

export async function removeVehicleImage(
  vehicleId: string,
  images: VehicleImageItem[],
  imageId: string
): Promise<VehicleImageItem[]> {
  const imageToDelete = images.find((img) => img.id === imageId);
  if (!imageToDelete) return images;

  if (imageToDelete.path) {
    await deleteObject(ref(storage, imageToDelete.path)).catch(() => undefined);
  }

  if (imageToDelete.thumbPath) {
    await deleteObject(ref(storage, imageToDelete.thumbPath)).catch(() => undefined);
  }

  const updated = images.filter((img) => img.id !== imageId);
  const coverImageUrl = updated[0]?.url ?? "";
  const coverThumbUrl = updated[0]?.thumbUrl ?? updated[0]?.url ?? "";

  await updateDoc(doc(db, "vehicles", vehicleId), {
    images: updated,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(vehicleId, "images_updated", "O imagine a fost stearsa.");
  return updated;
}

export async function changeVehicleDriver(
  vehicleId: string,
  nextDriverUserId: string,
  nextDriverUserName: string,
  nextDriverThemeKey: string | null
): Promise<void> {
  const vehicleSnap = await getDoc(doc(db, "vehicles", vehicleId));
  if (!vehicleSnap.exists()) return;

  const vehicleData = vehicleSnap.data();
  const plateNumber = toSafeString(vehicleData.plateNumber, "Masina");
  const previousDriverUserId = toSafeString(vehicleData.currentDriverUserId);

  await updateDoc(doc(db, "vehicles", vehicleId), {
    currentDriverUserId: nextDriverUserId || "",
    currentDriverUserName: nextDriverUserName || "",
    currentDriverThemeKey: nextDriverThemeKey ?? null,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  const message = nextDriverUserId
    ? `Soferul curent a fost schimbat la ${nextDriverUserName}.`
    : "Masina nu mai are sofer curent alocat.";

  await addVehicleEvent(vehicleId, "driver_changed", message);

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_driver_changed",
    entityId: vehicleId,
    title: "Sofer masina schimbat",
    message: `Masina ${plateNumber} are acum ca sofer curent ${nextDriverUserName || "niciun user"}.`,
    directUserId: nextDriverUserId || previousDriverUserId || "",
    ownerUserId: toSafeString(vehicleData.ownerUserId),
    actorUserId: toSafeString(vehicleData.ownerUserId),
    actorUserName: toSafeString(vehicleData.ownerUserName, "Responsabil"),
    actorUserThemeKey: vehicleData.ownerThemeKey ?? null,
  });
}

export async function claimVehicleForCurrentUser(
  vehicleId: string,
  userId: string,
  userName: string,
  userThemeKey: string | null
): Promise<void> {
  await updateDoc(doc(db, "vehicles", vehicleId), {
    ownerUserId: userId,
    ownerUserName: userName,
    ownerThemeKey: userThemeKey ?? null,
    currentDriverUserId: userId,
    currentDriverUserName: userName,
    currentDriverThemeKey: userThemeKey ?? null,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "claimed",
    `Masina a fost preluata in responsabilitate de ${userName}.`
  );
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  const data = snap.exists() ? snap.data() : null;

  await deleteDoc(doc(db, "vehicles", vehicleId));

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType: "vehicle_deleted",
    entityId: vehicleId,
    title: "Masina stearsa",
    message: `Masina ${data?.plateNumber ?? vehicleId} a fost stearsa din sistem.`,
    ownerUserId: data?.ownerUserId ?? "",
  });
}

function mapVehiclePositionDoc(id: string, data: Record<string, any>): VehiclePositionItem {
  return {
    id,
    vehicleId: toSafeString(data.vehicleId),
    imei: toSafeString(data.imei),
    lat: toSafeNumber(data.lat, 0),
    lng: toSafeNumber(data.lng, 0),
    speedKmh: toSafeNumber(data.speedKmh, 0),
    altitude: toSafeNumber(data.altitude, 0),
    angle: toSafeNumber(data.angle, 0),
    satellites: toSafeNumber(data.satellites, 0),
    gpsTimestamp: toSafeNumber(data.gpsTimestamp, 0),
    serverTimestamp: toSafeNumber(data.serverTimestamp, 0),
    eventIoId: toSafeNumber(data.eventIoId, 0),
    ignitionOn: toSafeBoolean(data.ignitionOn, false),
    odometerKm: toOptionalNumber(data.odometerKm),
    rawIo: toSafeObject(data.rawIo),
  };
}

function mapVehicleTrackerEventDoc(
  id: string,
  data: Record<string, any>
): VehicleTrackerEventItem {
  return {
    id,
    type: toSafeString(data.type, "tracker_event"),
    timestamp: toSafeNumber(data.timestamp ?? data.gpsTimestamp ?? data.createdAt, Date.now()),
    lat: toOptionalNumber(data.lat),
    lng: toOptionalNumber(data.lng),
    speedKmh: toOptionalNumber(data.speedKmh),
    metadata: toSafeObject(data.metadata),
  };
}

function mapVehicleCommandDoc(id: string, data: Record<string, any>): VehicleCommandItem {
  const type = toVehicleCommandType(data.type);
  const status = toVehicleCommandStatus(data.status);

  return {
    id,
    type,
    status,
    requestedBy: toSafeString(data.requestedBy, "system"),
    requestedAt: toSafeNumber(data.requestedAt, Date.now()),
    completedAt:
      data.completedAt === null || data.completedAt === undefined
        ? null
        : toSafeNumber(data.completedAt, Date.now()),
    providerMessage: toSafeString(data.providerMessage),
    result: toSafeString(data.result),
    durationSec:
      data.durationSec === null || data.durationSec === undefined
        ? null
        : toSafeNumber(data.durationSec, 0),
  };
}

async function getVehiclePositionsForDay(
  vehicleId: string,
  dayKey: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  const allItems: VehiclePositionItem[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  const pointsRef = collection(
    db,
    "vehicles",
    vehicleId,
    "positionDays",
    dayKey,
    "points"
  ) as CollectionReference<DocumentData>;

  for (let page = 0; page < maxPages; page += 1) {
    const constraints: QueryConstraint[] = [
      where("gpsTimestamp", ">=", fromTs),
      where("gpsTimestamp", "<=", toTs),
      orderBy("gpsTimestamp", "asc"),
      limit(pageSize),
    ];

    if (lastDoc) {
      constraints.push(startAfter(lastDoc));
    }

    const q = query(pointsRef, ...constraints);
    const snap = await getDocs(q);

    if (snap.empty) break;

    const pageItems: VehiclePositionItem[] = snap.docs.map((docItem) =>
      mapVehiclePositionDoc(docItem.id, docItem.data() as Record<string, any>)
    );

    allItems.push(...pageItems);

    if (allItems.length >= MAX_TOTAL_ROUTE_POINTS) {
      console.warn(
        `[getVehiclePositionsForDay] limita atinsa vehicleId=${vehicleId} dayKey=${dayKey} points=${allItems.length}`
      );
      break;
    }

    if (snap.docs.length < pageSize) {
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (!lastDoc) break;
  }

  return allItems;
}

export function subscribeVehiclePositions(
  vehicleId: string,
  onData: (items: VehiclePositionItem[]) => void,
  maxItems = 300
): () => void {
  if (!vehicleId) {
    onData([]);
    return () => undefined;
  }

  const snapRef = doc(db, "vehicles", vehicleId);
  let requestSeq = 0;

  return onSnapshot(
    snapRef,
    async (snap) => {
      const currentSeq = ++requestSeq;

      try {
        if (!snap.exists()) {
          onData([]);
          return;
        }

        const data = snap.data();
        const gpsSnapshot = data?.gpsSnapshot;
        if (!gpsSnapshot?.gpsTimestamp) {
          onData([]);
          return;
        }

        const toTs = Number(gpsSnapshot.gpsTimestamp);
        const fromTs = Math.max(0, toTs - 24 * 60 * 60 * 1000);

        const items = await getVehiclePositionsRange(
          vehicleId,
          fromTs,
          toTs,
          maxItems,
          5
        );

        if (currentSeq !== requestSeq) return;
        onData(items.slice(Math.max(0, items.length - maxItems)));
      } catch (error) {
        console.error("[subscribeVehiclePositions]", error);
      }
    },
    (error) => {
      console.error("[subscribeVehiclePositions]", error);
    }
  );
}

export async function getVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const dayKeys = enumerateDayKeys(fromTs, toTs);
  const allItems: VehiclePositionItem[] = [];

  for (const dayKey of dayKeys) {
    const dayStart = getDayStartTs(dayKey);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;

    const effectiveFrom = Math.max(fromTs, dayStart);
    const effectiveTo = Math.min(toTs, dayEnd);

    const dayItems = await getVehiclePositionsForDay(
      vehicleId,
      dayKey,
      effectiveFrom,
      effectiveTo,
      pageSize,
      maxPages
    );

    allItems.push(...dayItems);

    if (allItems.length >= MAX_TOTAL_ROUTE_POINTS) {
      console.warn(
        `[getVehiclePositionsRange] limita atinsa vehicleId=${vehicleId} points=${allItems.length}`
      );
      break;
    }
  }

  return normalizePositionItems(allItems);
}

export async function getVehiclePositionsRangeChunked(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): Promise<VehiclePositionItem[]> {
  return getVehiclePositionsRange(vehicleId, fromTs, toTs, pageSize, maxPages);
}

export function pollVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  onData: (items: VehiclePositionItem[]) => void,
  onError?: (error: unknown) => void,
  refreshMs = 15000,
  pageSize = DEFAULT_ROUTE_PAGE_SIZE,
  maxPages = DEFAULT_ROUTE_MAX_PAGES
): () => void {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    onData([]);
    return () => undefined;
  }

  let stopped = false;
  let timer: number | null = null;
  let currentItems: VehiclePositionItem[] = [];
  let lastLoadedToTs = fromTs;

  const isPastWindow = toTs < Date.now() - 30_000;

  const scheduleNext = () => {
    if (stopped || isPastWindow) return;
    timer = window.setTimeout(loadIncremental, refreshMs);
  };

  const loadInitial = async () => {
    try {
      const items = await getVehiclePositionsRange(
        vehicleId,
        fromTs,
        toTs,
        pageSize,
        maxPages
      );

      if (stopped) return;

      currentItems = items;
      lastLoadedToTs =
        items.length > 0 ? items[items.length - 1].gpsTimestamp : fromTs;

      onData(currentItems);
    } catch (error) {
      console.error("[pollVehiclePositionsRange][initial]", error);
      if (!stopped) onError?.(error);
    } finally {
      scheduleNext();
    }
  };

  const loadIncremental = async () => {
    try {
      const now = Date.now();
      const effectiveToTs = Math.min(now, toTs > now ? now : toTs);
      const incrementalFromTs = Math.max(
        fromTs,
        lastLoadedToTs - ROUTE_INCREMENTAL_OVERLAP_MS
      );

      if (incrementalFromTs > effectiveToTs) {
        onData(currentItems);
        scheduleNext();
        return;
      }

      const incoming = await getVehiclePositionsRange(
        vehicleId,
        incrementalFromTs,
        effectiveToTs,
        pageSize,
        maxPages
      );

      if (stopped) return;

      if (incoming.length > 0) {
        currentItems = mergePositionItems(currentItems, incoming);

        if (currentItems.length > MAX_TOTAL_ROUTE_POINTS) {
          currentItems = currentItems.slice(
            Math.max(0, currentItems.length - MAX_TOTAL_ROUTE_POINTS)
          );
        }

        lastLoadedToTs =
          currentItems[currentItems.length - 1]?.gpsTimestamp ?? lastLoadedToTs;
      }

      onData(currentItems);
    } catch (error) {
      console.error("[pollVehiclePositionsRange][incremental]", error);
      if (!stopped) onError?.(error);
    } finally {
      scheduleNext();
    }
  };

  void loadInitial();

  return () => {
    stopped = true;
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  };
}

export function subscribeVehiclePositionsRange(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  onData: (items: VehiclePositionItem[]) => void,
  refreshMs = 15000
): () => void {
  return pollVehiclePositionsRange(
    vehicleId,
    fromTs,
    toTs,
    onData,
    undefined,
    refreshMs
  );
}

export async function getVehicleTrackerEvents(
  vehicleId: string,
  fromTs: number,
  toTs: number,
  maxItems = 500
): Promise<VehicleTrackerEventItem[]> {
  if (!vehicleId || !Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return [];
  }

  const eventsQuery = query(
    collection(db, "vehicles", vehicleId, "events"),
    where("timestamp", ">=", fromTs),
    where("timestamp", "<=", toTs),
    orderBy("timestamp", "asc"),
    limit(maxItems)
  );

  const snap = await getDocs(eventsQuery);
  return snap.docs.map((docItem) => mapVehicleTrackerEventDoc(docItem.id, docItem.data()));
}

export async function getVehicleCommands(
  vehicleId: string,
  maxItems = 20
): Promise<VehicleCommandItem[]> {
  if (!vehicleId) return [];

  const commandsQuery = query(
    collection(db, "vehicles", vehicleId, "commands"),
    orderBy("requestedAt", "desc"),
    limit(maxItems)
  );

  const snap = await getDocs(commandsQuery);
  return snap.docs.map((docItem) => mapVehicleCommandDoc(docItem.id, docItem.data()));
}

export async function requestVehicleCommand(
  vehicleId: string,
  payload: {
    type: "pulse_dout1" | "allow_start" | "block_start";
    requestedBy: string;
    durationSec?: number | null;
  }
): Promise<string> {
  if (!vehicleId) {
    throw new Error("vehicleId lipsa");
  }

  const created = await addDoc(collection(db, "vehicles", vehicleId, "commands"), {
    type: payload.type,
    status: "requested",
    requestedBy: payload.requestedBy,
    requestedAt: Date.now(),
    completedAt: null,
    providerMessage: "",
    result: "queued",
    durationSec: payload.durationSec ?? null,
    createdAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "vehicles",
    eventType:
      payload.type === "pulse_dout1"
        ? "vehicle_started"
        : payload.type === "block_start"
        ? "vehicle_block_start_requested"
        : "vehicle_command_requested",
    entityId: vehicleId,
    title:
      payload.type === "pulse_dout1"
        ? "Cerere pornire masina"
        : payload.type === "block_start"
        ? "Cerere blocare pornire"
        : "Comanda vehicul noua",
    message:
      payload.type === "pulse_dout1"
        ? "S-a trimis comanda de pornire a masinii (DOUT1)."
        : payload.type === "block_start"
        ? "S-a trimis comanda de blocare a pornirii."
        : `S-a trimis comanda ${payload.type} pentru vehicul.`,
    actorUserName: payload.requestedBy,
  });

  return created.id;
}

function parseDateToStartTs(dateString?: string): number | null {
  if (!dateString) return null;
  const ts = new Date(`${dateString}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function diffDaysFromToday(targetTs: number): number {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.ceil((targetTs - todayStart) / 86_400_000);
}

export async function runVehicleMaintenanceAlerts(
  actor?: { userId?: string; userName?: string; userThemeKey?: string | null }
): Promise<void> {
  const vehicles = await getVehiclesList();
  const todayKey = new Date().toISOString().slice(0, 10);

  for (const vehicle of vehicles) {
    const ownerUserId = vehicle.ownerUserId || "";
    const directUserId = vehicle.currentDriverUserId || ownerUserId;

    if (vehicle.nextServiceKm > 0) {
      const remainingKm = vehicle.nextServiceKm - vehicle.currentKm;
      if (remainingKm <= 500) {
        const markerId = `${vehicle.id}_service_${todayKey}`;
        const markerRef = doc(db, "vehicleMaintenanceAlerts", markerId);
        const marker = await getDoc(markerRef);

        if (!marker.exists()) {
          await dispatchNotificationEvent({
            module: "vehicles",
            eventType: "vehicle_service_due_soon",
            entityId: vehicle.id,
            title: "Service aproape scadent",
            message: `Masina ${vehicle.plateNumber} se apropie de revizie (mai sunt ${Math.max(
              remainingKm,
              0
            )} km).`,
            directUserId,
            ownerUserId,
            actorUserId: actor?.userId ?? "",
            actorUserName: actor?.userName ?? "WorkControl",
            actorUserThemeKey: actor?.userThemeKey ?? null,
          });
          await setDoc(markerRef, {
            createdAt: Date.now(),
            type: "service",
            vehicleId: vehicle.id,
          });
        }
      }
    }

    const expiringDocs: Array<{
      label: "ITP" | "RCA" | "CASCO";
      value: string;
      key: string;
    }> = [
      { label: "ITP", value: vehicle.nextItpDate, key: "itp" },
      { label: "RCA", value: vehicle.nextRcaDate, key: "rca" },
      { label: "CASCO", value: vehicle.nextCascoDate, key: "casco" },
    ];

    for (const docInfo of expiringDocs) {
      const expiryTs = parseDateToStartTs(docInfo.value);
      if (!expiryTs) continue;

      const daysLeft = diffDaysFromToday(expiryTs);
      if (daysLeft > 10) continue;

      const markerId = `${vehicle.id}_${docInfo.key}_${todayKey}`;
      const markerRef = doc(db, "vehicleMaintenanceAlerts", markerId);
      const marker = await getDoc(markerRef);

      if (marker.exists()) continue;

      await dispatchNotificationEvent({
        module: "vehicles",
        eventType:
          docInfo.key === "itp"
            ? "vehicle_document_itp_due_soon"
            : docInfo.key === "rca"
              ? "vehicle_document_rca_due_soon"
              : "vehicle_document_casco_due_soon",
        entityId: vehicle.id,
        title: `${docInfo.label} aproape de expirare`,
        message: `Masina ${vehicle.plateNumber}: ${docInfo.label} expira in ${Math.max(
          daysLeft,
          0
        )} zile (${docInfo.value}).`,
        directUserId,
        ownerUserId,
        actorUserId: actor?.userId ?? "",
        actorUserName: actor?.userName ?? "WorkControl",
        actorUserThemeKey: actor?.userThemeKey ?? null,
      });

      await setDoc(markerRef, {
        createdAt: Date.now(),
        type: docInfo.key,
        vehicleId: vehicle.id,
      });
    }
  }
}