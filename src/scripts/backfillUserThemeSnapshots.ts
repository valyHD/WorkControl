import {
  collection,
  getDocs,
  serverTimestamp,
  writeBatch,
  doc,
} from "firebase/firestore";
import { db } from "../lib/firebase/firebase";

type UserLite = {
  id: string;
  themeKey?: string | null;
  fullName?: string;
};



export async function backfillUserThemeSnapshots() {
  const [usersSnap, toolsSnap, vehiclesSnap, timesheetsSnap, notificationsSnap] =
    await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "tools")),
      getDocs(collection(db, "vehicles")),
      getDocs(collection(db, "timesheets")),
      getDocs(collection(db, "notifications")),
    ]);

  const userMap = new Map<string, UserLite>();

  usersSnap.forEach((item) => {
    const data = item.data();
    userMap.set(item.id, {
      id: item.id,
      themeKey: data.themeKey ?? null,
      fullName: data.fullName ?? "",
    });
  });

  const batch = writeBatch(db);
  let updatedCount = 0;

  toolsSnap.forEach((item) => {
    const data = item.data();
    const owner = userMap.get(data.ownerUserId ?? "");
    const holder = userMap.get(data.currentHolderUserId ?? "");

    const patch: Record<string, any> = {};
    let changed = false;

    if ((data.ownerThemeKey ?? null) !== (owner?.themeKey ?? null)) {
      patch.ownerThemeKey = owner?.themeKey ?? null;
      changed = true;
    }

    if ((data.currentHolderThemeKey ?? null) !== (holder?.themeKey ?? null)) {
      patch.currentHolderThemeKey = holder?.themeKey ?? null;
      changed = true;
    }

    if (changed) {
      patch.updatedAt = Date.now();
      patch.updatedAtServer = serverTimestamp();
      batch.set(doc(db, "tools", item.id), patch, { merge: true });
      updatedCount += 1;
    }
  });

  vehiclesSnap.forEach((item) => {
    const data = item.data();
    const owner = userMap.get(data.ownerUserId ?? "");
    const driver = userMap.get(data.currentDriverUserId ?? "");

    const patch: Record<string, any> = {};
    let changed = false;

    if ((data.ownerThemeKey ?? null) !== (owner?.themeKey ?? null)) {
      patch.ownerThemeKey = owner?.themeKey ?? null;
      changed = true;
    }

    if ((data.currentDriverThemeKey ?? null) !== (driver?.themeKey ?? null)) {
      patch.currentDriverThemeKey = driver?.themeKey ?? null;
      changed = true;
    }

    if (changed) {
      patch.updatedAt = Date.now();
      patch.updatedAtServer = serverTimestamp();
      batch.set(doc(db, "vehicles", item.id), patch, { merge: true });
      updatedCount += 1;
    }
  });

  timesheetsSnap.forEach((item) => {
    const data = item.data();
    const user = userMap.get(data.userId ?? "");

    if ((data.userThemeKey ?? null) !== (user?.themeKey ?? null)) {
      batch.set(
        doc(db, "timesheets", item.id),
        {
          userThemeKey: user?.themeKey ?? null,
          updatedAt: Date.now(),
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      );
      updatedCount += 1;
    }
  });

notificationsSnap.forEach((item) => {
  const data = item.data();
  const targetUser = userMap.get(data.userId ?? "");
  const actorUser = userMap.get(data.actorUserId ?? "");

  const patch: Record<string, any> = {};
  let changed = false;

  if ((data.targetUserThemeKey ?? null) !== (targetUser?.themeKey ?? null)) {
    patch.targetUserThemeKey = targetUser?.themeKey ?? null;
    changed = true;
  }

  if ((data.actorUserThemeKey ?? null) !== (actorUser?.themeKey ?? null)) {
    patch.actorUserThemeKey = actorUser?.themeKey ?? null;
    changed = true;
  }

  if (changed) {
    batch.set(
      doc(db, "notifications", item.id),
      patch,
      { merge: true }
    );
    updatedCount += 1;
  }
});

  await batch.commit();
  console.log(`[backfillUserThemeSnapshots] actualizate: ${updatedCount}`);
  return updatedCount;
}