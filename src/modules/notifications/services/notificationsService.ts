import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type {
  NotificationRuleEventType,
  NotificationRuleModule,
  NotificationRuleItem,
} from "../../../types/notification-rule";

export type DispatchNotificationEventInput = {
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  entityId?: string;

  title: string;
  message: string;

  directUserId?: string;
  ownerUserId?: string;

  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

type AppUserLite = {
  id: string;
  role?: string;
  active?: boolean;
  themeKey?: string | null;
};

async function getMatchingRules(
  module: NotificationRuleModule,
  eventType: NotificationRuleEventType
): Promise<NotificationRuleItem[]> {
  const snap = await getDocs(
    query(collection(db, "notificationRules"), where("enabled", "==", true))
  );

  return snap.docs.map((docItem) => {
    const data = docItem.data();

    return {
      id: docItem.id,
      name: data.name ?? "",
      module: data.module ?? "general",
      eventType: data.eventType ?? "user_created",
      enabled: data.enabled ?? true,
      recipients: {
        notifyDirectUser: data.recipients?.notifyDirectUser ?? false,
        notifyOwner: data.recipients?.notifyOwner ?? false,
        notifyAdmins: data.recipients?.notifyAdmins ?? false,
        notifyManagers: data.recipients?.notifyManagers ?? false,
        specificUserIds: Array.isArray(data.recipients?.specificUserIds)
          ? data.recipients.specificUserIds
          : [],
      },
      createdAt: data.createdAt ?? Date.now(),
      updatedAt: data.updatedAt ?? Date.now(),
    };
  }).filter((rule) => {
    const moduleMatches =
      rule.module === module || rule.module === "general" || rule.module === "system";
    const eventMatches =
      rule.eventType === eventType || rule.eventType === "any_change";
    return moduleMatches && eventMatches;
  });
}

async function getAllUsersLite(): Promise<AppUserLite[]> {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((docItem) => ({
    id: docItem.id,
    role: docItem.data().role ?? "",
    active: docItem.data().active ?? true,
    themeKey: docItem.data().themeKey ?? null,
  }));
}

async function createNotificationForUser(params: {
  userId: string;
  targetUserThemeKey?: string | null;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
  title: string;
  message: string;
  module: NotificationRuleModule;
  entityId?: string;
}) {
  if (!params.userId) return;

  await addDoc(collection(db, "notifications"), {
    userId: params.userId,
    targetUserThemeKey: params.targetUserThemeKey ?? null,
    actorUserId: params.actorUserId ?? "",
    actorUserName: params.actorUserName ?? "",
    actorUserThemeKey: params.actorUserThemeKey ?? null,
    title: params.title,
    message: params.message,
    module: params.module,
    entityId: params.entityId ?? "",
    read: false,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });
}

export async function dispatchNotificationEvent(
  input: DispatchNotificationEventInput
): Promise<void> {
  const rules = await getMatchingRules(input.module, input.eventType);
  if (rules.length === 0) return;

  const users = await getAllUsersLite();
  const recipientsSet = new Set<string>();

  for (const rule of rules) {
    if (rule.recipients.notifyDirectUser && input.directUserId) {
      recipientsSet.add(input.directUserId);
    }

    if (rule.recipients.notifyOwner && input.ownerUserId) {
      recipientsSet.add(input.ownerUserId);
    }

    if (rule.recipients.notifyAdmins) {
      users
        .filter((user) => user.active !== false && user.role === "admin")
        .forEach((user) => recipientsSet.add(user.id));
    }

    if (rule.recipients.notifyManagers) {
      users
        .filter((user) => user.active !== false && user.role === "manager")
        .forEach((user) => recipientsSet.add(user.id));
    }

    rule.recipients.specificUserIds.forEach((userId) => {
      if (userId) recipientsSet.add(userId);
    });
  }

  const userIds = Array.from(recipientsSet);

  await Promise.all(
    userIds.map((userId) => {
      const targetUser = users.find((u) => u.id === userId);

      return createNotificationForUser({
        userId,
        targetUserThemeKey: targetUser?.themeKey ?? null,
        actorUserId: input.actorUserId ?? "",
        actorUserName: input.actorUserName ?? "",
        actorUserThemeKey: input.actorUserThemeKey ?? null,
        title: input.title,
        message: input.message,
        module: input.module,
        entityId: input.entityId,
      });
    })
  );
}
