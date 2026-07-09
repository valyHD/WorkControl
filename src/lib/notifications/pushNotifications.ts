import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getToken } from "firebase/messaging";
import { db } from "../firebase/firebase";
import { getMessagingClient } from "../firebase/messaging";

export type PushActivationResult = {
  ok: boolean;
  reason:
    | "ok"
    | "unsupported"
    | "ios_requires_install"
    | "permission_denied"
    | "missing_vapid"
    | "missing_service_worker"
    | "token_error";
  token?: string;
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const PUSH_INSTALLATION_STORAGE_KEY = "workcontrol:push-installation-id";

export function hasPushVapidKey(): boolean {
  return Boolean(VAPID_KEY && VAPID_KEY.trim());
}

async function getNotificationServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const existing = registrations.find((registration) =>
    [registration.active, registration.waiting, registration.installing].some((worker) => {
      if (!worker?.scriptURL) return false;
      try {
        return new URL(worker.scriptURL).pathname.endsWith("/notification-sw.js");
      } catch {
        return worker.scriptURL.endsWith("/notification-sw.js");
      }
    })
  );
  if (existing) {
    await existing.update().catch(() => undefined);
    return existing;
  }

  const registration = await navigator.serviceWorker.register("/notification-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await registration.update().catch(() => undefined);
  return registration;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function makeClientId(): string {
  const randomValue =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return randomValue.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getPushInstallationId(): string {
  if (typeof window === "undefined") return makeClientId();

  try {
    const existing = window.localStorage.getItem(PUSH_INSTALLATION_STORAGE_KEY);
    if (existing) return existing;

    const next = makeClientId();
    window.localStorage.setItem(PUSH_INSTALLATION_STORAGE_KEY, next);
    return next;
  } catch {
    return makeClientId();
  }
}

function toSafeDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

async function saveTokenForUser(userId: string, token: string): Promise<void> {
  const tokensRef = collection(db, "pushTokens");
  const installationId = getPushInstallationId();
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "unknown";
  const tokenDocId = `${toSafeDocId(userId)}_${toSafeDocId(installationId)}`;
  const existing = await getDocs(query(tokensRef, where("userId", "==", userId)));
  const staleDocs = existing.docs.filter((item) => {
    return item.id !== tokenDocId;
  });

  await Promise.all(staleDocs.map((item) => deleteDoc(item.ref)));

  await setDoc(doc(tokensRef, tokenDocId), {
    userId,
    token,
    installationId,
    userAgent,
    platform,
    lastSeenAt: Date.now(),
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  }, { merge: true });
}


export async function hasUserPushToken(userId: string): Promise<boolean> {
  if (!userId) return false;

  const snap = await getDocs(
    query(collection(db, "pushTokens"), where("userId", "==", userId), limit(1))
  );

  return !snap.empty;
}

export async function activatePushNotifications(userId: string): Promise<PushActivationResult> {
  if (isIosDevice() && !isStandaloneApp()) {
    return { ok: false, reason: "ios_requires_install" };
  }

  if (typeof window === "undefined" || !("Notification" in window)) {
    return { ok: false, reason: "unsupported" };
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: "permission_denied" };
    }
  }

  if (Notification.permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  if (!hasPushVapidKey()) {
    return { ok: false, reason: "missing_vapid" };
  }

  const messaging = await getMessagingClient();
  if (!messaging) {
    return { ok: false, reason: "unsupported" };
  }

  const swRegistration = await getNotificationServiceWorkerRegistration();
  if (!swRegistration) {
    return { ok: false, reason: "missing_service_worker" };
  }

  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY!,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      return { ok: false, reason: "token_error" };
    }

    await saveTokenForUser(userId, token);

    return {
      ok: true,
      reason: "ok",
      token,
    };
  } catch (error) {
    console.error("[Push] Nu s-a putut obtine token-ul:", error);
    return { ok: false, reason: "token_error" };
  }
}

export async function syncPushTokenIfGranted(userId: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (isIosDevice() && !isStandaloneApp()) return;
  if (Notification.permission !== "granted") return;

  await activatePushNotifications(userId);
}
