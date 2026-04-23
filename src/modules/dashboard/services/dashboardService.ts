import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { AppUserItem } from "../../../types/user";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";

export type DashboardNotificationItem = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  entityId?: string;
  targetUserThemeKey?: string | null;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
};

export type DashboardStats = {
  totalUsers: number;
  activeUsers: number;

  totalTools: number;
  defectiveTools: number;
  lostTools: number;
  toolsInWarehouse: number;

  totalVehicles: number;
  unavailableVehicles: number;
  damagedVehicles: number;

  activeTimesheets: number;
  totalProjects: number;
  activeProjects: number;

  unreadNotifications: number;
};

export type DashboardData = {
  stats: DashboardStats;
  users: AppUserItem[];
  tools: ToolItem[];
  vehicles: VehicleItem[];
  timesheets: TimesheetItem[];
  projects: ProjectItem[];
  notifications: DashboardNotificationItem[];
};

function mapUserDoc(id: string, data: Record<string, any>): AppUserItem {
  return {
    id,
    uid: data.uid ?? id,
    fullName: data.fullName ?? "",
    email: data.email ?? "",
    active: data.active ?? true,
    role: data.role ?? "angajat",
    createdAt: data.createdAt ?? undefined,
    updatedAt: data.updatedAt ?? undefined,
  };
}

function mapToolDoc(id: string, data: Record<string, any>): ToolItem {
  return {
    id,
    name: data.name ?? "",
    internalCode: data.internalCode ?? "",
    ownerThemeKey: data.ownerThemeKey ?? null,
    currentHolderThemeKey: data.currentHolderThemeKey ?? null,
    qrCodeValue: data.qrCodeValue ?? "",
    status: data.status ?? "depozit",

    ownerUserId: data.ownerUserId ?? "",
    ownerUserName: data.ownerUserName ?? "",

    currentHolderUserId: data.currentHolderUserId ?? "",
    currentHolderUserName: data.currentHolderUserName ?? "",

    locationType: data.locationType ?? "depozit",
    locationLabel: data.locationLabel ?? "Depozit",

    description: data.description ?? "",
    warrantyText: data.warrantyText ?? "",
    warrantyUntil: data.warrantyUntil ?? "",

    coverImageUrl: data.coverImageUrl ?? "",
    coverThumbUrl: data.coverThumbUrl ?? "",
    imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
    images: Array.isArray(data.images) ? data.images : [],

    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
  };
}

function mapVehicleDoc(id: string, data: Record<string, any>): VehicleItem {
  return {
    id,
    plateNumber: data.plateNumber ?? "",
    brand: data.brand ?? "",
    model: data.model ?? "",
    year: data.year ?? "",
    ownerThemeKey: data.ownerThemeKey ?? null,
    currentDriverThemeKey: data.currentDriverThemeKey ?? null,
    vin: data.vin ?? "",
    fuelType: data.fuelType ?? "",
    status: data.status ?? "activa",
    currentKm: Number(data.currentKm ?? 0),
    initialRecordedKm: Number(data.initialRecordedKm ?? data.currentKm ?? 0),

    ownerUserId: data.ownerUserId ?? "",
    ownerUserName: data.ownerUserName ?? "",

    currentDriverUserId: data.currentDriverUserId ?? "",
    currentDriverUserName: data.currentDriverUserName ?? "",

    maintenanceNotes: data.maintenanceNotes ?? "",
    serviceStrategy: data.serviceStrategy === "absolute" ? "absolute" : "interval",
    serviceIntervalKm: Number(data.serviceIntervalKm ?? 15000),
    nextServiceKm: Number(data.nextServiceKm ?? 0),
    nextItpDate: data.nextItpDate ?? "",
    nextRcaDate: data.nextRcaDate ?? "",
    nextCascoDate: data.nextCascoDate ?? "",

    coverImageUrl: data.coverImageUrl ?? "",
    coverThumbUrl: data.coverThumbUrl ?? "",
    images: Array.isArray(data.images) ? data.images : [],
    documents: Array.isArray(data.documents) ? data.documents : [],

    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
  };
}

function mapTimesheetDoc(id: string, data: Record<string, any>): TimesheetItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    userThemeKey: data.userThemeKey ?? null,
    projectId: data.projectId ?? "",
    projectCode: data.projectCode ?? "",
    projectName: data.projectName ?? "",

    status: data.status ?? "activ",
    explanation: data.explanation ?? "",

    startAt: data.startAt ?? Date.now(),
    stopAt: data.stopAt ?? null,
    workedMinutes: Number(data.workedMinutes ?? 0),

    startLocation: {
      lat: data.startLocation?.lat ?? null,
      lng: data.startLocation?.lng ?? null,
      label: data.startLocation?.label ?? "",
    },
    stopLocation: data.stopLocation
      ? {
          lat: data.stopLocation?.lat ?? null,
          lng: data.stopLocation?.lng ?? null,
          label: data.stopLocation?.label ?? "",
        }
      : null,

    startSource: data.startSource ?? "web",
    stopSource: data.stopSource ?? "",

    workDate: data.workDate ?? "",
    yearMonth: data.yearMonth ?? "",
    weekKey: data.weekKey ?? "",

    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
  };
}

function mapProjectDoc(id: string, data: Record<string, any>): ProjectItem {
  return {
    id,
    code: data.code ?? "",
    name: data.name ?? "",
    status: data.status ?? "activ",
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
  };
}

function mapNotificationDoc(
  id: string,
  data: Record<string, any>
): DashboardNotificationItem {
  return {
    id,
    title: data.title ?? "",
    message: data.message ?? "",
    read: data.read ?? false,
    createdAt: data.createdAt ?? Date.now(),
    module: data.module ?? "",
    entityId: data.entityId ?? "",
    targetUserThemeKey: data.targetUserThemeKey ?? null,
    actorUserId: data.actorUserId ?? "",
    actorUserName: data.actorUserName ?? "",
    actorUserThemeKey: data.actorUserThemeKey ?? null,
  };
}

export async function getDashboardData(currentUserId?: string): Promise<DashboardData> {
  const [usersSnap, toolsSnap, vehiclesSnap, timesheetsSnap, projectsSnap] =
    await Promise.all([
      getDocs(query(collection(db, "users"), orderBy("fullName", "asc"))),
      getDocs(query(collection(db, "tools"), orderBy("updatedAt", "desc"))),
      getDocs(query(collection(db, "vehicles"), orderBy("updatedAt", "desc"))),
      getDocs(query(collection(db, "timesheets"), orderBy("startAt", "desc"))),
      getDocs(query(collection(db, "projects"), orderBy("name", "asc"))),
    ]);

  const users = usersSnap.docs.map((d) => mapUserDoc(d.id, d.data()));
  const tools = toolsSnap.docs.map((d) => mapToolDoc(d.id, d.data()));
  const vehicles = vehiclesSnap.docs.map((d) => mapVehicleDoc(d.id, d.data()));
  const timesheets = timesheetsSnap.docs.map((d) => mapTimesheetDoc(d.id, d.data()));
  const projects = projectsSnap.docs.map((d) => mapProjectDoc(d.id, d.data()));

  let notifications: DashboardNotificationItem[] = [];

  if (currentUserId) {
    const notificationsSnap = await getDocs(
      query(
        collection(db, "notifications"),
        where("userId", "==", currentUserId),
        orderBy("createdAt", "desc")
      )
    );

    notifications = notificationsSnap.docs.map((d) =>
      mapNotificationDoc(d.id, d.data())
    );
  }

  const stats: DashboardStats = {
    totalUsers: users.length,
    activeUsers: users.filter((u) => u.active).length,

    totalTools: tools.length,
    defectiveTools: tools.filter((t) => t.status === "defecta").length,
    lostTools: tools.filter((t) => t.status === "pierduta").length,
    toolsInWarehouse: tools.filter((t) => !t.currentHolderUserId).length,

    totalVehicles: vehicles.length,
    unavailableVehicles: vehicles.filter((v) => v.status === "indisponibila").length,
    damagedVehicles: vehicles.filter((v) => v.status === "avariata").length,

    activeTimesheets: timesheets.filter((t) => t.status === "activ").length,
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === "activ").length,

    unreadNotifications: notifications.filter((n) => !n.read).length,
  };

  return {
    stats,
    users,
    tools,
    vehicles,
    timesheets,
    projects,
    notifications,
  };
}
