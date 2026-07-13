import { useEffect, useRef } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

export function useNotificationsListener(userId: string | undefined) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      where("read", "==", false),
      orderBy("createdAt", "desc"),
      limit(10)
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
            // Push notifications are dispatched by the backend. Showing another
            // local notification here produces duplicates when the app is open.
            return;
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
