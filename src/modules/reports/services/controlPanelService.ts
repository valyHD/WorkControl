import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

export type ControlPanelSettings = {
  retentionMonths: number;
  autoBackupEnabled: boolean;
  autoBackupIntervalDays: number;
  notifyBeforeCleanupDays: number;
  uiFontScale: number;
  uiFontFamily: "dm-sans" | "inter" | "poppins" | "roboto-slab";
  uiDensity: "compact" | "comfortable" | "spacious";
  uiPalette: "blue" | "slate" | "emerald" | "sunset" | "violet";
  uiCardStyle: "flat" | "elevated" | "glass";
  uiContrast: "normal" | "high";
  uiAnimations: "full" | "reduced" | "none";
  updatedAt: number;
};

export type BackupExportSummary = {
  generatedAt: number;
  counts: Record<string, number>;
  totalRecords: number;
  sizeBytes: number;
};

export type ProfessionalBackupView = {
  users: Array<{ userName: string; email: string }>;
  tools: Array<{ toolName: string; internalCode: string; ownerName: string; ownerEmail: string }>;
  toolEvents: Array<{
    userName: string;
    userEmail: string;
    events: Array<{ toolName: string; type: string; message: string; dateTime: number }>;
  }>;
  vehicles: Array<{ vehicleName: string; plateNumber: string; ownerName: string; ownerEmail: string }>;
  vehicleEvents: Array<{
    userName: string;
    userEmail: string;
    events: Array<{ vehicleName: string; type: string; message: string; dateTime: number }>;
  }>;
  timesheets: Array<{
    userName: string;
    userEmail: string;
    entries: Array<{
      projectName: string;
      projectCode: string;
      startAt: number;
      stopAt: number | null;
      workedMinutes: number;
      status: string;
    }>;
  }>;
  notifications: Array<{ title: string; message: string; dateTime: number; module: string; eventType: string }>;
};

export function buildProfessionalBackupView(data: Record<string, Array<Record<string, unknown>>>): ProfessionalBackupView {
  const users = (data.users ?? []).map((item) => ({
    id: String(item.id ?? item.uid ?? ""),
    uid: String(item.uid ?? ""),
    userName: String(item.fullName ?? item.userName ?? "Utilizator necunoscut"),
    email: String(item.email ?? "-"),
  }));

  const userById = new Map<string, { userName: string; email: string }>();
  const userByName = new Map<string, { userName: string; email: string }>();
  users.forEach((user) => {
    if (user.id) userById.set(user.id, { userName: user.userName, email: user.email });
    if (user.uid) userById.set(user.uid, { userName: user.userName, email: user.email });
    userByName.set(user.userName, { userName: user.userName, email: user.email });
  });

  const resolveUser = (userId?: unknown, userName?: unknown) => {
    const byId = userById.get(String(userId ?? ""));
    if (byId) return byId;
    const byName = userByName.get(String(userName ?? ""));
    if (byName) return byName;
    return {
      userName: String(userName ?? "Utilizator necunoscut"),
      email: "-",
    };
  };

  const tools = (data.tools ?? []).map((item) => {
    const owner = resolveUser(item.ownerUserId, item.ownerUserName);
    return {
      id: String(item.id ?? ""),
      toolName: String(item.name ?? "Sculă"),
      internalCode: String(item.internalCode ?? "-"),
      ownerName: owner.userName,
      ownerEmail: owner.email,
    };
  });
  const toolNameById = new Map<string, string>(tools.map((item) => [item.id, item.toolName]));

  const vehicles = (data.vehicles ?? []).map((item) => {
    const owner = resolveUser(item.ownerUserId, item.ownerUserName);
    return {
      id: String(item.id ?? ""),
      vehicleName: `${String(item.brand ?? "-")} ${String(item.model ?? "-")}`.trim(),
      plateNumber: String(item.plateNumber ?? "-"),
      ownerName: owner.userName,
      ownerEmail: owner.email,
    };
  });
  const vehicleNameById = new Map<string, string>(
    vehicles.map((item) => [item.id, item.vehicleName === "-" ? item.plateNumber : `${item.vehicleName} · ${item.plateNumber}`])
  );

  const groupEventsByUser = <
    T extends {
      actorUserId?: unknown;
      actorUserName?: unknown;
      message?: unknown;
      type?: unknown;
      createdAt?: unknown;
      targetName: string;
    },
  >(
    events: T[]
  ) => {
    const grouped = new Map<string, { userName: string; userEmail: string; events: ProfessionalBackupView["toolEvents"][number]["events"] }>();
    events.forEach((event) => {
      const actor = resolveUser(event.actorUserId, event.actorUserName);
      const key = `${actor.userName}__${actor.email}`;
      if (!grouped.has(key)) grouped.set(key, { userName: actor.userName, userEmail: actor.email, events: [] });
      grouped.get(key)!.events.push({
        toolName: event.targetName,
        type: String(event.type ?? "-"),
        message: String(event.message ?? "-"),
        dateTime: Number(event.createdAt ?? 0),
      });
    });
    return [...grouped.values()].map((item) => ({
      ...item,
      events: item.events.sort((a, b) => b.dateTime - a.dateTime),
    }));
  };

  const toolEvents = groupEventsByUser(
    (data.toolEvents ?? []).map((item) => ({
      ...item,
      targetName: toolNameById.get(String(item.toolId ?? "")) ?? String(item.toolId ?? "Sculă necunoscută"),
    }))
  );

  const vehicleEventsRaw = (data.vehicleEvents ?? []).map((item) => ({
    ...item,
    targetName: vehicleNameById.get(String(item.vehicleId ?? "")) ?? String(item.vehicleId ?? "Mașină necunoscută"),
  }));
  const vehicleEventsGrouped = groupEventsByUser(vehicleEventsRaw).map((item) => ({
    userName: item.userName,
    userEmail: item.userEmail,
    events: item.events.map((event) => ({
      vehicleName: event.toolName,
      type: event.type,
      message: event.message,
      dateTime: event.dateTime,
    })),
  }));

  const timesheetsGroupedMap = new Map<string, ProfessionalBackupView["timesheets"][number]>();
  (data.timesheets ?? []).forEach((item) => {
    const owner = resolveUser(item.userId, item.userName);
    const key = `${owner.userName}__${owner.email}`;
    if (!timesheetsGroupedMap.has(key)) {
      timesheetsGroupedMap.set(key, { userName: owner.userName, userEmail: owner.email, entries: [] });
    }
    timesheetsGroupedMap.get(key)!.entries.push({
      projectName: String(item.projectName ?? "-"),
      projectCode: String(item.projectCode ?? "-"),
      startAt: Number(item.startAt ?? 0),
      stopAt: item.stopAt == null ? null : Number(item.stopAt),
      workedMinutes: Number(item.workedMinutes ?? 0),
      status: String(item.status ?? "-"),
    });
  });
  const timesheets = [...timesheetsGroupedMap.values()].map((item) => ({
    ...item,
    entries: item.entries.sort((a, b) => b.startAt - a.startAt),
  }));

  const notifications = (data.notifications ?? [])
    .map((item) => ({
      title: String(item.title ?? "Notificare"),
      message: String(item.message ?? "-"),
      dateTime: Number(item.createdAt ?? 0),
      createdAt: Number(item.createdAt ?? 0),
      module: String(item.module ?? "general"),
      eventType: String(item.eventType ?? "-"),
    }))
    .sort((a, b) => b.dateTime - a.dateTime);

  return {
    users: users.map((item) => ({ userName: item.userName, email: item.email })),
    tools: tools.map(({ toolName, internalCode, ownerName, ownerEmail }) => ({ toolName, internalCode, ownerName, ownerEmail })),
    toolEvents,
    vehicles: vehicles.map(({ vehicleName, plateNumber, ownerName, ownerEmail }) => ({ vehicleName, plateNumber, ownerName, ownerEmail })),
    vehicleEvents: vehicleEventsGrouped,
    timesheets,
    notifications,
  };
}

function formatBackupPrettyText(
  exportedAt: number,
  data: Record<string, Array<Record<string, unknown>>>,
  counts: Record<string, number>
): string {
  function formatTs(value: unknown) {
    const ts = Number(value ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return "-";
    return new Date(ts).toLocaleString("ro-RO");
  }

  function toDayKey(value: unknown) {
    const ts = Number(value ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return "fara_data";
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function readableDay(dayKey: string) {
    if (dayKey === "fara_data") return "Fără dată";
    const [year, month, day] = dayKey.split("-");
    return `${day}.${month}.${year}`;
  }

  function sortDescByCreatedAt<T extends Record<string, unknown>>(items: T[]) {
    return [...items].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
  }

  function groupByUserAndDay(
    items: Array<Record<string, unknown>>,
    userResolver: (item: Record<string, unknown>) => string
  ) {
    const grouped = new Map<string, Map<string, Array<Record<string, unknown>>>>();
    for (const item of sortDescByCreatedAt(items)) {
      const user = userResolver(item) || "Utilizator necunoscut";
      const day = toDayKey(item.createdAt);
      if (!grouped.has(user)) grouped.set(user, new Map<string, Array<Record<string, unknown>>>());
      const userDays = grouped.get(user)!;
      if (!userDays.has(day)) userDays.set(day, []);
      userDays.get(day)!.push(item);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "ro"));
  }

  const lines: string[] = [
    "WORKCONTROL BACKUP - RAPORT TEXT",
    `Generat la: ${new Date(exportedAt).toLocaleString("ro-RO")}`,
    "",
  ];

  const professionalView = buildProfessionalBackupView(data);

  const notifications = professionalView.notifications;
  lines.push(`=== NOTIFICARI (${counts.notifications ?? notifications.length}) ===`);
  if (notifications.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(notifications as unknown as Array<Record<string, unknown>>, () => "General");
    grouped.forEach(([userName, byDay]) => {
      lines.push(`## ${userName}`);
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.title ?? "Eveniment")}`);
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  ${String(item.module ?? "general")} · ${String(item.eventType ?? "-")} · ${formatTs(item.dateTime)}`);
            lines.push("");
          });
        });
      lines.push("");
    });
  }

  const timesheets = professionalView.timesheets.flatMap((item) =>
    item.entries.map((entry) => ({ ...entry, userName: item.userName, userId: item.userEmail, createdAt: entry.startAt }))
  );
  lines.push(`=== PONTAJE (${counts.timesheets ?? timesheets.length}) ===`);
  if (timesheets.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(timesheets, (item) => String(item.userName || item.userId || "Utilizator"));
    grouped.forEach(([userName, byDay]) => {
      lines.push(`## ${userName}`);
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(
              `  ${String(item.userName || userName)} · ${String(item.projectCode ?? "-")} - ${String(item.projectName ?? "-")}`
            );
            lines.push(
              `  Start: ${formatTs(item.startAt)} · Stop: ${formatTs(item.stopAt)} · Durata: ${String(
                Math.floor(Number(item.workedMinutes ?? 0) / 60)
              )}h ${String(Number(item.workedMinutes ?? 0) % 60).padStart(2, "0")}m · Status: ${String(
                item.status ?? "-"
              )}`
            );
            lines.push(`  ${String(item.status ?? "-")}`);
            lines.push("");
          });
        });
      lines.push("");
    });
  }

  const vehicleEvents = professionalView.vehicleEvents.flatMap((item) =>
    item.events.map((entry) => ({ ...entry, createdAt: entry.dateTime, userName: item.userName, message: entry.message }))
  );
  lines.push(`=== ISTORIC MASINI (${counts.vehicleEvents ?? vehicleEvents.length}) ===`);
  if (vehicleEvents.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(vehicleEvents, (item) => String(item.userName ?? "Utilizator necunoscut"));
    grouped.forEach(([userName, byDay]) => {
      lines.push(`## ${userName}`);
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  ${String(item.vehicleName ?? "-")} · ${formatTs(item.createdAt)}`);
          });
        });
      lines.push("");
    });
  }

  const toolEvents = professionalView.toolEvents.flatMap((item) =>
    item.events.map((entry) => ({ ...entry, createdAt: entry.dateTime, userName: item.userName, message: entry.message }))
  );
  lines.push(`=== ISTORIC SCULE (${counts.toolEvents ?? toolEvents.length}) ===`);
  if (toolEvents.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(toolEvents, (item) => String(item.userName ?? "Utilizator necunoscut"));
    grouped.forEach(([userName, byDay]) => {
      lines.push(`## ${userName}`);
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  ${String(item.toolName ?? "-")} · ${formatTs(item.createdAt)}`);
          });
        });
      lines.push("");
    });
  }

  for (const collectionName of BACKUP_COLLECTIONS) {
    if (["notifications", "timesheets", "vehicleEvents", "toolEvents"].includes(collectionName)) {
      continue;
    }
    const items = data[collectionName] ?? [];
    lines.push(`=== ${collectionName.toUpperCase()} (${counts[collectionName] ?? 0}) ===`);
    if (items.length === 0) {
      lines.push("Fără înregistrări.", "");
      continue;
    }

    items.forEach((item, index) => {
      lines.push(`${index + 1}. ID: ${String(item.id ?? "-")}`);
      for (const [key, value] of Object.entries(item)) {
        if (key === "id") continue;
        lines.push(`   - ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}

const DEFAULT_SETTINGS: ControlPanelSettings = {
  retentionMonths: 2,
  autoBackupEnabled: false,
  autoBackupIntervalDays: 7,
  notifyBeforeCleanupDays: 3,
  uiFontScale: 1,
  uiFontFamily: "dm-sans",
  uiDensity: "comfortable",
  uiPalette: "blue",
  uiCardStyle: "elevated",
  uiContrast: "normal",
  uiAnimations: "full",
  updatedAt: Date.now(),
};

const BACKUP_COLLECTIONS = [
  "users",
  "tools",
  "toolEvents",
  "vehicles",
  "vehicleEvents",
  "timesheets",
  "projects",
  "notifications",
  "notificationRules",
] as const;

export async function getControlPanelSettings(): Promise<ControlPanelSettings> {
  const snap = await getDoc(doc(db, "systemSettings", "controlPanel"));
  if (!snap.exists()) return DEFAULT_SETTINGS;

  const data = snap.data();
  return {
    retentionMonths: Number(data.retentionMonths ?? DEFAULT_SETTINGS.retentionMonths),
    autoBackupEnabled: Boolean(data.autoBackupEnabled ?? DEFAULT_SETTINGS.autoBackupEnabled),
    autoBackupIntervalDays: Number(data.autoBackupIntervalDays ?? DEFAULT_SETTINGS.autoBackupIntervalDays),
    notifyBeforeCleanupDays: Number(data.notifyBeforeCleanupDays ?? DEFAULT_SETTINGS.notifyBeforeCleanupDays),
    uiFontScale: Number(data.uiFontScale ?? DEFAULT_SETTINGS.uiFontScale),
    uiFontFamily: data.uiFontFamily ?? DEFAULT_SETTINGS.uiFontFamily,
    uiDensity: data.uiDensity ?? DEFAULT_SETTINGS.uiDensity,
    uiPalette: data.uiPalette ?? DEFAULT_SETTINGS.uiPalette,
    uiCardStyle: data.uiCardStyle ?? DEFAULT_SETTINGS.uiCardStyle,
    uiContrast: data.uiContrast ?? DEFAULT_SETTINGS.uiContrast,
    uiAnimations: data.uiAnimations ?? DEFAULT_SETTINGS.uiAnimations,
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

export async function saveControlPanelSettings(values: ControlPanelSettings): Promise<void> {
  await setDoc(
    doc(db, "systemSettings", "controlPanel"),
    {
      ...values,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function exportBackupDataset(): Promise<{ payload: string; prettyPayload: string; summary: BackupExportSummary }> {
  const exportedAt = Date.now();
  const counts: Record<string, number> = {};
  const data: Record<string, Array<Record<string, unknown>>> = {};

  await dispatchNotificationEvent({
    module: "backup",
    eventType: "backup_requested",
    title: "Backup pornit",
    message: "A fost inițiat exportul complet de date.",
  });

  try {
    for (const collectionName of BACKUP_COLLECTIONS) {
      const snap = await getDocs(collection(db, collectionName));
      counts[collectionName] = snap.size;
      data[collectionName] = snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
    }

    const professionalView = buildProfessionalBackupView(data);
    const payloadObject = {
      meta: {
        app: "WorkControl",
        exportedAt,
        exportedAtIso: new Date(exportedAt).toISOString(),
        collections: BACKUP_COLLECTIONS,
      },
      data,
      professionalView,
    };

    const payload = JSON.stringify(payloadObject, null, 2);
    const prettyPayload = formatBackupPrettyText(exportedAt, data, counts);
    const sizeBytes = new Blob([payload]).size;

    await setDoc(
      doc(collection(db, "backupJobs")),
      {
        type: "manual_export",
        exportedAt,
        counts,
        sizeBytes,
        createdAtServer: serverTimestamp(),
      },
      { merge: true }
    );

    await dispatchNotificationEvent({
      module: "backup",
      eventType: "backup_completed",
      title: "Backup finalizat",
      message: `Backup complet gata (${Object.values(counts).reduce((s, n) => s + n, 0)} înregistrări).`,
    });

    return {
      payload,
      prettyPayload,
      summary: {
        generatedAt: exportedAt,
        counts,
        totalRecords: Object.values(counts).reduce((sum, count) => sum + count, 0),
        sizeBytes,
      },
    };
  } catch (error) {
    await dispatchNotificationEvent({
      module: "backup",
      eventType: "backup_failed",
      title: "Backup eșuat",
      message: "Exportul de date a eșuat. Verifică logurile și drepturile Firestore.",
    });
    throw error;
  }
}

export async function getCollectionCounters(): Promise<Record<string, number>> {
  const counters: Record<string, number> = {};
  for (const collectionName of BACKUP_COLLECTIONS) {
    const snap = await getDocs(collection(db, collectionName));
    counters[collectionName] = snap.size;
  }
  return counters;
}

export async function cleanupHistory(params: {
  retentionMonths: number;
  cleanupMode: "retention_only" | "delete_all_selected";
  cleanNotifications: boolean;
  cleanToolEvents: boolean;
  cleanVehicleEvents: boolean;
  cleanTimesheets: boolean;
}): Promise<{ deletedCount: number; cutoffTs: number }> {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - Math.max(1, params.retentionMonths));
  const cutoffTs = cutoffDate.getTime();

  const deleteTargets: Array<{ collectionName: string; id: string }> = [];
  let deletedCount = 0;

  async function purge(collectionName: string, dateField: string) {
    const baseCollection = collection(db, collectionName);
    const snap =
      params.cleanupMode === "delete_all_selected"
        ? await getDocs(query(baseCollection, limit(2000)))
        : await getDocs(query(baseCollection, where(dateField, "<", cutoffTs), limit(2000)));
    snap.docs.forEach((item) => {
      deletedCount += 1;
      deleteTargets.push({ collectionName, id: item.id });
    });
  }

  if (params.cleanNotifications) await purge("notifications", "createdAt");
  if (params.cleanToolEvents) await purge("toolEvents", "createdAt");
  if (params.cleanVehicleEvents) await purge("vehicleEvents", "createdAt");

  if (params.cleanTimesheets) {
    const timesheetsSnap =
      params.cleanupMode === "delete_all_selected"
        ? await getDocs(query(collection(db, "timesheets"), orderBy("startAt", "desc"), limit(2000)))
        : await getDocs(
            query(collection(db, "timesheets"), where("startAt", "<", cutoffTs), orderBy("startAt", "asc"), limit(2000))
          );
    timesheetsSnap.docs.forEach((item) => {
      deletedCount += 1;
      deleteTargets.push({ collectionName: "timesheets", id: item.id });
    });
  }

  const DELETE_CHUNK_SIZE = 25;
  for (let index = 0; index < deleteTargets.length; index += DELETE_CHUNK_SIZE) {
    const chunk = deleteTargets.slice(index, index + DELETE_CHUNK_SIZE);
    await Promise.all(chunk.map((item) => deleteDoc(doc(db, item.collectionName, item.id))));
  }

  await dispatchNotificationEvent({
    module: "backup",
    eventType: "data_retention_cleanup",
    title: "Curățare istoric executată",
    message: `Au fost șterse ${deletedCount} înregistrări istorice mai vechi de ${params.retentionMonths} luni.`,
  });

  return { deletedCount, cutoffTs };
}

export async function getLatestBackupJob() {
  const snap = await getDocs(query(collection(db, "backupJobs"), orderBy("exportedAt", "desc"), limit(1)));
  if (snap.empty) return null;
  return snap.docs[0].data();
}
