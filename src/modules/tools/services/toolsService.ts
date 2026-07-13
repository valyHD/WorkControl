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
import { httpsCallable } from "firebase/functions";
import { auth, db, functions, storage } from "../../../lib/firebase/firebase";
import { clampQueryLimit } from "../../../lib/firebase/queryLimits";
import {
  buildCompanyScopeConstraints,
  buildUserDirectoryConstraints,
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";
import { getUserDirectoryCollectionName } from "../../../lib/firebase/companyIsolationRollout";
import type {
  AppUser,
  ToolEventItem,
  ToolFormValues,
  ToolImageItem,
  ToolItem,
} from "../../../types/tool";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import { buildAuditChanges, buildAuditSnapshot, type AuditFieldDescriptor } from "../../audit/utils/auditMetadata";

const toolsCollection = collection(db, "tools");
const userOperationalViewsCollection = collection(db, "userOperationalViews");
const usersCollection = collection(db, "users");
const toolEventsCollection = collection(db, "toolEvents");

const toolAuditFields: AuditFieldDescriptor<ToolFormValues>[] = [
  { key: "name", label: "Nume scula" },
  { key: "internalCode", label: "Cod intern" },
  { key: "qrCodeValue", label: "Cod QR" },
  { key: "status", label: "Status" },
  { key: "ownerUserName", label: "Responsabil" },
  { key: "currentHolderUserName", label: "Detinator" },
  { key: "locationType", label: "Tip locatie" },
  { key: "locationLabel", label: "Locatie" },
  { key: "description", label: "Descriere" },
  { key: "warrantyText", label: "Garantie" },
  { key: "warrantyUntil", label: "Garantie pana la" },
];

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
    pendingHolderUserId: data.pendingHolderUserId ?? "",
    pendingHolderUserName: data.pendingHolderUserName ?? "",
    pendingHolderThemeKey: data.pendingHolderThemeKey ?? null,
    pendingHolderRequestedAt: data.pendingHolderRequestedAt ?? 0,

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
    companyId: data.companyId ?? "",
  };
}

export async function getUsersList(): Promise<AppUser[]> {
  const context = await getCurrentCompanyAccessContext();
  const source = getUserDirectoryCollectionName() === "userOperationalViews"
    ? userOperationalViewsCollection
    : usersCollection;
  const snap = await getDocs(query(
    source,
    ...buildUserDirectoryConstraints(context),
    orderBy("fullName", "asc")
  ));
  const users = new Map<string, AppUser>();
  snap.docs.forEach((docItem) => {
    const data = docItem.data();
    const uid = String(data.uid || "").trim() || docItem.id;
    users.set(uid, {
      id: uid,
      uid,
      themeKey: data.themeKey ?? null,
      avatarUrl: data.avatarUrl ?? "",
      avatarThumbUrl: data.avatarThumbUrl ?? data.avatarUrl ?? "",
      fullName: data.fullName ?? "Utilizator fara nume",
      email: data.email ?? "",
      active: data.active ?? true,
      role: data.role ?? "",
      roleTitle: data.roleTitle ?? "",
      department: data.department ?? "",
      companyIds: [data.companyId].filter(Boolean),
      companyNames: [],
      primaryCompanyId: data.companyId ?? "",
      primaryCompanyName: "",
    });
  });
  return [...users.values()];
}

export async function getToolsList(maxItems = 500): Promise<ToolItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const resultLimit = clampQueryLimit(maxItems, 500, 500);
  if (context.role !== "angajat") {
    const snap = await getDocs(query(
      toolsCollection,
      ...buildCompanyScopeConstraints(context),
      orderBy("updatedAt", "desc"),
      limit(resultLimit)
    ));
    return snap.docs.map((docItem) => mapToolDoc(docItem.id, docItem.data()));
  }
  const assignmentFields = ["ownerUserId", "currentHolderUserId", "pendingHolderUserId"] as const;
  const snapshots = await Promise.all(assignmentFields.map((field) => getDocs(query(
    toolsCollection,
    ...buildCompanyScopeConstraints(context),
    where(field, "==", context.uid),
    limit(resultLimit)
  ))));
  const unique = new Map<string, ToolItem>();
  snapshots.forEach((snap) => snap.docs.forEach((docItem) => {
    unique.set(docItem.id, mapToolDoc(docItem.id, docItem.data()));
  }));
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getToolById(toolId: string): Promise<ToolItem | null> {
  const snap = await getDoc(doc(db, "tools", toolId));
  if (!snap.exists()) return null;
  return mapToolDoc(snap.id, snap.data());
}

export async function findToolByQrCode(qrCodeValue: string): Promise<ToolItem | null> {
  const clean = qrCodeValue.trim();
  if (!clean) return null;

  const tools = await getToolsList();
  return tools.find((tool) => tool.qrCodeValue === clean) ?? null;
}

export async function findToolByInternalCode(
  internalCode: string
): Promise<ToolItem | null> {
  const clean = internalCode.trim();
  if (!clean) return null;

  const tools = await getToolsList();
  return tools.find((tool) => tool.internalCode === clean) ?? null;
}

export async function isQrCodeUsed(
  qrCodeValue: string,
  excludeToolId?: string
): Promise<boolean> {
  const clean = qrCodeValue.trim();
  if (!clean) return false;

  const tools = await getToolsList();
  return tools.some((tool) => tool.qrCodeValue === clean && tool.id !== excludeToolId);
}

export async function isInternalCodeUsed(
  internalCode: string,
  excludeToolId?: string
): Promise<boolean> {
  const clean = internalCode.trim();
  if (!clean) return false;

  const tools = await getToolsList();
  return tools.some((tool) => tool.internalCode === clean && tool.id !== excludeToolId);
}

export async function createTool(values: ToolFormValues): Promise<string> {
  const context = await getCurrentCompanyAccessContext();
  const companyId = values.companyId || requirePrimaryCompanyId(context);
  const now = Date.now();
  const fieldsText = buildAuditSnapshot(values, toolAuditFields);

  const docRef = await addDoc(toolsCollection, {
    ...values,
    companyId,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(docRef.id, "created", `Scula "${values.name}" a fost creata.`);

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_created",
    entityId: docRef.id,
    title: "Sculă nouă",
    message: `A fost adăugată scula ${values.name}.`,
    directUserId: values.currentHolderUserId || "",
    ownerUserId: values.ownerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
    metadata: {
      fieldsText,
      fieldsCount: fieldsText.length,
    },
  });

  return docRef.id;
}

export async function updateTool(toolId: string, values: ToolFormValues): Promise<void> {
  const existingSnap = await getDoc(doc(db, "tools", toolId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const previousStatus = existingData?.status ?? "";
  const previousOwnerUserId = existingData?.ownerUserId ?? "";
  const changesText = buildAuditChanges(
    existingData as Partial<ToolFormValues> | null,
    values,
    toolAuditFields
  );

  await updateDoc(doc(db, "tools", toolId), {
    ...values,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await addToolEvent(toolId, "updated", `Scula "${values.name}" a fost actualizata.`);

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_updated",
    entityId: toolId,
    title: "Sculă actualizată",
    message: `Datele sculei ${values.name} au fost actualizate.`,
    directUserId: values.currentHolderUserId || "",
    ownerUserId: values.ownerUserId || previousOwnerUserId || "",
    actorUserId: values.ownerUserId || "",
    actorUserName: values.ownerUserName || "Responsabil",
    actorUserThemeKey: values.ownerThemeKey ?? null,
    metadata: {
      changesText,
      changesCount: changesText.length,
    },
  });

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
  metadata: {
    changesText: [`Status: ${previousStatus || "-"} -> ${values.status}`],
    changesCount: 1,
  },
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
  const actorUserId = actor?.actorUserId || auth.currentUser?.uid || "";
  await addDoc(toolEventsCollection, {
    toolId,
    type,
    message,
    actorUserId,
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

export async function addToolComment(
  toolId: string,
  comment: string,
  actor: {
    actorUserId?: string;
    actorUserName?: string;
    actorUserThemeKey?: string | null;
  }
): Promise<void> {
  const cleanComment = comment.trim();
  if (!toolId || !cleanComment) return;

  const toolSnap = await getDoc(doc(db, "tools", toolId));
  const toolData = toolSnap.exists() ? toolSnap.data() : null;
  const toolName = toolData?.name ?? toolId;

  await addToolEvent(toolId, "comment", `Comentariu: ${cleanComment}`, actor);

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_updated",
    entityId: toolId,
    title: "Comentariu scula",
    message: `${actor.actorUserName || "Utilizator"} a adaugat un comentariu la scula ${toolName}: ${cleanComment}`,
    notificationPath: `/tools/${toolId}`,
    directUserId: toolData?.currentHolderUserId ?? "",
    ownerUserId: toolData?.ownerUserId ?? "",
    actorUserId: actor.actorUserId ?? "",
    actorUserName: actor.actorUserName ?? "Utilizator",
    actorUserThemeKey: actor.actorUserThemeKey ?? null,
    metadata: {
      fieldsText: [`Comentariu: ${cleanComment}`],
      fieldsCount: 1,
    },
  });
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

    await uploadBytes(fullRef, fullBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });
    await uploadBytes(thumbRef, thumbBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });

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

  const toolSnap = await getDoc(doc(db, "tools", toolId));
  const toolData = toolSnap.exists() ? toolSnap.data() : null;
  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_images_updated",
    entityId: toolId,
    title: "Poze scula actualizate",
    message: `Au fost adaugate ${newImages.length} poze pentru scula ${toolData?.name ?? toolId}.`,
    directUserId: toolData?.currentHolderUserId ?? "",
    ownerUserId: toolData?.ownerUserId ?? "",
  });
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

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_cover_changed",
    entityId: toolId,
    title: "Poza principala scula schimbata",
    message: `Poza principala pentru ${data.name ?? toolId} a fost schimbata.`,
    directUserId: data.currentHolderUserId ?? "",
    ownerUserId: data.ownerUserId ?? "",
  });
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

  const toolSnap = await getDoc(doc(db, "tools", toolId));
  const toolData = toolSnap.exists() ? toolSnap.data() : null;
  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_image_deleted",
    entityId: toolId,
    title: "Poza scula stearsa",
    message: `O poza a sculei ${toolData?.name ?? toolId} a fost stearsa.`,
    directUserId: toolData?.currentHolderUserId ?? "",
    ownerUserId: toolData?.ownerUserId ?? "",
  });
  return updatedImages;
}

export async function deleteTool(toolId: string): Promise<void> {
  const snap = await getDoc(doc(db, "tools", toolId));
  const data = snap.exists() ? snap.data() : null;

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_deleted",
    entityId: toolId,
    title: "Sculă ștearsă",
    message: `Scula ${data?.name ?? toolId} a fost ștearsă din sistem.`,
    ownerUserId: data?.ownerUserId ?? "",
  });
  await deleteDoc(doc(db, "tools", toolId));
}

export async function changeToolHolder(
  toolId: string,
  nextHolderUserId: string,
  nextHolderUserName: string,
  nextHolderThemeKey: string | null,
  initiator: {
    userId: string;
    userName: string;
    userThemeKey: string | null;
  }
): Promise<void> {
  void nextHolderThemeKey;
  const toolSnap = await getDoc(doc(db, "tools", toolId));
  if (!toolSnap.exists()) return;

  const toolData = toolSnap.data();
  const toolName = toolData.name ?? "Scula";
  const previousHolderUserId = toolData.currentHolderUserId ?? "";
  const isOwnerInitiator = Boolean(initiator.userId && initiator.userId === (toolData.ownerUserId ?? ""));
  const initiatorName = initiator.userName || (isOwnerInitiator ? toolData.ownerUserName : toolData.currentHolderUserName) || "Utilizator";
  const initiatorThemeKey = initiator.userThemeKey ?? (isOwnerInitiator ? toolData.ownerThemeKey : toolData.currentHolderThemeKey) ?? null;

  const transferCallable = httpsCallable<
    { toolId: string; nextHolderUserId: string },
    { toolId: string; pendingHolderUserId: string }
  >(functions, "requestToolTransfer");
  await transferCallable({ toolId, nextHolderUserId });

  if (nextHolderUserId) {

    await addToolEvent(
      toolId,
      "holder_changed",
      `A fost trimisa o solicitare catre ${nextHolderUserName} pentru preluarea sculei.`
    );

    await dispatchNotificationEvent({
      module: "tools",
      eventType: "tool_holder_changed",
      entityId: toolId,
      title: "Solicitare primire scula",
      message: `${toolName} ti-a fost asignata. Accepta solicitarea pentru a deveni detinator curent.`,
      directUserId: nextHolderUserId,
      ownerUserId: toolData.ownerUserId ?? "",
      actorUserId: initiator.userId || "",
      actorUserName: initiatorName,
      actorUserThemeKey: initiatorThemeKey,
    });
    return;
  }

  const message = `Scula a fost returnata in depozit de ${initiatorName}.`;

  await addToolEvent(toolId, "holder_changed", message);

await dispatchNotificationEvent({
  module: "tools",
  eventType: "tool_holder_changed",
  entityId: toolId,
  title: "Scula mutata",
  message: `${toolName} a fost mutata in depozit.`,
  directUserId: previousHolderUserId || "",
  ownerUserId: toolData.ownerUserId ?? "",
  actorUserId: initiator.userId || "",
  actorUserName: initiatorName,
  actorUserThemeKey: initiatorThemeKey,
});
}

export async function acceptToolHolderChange(
  toolId: string,
  accepterUserId: string
): Promise<void> {
  const toolSnap = await getDoc(doc(db, "tools", toolId));
  if (!toolSnap.exists()) return;

  const toolData = toolSnap.data();
  const pendingHolderUserId = toolData.pendingHolderUserId ?? "";
  if (!pendingHolderUserId || pendingHolderUserId !== accepterUserId) return;

  const pendingHolderUserName = toolData.pendingHolderUserName ?? "";
  const pendingHolderThemeKey = toolData.pendingHolderThemeKey ?? null;
  const toolName = toolData.name ?? "Scula";

  const acceptCallable = httpsCallable<{ toolId: string }, { toolId: string }>(
    functions,
    "acceptToolTransfer"
  );
  await acceptCallable({ toolId });

  await addToolEvent(
    toolId,
    "holder_changed",
    `Solicitarea a fost acceptata. Scula este acum la ${pendingHolderUserName || "utilizator"}`
  );

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_holder_changed",
    entityId: toolId,
    title: "Solicitare scula acceptata",
    message: `${toolName} a fost acceptata de ${pendingHolderUserName || "utilizator"}.`,
    directUserId: toolData.ownerUserId ?? "",
    ownerUserId: toolData.ownerUserId ?? "",
    actorUserId: pendingHolderUserId,
    actorUserName: pendingHolderUserName || "Utilizator",
    actorUserThemeKey: pendingHolderThemeKey ?? null,
  });
}

export async function getToolsOwnedByUser(userId: string): Promise<ToolItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(
    query(
      toolsCollection,
      ...buildCompanyScopeConstraints(context),
      where("ownerUserId", "==", userId)
    )
  );

  return snap.docs
    .map((docItem) => mapToolDoc(docItem.id, docItem.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getToolsHeldByUser(userId: string): Promise<ToolItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(
    query(
      toolsCollection,
      ...buildCompanyScopeConstraints(context),
      where("currentHolderUserId", "==", userId)
    )
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
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== userId) throw new Error("Poti prelua scula numai pentru tine.");
  const claimCallable = httpsCallable<{ toolId: string }, { toolId: string }>(
    functions,
    "claimTool"
  );
  await claimCallable({ toolId });

  await addToolEvent(
    toolId,
    "holder_changed",
    `Scula a fost preluata in responsabilitate si setata la utilizatorul ${userName}.`
  );

  await dispatchNotificationEvent({
    module: "tools",
    eventType: "tool_claimed",
    entityId: toolId,
    title: "Scula preluata",
    message: `Scula a fost preluata de ${userName}.`,
    directUserId: userId,
    ownerUserId: userId,
    actorUserId: userId,
    actorUserName: userName,
    actorUserThemeKey: userThemeKey,
  });
}

export async function getToolsHeldByUserFromOthers(userId: string): Promise<ToolItem[]> {
  const held = await getToolsHeldByUser(userId);
  return held.filter((tool) => tool.ownerUserId && tool.ownerUserId !== userId);
}
