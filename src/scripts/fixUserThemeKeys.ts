import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase/firebase";

const USER_THEME_KEYS = [
  "u1",
  "u2",
  "u3",
  "u4",
  "u5",
  "u6",
  "u7",
  "u8",
  "u9",
  "u10",
  "u11",
  "u12",
];

function normalizeThemeKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function pickNextAvailableThemeKey(usedKeys: string[]) {
  const normalizedUsed = usedKeys
    .map(normalizeThemeKey)
    .filter(Boolean);

  for (const key of USER_THEME_KEYS) {
    if (!normalizedUsed.includes(key)) {
      return key;
    }
  }

  // daca se termina lista, reia ciclic
  const index = normalizedUsed.length % USER_THEME_KEYS.length;
  return USER_THEME_KEYS[index];
}

export async function fixMissingUserThemeKeys() {
  const snapshot = await getDocs(collection(db, "users"));

  const docs = snapshot.docs;

  const usedThemeKeys = docs
    .map((item) => normalizeThemeKey(item.data()?.themeKey))
    .filter(Boolean);

  const batch = writeBatch(db);
  let updatedCount = 0;

  for (const item of docs) {
    const data = item.data();
    const currentThemeKey = normalizeThemeKey(data?.themeKey);

    if (currentThemeKey) {
      continue;
    }

    const nextThemeKey = pickNextAvailableThemeKey(usedThemeKeys);
    usedThemeKeys.push(nextThemeKey);

    batch.set(
      doc(db, "users", item.id),
      {
        themeKey: nextThemeKey,
        updatedAt: Date.now(),
        updatedAtServer: serverTimestamp(),
      },
      { merge: true }
    );

    updatedCount += 1;
  }

  if (updatedCount === 0) {
    console.log("[fixMissingUserThemeKeys] Niciun user fara themeKey.");
    return 0;
  }

  await batch.commit();
  console.log(`[fixMissingUserThemeKeys] Am actualizat ${updatedCount} useri.`);
  return updatedCount;
}