import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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

const notificationRulesCollection = collection(db, "notificationRules");

function mapRuleDoc(id: string, data: Record<string, any>): NotificationRuleItem {
  return {
    id,
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
}

export async function getNotificationRules(): Promise<NotificationRuleItem[]> {
  const snap = await getDocs(query(notificationRulesCollection, orderBy("updatedAt", "desc")));
  return snap.docs.map((docItem) => mapRuleDoc(docItem.id, docItem.data()));
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
}