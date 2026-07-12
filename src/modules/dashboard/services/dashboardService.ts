import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { AppUserItem } from "../../../types/user";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";
import { getLocalDateKey } from "../../timesheets/utils/timesheetAnalytics";

export type DashboardNotificationItem = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
  module?: string;
  eventType?: string;
  entityId?: string;
  notificationPath?: string;
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
  scope: "personal" | "management";
  stats: DashboardStats;
  users: AppUserItem[];
  tools: ToolItem[];
  vehicles: VehicleItem[];
  timesheets: TimesheetItem[];
  projects: ProjectItem[];
  notifications: DashboardNotificationItem[];
  maintenance: DashboardMaintenanceSummary;
};

export type DashboardMaintenanceSummary = {
  clients: number;
  lifts: number;
  expiredLifts: number;
  expiringSoonLifts: number;
  isPartial: boolean;
};

type DashboardReferenceData = Pick<DashboardData, "users" | "tools" | "vehicles" | "projects">;

const DASHBOARD_REFERENCE_CACHE_MS = 15 * 60_000;
const DASHBOARD_LIMITS = {
  users: 250,
  tools: 250,
  vehicles: 150,
  projects: 200,
  timesheets: 500,
  maintenanceClients: 160,
} as const;
let referenceCache: { expiresAt: number; data: DashboardReferenceData } | null = null;
let referenceRequest: Promise<DashboardReferenceData> | null = null;

function mapUserDoc(id: string, data: Record<string, any>): AppUserItem {
  return {
    id,
    uid: data.uid ?? id,
    fullName: data.fullName ?? "",
    email: data.email ?? "",
    active: data.active ?? true,
    role: data.role ?? "angajat",
    themeKey: data.themeKey ?? null,
    avatarUrl: data.avatarUrl ?? "",
    avatarThumbUrl: data.avatarThumbUrl ?? "",
    roleTitle: data.roleTitle ?? "",
    department: data.department ?? "",
    primaryCompanyId: data.primaryCompanyId ?? "",
    primaryCompanyName: data.primaryCompanyName ?? "",
    createdAt: data.createdAt ?? undefined,
    updatedAt: data.updatedAt ?? undefined,
    lastSeenAt: data.lastSeenAt ?? undefined,
    lastActiveAt: data.lastActiveAt ?? undefined,
    lastSiteEnteredAt: data.lastSiteEnteredAt ?? undefined,
    isOnline: data.isOnline ?? false,
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
    currentKm: Math.max(Number(data.currentKm ?? 0), Number(data.gpsSnapshot?.odometerKm ?? 0)),
    initialRecordedKm: Number(data.initialRecordedKm ?? data.currentKm ?? 0),

    ownerUserId: data.ownerUserId ?? "",
    ownerUserName: data.ownerUserName ?? "",

    currentDriverUserId: data.currentDriverUserId ?? "",
    currentDriverUserName: data.currentDriverUserName ?? "",

    maintenanceNotes: data.maintenanceNotes ?? "",
    serviceStrategy: data.serviceStrategy === "absolute" ? "absolute" : "interval",
    serviceIntervalKm: Number(data.serviceIntervalKm ?? 15000),
    nextServiceKm: Number(data.nextServiceKm ?? 0),
    nextOilServiceKm: Number(data.nextOilServiceKm ?? 0),
    nextItpDate: data.nextItpDate ?? "",
    nextRcaDate: data.nextRcaDate ?? "",
    nextCascoDate: data.nextCascoDate ?? "",
    nextRovinietaDate: data.nextRovinietaDate ?? "",

    coverImageUrl: data.coverImageUrl ?? "",
    coverThumbUrl: data.coverThumbUrl ?? "",
    images: Array.isArray(data.images) ? data.images : [],
    documents: Array.isArray(data.documents) ? data.documents : [],
    gpsSnapshot: data.gpsSnapshot ?? null,
    tracker: data.tracker ?? null,

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

function mapNotificationDoc(id: string, data: Record<string, any>): DashboardNotificationItem {
  return {
    id,
    title: data.title ?? "",
    message: data.message ?? "",
    read: data.read ?? false,
    createdAt: data.createdAt ?? Date.now(),
    module: data.module ?? "",
    eventType: data.eventType ?? "",
    entityId: data.entityId ?? "",
    notificationPath: data.notificationPath ?? "",
    targetUserThemeKey: data.targetUserThemeKey ?? null,
    actorUserId: data.actorUserId ?? "",
    actorUserName: data.actorUserName ?? "",
    actorUserThemeKey: data.actorUserThemeKey ?? null,
  };
}

async function getDashboardReferenceData(): Promise<DashboardReferenceData> {
  if (referenceCache?.expiresAt && referenceCache.expiresAt > Date.now()) {
    return referenceCache.data;
  }
  if (referenceRequest) return referenceRequest;

  referenceRequest = (async () => {
    const [usersSnap, toolsSnap, vehiclesSnap, projectsSnap] = await Promise.all([
      getDocs(
        query(collection(db, "users"), orderBy("fullName", "asc"), limit(DASHBOARD_LIMITS.users))
      ),
      getDocs(
        query(collection(db, "tools"), orderBy("updatedAt", "desc"), limit(DASHBOARD_LIMITS.tools))
      ),
      getDocs(
        query(
          collection(db, "vehicles"),
          orderBy("updatedAt", "desc"),
          limit(DASHBOARD_LIMITS.vehicles)
        )
      ),
      getDocs(
        query(collection(db, "projects"), orderBy("name", "asc"), limit(DASHBOARD_LIMITS.projects))
      ),
    ]);
    const data = {
      users: usersSnap.docs.map((d) => mapUserDoc(d.id, d.data())),
      tools: toolsSnap.docs.map((d) => mapToolDoc(d.id, d.data())),
      vehicles: vehiclesSnap.docs.map((d) => mapVehicleDoc(d.id, d.data())),
      projects: projectsSnap.docs.map((d) => mapProjectDoc(d.id, d.data())),
    };
    referenceCache = { data, expiresAt: Date.now() + DASHBOARD_REFERENCE_CACHE_MS };
    return data;
  })();

  try {
    return await referenceRequest;
  } finally {
    referenceRequest = null;
  }
}

function parseDateOnly(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function getDashboardMaintenanceSummary(): Promise<DashboardMaintenanceSummary> {
  const snap = await getDocs(
    query(
      collection(db, "maintenanceClients"),
      orderBy("updatedAt", "desc"),
      limit(DASHBOARD_LIMITS.maintenanceClients)
    )
  );
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const soonUtc = todayUtc + 30 * 24 * 60 * 60 * 1000;
  let lifts = 0;
  let expiredLifts = 0;
  let expiringSoonLifts = 0;

  snap.docs.forEach((item) => {
    const data = item.data();
    const legacyLifts = Array.isArray(data.liftNumbers)
      ? data.liftNumbers
      : data.liftNumber
        ? [data.liftNumber]
        : [];
    const structuredLifts = Array.isArray(data.addresses)
      ? data.addresses.flatMap((address: Record<string, unknown>) =>
          Array.isArray(address.lifts) ? address.lifts : []
        )
      : [];
    const identities = new Set<string>();
    legacyLifts.forEach((lift: unknown) => {
      const value = String(lift || "").trim();
      if (value) identities.add(value);
    });
    structuredLifts.forEach((lift: Record<string, unknown>) => {
      const value = String(lift.serialNumber || lift.label || "").trim();
      if (value) identities.add(value);
    });
    lifts += identities.size;

    const expiryByLift =
      data.liftExpiryDates && typeof data.liftExpiryDates === "object"
        ? Object.values(data.liftExpiryDates as Record<string, unknown>)
        : [];
    const expiryValues = [
      ...expiryByLift,
      ...structuredLifts.map((lift: Record<string, unknown>) => lift.inspectionExpiryDate),
      ...(identities.size === 1 ? [data.expiryDate] : []),
    ];
    const uniqueExpiries = new Set(
      expiryValues.map(parseDateOnly).filter((value): value is number => value !== null)
    );
    uniqueExpiries.forEach((expiry) => {
      if (expiry < todayUtc) expiredLifts += 1;
      else if (expiry <= soonUtc) expiringSoonLifts += 1;
    });
  });

  return {
    clients: snap.size,
    lifts,
    expiredLifts,
    expiringSoonLifts,
    isPartial: snap.size >= DASHBOARD_LIMITS.maintenanceClients,
  };
}

export async function getDashboardData(
  currentUserId?: string,
  dayKey = getLocalDateKey(Date.now()),
  currentRole = "admin"
): Promise<DashboardData> {
  const managementScope = currentRole === "admin" || currentRole === "manager";
  const notificationsRequest = currentUserId
    ? getDocs(
        query(
          collection(db, "notifications"),
          where("userId", "==", currentUserId),
          orderBy("createdAt", "desc"),
          limit(10)
        )
      )
    : Promise.resolve(null);
  const timesheetsRequest = managementScope
    ? getDocs(
        query(
          collection(db, "timesheets"),
          where("workDate", "==", dayKey),
          limit(DASHBOARD_LIMITS.timesheets)
        )
      )
    : currentUserId
      ? getDocs(
          query(
            collection(db, "timesheets"),
            where("userId", "==", currentUserId),
            orderBy("startAt", "desc"),
            limit(20)
          )
        )
      : Promise.resolve(null);
  const [references, timesheetsSnap, notificationsSnap, maintenance] = await Promise.all([
    managementScope
      ? getDashboardReferenceData()
      : Promise.resolve({ users: [], tools: [], vehicles: [], projects: [] }),
    timesheetsRequest,
    notificationsRequest,
    managementScope
      ? getDashboardMaintenanceSummary()
      : Promise.resolve({
          clients: 0,
          lifts: 0,
          expiredLifts: 0,
          expiringSoonLifts: 0,
          isPartial: false,
        }),
  ]);

  const { users, tools, vehicles, projects } = references;
  const timesheets = timesheetsSnap
    ? timesheetsSnap.docs
        .map((d) => mapTimesheetDoc(d.id, d.data()))
        .filter((item) => managementScope || item.workDate === dayKey)
    : [];
  const notifications = notificationsSnap
    ? notificationsSnap.docs.map((d) => mapNotificationDoc(d.id, d.data()))
    : [];

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
    scope: managementScope ? "management" : "personal",
    stats,
    users,
    tools,
    vehicles,
    timesheets,
    projects,
    notifications,
    maintenance,
  };
}
