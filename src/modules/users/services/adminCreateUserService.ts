import {
  createUserWithEmailAndPassword,
  signOut,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase/firebase";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

export async function adminCreateUserWithEmail(params: {
  adminEmail: string;
  adminPassword: string;
  fullName: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "angajat";
  themeKey: string;
}) {
const {
  adminEmail,
  adminPassword,
  fullName,
  email,
  password,
  role,
  themeKey,
} = params;

  const result = await createUserWithEmailAndPassword(auth, email, password);
  const createdUser = result.user;
console.log("SCRIU IN FIRESTORE themeKey =", themeKey);
await setDoc(doc(db, "users", createdUser.uid), {
  uid: createdUser.uid,
  fullName,
  email,
  active: true,
  role,
  themeKey, // 🔥 FOARTE IMPORTANT
  createdAt: Date.now(),
  createdAtServer: serverTimestamp(),
});

  await dispatchNotificationEvent({
    module: "users",
    eventType: "user_created",
    entityId: createdUser.uid,
    title: "Utilizator nou creat",
    message: `A fost creat utilizatorul ${fullName} (${email}).`,
    directUserId: createdUser.uid,
    ownerUserId: createdUser.uid,
    actorUserId: createdUser.uid,
    actorUserName: fullName,
    actorUserThemeKey: themeKey ?? null,
  });

  await signOut(auth);
  await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

  return createdUser.uid;
}