import { useEffect, useRef } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { showBrowserNotification } from "./showNotification";
import { resolveNotificationPath } from "./notificationNavigation";

export function useNotificationsListener(userId: string | undefined) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      where("read", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!initializedRef.current) {
          initializedRef.current = true;
          return;
        }

        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            const data = change.doc.data();
            void showBrowserNotification(
              data.title ?? "Notificare",
              data.message ?? "",
              resolveNotificationPath({
                module: data.module,
                eventType: data.eventType,
                entityId: data.entityId,
              })
            );
          }
        });
      },
      (error) => {
        console.error("Eroare listener notificari:", error);
      }
    );

    return () => unsub();
  }, [userId]);
}
