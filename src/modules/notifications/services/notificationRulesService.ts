import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type {
  NotificationRuleFormValues,
  NotificationRuleItem,
} from "../../../types/notification-rule";
import { dispatchNotificationEvent } from "./notificationsService";

const notificationRulesCollection = collection(db, "notificationRules");

function mapRuleDoc(id: string, data: Record<string, any>): NotificationRuleItem {
  return {
    id,
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
}

export async function getNotificationRules(): Promise<NotificationRuleItem[]> {
  const snap = await getDocs(
    query(notificationRulesCollection, orderBy("updatedAt", "desc"), limit(100))
  );
  return snap.docs.map((docItem) => mapRuleDoc(docItem.id, docItem.data()));
}

export function subscribeNotificationRules(
  onData: (rules: NotificationRuleItem[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const rulesQuery = query(notificationRulesCollection, orderBy("updatedAt", "desc"), limit(100));
  return onSnapshot(
    rulesQuery,
    (snap) => {
      onData(snap.docs.map((docItem) => mapRuleDoc(docItem.id, docItem.data())));
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function getNotificationRuleById(
  ruleId: string
): Promise<NotificationRuleItem | null> {
  const snap = await getDoc(doc(db, "notificationRules", ruleId));
  if (!snap.exists()) return null;
  return mapRuleDoc(snap.id, snap.data());
}

export async function createNotificationRule(
  values: NotificationRuleFormValues
): Promise<string> {
  const now = Date.now();

  const refDoc = await addDoc(notificationRulesCollection, {
    ...values,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "notifications",
    eventType: "notification_rule_created",
    entityId: refDoc.id,
    title: "Regulă notificări creată",
    message: `Regula "${values.name}" a fost creată.`,
    notificationPath: "/notification-rules",
  });

  return refDoc.id;
}

export async function updateNotificationRule(
  ruleId: string,
  values: NotificationRuleFormValues
): Promise<void> {
  await updateDoc(doc(db, "notificationRules", ruleId), {
    ...values,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "notifications",
    eventType: "notification_rule_updated",
    entityId: ruleId,
    title: "Regulă notificări actualizată",
    message: `Regula "${values.name}" a fost actualizată.`,
    notificationPath: "/notification-rules",
  });
}

export async function deleteNotificationRule(rule: NotificationRuleItem): Promise<void> {
  await deleteDoc(doc(db, "notificationRules", rule.id));

  await dispatchNotificationEvent({
    module: "notifications",
    eventType: "notification_rule_deleted",
    entityId: rule.id,
    title: "Regula notificari stearsa",
    message: `Regula "${rule.name}" a fost stearsa.`,
    notificationPath: "/notification-rules",
  });
}
