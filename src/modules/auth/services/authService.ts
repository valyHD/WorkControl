import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase/firebase";
import { createAuditLog } from "../../audit/services/auditLogService";
import {
  evaluateInternalAccessProfile,
  InternalAccessError,
} from "./internalAccessPolicy";

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
  role?: "admin" | "manager" | "angajat";
  active?: boolean;
  globalAdmin?: boolean;
};

const USER_PRESENCE_HEARTBEAT_MS = 30_000;

export async function loginWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  const profileSnap = await getDoc(doc(db, "users", result.user.uid));
  const decision = evaluateInternalAccessProfile(
    profileSnap.exists() ? profileSnap.data() : null
  );
  if (!decision.allowed) {
    await signOut(auth);
    throw new InternalAccessError(decision);
  }
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

    const profileSnap = await getDoc(doc(db, "users", firebaseUser.uid));
    const profile = profileSnap.exists() ? profileSnap.data() : null;
    const decision = evaluateInternalAccessProfile(profile);
    if (!decision.allowed || !profile) {
      await signOut(auth).catch(() => undefined);
      callback(null);
      return;
    }

    callback({
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? String(profile.email ?? ""),
      displayName:
        String(profile.fullName ?? "") ||
        firebaseUser.displayName ||
        firebaseUser.email ||
        "Utilizator",
      avatarUrl: String(profile.avatarUrl ?? firebaseUser.photoURL ?? ""),
      avatarThumbUrl: String(
        profile.avatarThumbUrl ?? profile.avatarUrl ?? firebaseUser.photoURL ?? ""
      ),
      themeKey: typeof profile.themeKey === "string" ? profile.themeKey : null,
      roleTitle: String(profile.roleTitle ?? ""),
      department: String(profile.department ?? ""),
      companyIds: Array.isArray(profile.companyIds)
        ? profile.companyIds.filter((value): value is string => typeof value === "string")
        : [],
      companyNames: Array.isArray(profile.companyNames)
        ? profile.companyNames.filter((value): value is string => typeof value === "string")
        : [],
      primaryCompanyId: String(profile.primaryCompanyId ?? ""),
      primaryCompanyName: String(profile.primaryCompanyName ?? ""),
      role: profile.role as AppAuthUser["role"],
      active: true,
      globalAdmin: profile.globalAdmin === true,
    });
  });
}

async function recordSiteEntry(user: AppAuthUser) {
  const userRef = doc(db, "users", user.uid);
  const now = Date.now();
  const actorName = user.displayName || user.email || "Utilizator";
  const actorThemeKey: string | null = user.themeKey ?? null;

  await setDoc(
    userRef,
    {
      isOnline: true,
      lastSeenAt: now,
      lastActiveAt: now,
      lastSiteEnteredAt: now,
      lastSeenAtServer: serverTimestamp(),
      lastActiveAtServer: serverTimestamp(),
      lastSiteEnteredAtServer: serverTimestamp(),
    },
    { merge: true }
  );

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

  void recordSiteEntry(user).finally(() => {
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
