import {
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
  writeBatch,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { auth, db, storage } from "../../../lib/firebase/firebase";
import { createAuditLog } from "../../audit/services/auditLogService";
import { buildAuditChanges, type AuditFieldDescriptor } from "../../audit/utils/auditMetadata";
import type { AppUserItem, UserRole } from "../../../types/user";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const usersCollection = collection(db, "users");
const userAuditFields: AuditFieldDescriptor<Pick<AppUserItem, "fullName" | "role" | "roleTitle" | "department" | "active">>[] = [
  { key: "fullName", label: "Nume" },
  { key: "role", label: "Rol" },
  { key: "roleTitle", label: "Functie" },
  { key: "department", label: "Departament" },
  { key: "active", label: "Activ" },
];

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toUserRole(value: unknown): UserRole {
  return value === "admin" || value === "manager" || value === "angajat" ? value : "angajat";
}

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object") {
    const maybeTimestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTimestamp.toMillis === "function") return maybeTimestamp.toMillis();
    if (typeof maybeTimestamp.seconds === "number") return maybeTimestamp.seconds * 1000;
  }
  return undefined;
}

async function resizeAvatarImage(
  file: File,
  options: { size: number; quality: number }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.src = String(reader.result);
    };
    reader.onerror = reject;
    image.onerror = () => reject(new Error("Imaginea nu a putut fi citita."));

    image.onload = () => {
      const side = Math.min(image.width, image.height);
      const sx = Math.round((image.width - side) / 2);
      const sy = Math.round((image.height - side) / 2);
      const canvas = document.createElement("canvas");
      canvas.width = options.size;
      canvas.height = options.size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Nu am putut crea canvas."));
        return;
      }

      ctx.drawImage(image, sx, sy, side, side, 0, 0, options.size, options.size);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Nu am putut genera avatarul."));
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

async function commitInChunks(
  updates: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }>
) {
  for (let index = 0; index < updates.length; index += 450) {
    const batch = writeBatch(db);
    updates.slice(index, index + 450).forEach((item) => batch.update(item.ref, item.data));
    await batch.commit();
  }
}

async function collectUserNameSnapshotUpdates(
  collectionName: string,
  userId: string,
  userIdField: string,
  userNameField: string,
  fullName: string
) {
  const snap = await getDocs(query(collection(db, collectionName), where(userIdField, "==", userId)));
  return snap.docs.map((docItem) => ({
    ref: docItem.ref,
    data: {
      [userNameField]: fullName,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
  }));
}

async function syncCompanyAssignedUserNames(userId: string) {
  const [companiesSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, "firmeMentenanta"), where("assignedUserIds", "array-contains", userId))),
    getDocs(collection(db, "users")),
  ]);

  const userNames = new Map(
    usersSnap.docs.map((docItem) => {
      const data = docItem.data();
      return [docItem.id, toText(data.fullName) || toText(data.email) || docItem.id];
    })
  );

  const updates = companiesSnap.docs.map((docItem) => {
    const assignedUserIds = Array.isArray(docItem.data().assignedUserIds)
      ? docItem.data().assignedUserIds.map((item: unknown) => toText(item)).filter(Boolean)
      : [];

    return {
      ref: docItem.ref,
      data: {
        assignedUserNames: assignedUserIds.map((id: string) => userNames.get(id) || id),
        updatedAt: Date.now(),
        updatedAtServer: serverTimestamp(),
      },
    };
  });

  await commitInChunks(updates);
}

async function propagateUserName(userId: string, fullName: string) {
  const snapshots: Array<[string, string, string]> = [
    ["tools", "ownerUserId", "ownerUserName"],
    ["tools", "currentHolderUserId", "currentHolderUserName"],
    ["tools", "pendingHolderUserId", "pendingHolderUserName"],
    ["vehicles", "ownerUserId", "ownerUserName"],
    ["vehicles", "currentDriverUserId", "currentDriverUserName"],
    ["vehicles", "pendingDriverUserId", "pendingDriverUserName"],
    ["timesheets", "userId", "userName"],
    ["expenseDocuments", "uploadedByUserId", "uploadedByUserName"],
    ["expenseDocuments", "assignedUserId", "assignedUserName"],
    ["leaveRequests", "userId", "userName"],
    ["maintenancePartOrders", "requestedByUserId", "requestedByUserName"],
    ["maintenancePartOrders", "notifyUserId", "notifyUserName"],
    ["maintenancePartOrders", "notificationSeenByUserId", "notificationSeenByUserName"],
    ["maintenancePartOrders", "supplierEmailSentByUserId", "supplierEmailSentByUserName"],
    ["maintenancePartOrders", "supplierQuoteReceivedByUserId", "supplierQuoteReceivedByUserName"],
    ["maintenancePartOrders", "clientOfferEmailSentByUserId", "clientOfferEmailSentByUserName"],
    ["maintenancePartOrders", "resolvedByUserId", "resolvedByUserName"],
    ["toolEvents", "actorUserId", "actorUserName"],
    ["vehicleEvents", "actorUserId", "actorUserName"],
    ["auditLogs", "actorUserId", "actorUserName"],
    ["auditLogs", "targetUserId", "targetUserName"],
    ["notifications", "actorUserId", "actorUserName"],
  ];

  const updatesNested = await Promise.all(
    snapshots.map(([collectionName, userIdField, userNameField]) =>
      collectUserNameSnapshotUpdates(collectionName, userId, userIdField, userNameField, fullName)
    )
  );

  await commitInChunks(updatesNested.flat());
  await syncCompanyAssignedUserNames(userId);
}

function mapUserDoc(id: string, data: Record<string, unknown>): AppUserItem {
  return {
    id,
    uid: toText(data.uid) || id,
    fullName: toText(data.fullName),
    email: toText(data.email),
    active: typeof data.active === "boolean" ? data.active : true,
    role: toUserRole(data.role),
    themeKey: toText(data.themeKey) || undefined,
    avatarUrl: toText(data.avatarUrl),
    avatarThumbUrl: toText(data.avatarThumbUrl) || toText(data.avatarUrl),
    roleTitle: toText(data.roleTitle),
    department: toText(data.department),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    lastSeenAt: toMillis(data.lastSeenAt ?? data.lastSeenAtServer),
    lastActiveAt: toMillis(data.lastActiveAt ?? data.lastActiveAtServer),
    lastSiteEnteredAt: toMillis(data.lastSiteEnteredAt ?? data.lastSiteEnteredAtServer),
    isOnline: typeof data.isOnline === "boolean" ? data.isOnline : false,
    companyIds: Array.isArray(data.companyIds) ? data.companyIds.map((item) => toText(item)).filter(Boolean) : [],
    companyNames: Array.isArray(data.companyNames) ? data.companyNames.map((item) => toText(item)).filter(Boolean) : [],
    primaryCompanyId: toText(data.primaryCompanyId),
    primaryCompanyName: toText(data.primaryCompanyName),
  };
}

export async function getAllUsers(): Promise<AppUserItem[]> {
  const snap = await getDocs(query(usersCollection, orderBy("fullName", "asc"), limit(250)));
  return snap.docs.map((docItem) => mapUserDoc(docItem.id, docItem.data()));
}

export function subscribeUsers(
  onData: (items: AppUserItem[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    query(usersCollection, orderBy("fullName", "asc"), limit(250)),
    (snap) => {
      onData(snap.docs.map((docItem) => mapUserDoc(docItem.id, docItem.data())));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function getUserById(userId: string): Promise<AppUserItem | null> {
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return null;
  return mapUserDoc(snap.id, snap.data());
}

export async function getUserAvatar(userId: string): Promise<{ avatarUrl: string; avatarThumbUrl: string } | null> {
  if (!userId) return null;
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    avatarUrl: toText(data.avatarUrl),
    avatarThumbUrl: toText(data.avatarThumbUrl) || toText(data.avatarUrl),
  };
}

export async function uploadUserAvatar(
  userId: string,
  file: File
): Promise<{ avatarUrl: string; avatarThumbUrl: string }> {
  if (!userId) throw new Error("User lipsa.");
  if (!file.type.startsWith("image/")) throw new Error("Alege o imagine.");

  const existingSnap = await getDoc(doc(db, "users", userId));
  const existing = existingSnap.exists() ? existingSnap.data() : {};
  const stamp = Date.now();
  const avatarPath = `users/${userId}/avatar_${stamp}.jpg`;
  const avatarThumbPath = `users/${userId}/avatar_thumb_${stamp}.jpg`;

  const [avatarBlob, thumbBlob] = await Promise.all([
    resizeAvatarImage(file, { size: 512, quality: 0.86 }),
    resizeAvatarImage(file, { size: 96, quality: 0.78 }),
  ]);

  const avatarRef = ref(storage, avatarPath);
  const thumbRef = ref(storage, avatarThumbPath);
  await Promise.all([
    uploadBytes(avatarRef, avatarBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    }),
    uploadBytes(thumbRef, thumbBlob, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    }),
  ]);

  const [avatarUrl, avatarThumbUrl] = await Promise.all([
    getDownloadURL(avatarRef),
    getDownloadURL(thumbRef),
  ]);

  await updateDoc(doc(db, "users", userId), {
    avatarUrl,
    avatarThumbUrl,
    avatarPath,
    avatarThumbPath,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  if (auth.currentUser?.uid === userId) {
    await updateProfile(auth.currentUser, { photoURL: avatarThumbUrl }).catch((error) => {
      console.warn("[uploadUserAvatar][auth photoURL]", error);
    });
  }

  await Promise.all(
    [toText(existing.avatarPath), toText(existing.avatarThumbPath)]
      .filter((path) => path && path !== avatarPath && path !== avatarThumbPath)
      .map((path) => deleteObject(ref(storage, path)).catch(() => undefined))
  );

  return { avatarUrl, avatarThumbUrl };
}

export async function updateUserWorkDetails(
  userId: string,
  values: Pick<AppUserItem, "roleTitle" | "department">
): Promise<void> {
  if (!userId) throw new Error("User lipsa.");

  const roleTitle = toText(values.roleTitle).trim();
  const department = toText(values.department).trim();
  const existingSnap = await getDoc(doc(db, "users", userId));
  const existingData = existingSnap.exists() ? existingSnap.data() : {};
  const fullName = toText(existingData.fullName) || toText(existingData.email) || "Utilizator";

  await updateDoc(doc(db, "users", userId), {
    roleTitle,
    department,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "users",
    eventType: "user_updated",
    entityId: userId,
    title: "Profil de lucru actualizat",
    message: `Datele de lucru pentru ${fullName} au fost actualizate.`,
    directUserId: userId,
    ownerUserId: userId,
    actorUserId: userId,
    actorUserName: fullName,
    actorUserThemeKey: existingData.themeKey ?? null,
    metadata: {
      changesText: [`Functie: ${roleTitle || "-"}`, `Departament: ${department || "-"}`],
      changesCount: 2,
    },
  });
}

export async function updateUserProfile(
  userId: string,
  values: Pick<AppUserItem, "fullName" | "role" | "active"> & Partial<Pick<AppUserItem, "roleTitle" | "department">>
): Promise<void> {
  const existingSnap = await getDoc(doc(db, "users", userId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;
  const previousName = toText(existingData?.fullName);
  const previousRole = existingData?.role ?? "";
  const previousActive = existingData?.active ?? true;
  const changesText = buildAuditChanges(
    existingData as Partial<Pick<AppUserItem, "fullName" | "role" | "roleTitle" | "department" | "active">> | null,
    values,
    userAuditFields
  );

  await updateDoc(doc(db, "users", userId), {
    fullName: values.fullName,
    role: values.role,
    ...(typeof values.roleTitle === "string" ? { roleTitle: values.roleTitle.trim() } : {}),
    ...(typeof values.department === "string" ? { department: values.department.trim() } : {}),
    active: values.active,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  if (auth.currentUser?.uid === userId && auth.currentUser.displayName !== values.fullName) {
    await updateProfile(auth.currentUser, { displayName: values.fullName }).catch((error) => {
      console.warn("[updateUserProfile][auth displayName]", error);
    });
  }

  if (previousName !== values.fullName) {
    await propagateUserName(userId, values.fullName);
  }

  await dispatchNotificationEvent({
    module: "users",
    eventType: "user_updated",
    entityId: userId,
    title: "Profil utilizator actualizat",
    message: `Datele utilizatorului ${values.fullName} au fost actualizate.`,
    directUserId: userId,
    ownerUserId: userId,
    actorUserId: userId,
    actorUserName: values.fullName,
    actorUserThemeKey: existingData?.themeKey ?? null,
    metadata: {
      changesText,
      changesCount: changesText.length,
    },
  });

  if (previousRole !== values.role) {
    await dispatchNotificationEvent({
      module: "users",
      eventType: "user_role_changed",
      entityId: userId,
      title: "Rol utilizator schimbat",
      message: `${values.fullName} are acum rolul ${values.role}.`,
      directUserId: userId,
      ownerUserId: userId,
      actorUserId: userId,
      actorUserName: values.fullName,
      actorUserThemeKey: existingData?.themeKey ?? null,
      metadata: {
        changesText: [`Rol: ${previousRole || "-"} -> ${values.role}`],
        changesCount: 1,
      },
    });
  }

  if (previousActive !== values.active) {
    await dispatchNotificationEvent({
      module: "users",
      eventType: "user_activation_changed",
      entityId: userId,
      title: "Status utilizator modificat",
      message: `${values.fullName} este acum ${values.active ? "activ" : "inactiv"}.`,
      directUserId: userId,
      ownerUserId: userId,
      actorUserId: userId,
      actorUserName: values.fullName,
      actorUserThemeKey: existingData?.themeKey ?? null,
      metadata: {
        changesText: [`Activ: ${previousActive ? "da" : "nu"} -> ${values.active ? "da" : "nu"}`],
        changesCount: 1,
      },
    });
  }
}

export async function deleteUserProfile(userId: string): Promise<void> {
  const snap = await getDoc(doc(db, "users", userId));
  const data = snap.exists() ? snap.data() : null;
  await deleteDoc(doc(db, "users", userId));

  await createAuditLog({
    category: "users",
    action: "user_deleted",
    title: "Utilizator sters",
    message: `Utilizatorul ${data?.fullName || data?.email || userId} a fost sters.`,
    targetUserId: userId,
    targetUserName: data?.fullName || data?.email || userId,
    entityId: userId,
    entityLabel: data?.fullName || data?.email || userId,
    path: "/users",
    pageTitle: "Utilizatori",
  }).catch((error) => console.warn("[audit][user_deleted]", error));
}
