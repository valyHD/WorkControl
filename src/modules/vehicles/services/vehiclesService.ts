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
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, storage } from "../../../lib/firebase/firebase";
import type {
  VehicleEventItem,
  VehicleFormValues,
  VehicleImageItem,
  VehicleItem,
  VehiclePositionItem,
} from "../../../types/vehicle";
import type { AppUser } from "../../../types/tool";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const vehiclesCollection = collection(db, "vehicles");
const vehicleEventsCollection = collection(db, "vehicleEvents");
const usersCollection = collection(db, "users");

function mapVehicleDoc(id: string, data: Record<string, any>): VehicleItem {
  return {
    id,
    plateNumber: data.plateNumber ?? "",
    brand: data.brand ?? "",
    model: data.model ?? "",
    year: data.year ?? "",
    vin: data.vin ?? "",
    fuelType: data.fuelType ?? "",
    ownerThemeKey: data.ownerThemeKey ?? null,
currentDriverThemeKey: data.currentDriverThemeKey ?? null,
    status: data.status ?? "activa",
    currentKm: Number(data.currentKm ?? 0),

    ownerUserId: data.ownerUserId ?? "",
    ownerUserName: data.ownerUserName ?? "",

    currentDriverUserId: data.currentDriverUserId ?? "",
    currentDriverUserName: data.currentDriverUserName ?? "",

    maintenanceNotes: data.maintenanceNotes ?? "",
    nextServiceKm: Number(data.nextServiceKm ?? 0),
    nextItpDate: data.nextItpDate ?? "",
    nextRcaDate: data.nextRcaDate ?? "",

    coverImageUrl: data.coverImageUrl ?? "",
    coverThumbUrl: data.coverThumbUrl ?? "",
    images: Array.isArray(data.images) ? data.images : [],

    gpsSnapshot: data.gpsSnapshot
      ? {
          lat: Number(data.gpsSnapshot.lat ?? 0),
          lng: Number(data.gpsSnapshot.lng ?? 0),
          speedKmh: Number(data.gpsSnapshot.speedKmh ?? 0),
          altitude: Number(data.gpsSnapshot.altitude ?? 0),
          angle: Number(data.gpsSnapshot.angle ?? 0),
          satellites: Number(data.gpsSnapshot.satellites ?? 0),
          gpsTimestamp: Number(data.gpsSnapshot.gpsTimestamp ?? 0),
          serverTimestamp: Number(data.gpsSnapshot.serverTimestamp ?? 0),
          ignitionOn: Boolean(data.gpsSnapshot.ignitionOn ?? false),
          odometerKm: Number(data.gpsSnapshot.odometerKm ?? 0),
          imei: data.gpsSnapshot.imei ?? "",
          online: Boolean(data.gpsSnapshot.online ?? false),
        }
      : null,
    tracker: data.tracker
      ? {
          imei: data.tracker.imei ?? "",
          lastSeenAt: Number(data.tracker.lastSeenAt ?? 0),
          protocol: data.tracker.protocol ?? "",
        }
      : null,

    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
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

    reader.onerror = reject;

    image.onload = () => {
      let { width, height } = image;

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

    image.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function getVehicleUsers(): Promise<AppUser[]> {
  const snap = await getDocs(query(usersCollection, orderBy("fullName", "asc")));
  return snap.docs.map((docItem) => ({
    id: docItem.id,
    uid: docItem.data().uid ?? "",
    themeKey: docItem.data().themeKey ?? null,
    fullName: docItem.data().fullName ?? "Utilizator fara nume",
    email: docItem.data().email ?? "",
    active: docItem.data().active ?? true,
    role: docItem.data().role ?? "",
  }));
}

export async function getVehiclesList(): Promise<VehicleItem[]> {
  const snap = await getDocs(query(vehiclesCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapVehicleDoc(docItem.id, docItem.data()));
}

export async function getVehicleById(vehicleId: string): Promise<VehicleItem | null> {
  const snap = await getDoc(doc(db, "vehicles", vehicleId));
  if (!snap.exists()) return null;
  return mapVehicleDoc(snap.id, snap.data());
}

export async function isPlateNumberUsed(
  plateNumber: string,
  excludeVehicleId?: string
): Promise<boolean> {
  const clean = plateNumber.trim().toUpperCase();
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
    plateNumber: values.plateNumber.trim().toUpperCase(),
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

  return refDoc.id;
}

export async function updateVehicle(
  vehicleId: string,
  values: VehicleFormValues
): Promise<void> {
  const existingSnap = await getDoc(doc(db, "vehicles", vehicleId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const previousStatus = existingData?.status ?? "";
  const previousOwnerUserId = existingData?.ownerUserId ?? "";

  await updateDoc(doc(db, "vehicles", vehicleId), {
    ...values,
    plateNumber: values.plateNumber.trim().toUpperCase(),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addVehicleEvent(
    vehicleId,
    "updated",
    `Masina ${values.plateNumber} a fost actualizata.`
  );

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
export async function getVehicleEvents(vehicleId: string): Promise<VehicleEventItem[]> {
  const snap = await getDocs(
    query(vehicleEventsCollection, where("vehicleId", "==", vehicleId))
  );

  const events = snap.docs.map((docItem) => ({
    id: docItem.id,
    vehicleId: docItem.data().vehicleId,
    type: docItem.data().type,
    message: docItem.data().message,
    createdAt: docItem.data().createdAt ?? Date.now(),
    actorUserId: docItem.data().actorUserId ?? "",
    actorUserName: docItem.data().actorUserName ?? "",
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
    const baseName = `${Date.now()}_${file.name
      .replace(/\s+/g, "_")
      .replace(/\.[^/.]+$/, "")}`;

    const fullPath = `vehicles/${vehicleId}/images/${baseName}.jpg`;
    const thumbPath = `vehicles/${vehicleId}/images/thumb_${baseName}.jpg`;

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
  const plateNumber = vehicleData.plateNumber ?? "Masina";
  const previousDriverUserId = vehicleData.currentDriverUserId ?? "";

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
    ownerUserId: vehicleData.ownerUserId ?? "",
    actorUserId: vehicleData.ownerUserId ?? "",
    actorUserName: vehicleData.ownerUserName ?? "Responsabil",
    actorUserThemeKey: vehicleData.ownerThemeKey ?? null,
  });
}

export async function claimVehicleForCurrentUser(
  vehicleId: string,
  userId: string,
  userName: string,
  userThemeKey: string | null
): Promise<void>{
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
  await deleteDoc(doc(db, "vehicles", vehicleId));
}
function mapVehiclePositionDoc(id: string, data: Record<string, any>): VehiclePositionItem {
  return {
    id,
    vehicleId: data.vehicleId ?? "",
    imei: data.imei ?? "",
    lat: Number(data.lat ?? 0),
    lng: Number(data.lng ?? 0),
    speedKmh: Number(data.speedKmh ?? 0),
    altitude: Number(data.altitude ?? 0),
    angle: Number(data.angle ?? 0),
    satellites: Number(data.satellites ?? 0),
    gpsTimestamp: Number(data.gpsTimestamp ?? 0),
    serverTimestamp: Number(data.serverTimestamp ?? 0),
    eventIoId: Number(data.eventIoId ?? 0),
    ignitionOn: Boolean(data.ignitionOn ?? false),
    odometerKm: Number(data.odometerKm ?? 0),
    rawIo: typeof data.rawIo === "object" && data.rawIo ? data.rawIo : {},
  };
}

export function subscribeVehiclePositions(
  vehicleId: string,
  onData: (items: VehiclePositionItem[]) => void,
  maxItems = 300
): () => void {
  const positionsQuery = query(
    collection(db, "vehicles", vehicleId, "positions"),
    orderBy("gpsTimestamp", "desc"),
    limit(maxItems)
  );

  return onSnapshot(positionsQuery, (snap) => {
    const items = snap.docs
      .map((docItem) => mapVehiclePositionDoc(docItem.id, docItem.data()))
      .filter((item) => !(item.lat === 0 && item.lng === 0))
      .sort((a, b) => a.gpsTimestamp - b.gpsTimestamp);

    onData(items);
  });
}
