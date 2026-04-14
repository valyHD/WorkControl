import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase/firebase";
import { pickNextAvailableThemeKey } from "../../../lib/ui/userTheme";

export type AppAuthUser = {
  uid: string;
  email: string;
  displayName: string;
  themeKey?: string | null;
};

async function getNextUserThemeKey() {
  const snapshot = await getDocs(collection(db, "users"));
  const usedThemeKeys = snapshot.docs.map((docItem) => docItem.data()?.themeKey);
  return pickNextAvailableThemeKey(usedThemeKeys);
}

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(
  fullName: string,
  email: string,
  password: string
) {
  const result = await createUserWithEmailAndPassword(auth, email, password);

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, {
      displayName: fullName,
    });
  }

  await ensureUserDocument(result.user, fullName);
  return result;
}

export async function logoutUser() {
  await signOut(auth);
}

export function observeAuth(callback: (user: AppAuthUser | null) => void) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }

    await ensureUserDocument(firebaseUser);

callback({
  uid: firebaseUser.uid,
  email: firebaseUser.email ?? "",
  displayName:
    firebaseUser.displayName ||
    firebaseUser.email ||
    "Utilizator",
  themeKey: null,
});
  });
}

export async function ensureUserDocument(
  firebaseUser: User,
  overrideName?: string
) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const themeKey = await getNextUserThemeKey();

    await setDoc(userRef, {
      uid: firebaseUser.uid,
      fullName:
        overrideName ||
        firebaseUser.displayName ||
        firebaseUser.email ||
        "Utilizator",
      email: firebaseUser.email ?? "",
      active: true,
      role: "admin",
      themeKey,
      createdAt: Date.now(),
      createdAtServer: serverTimestamp(),
    });

    return;
  }

  const existing = snap.data();
  const nextName =
    overrideName ||
    firebaseUser.displayName ||
    existing.fullName ||
    firebaseUser.email ||
    "Utilizator";

  const nextThemeKey =
    existing.themeKey && String(existing.themeKey).trim()
      ? existing.themeKey
      : await getNextUserThemeKey();

  await setDoc(
    userRef,
    {
      uid: firebaseUser.uid,
      fullName: nextName,
      email: firebaseUser.email ?? existing.email ?? "",
      active: existing.active ?? true,
      role: existing.role ?? "admin",
      themeKey: nextThemeKey,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}