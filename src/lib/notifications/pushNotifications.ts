import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
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
    | "permission_denied"
    | "missing_vapid"
    | "missing_service_worker"
    | "token_error";
  token?: string;
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export function hasPushVapidKey(): boolean {
  return Boolean(VAPID_KEY && VAPID_KEY.trim());
}

async function getNotificationServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;

  return navigator.serviceWorker.register("/notification-sw.js");
}

async function saveTokenForUser(userId: string, token: string): Promise<void> {
  const tokensRef = collection(db, "pushTokens");

  const existing = await getDocs(
    query(tokensRef, where("userId", "==", userId), where("token", "==", token))
  );

  if (!existing.empty) return;

  await addDoc(tokensRef, {
    userId,
    token,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}

export async function activatePushNotifications(userId: string): Promise<PushActivationResult> {
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
  if (Notification.permission !== "granted") return;

  await activatePushNotifications(userId);
}
