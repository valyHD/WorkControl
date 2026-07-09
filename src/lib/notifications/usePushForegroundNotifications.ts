import { useEffect, useRef } from "react";
import { onMessage } from "firebase/messaging";
import { getMessagingClient } from "../firebase/messaging";
import { showBrowserNotification } from "./showNotification";

type PushMessagePayload = {
  data?: {
    title?: string;
    body?: string;
    message?: string;
    path?: string;
    notificationId?: string;
    soundEnabled?: string;
  };
  notification?: {
    title?: string;
    body?: string;
  };
};

function shouldSkipDuplicate(notificationId?: string, fallbackKey?: string): boolean {
  if (typeof window === "undefined") return false;

  const dedupeKey = notificationId || fallbackKey;
  if (!dedupeKey) return false;

  const storageKey = `wc_push_seen_${dedupeKey}`;
  const now = Date.now();
  const ttlMs = 60_000;

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const ts = Number(raw);
      if (Number.isFinite(ts) && now - ts < ttlMs) {
        return true;
      }
    }
    localStorage.setItem(storageKey, String(now));
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

  await showBrowserNotification(title, body, path, {
    sound: payload.data?.soundEnabled !== "false",
    tag: `workcontrol-${notificationId || `${title}|${body}|${path}`}`,
    notificationId,
  });
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
