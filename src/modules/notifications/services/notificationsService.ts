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
import { createAuditLog } from "../../audit/services/auditLogService";

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
};

type AppUserLite = {
  id: string;
  fullName?: string;
  email?: string;
  role?: string;
  active?: boolean;
  themeKey?: string | null;
};

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

async function getMatchingRules(
  module: NotificationRuleModule,
  eventType: NotificationRuleEventType,
  inputEntityId?: string
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
      entityId: data.entityId ?? "",
      entityLabel: data.entityLabel ?? "",
      enabled: data.enabled ?? true,
      scheduleTime: data.scheduleTime ?? "08:30",
      stopTime: data.stopTime ?? "17:00",
      weekdays: Array.isArray(data.weekdays) && data.weekdays.length > 0 ? data.weekdays : [1, 2, 3, 4, 5],
      reminderDelayHours: Number(data.reminderDelayHours ?? 8),
      reminderRepeatMinutes: Math.max(5, Math.min(720, Number(data.reminderRepeatMinutes ?? 60))),
      reminderActiveMinutes: Math.max(0, Math.min(1440, Number(data.reminderActiveMinutes ?? 120))),
      soundEnabled: data.soundEnabled ?? true,
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
    const entityMatches =
      !rule.entityId || !inputEntityId || rule.entityId === inputEntityId;
    return moduleMatches && eventMatches && entityMatches;
  });
}

async function getAllUsersLite(): Promise<AppUserLite[]> {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((docItem) => ({
    id: docItem.id,
    fullName: docItem.data().fullName ?? "",
    email: docItem.data().email ?? "",
    role: docItem.data().role ?? "",
    active: docItem.data().active ?? true,
    themeKey: docItem.data().themeKey ?? null,
  }));
}

async function createNotificationForUser(params: {
  userId: string;
  targetUserThemeKey?: string | null;
  targetUserName?: string;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
  title: string;
  message: string;
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  entityId?: string;
  notificationPath?: string;
  soundEnabled?: boolean;
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
    eventType: params.eventType,
    entityId: params.entityId ?? "",
    notificationPath: params.notificationPath ?? "",
    soundEnabled: params.soundEnabled ?? true,
    read: false,
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  });

  await createAuditLog({
    category: "notifications",
    action: "notification_delivered",
    title: "Notificare primita",
    message: `${params.targetUserName || params.userId} a primit notificarea: ${params.title}.`,
    actorUserId: params.actorUserId ?? "",
    actorUserName: params.actorUserName || "WorkControl",
    actorUserThemeKey: params.actorUserThemeKey ?? null,
    targetUserId: params.userId,
    targetUserName: params.targetUserName || params.userId,
    targetUserThemeKey: params.targetUserThemeKey ?? null,
    entityId: params.entityId ?? "",
    entityLabel: params.title,
    path: params.notificationPath ?? "",
    pageTitle: "Notificari",
    metadata: {
      module: params.module,
      eventType: params.eventType,
      soundEnabled: params.soundEnabled ?? true,
    },
  }).catch((error) => console.warn("[audit][notification_delivered]", error));
}

export async function dispatchNotificationEvent(
  input: DispatchNotificationEventInput
): Promise<void> {
  const notificationPath = buildDefaultNotificationPath(input);

  await createAuditLog({
    category: input.module,
    action: input.eventType,
    title: input.title,
    message: input.message,
    actorUserId: input.actorUserId ?? "",
    actorUserName: input.actorUserName || "WorkControl",
    actorUserThemeKey: input.actorUserThemeKey ?? null,
    targetUserId: input.directUserId || input.ownerUserId || "",
    entityId: input.entityId ?? "",
    entityLabel: input.title,
    path: notificationPath,
    pageTitle: input.module,
    metadata: {
      directUserId: input.directUserId ?? "",
      ownerUserId: input.ownerUserId ?? "",
      module: input.module,
      eventType: input.eventType,
      ...(input.metadata ?? {}),
    },
  }).catch((error) => console.warn("[audit][event]", error));

  const rules = await getMatchingRules(input.module, input.eventType, input.entityId);
  if (rules.length === 0) return;

  const users = await getAllUsersLite();
  const recipientsSet = new Set<string>();
  const soundEnabled = input.soundEnabled ?? rules.some((rule) => rule.soundEnabled !== false);

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
  if (userIds.length === 0) return;

  await Promise.all(
    userIds.map((userId) => {
      const targetUser = users.find((u) => u.id === userId);

      return createNotificationForUser({
        userId,
        targetUserThemeKey: targetUser?.themeKey ?? null,
        targetUserName: targetUser?.fullName || targetUser?.email || userId,
        actorUserId: input.actorUserId ?? "",
        actorUserName: input.actorUserName ?? "",
        actorUserThemeKey: input.actorUserThemeKey ?? null,
        title: input.title,
        message: input.message,
        module: input.module,
        eventType: input.eventType,
        entityId: input.entityId,
        notificationPath,
        soundEnabled,
      });
    })
  );
}
