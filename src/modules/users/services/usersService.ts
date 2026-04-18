import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { AppUserItem } from "../../../types/user";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const usersCollection = collection(db, "users");
function mapUserDoc(id: string, data: Record<string, any>): AppUserItem {
  return {
    id,
    uid: data.uid ?? id,
    fullName: data.fullName ?? "",
    email: data.email ?? "",
    active: data.active ?? true,
    role: data.role ?? "angajat",
    themeKey: data.themeKey ?? undefined,
    createdAt: data.createdAt ?? undefined,
    updatedAt: data.updatedAt ?? undefined,
  };
}

export async function getAllUsers(): Promise<AppUserItem[]> {
  const snap = await getDocs(query(usersCollection, orderBy("fullName", "asc")));
  return snap.docs.map((docItem) => mapUserDoc(docItem.id, docItem.data()));
}

export async function getUserById(userId: string): Promise<AppUserItem | null> {
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return null;
  return mapUserDoc(snap.id, snap.data());
}

export async function updateUserProfile(
  userId: string,
  values: Pick<AppUserItem, "fullName" | "role" | "active">
): Promise<void> {
  const existingSnap = await getDoc(doc(db, "users", userId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;
  const previousRole = existingData?.role ?? "";
  const previousActive = existingData?.active ?? true;

  await updateDoc(doc(db, "users", userId), {
    fullName: values.fullName,
    role: values.role,
    active: values.active,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });


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
    });
  }
}