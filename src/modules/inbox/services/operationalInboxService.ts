import { collection, doc, getDocs, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";

export type OperationalInboxItem = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module: string;
  eventType: string;
  entityId: string;
  notificationPath: string;
  priority: "critical" | "action" | "info";
  score: number;
};

export function classifyInboxPriority(input: Pick<OperationalInboxItem, "title" | "message" | "module" | "eventType" | "read" | "createdAt">) {
  const text = `${input.module} ${input.eventType} ${input.title} ${input.message}`.toLowerCase();
  const critical = /critic|urgent|securitate|eroare|error|expirat|avariat|pierdut/.test(text);
  const actionable = /aproba|verifica|lipseste|neinchis|interventie|comanda|revizie|pontaj/.test(text);
  const ageHours = Math.max(0, (Date.now() - input.createdAt) / 3_600_000);
  const score = (critical ? 100 : actionable ? 60 : 20) + (input.read ? 0 : 25) - Math.min(20, ageHours / 12);
  return { priority: critical ? "critical" : actionable ? "action" : "info", score } as const;
}

export async function getOperationalInbox(userId: string, maxItems = 25) {
  const snap = await getDocs(query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(Math.max(1, Math.min(50, maxItems)))
  ));
  return snap.docs.map((item) => {
    const data = item.data();
    const base = {
      id: item.id,
      title: String(data.title || "Notificare"),
      message: String(data.message || ""),
      read: Boolean(data.read),
      createdAt: Number(data.createdAt || Date.now()),
      module: String(data.module || "general"),
      eventType: String(data.eventType || ""),
      entityId: String(data.entityId || ""),
      notificationPath: String(data.notificationPath || ""),
    };
    return { ...base, ...classifyInboxPriority(base) } satisfies OperationalInboxItem;
  }).sort((left, right) => right.score - left.score);
}

export async function markOperationalInboxItemRead(id: string) {
  await updateDoc(doc(db, "notifications", id), { read: true });
}
