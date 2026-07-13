import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase/firebase";
import type {
  NotificationRuleEventType,
  NotificationRuleModule,
} from "../../../types/notification-rule";

export type DispatchNotificationEventInput = {
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  entityId?: string;

  title: string;
  message: string;
  notificationPath?: string;

  directUserId?: string;
  ownerUserId?: string;

  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
  soundEnabled?: boolean;
  metadata?: Record<string, unknown>;
  companyId?: string;
  idempotencyKey?: string;
};

const NOTIFICATION_RETENTION_COUNT = 10;

export function getNotificationIdsToPrune(ids: string[], keepCount = NOTIFICATION_RETENTION_COUNT) {
  const safeKeepCount = Math.max(1, Math.floor(keepCount));
  return ids.slice(safeKeepCount);
}

export async function pruneNotificationsForUser(
  userId: string,
  keepCount = NOTIFICATION_RETENTION_COUNT
): Promise<number> {
  if (!userId) return 0;

  let deletedCount = 0;
  for (let pass = 0; pass < 10; pass += 1) {
    const snap = await getDocs(
      query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(500)
      )
    );
    const idsToDelete = new Set(
      getNotificationIdsToPrune(
        snap.docs.map((notificationDoc) => notificationDoc.id),
        keepCount
      )
    );
    if (idsToDelete.size === 0) break;

    const batch = writeBatch(db);
    snap.docs.forEach((notificationDoc) => {
      if (idsToDelete.has(notificationDoc.id)) batch.delete(notificationDoc.ref);
    });
    await batch.commit();
    deletedCount += idsToDelete.size;
    if (snap.size < 500) break;
  }

  return deletedCount;
}

function buildDefaultNotificationPath(input: DispatchNotificationEventInput): string {
  if (input.notificationPath?.startsWith("/")) return input.notificationPath;
  if (input.module === "tools" && input.entityId) return `/tools/${input.entityId}`;
  if (input.module === "vehicles" && input.entityId) return `/vehicles/${input.entityId}`;
  if (input.module === "timesheets" && input.entityId) return `/timesheets/${input.entityId}`;
  if (input.module === "users" && input.entityId) return `/users/${input.entityId}/edit`;
  if (input.module === "maintenance" && input.entityId) return `/maintenance/${input.entityId}`;
  if (input.module === "expenses") return "/expenses/scan";
  if (input.module === "projects") return "/projects";
  if (input.module === "leave") return "/my-leave";
  if (input.module === "notifications") return "/notifications";
  if (input.module === "backup" || input.module === "system" || input.module === "web" || input.module === "server") {
    return "/control-panel";
  }
  return "";
}

export async function dispatchNotificationEvent(
  input: DispatchNotificationEventInput
): Promise<void> {
  const callable = httpsCallable<
    DispatchNotificationEventInput,
    { delivered: number; duplicate: boolean }
  >(functions, "dispatchNotificationEvent");
  await callable({ ...input, notificationPath: buildDefaultNotificationPath(input) });
}
