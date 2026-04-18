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
  uiDensity: "compact" | "comfortable" | "spacious";
  uiPalette: "blue" | "slate" | "emerald";
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
  const lines: string[] = [
    "WORKCONTROL BACKUP - RAPORT TEXT",
    `Generat la: ${new Date(exportedAt).toLocaleString("ro-RO")}`,
    "",
  ];

  for (const collectionName of BACKUP_COLLECTIONS) {
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
  uiDensity: "comfortable",
  uiPalette: "blue",
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
    uiDensity: data.uiDensity ?? DEFAULT_SETTINGS.uiDensity,
    uiPalette: data.uiPalette ?? DEFAULT_SETTINGS.uiPalette,
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

  async function purge(collectionName: string) {
    const snap = await getDocs(
      query(collection(db, collectionName), where("createdAt", "<", cutoffTs), limit(500))
    );
    snap.docs.forEach((item) => {
      deletedCount += 1;
      deleteTargets.push(deleteDoc(doc(db, collectionName, item.id)));
    });
  }

  if (params.cleanNotifications) await purge("notifications");
  if (params.cleanToolEvents) await purge("toolEvents");
  if (params.cleanVehicleEvents) await purge("vehicleEvents");

  if (params.cleanTimesheets) {
    const timesheetsSnap = await getDocs(
      query(collection(db, "timesheets"), where("startAt", "<", cutoffTs), orderBy("startAt", "asc"), limit(500))
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
