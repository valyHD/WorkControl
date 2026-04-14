import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
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
  AppUser,
  ToolEventItem,
  ToolFormValues,
  ToolImageItem,
  ToolItem,
} from "../../../types/tool";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const toolsCollection = collection(db, "tools");
const usersCollection = collection(db, "users");
const toolEventsCollection = collection(db, "toolEvents");

async function resizeImage(
  file: File,
  options: {
    maxWidth: number;
    maxHeight: number;
    quality: number;
  }
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

function mapToolDoc(id: string, data: Record<string, any>): ToolItem {
  return {
    id,
    name: data.name ?? "",
    ownerThemeKey: data.ownerThemeKey ?? null,
currentHolderThemeKey: data.currentHolderThemeKey ?? null,
    internalCode: data.internalCode ?? "",
    qrCodeValue: data.qrCodeValue ?? "",
    status: data.status ?? "depozit",

    coverThumbUrl: data.coverThumbUrl ?? "",

    ownerUserId: data.ownerUserId ?? "",
    ownerUserName: data.ownerUserName ?? "",

    currentHolderUserId: data.currentHolderUserId ?? "",
    currentHolderUserName: data.currentHolderUserName ?? "",

    locationType: data.locationType ?? "depozit",
    locationLabel: data.locationLabel ?? "Depozit",

    description: data.description ?? "",
    warrantyText: data.warrantyText ?? "",
    warrantyUntil: data.warrantyUntil ?? "",

    coverImageUrl: data.coverImageUrl ?? "",
    imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
    images: Array.isArray(data.images) ? data.images : [],

    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
  };
}

export async function getUsersList(): Promise<AppUser[]> {
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

export async function getToolsList(): Promise<ToolItem[]> {
  const snap = await getDocs(query(toolsCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapToolDoc(docItem.id, docItem.data()));
}

export async function getToolById(toolId: string): Promise<ToolItem | null> {
  const snap = await getDoc(doc(db, "tools", toolId));
  if (!snap.exists()) return null;
  return mapToolDoc(snap.id, snap.data());
}

export async function findToolByQrCode(qrCodeValue: string): Promise<ToolItem | null> {
  const clean = qrCodeValue.trim();
  if (!clean) return null;

  const snap = await getDocs(
    query(toolsCollection, where("qrCodeValue", "==", clean), limit(1))
  );

  if (snap.empty) return null;
  return mapToolDoc(snap.docs[0].id, snap.docs[0].data());
}

export async function findToolByInternalCode(
  internalCode: string
): Promise<ToolItem | null> {
  const clean = internalCode.trim();
  if (!clean) return null;

  const snap = await getDocs(
    query(toolsCollection, where("internalCode", "==", clean), limit(1))
  );

  if (snap.empty) return null;
  return mapToolDoc(snap.docs[0].id, snap.docs[0].data());
}

export async function isQrCodeUsed(
  qrCodeValue: string,
  excludeToolId?: string
): Promise<boolean> {
  const clean = qrCodeValue.trim();
  if (!clean) return false;

  const snap = await getDocs(
    query(toolsCollection, where("qrCodeValue", "==", clean), limit(10))
  );

  if (snap.empty) return false;

  return snap.docs.some((docItem) => docItem.id !== excludeToolId);
}

export async function isInternalCodeUsed(
  internalCode: string,
  excludeToolId?: string
): Promise<boolean> {
  const clean = internalCode.trim();
  if (!clean) return false;

  const snap = await getDocs(
    query(toolsCollection, where("internalCode", "==", clean), limit(10))
  );

  if (snap.empty) return false;

  return snap.docs.some((docItem) => docItem.id !== excludeToolId);
}

export async function createTool(values: ToolFormValues): Promise<string> {
  const now = Date.now();

  const docRef = await addDoc(toolsCollection, {
    ...values,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(docRef.id, "created", `Scula "${values.name}" a fost creata.`);
  return docRef.id;
}

export async function updateTool(toolId: string, values: ToolFormValues): Promise<void> {
  const existingSnap = await getDoc(doc(db, "tools", toolId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const previousStatus = existingData?.status ?? "";
  const previousOwnerUserId = existingData?.ownerUserId ?? "";

  await updateDoc(doc(db, "tools", toolId), {
    ...values,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(toolId, "updated", `Scula "${values.name}" a fost actualizata.`);

  if (previousStatus !== values.status) {
    await addToolEvent(
      toolId,
      "status_changed",
      `Statusul sculei "${values.name}" a fost schimbat din "${previousStatus || "-"}" in "${values.status}".`
    );

await dispatchNotificationEvent({
  module: "tools",
  eventType: "tool_status_changed",
  entityId: toolId,
  title: "Status scula schimbat",
  message: `Scula ${values.name} are acum statusul ${values.status}.`,
  directUserId: values.currentHolderUserId || "",
  ownerUserId: values.ownerUserId || previousOwnerUserId || "",
  actorUserId: values.ownerUserId || "",
  actorUserName: values.ownerUserName || "Responsabil",
  actorUserThemeKey: values.ownerThemeKey ?? null,
});
  }
}
export async function addToolEvent(
  toolId: string,
  type: ToolEventItem["type"],
  message: string,
  actor?: {
    actorUserId?: string;
    actorUserName?: string;
    actorUserThemeKey?: string | null;
  }
): Promise<void> {
  await addDoc(toolEventsCollection, {
    toolId,
    type,
    message,
    actorUserId: actor?.actorUserId ?? "",
    actorUserName: actor?.actorUserName ?? "",
    actorUserThemeKey: actor?.actorUserThemeKey ?? null,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}

export async function getToolEvents(toolId: string): Promise<ToolEventItem[]> {
  const snap = await getDocs(
    query(toolEventsCollection, where("toolId", "==", toolId))
  );

  const events = snap.docs.map((docItem) => ({
    id: docItem.id,
    toolId: docItem.data().toolId,
    type: docItem.data().type,
    message: docItem.data().message,
    createdAt: docItem.data().createdAt ?? Date.now(),
    actorUserId: docItem.data().actorUserId ?? "",
    actorUserName: docItem.data().actorUserName ?? "",
    actorUserThemeKey: docItem.data().actorUserThemeKey ?? null,
  }));

  return events.sort((a, b) => b.createdAt - a.createdAt);
}

export async function uploadToolImages(toolId: string, files: File[]): Promise<ToolImageItem[]> {
  const uploadedItems: ToolImageItem[] = [];

  for (const file of files) {
    const baseName = `${Date.now()}_${file.name.replace(/\s+/g, "_").replace(/\.[^/.]+$/, "")}`;
    const fullPath = `tools/${toolId}/images/${baseName}.jpg`;
    const thumbPath = `tools/${toolId}/images/thumb_${baseName}.jpg`;

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
    } as ToolImageItem & { thumbUrl: string; thumbPath: string });
  }

  return uploadedItems;
}

export async function saveToolImages(
  toolId: string,
  currentImages: ToolImageItem[],
  newImages: ToolImageItem[]
): Promise<void> {
  const mergedImages = [...currentImages, ...newImages];
  const imageUrls = mergedImages.map((img) => img.url);
  const coverImageUrl = mergedImages[0]?.url ?? "";
  const coverThumbUrl = mergedImages[0]?.thumbUrl ?? mergedImages[0]?.url ?? "";

  await updateDoc(doc(db, "tools", toolId), {
    images: mergedImages,
    imageUrls,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(toolId, "images_updated", "Imaginile sculei au fost actualizate.");
}

export async function setToolCoverImage(toolId: string, imageUrl: string): Promise<void> {
  const toolSnap = await getDoc(doc(db, "tools", toolId));
  if (!toolSnap.exists()) return;

  const data = toolSnap.data();
  const images = Array.isArray(data.images) ? data.images : [];
  const selectedImage = images.find((img: any) => img.url === imageUrl);

  await updateDoc(doc(db, "tools", toolId), {
    coverImageUrl: imageUrl,
    coverThumbUrl: selectedImage?.thumbUrl ?? imageUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(toolId, "images_updated", "Poza principala a fost schimbata.");
}

export async function removeToolImage(
  toolId: string,
  images: ToolImageItem[],
  imageId: string
): Promise<ToolImageItem[]> {
  const imageToDelete = images.find((img) => img.id === imageId);
  if (!imageToDelete) return images;

  if (imageToDelete.path) {
    await deleteObject(ref(storage, imageToDelete.path)).catch(() => undefined);
  }

  if (imageToDelete.thumbPath) {
    await deleteObject(ref(storage, imageToDelete.thumbPath)).catch(() => undefined);
  }

  const updatedImages = images.filter((img) => img.id !== imageId);
  const imageUrls = updatedImages.map((img) => img.url);
  const coverImageUrl = updatedImages[0]?.url ?? "";
  const coverThumbUrl = updatedImages[0]?.thumbUrl ?? updatedImages[0]?.url ?? "";

  await updateDoc(doc(db, "tools", toolId), {
    images: updatedImages,
    imageUrls,
    coverImageUrl,
    coverThumbUrl,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(toolId, "images_updated", "O imagine a fost stearsa.");
  return updatedImages;
}

export async function deleteTool(toolId: string): Promise<void> {
  await deleteDoc(doc(db, "tools", toolId));
}

export async function changeToolHolder(
  toolId: string,
  nextHolderUserId: string,
  nextHolderUserName: string,
  nextHolderThemeKey: string | null,
  ownerUserName: string
): Promise<void> {
  const toolSnap = await getDoc(doc(db, "tools", toolId));
  if (!toolSnap.exists()) return;

  const toolData = toolSnap.data();
  const toolName = toolData.name ?? "Scula";
  const previousHolderUserId = toolData.currentHolderUserId ?? "";
  const previousHolderUserName = toolData.currentHolderUserName ?? "";

  const locationType = nextHolderUserId ? "utilizator" : "depozit";
  const locationLabel = nextHolderUserId ? nextHolderUserName : "Depozit";
  const status = nextHolderUserId ? "atribuita" : "depozit";

  await updateDoc(doc(db, "tools", toolId), {
    currentHolderUserId: nextHolderUserId || "",
    currentHolderUserName: nextHolderUserName || "",
    currentHolderThemeKey: nextHolderThemeKey ?? null,
    locationType,
    locationLabel,
    status,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  const message = nextHolderUserId
    ? `Scula a fost mutata de la ${previousHolderUserName || "depozit"} la ${nextHolderUserName}.`
    : `Scula a fost returnata in depozit de responsabilul ${ownerUserName}.`;

  await addToolEvent(toolId, "holder_changed", message);

await dispatchNotificationEvent({
  module: "tools",
  eventType: "tool_holder_changed",
  entityId: toolId,
  title: "Scula mutata",
  message: `${toolName} a fost mutata ${nextHolderUserId ? `la ${nextHolderUserName}` : "in depozit"}.`,
  directUserId: nextHolderUserId || previousHolderUserId || "",
  ownerUserId: toolData.ownerUserId ?? "",
  actorUserId: toolData.ownerUserId ?? "",
  actorUserName: toolData.ownerUserName ?? "Responsabil",
  actorUserThemeKey: toolData.ownerThemeKey ?? null,
});
}

export async function getToolsOwnedByUser(userId: string): Promise<ToolItem[]> {
  const snap = await getDocs(
    query(toolsCollection, where("ownerUserId", "==", userId))
  );

  return snap.docs
    .map((docItem) => mapToolDoc(docItem.id, docItem.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getToolsHeldByUser(userId: string): Promise<ToolItem[]> {
  const snap = await getDocs(
    query(toolsCollection, where("currentHolderUserId", "==", userId))
  );

  return snap.docs
    .map((docItem) => mapToolDoc(docItem.id, docItem.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getToolsOwnedByUserButHeldByOthers(userId: string): Promise<ToolItem[]> {
  const owned = await getToolsOwnedByUser(userId);
  return owned.filter((tool) => tool.currentHolderUserId && tool.currentHolderUserId !== userId);
}

export async function claimToolForCurrentUser(
  toolId: string,
  userId: string,
  userName: string,
  userThemeKey: string | null
): Promise<void>{
  await updateDoc(doc(db, "tools", toolId), {
ownerUserId: userId,
ownerUserName: userName,
ownerThemeKey: userThemeKey ?? null,
currentHolderUserId: userId,
currentHolderUserName: userName,
currentHolderThemeKey: userThemeKey ?? null,
locationType: "utilizator",
locationLabel: userName,
updatedAt: Date.now(),
updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(
    toolId,
    "holder_changed",
    `Scula a fost preluata in responsabilitate si setata la utilizatorul ${userName}.`
  );
}

export async function getToolsHeldByUserFromOthers(userId: string): Promise<ToolItem[]> {
  const held = await getToolsHeldByUser(userId);
  return held.filter((tool) => tool.ownerUserId && tool.ownerUserId !== userId);
}