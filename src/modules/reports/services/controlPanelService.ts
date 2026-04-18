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

  const notifications = (data.notifications ?? []).map((item) => ({ ...item }));
  lines.push(`=== NOTIFICARI (${counts.notifications ?? notifications.length}) ===`);
  if (notifications.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(notifications, (item) => String(item.actorUserName || item.userId || "Sistem"));
    grouped.forEach(([userName, byDay]) => {
      lines.push(`## ${userName}`);
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.title ?? "Eveniment")}`);
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  ${formatTs(item.createdAt)}`);
            lines.push(`  ${item.read ? "citita" : "noua"}`);
            lines.push("");
          });
        });
      lines.push("");
    });
  }

  const timesheets = (data.timesheets ?? []).map((item) => ({ ...item }));
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

  const vehicleEvents = (data.vehicleEvents ?? []).map((item) => ({ ...item }));
  lines.push(`=== ISTORIC MASINI (${counts.vehicleEvents ?? vehicleEvents.length}) ===`);
  if (vehicleEvents.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(vehicleEvents, () => "Sistem");
    grouped.forEach(([, byDay]) => {
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  Sistem · ${formatTs(item.createdAt)}`);
          });
        });
      lines.push("");
    });
  }

  const toolEvents = (data.toolEvents ?? []).map((item) => ({ ...item }));
  lines.push(`=== ISTORIC SCULE (${counts.toolEvents ?? toolEvents.length}) ===`);
  if (toolEvents.length === 0) {
    lines.push("Fără înregistrări.", "");
  } else {
    const grouped = groupByUserAndDay(toolEvents, () => "Sistem");
    grouped.forEach(([, byDay]) => {
      [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .forEach(([dayKey, dayItems]) => {
          lines.push(`  ${readableDay(dayKey)}`);
          dayItems.forEach((item) => {
            lines.push(`  ${String(item.message ?? "-")}`);
            lines.push(`  Sistem · ${formatTs(item.createdAt)}`);
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

    const payloadObject = {
      meta: {
        app: "WorkControl",
        exportedAt,
        exportedAtIso: new Date(exportedAt).toISOString(),
        collections: BACKUP_COLLECTIONS,
      },
      data,
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

  const deleteTargets: Array<Promise<void>> = [];
  let deletedCount = 0;

  async function purge(collectionName: string, dateField: string) {
    const baseCollection = collection(db, collectionName);
    const snap =
      params.cleanupMode === "delete_all_selected"
        ? await getDocs(query(baseCollection, limit(2000)))
        : await getDocs(query(baseCollection, where(dateField, "<", cutoffTs), limit(2000)));
    snap.docs.forEach((item) => {
      deletedCount += 1;
      deleteTargets.push(deleteDoc(doc(db, collectionName, item.id)));
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
      deleteTargets.push(deleteDoc(doc(db, "timesheets", item.id)));
    });
  }

  await Promise.all(deleteTargets);

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
