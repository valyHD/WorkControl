import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { AuditLogCategory, AuditLogInput, AuditLogItem } from "../../../types/audit";

const auditLogsCollection = collection(db, "auditLogs");
const PAGE_VIEW_THROTTLE_MS = 12_000;
const pageViewMemory = new Map<string, number>();

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object") {
    const maybeTimestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTimestamp.toMillis === "function") return maybeTimestamp.toMillis();
    if (typeof maybeTimestamp.seconds === "number") return maybeTimestamp.seconds * 1000;
  }
  return Date.now();
}

function normalizeCategory(value: unknown): AuditLogCategory {
  const safe = toText(value, "general") as AuditLogCategory;
  const allowed: AuditLogCategory[] = [
    "auth",
    "navigation",
    "users",
    "tools",
    "vehicles",
    "timesheets",
    "leave",
    "projects",
    "notifications",
    "maintenance",
    "expenses",
    "backup",
    "system",
    "web",
    "server",
    "general",
  ];
  return allowed.includes(safe) ? safe : "general";
}

function cleanMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};

  Object.entries(metadata).slice(0, 30).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      result[key] = value.slice(0, 500);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) => String(item).slice(0, 160));
      return;
    }
    result[key] = JSON.stringify(value).slice(0, 500);
  });

  return result;
}

function shouldSkipAudit(input: AuditLogInput): boolean {
  const haystack = [
    input.category,
    input.action,
    input.title,
    input.message,
    input.entityLabel,
    JSON.stringify(input.metadata || {}),
  ].join(" ").toLowerCase();

  return haystack.includes("gpssim") || haystack.includes("gps_sim") || haystack.includes("test gps");
}

function buildSearchableText(input: AuditLogInput, metadata: Record<string, unknown>): string {
  return [
    input.category,
    input.action,
    input.title,
    input.message,
    input.actorUserName,
    input.targetUserName,
    input.entityLabel,
    input.entityId,
    input.path,
    input.pageTitle,
    ...Object.values(metadata).map((value) => String(value)),
  ]
    .join(" ")
    .toLowerCase()
    .slice(0, 5000);
}

function mapAuditLogDoc(id: string, data: Record<string, unknown>): AuditLogItem {
  return {
    id,
    category: normalizeCategory(data.category),
    action: toText(data.action),
    title: toText(data.title),
    message: toText(data.message),
    actorUserId: toText(data.actorUserId),
    actorUserName: toText(data.actorUserName),
    actorUserThemeKey: toText(data.actorUserThemeKey) || null,
    targetUserId: toText(data.targetUserId),
    targetUserName: toText(data.targetUserName),
    targetUserThemeKey: toText(data.targetUserThemeKey) || null,
    entityId: toText(data.entityId),
    entityLabel: toText(data.entityLabel),
    path: toText(data.path),
    pageTitle: toText(data.pageTitle),
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {},
    createdAt: toMillis(data.createdAt ?? data.createdAtServer),
    createdAtServer: data.createdAtServer,
    searchableText: toText(data.searchableText),
  };
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  if (shouldSkipAudit(input)) return;

  const metadata = cleanMetadata(input.metadata);
  const now = Date.now();
  const payload = {
    category: input.category,
    action: input.action.trim(),
    title: input.title.trim(),
    message: toText(input.message),
    actorUserId: toText(input.actorUserId),
    actorUserName: toText(input.actorUserName, "WorkControl"),
    actorUserThemeKey: input.actorUserThemeKey ?? null,
    targetUserId: toText(input.targetUserId),
    targetUserName: toText(input.targetUserName),
    targetUserThemeKey: input.targetUserThemeKey ?? null,
    entityId: toText(input.entityId),
    entityLabel: toText(input.entityLabel),
    path: toText(input.path),
    pageTitle: toText(input.pageTitle),
    metadata,
    searchableText: buildSearchableText(input, metadata),
    createdAt: now,
    createdAtServer: serverTimestamp(),
  };

  await addDoc(auditLogsCollection, payload);
}

export function logPageView(params: {
  userId: string;
  userName: string;
  userThemeKey?: string | null;
  path: string;
  pageTitle: string;
}): void {
  if (!params.userId || !params.path) return;

  const key = `${params.userId}:${params.path}`;
  const now = Date.now();
  const last = pageViewMemory.get(key) || 0;
  if (now - last < PAGE_VIEW_THROTTLE_MS) return;
  pageViewMemory.set(key, now);

  void createAuditLog({
    category: "navigation",
    action: "page_view",
    title: "Pagina accesata",
    message: `${params.userName || "Utilizator"} a intrat pe pagina ${params.pageTitle || params.path}.`,
    actorUserId: params.userId,
    actorUserName: params.userName,
    actorUserThemeKey: params.userThemeKey ?? null,
    path: params.path,
    pageTitle: params.pageTitle,
  }).catch((error) => console.warn("[audit][page_view]", error));
}

export async function getAuditLogs(maxItems = 800): Promise<AuditLogItem[]> {
  const snap = await getDocs(query(auditLogsCollection, orderBy("createdAt", "desc"), limit(maxItems)));
  return snap.docs.map((docItem) => mapAuditLogDoc(docItem.id, docItem.data()));
}

export function subscribeAuditLogs(
  callback: (items: AuditLogItem[]) => void,
  onError?: (error: unknown) => void,
  maxItems = 800
): Unsubscribe {
  return onSnapshot(
    query(auditLogsCollection, orderBy("createdAt", "desc"), limit(maxItems)),
    (snap) => callback(snap.docs.map((docItem) => mapAuditLogDoc(docItem.id, docItem.data()))),
    (error) => onError?.(error)
  );
}
