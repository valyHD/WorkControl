import { getApp } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

let messagingInstance: Promise<Messaging | null> | null = null;

export function getMessagingClient(): Promise<Messaging | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  if (!messagingInstance) {
    messagingInstance = isSupported()
      .then((supported) => {
        if (!supported) return null;
        return getMessaging(getApp());
      })
      .catch((error) => {
        console.error("[Push] Firebase Messaging indisponibil:", error);
        return null;
      });
  }

  return messagingInstance;
}
