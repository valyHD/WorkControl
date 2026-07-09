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
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase/firebase";
import { pickNextAvailableThemeKey } from "../../../lib/ui/userTheme";
import { createAuditLog } from "../../audit/services/auditLogService";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

export type AppAuthUser = {
  uid: string;
  email: string;
  displayName: string;
  themeKey?: string | null;
  avatarUrl?: string;
  avatarThumbUrl?: string;
  roleTitle?: string;
  department?: string;
  companyIds?: string[];
  companyNames?: string[];
  primaryCompanyId?: string;
  primaryCompanyName?: string;
};

const USER_PRESENCE_HEARTBEAT_MS = 30_000;
const USER_SITE_ENTER_NOTIFICATION_COOLDOWN_MS = 2 * 60 * 1000;

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
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    await setDoc(
      doc(db, "users", currentUser.uid),
      {
        isOnline: false,
        lastSeenAt: Date.now(),
        lastActiveAt: Date.now(),
        lastSeenAtServer: serverTimestamp(),
        lastActiveAtServer: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error("[logoutUser][presence]", error);
    });
  }

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
  avatarUrl: firebaseUser.photoURL || "",
  avatarThumbUrl: firebaseUser.photoURL || "",
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
      avatarUrl: firebaseUser.photoURL || "",
      avatarThumbUrl: firebaseUser.photoURL || "",
      active: true,
      role: "admin",
      themeKey,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      lastActiveAt: Date.now(),
      isOnline: true,
      createdAtServer: serverTimestamp(),
      lastSeenAtServer: serverTimestamp(),
      lastActiveAtServer: serverTimestamp(),
    });

    return;
  }

  const existing = snap.data();
  const nextName =
    overrideName ||
    existing.fullName ||
    firebaseUser.displayName ||
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
      avatarUrl: existing.avatarUrl || firebaseUser.photoURL || "",
      avatarThumbUrl: existing.avatarThumbUrl || existing.avatarUrl || firebaseUser.photoURL || "",
      active: existing.active ?? true,
      role: existing.role ?? "admin",
      themeKey: nextThemeKey,
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
      lastActiveAt: Date.now(),
      isOnline: true,
      updatedAtServer: serverTimestamp(),
      lastSeenAtServer: serverTimestamp(),
      lastActiveAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

async function maybeDispatchSiteEnteredNotification(user: AppAuthUser) {
  const userRef = doc(db, "users", user.uid);
  const now = Date.now();
  let shouldNotify = false;
  let actorName = user.displayName || user.email || "Utilizator";
  let actorThemeKey: string | null = user.themeKey ?? null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists() ? snap.data() : {};
    const lastNotifiedAt = Number(data.lastSiteEnterNotifiedAt || 0);
    actorName = String(data.fullName || actorName);
    actorThemeKey = data.themeKey ?? actorThemeKey ?? null;

    shouldNotify = now - lastNotifiedAt >= USER_SITE_ENTER_NOTIFICATION_COOLDOWN_MS;

    tx.set(
      userRef,
      {
        isOnline: true,
        lastSeenAt: now,
        lastActiveAt: now,
        lastSiteEnteredAt: now,
        ...(shouldNotify ? { lastSiteEnterNotifiedAt: now } : {}),
        lastSeenAtServer: serverTimestamp(),
        lastActiveAtServer: serverTimestamp(),
        lastSiteEnteredAtServer: serverTimestamp(),
      },
      { merge: true }
    );
  });

  await createAuditLog({
    category: "auth",
    action: "site_entered",
    title: "Intrare pe site",
    message: `${actorName} a intrat pe site.`,
    actorUserId: user.uid,
    actorUserName: actorName,
    actorUserThemeKey: actorThemeKey,
    targetUserId: user.uid,
    targetUserName: actorName,
    targetUserThemeKey: actorThemeKey,
    path: "/dashboard",
    pageTitle: "WorkControl",
  }).catch((error) => {
    console.warn("[audit][site_entered]", error);
  });

  if (!shouldNotify) return;

  await dispatchNotificationEvent({
    module: "users",
    eventType: "user_site_entered",
    entityId: user.uid,
    title: "Utilizator pe site",
    message: `${actorName} a intrat pe site.`,
    notificationPath: "/users",
    directUserId: user.uid,
    ownerUserId: user.uid,
    actorUserId: user.uid,
    actorUserName: actorName,
    actorUserThemeKey: actorThemeKey,
  }).catch((error) => {
    console.error("[presence][siteEnteredNotification]", error);
  });
}

export function startUserPresence(user: AppAuthUser): () => void {
  if (!user?.uid) return () => undefined;

  let stopped = false;
  let heartbeatTimer: number | undefined;
  const userRef = doc(db, "users", user.uid);

  const writePresence = async (online = true) => {
    if (!user.uid) return;
    const now = Date.now();

    await setDoc(
      userRef,
      {
        isOnline: online,
        lastSeenAt: now,
        lastActiveAt: now,
        lastSeenAtServer: serverTimestamp(),
        lastActiveAtServer: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error("[presence][write]", error);
    });
  };

  const scheduleHeartbeat = () => {
    if (stopped) return;
    heartbeatTimer = window.setTimeout(() => {
      void writePresence(true).finally(scheduleHeartbeat);
    }, USER_PRESENCE_HEARTBEAT_MS);
  };

  const handleActivity = () => {
    if (stopped) return;
    void writePresence(true);
  };

  const handleVisibilityChange = () => {
    if (stopped) return;
    void writePresence(document.visibilityState === "visible");
  };

  const handlePageHide = () => {
    if (stopped) return;
    void writePresence(false);
  };

  void maybeDispatchSiteEnteredNotification(user).finally(() => {
    if (!stopped) scheduleHeartbeat();
  });

  window.addEventListener("focus", handleActivity);
  window.addEventListener("online", handleActivity);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);

  return () => {
    stopped = true;
    if (typeof heartbeatTimer === "number") {
      window.clearTimeout(heartbeatTimer);
    }
    window.removeEventListener("focus", handleActivity);
    window.removeEventListener("online", handleActivity);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    void writePresence(false);
  };
}
