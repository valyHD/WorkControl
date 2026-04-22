import { useEffect, useRef } from "react";
import { onMessage } from "firebase/messaging";
import { getMessagingClient } from "../firebase/messaging";

type PushMessagePayload = {
  data?: {
    title?: string;
    body?: string;
    message?: string;
    path?: string;
    notificationId?: string;
  };
  notification?: {
    title?: string;
    body?: string;
  };
};

async function getNotificationRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;

  try {
    return await navigator.serviceWorker.register("/notification-sw.js");
  } catch (error) {
    console.error("[Push][foreground] Nu s-a putut inregistra service worker-ul:", error);
    return null;
  }
}

function shouldSkipDuplicate(notificationId?: string, fallbackKey?: string): boolean {
  if (typeof window === "undefined") return false;

  const dedupeKey = notificationId || fallbackKey;
  if (!dedupeKey) return false;

  const storageKey = `wc_push_seen_${dedupeKey}`;
  const now = Date.now();
  const ttlMs = 10_000;

  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const ts = Number(raw);
      if (Number.isFinite(ts) && now - ts < ttlMs) {
        return true;
      }
    }
    sessionStorage.setItem(storageKey, String(now));
  } catch {
    // no-op
  }

  return false;
}

async function showForegroundNotification(payload: PushMessagePayload): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = payload.notification?.title || payload.data?.title || "Notificare WorkControl";
  const body = payload.notification?.body || payload.data?.body || payload.data?.message || "";
  const path = payload.data?.path || "/notifications";
  const notificationId = payload.data?.notificationId;

  if (shouldSkipDuplicate(notificationId, `${title}|${body}|${path}`)) {
    return;
  }

  const registration = await getNotificationRegistration();
  if (registration) {
    await registration.showNotification(title, {
      body,
      data: { path },
      tag: notificationId || undefined,
    });
    return;
  }

  new Notification(title, { body, tag: notificationId || undefined });
}

export function usePushForegroundNotifications(enabled: boolean): void {
  const unsubscribeRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (!enabled) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      const messaging = await getMessagingClient();
      if (!messaging || cancelled) return;

      unsubscribeRef.current?.();
      unsubscribeRef.current = onMessage(messaging, (payload) => {
        void showForegroundNotification(payload as PushMessagePayload);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [enabled]);
}