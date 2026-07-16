import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase/firebase";
import {
  buildCompanyScopeConstraints,
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";
import type {
  ProjectFormValues,
  ProjectItem,
  TimesheetItem,
  TimesheetLocation,
  TimesheetStatsSummary,
} from "../../../types/timesheet";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import {
  buildAuditChanges,
  buildAuditSnapshot,
  type AuditFieldDescriptor,
} from "../../audit/utils/auditMetadata";
import { simplifyTimesheetAddressLabel } from "../utils/timesheetLocation";
import { notifyTimesheetsChanged } from "./timesheetLiveUpdates";

const projectsCollection = collection(db, "projects");
const timesheetsCollection = collection(db, "timesheets");
const usersCollection = collection(db, "users");
const projectAuditFields: AuditFieldDescriptor<ProjectFormValues>[] = [
  { key: "name", label: "Nume proiect" },
  { key: "status", label: "Status" },
];

function toMillis(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value) {
    const millis = Number((value as { toMillis: () => number }).toMillis());
    return Number.isFinite(millis) ? millis : fallback;
  }
  if (value && typeof value === "object" && "_seconds" in value) {
    const seconds = Number((value as { _seconds?: number })._seconds);
    const nanos = Number((value as { _nanoseconds?: number })._nanoseconds || 0);
    if (Number.isFinite(seconds)) return seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  return fallback;
}

function mapProjectDoc(id: string, data: Record<string, any>): ProjectItem {
  return {
    id,
    code: data.code ?? "",
    name: data.name ?? "",
    status: data.status ?? "activ",
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
    companyId: data.companyId ?? "",
  };
}

function mapTimesheetDoc(id: string, data: Record<string, any>): TimesheetItem {
  const rawStatus = (data.status ?? "activ") as TimesheetItem["status"];
  const normalizedStatus = rawStatus === "neinchis" && data.stopAt ? "corectat" : rawStatus;
  const createdAt = toMillis(data.createdAt, 0);
  const updatedAt = toMillis(data.updatedAt, createdAt || 0);
  const startAt = toMillis(data.startAt, createdAt || 0);
  const stopAt = data.stopAt == null ? null : toMillis(data.stopAt, 0);

  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",

    projectId: data.projectId ?? "",
    projectCode: data.projectCode ?? "",
    projectName: data.projectName ?? "",
    userThemeKey: data.userThemeKey ?? null,
    status: normalizedStatus,
    explanation: data.explanation ?? "",
    startExplanation: data.startExplanation ?? "",
    stopExplanation: data.stopExplanation ?? "",
    startPolicyFlag: data.startPolicyFlag ?? "",
    stopPolicyFlag: data.stopPolicyFlag ?? "",
    startExpectedTime: data.startExpectedTime ?? "",
    stopExpectedMinutes:
      typeof data.stopExpectedMinutes === "number" ? data.stopExpectedMinutes : null,

    startAt,
    stopAt,
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

    createdAt,
    updatedAt,
    companyId: data.companyId ?? "",
  };
}

function getDateParts(ts: number) {
  const date = new Date(ts);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  const tmp = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return {
    workDate: `${y}-${m}-${d}`,
    yearMonth: `${y}-${m}`,
    weekKey: `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
  };
}

function getProjectDisplayName(projectName?: string, projectCode?: string): string {
  const name = String(projectName ?? "").trim();
  const code = String(projectCode ?? "").trim();
  return name || code || "Fara proiect";
}

export async function getProjectsList(maxItems?: number): Promise<ProjectItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const constraints = [...buildCompanyScopeConstraints(context), orderBy("name", "asc")];
  if (Number.isFinite(maxItems)) {
    constraints.push(limit(Math.min(250, Math.max(1, Math.floor(maxItems as number)))));
  }
  const snap = await getDocs(query(projectsCollection, ...constraints));
  return snap.docs.map((docItem) => mapProjectDoc(docItem.id, docItem.data()));
}

export async function getActiveProjectsList(): Promise<ProjectItem[]> {
  const projects = await getProjectsList();
  return projects.filter((project) => project.status === "activ");
}

export async function getProjectById(projectId: string): Promise<ProjectItem | null> {
  const snap = await getDoc(doc(db, "projects", projectId));
  if (!snap.exists()) return null;
  return mapProjectDoc(snap.id, snap.data());
}

export async function getUserTimesheetProjectPreference(userId: string): Promise<string> {
  if (!userId) return "";
  const snap = await getDoc(doc(usersCollection, userId));
  if (!snap.exists()) return "";
  const data = snap.data();
  return String(data.timesheetDefaultProjectId ?? data.lastTimesheetProjectId ?? "").trim();
}

export async function saveUserTimesheetProjectPreference(
  userId: string,
  projectId: string
): Promise<void> {
  if (!userId) return;
  await setDoc(
    doc(usersCollection, userId),
    {
      timesheetDefaultProjectId: projectId.trim(),
      lastTimesheetProjectId: projectId.trim(),
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function createProject(values: ProjectFormValues): Promise<string> {
  const context = await getCurrentCompanyAccessContext();
  const companyId = requirePrimaryCompanyId(context);
  const now = Date.now();
  const savedValues = { ...values, name: values.name.trim() };
  const fieldsText = buildAuditSnapshot(savedValues, projectAuditFields);

  const refDoc = await addDoc(projectsCollection, {
    companyId,
    name: savedValues.name,
    status: savedValues.status,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "projects",
    eventType: "project_created",
    entityId: refDoc.id,
    title: "Proiect creat",
    message: `Proiect nou: ${values.name.trim()}.`,
    metadata: {
      fieldsText,
      fieldsCount: fieldsText.length,
    },
  });

  return refDoc.id;
}

export async function updateProject(projectId: string, values: ProjectFormValues): Promise<void> {
  const existingSnap = await getDoc(doc(db, "projects", projectId));
  const existingData = existingSnap.exists() ? existingSnap.data() : null;
  const previousStatus = existingData?.status ?? "";
  const savedValues = { ...values, name: values.name.trim() };
  const changesText = buildAuditChanges(
    existingData as Partial<ProjectFormValues> | null,
    savedValues,
    projectAuditFields
  );

  await updateDoc(doc(db, "projects", projectId), {
    code: deleteField(),
    name: savedValues.name,
    status: savedValues.status,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "projects",
    eventType: "project_updated",
    entityId: projectId,
    title: "Proiect actualizat",
    message: `Proiect actualizat: ${values.name.trim()} (${values.status}).`,
    metadata: {
      changesText,
      changesCount: changesText.length,
    },
  });

  if (previousStatus && previousStatus !== values.status) {
    await dispatchNotificationEvent({
      module: "projects",
      eventType: "project_status_changed",
      entityId: projectId,
      title: "Status proiect schimbat",
      message: `Proiectul ${values.name.trim()} are acum statusul ${values.status}.`,
      notificationPath: "/projects",
      metadata: {
        changesText: [`Status: ${previousStatus || "-"} -> ${values.status}`],
        changesCount: 1,
      },
    });
  }
}

export async function deleteProject(project: ProjectItem): Promise<void> {
  await dispatchNotificationEvent({
    module: "projects",
    eventType: "project_deleted",
    entityId: project.id,
    title: "Proiect sters",
    message: `Proiectul ${project.name || project.code || project.id} a fost sters.`,
    notificationPath: "/projects",
  });
  await deleteDoc(doc(db, "projects", project.id));
}

function cleanTimesheetLocation(location: TimesheetLocation): TimesheetLocation {
  return {
    lat: location.lat ?? null,
    lng: location.lng ?? null,
    label: simplifyTimesheetAddressLabel(location.label),
  };
}

export async function getActiveTimesheetForUser(userId: string): Promise<TimesheetItem | null> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(
    query(
      timesheetsCollection,
      ...buildCompanyScopeConstraints(context),
      where("userId", "==", userId),
      where("status", "==", "activ"),
      limit(1)
    )
  );

  if (snap.empty) return null;
  return mapTimesheetDoc(snap.docs[0].id, snap.docs[0].data());
}

export type StartTimesheetParams = {
  userId: string;
  userName: string;
  userThemeKey?: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  startLocation: TimesheetLocation;
  startExplanation?: string;
  startPolicyFlag?: string;
  startExpectedTime?: string;
  occurredAt?: number;
  offlineReplay?: boolean;
};

export type StartTimesheetResult = {
  timesheetId: string;
  duplicate: boolean;
};

export async function startTimesheetDetailed(
  params: StartTimesheetParams
): Promise<StartTimesheetResult> {
  const context = await getCurrentCompanyAccessContext();
  if (context.uid !== params.userId) {
    throw new Error("Poti porni numai pontajul propriu.");
  }
  const companyId = requirePrimaryCompanyId(context);
  const callable = httpsCallable<
    {
      companyId: string;
      projectId: string;
      startLocation: TimesheetLocation;
      startExplanation?: string;
      startPolicyFlag?: string;
      startExpectedTime?: string;
      occurredAt?: number;
      offlineReplay?: boolean;
      startSource: "web";
    },
    { timesheetId: string; duplicate: boolean }
  >(functions, "startTimesheetSecure");
  const response = await callable({
    companyId,
    projectId: params.projectId,
    startLocation: cleanTimesheetLocation(params.startLocation),
    startExplanation: params.startExplanation,
    startPolicyFlag: params.startPolicyFlag,
    startExpectedTime: params.startExpectedTime ?? "",
    occurredAt: params.offlineReplay === true ? params.occurredAt : undefined,
    offlineReplay: params.offlineReplay === true ? true : undefined,
    startSource: "web",
  });
  const timesheetId = response.data.timesheetId;
  if (!timesheetId) throw new Error("Pontajul nu a returnat un identificator valid.");
  const duplicate = response.data.duplicate === true;

  if (!duplicate) {
    await dispatchNotificationEvent({
      module: "timesheets",
      eventType: "timesheet_started",
      entityId: timesheetId,
      title: "Pontaj pornit",
      message: `${params.userName} a pornit pontajul pe ${getProjectDisplayName(params.projectName, params.projectCode)}.`,
      directUserId: params.userId,
      ownerUserId: params.userId,
      actorUserId: params.userId,
      actorUserName: params.userName,
      actorUserThemeKey: params.userThemeKey ?? null,
      metadata: {
        fieldsText: [
          `User: ${params.userName}`,
          `Proiect: ${getProjectDisplayName(params.projectName, params.projectCode)}`,
          `Ora asteptata pornire: ${params.startExpectedTime || "-"}`,
          `Explicatie start: ${params.startExplanation || "-"}`,
          `Locatie start: ${cleanTimesheetLocation(params.startLocation).label || "-"}`,
        ],
        fieldsCount: 5,
      },
      companyId,
      idempotencyKey: `timesheet-started-${timesheetId}`,
    });
  }

  notifyTimesheetsChanged({ userId: params.userId, reason: "start" });

  return {
    timesheetId,
    duplicate,
  };
}

export async function startTimesheet(params: StartTimesheetParams): Promise<string> {
  const result = await startTimesheetDetailed(params);
  return result.timesheetId;
}

export async function stopTimesheet(params: {
  timesheetId: string;
  explanation: string;
  stopLocation: TimesheetLocation;
  stopPolicyFlag?: string;
  stopExpectedMinutes?: number;
  occurredAt?: number;
}): Promise<void> {
  const refDoc = doc(db, "timesheets", params.timesheetId);
  const snap = await getDoc(refDoc);

  if (!snap.exists()) {
    throw new Error("Pontajul nu exista.");
  }

  const data = snap.data();
  const callable = httpsCallable<
    {
      timesheetId: string;
      stopLocation: TimesheetLocation;
      stopExplanation: string;
      stopPolicyFlag?: string;
      stopExpectedMinutes?: number;
      occurredAt?: number;
      stopSource: "web";
    },
    { duplicate: boolean; workedMinutes?: number; status?: TimesheetItem["status"] }
  >(functions, "stopTimesheetSecure");
  const response = await callable({
    timesheetId: params.timesheetId,
    stopLocation: cleanTimesheetLocation(params.stopLocation),
    stopExplanation: params.explanation.trim(),
    stopPolicyFlag: params.stopPolicyFlag,
    stopExpectedMinutes: params.stopExpectedMinutes,
    occurredAt: params.occurredAt,
    stopSource: "web",
  });
  const workedMinutes = response.data.workedMinutes ?? Number(data.workedMinutes ?? 0);
  const status = response.data.status ?? (data.status as TimesheetItem["status"]);

  await dispatchNotificationEvent({
    module: "timesheets",
    eventType: "timesheet_stopped",
    entityId: params.timesheetId,
    title: "Pontaj oprit",
    message: `${data.userName ?? "Utilizator"} a oprit pontajul pentru ${getProjectDisplayName(data.projectName, data.projectCode)}.`,
    directUserId: data.userId ?? "",
    ownerUserId: data.userId ?? "",
    actorUserId: data.userId ?? "",
    actorUserName: data.userName ?? "Utilizator",
    actorUserThemeKey: data.userThemeKey ?? null,
    metadata: {
      fieldsText: [
        `User: ${data.userName ?? "Utilizator"}`,
        `Proiect: ${getProjectDisplayName(data.projectName, data.projectCode)}`,
        `Minute lucrate: ${workedMinutes}`,
        `Status: ${status}`,
        `Explicatie stop: ${params.explanation.trim() || "-"}`,
        `Locatie stop: ${cleanTimesheetLocation(params.stopLocation).label || "-"}`,
      ],
      fieldsCount: 6,
    },
    companyId: String(data.companyId ?? ""),
    idempotencyKey: `timesheet-stopped-${params.timesheetId}`,
  });

  notifyTimesheetsChanged({ userId: String(data.userId ?? ""), reason: "stop" });
}

export async function getTimesheetsList(): Promise<TimesheetItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(
    query(
      timesheetsCollection,
      ...buildCompanyScopeConstraints(context),
      orderBy("startAt", "desc")
    )
  );
  return snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));
}

export async function getTimesheetsManagementList(maxItems = 1000): Promise<TimesheetItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const safeLimit = Math.max(50, Math.min(1500, Math.floor(maxItems)));
  const snap = await getDocs(
    query(
      timesheetsCollection,
      ...buildCompanyScopeConstraints(context),
      orderBy("startAt", "desc"),
      limit(safeLimit)
    )
  );
  return snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));
}

export async function getTimesheetsForUser(
  userId: string,
  maxItems = 500
): Promise<TimesheetItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(maxItems)));
  const snap = await getDocs(
    query(
      timesheetsCollection,
      ...buildCompanyScopeConstraints(context),
      where("userId", "==", userId),
      orderBy("startAt", "desc"),
      limit(safeLimit)
    )
  );
  return snap.docs
    .map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()))
    .sort((a, b) => b.startAt - a.startAt);
}

export async function getLatestTimesheetProjectForUser(
  userId: string
): Promise<ProjectItem | null> {
  if (!userId) return null;

  const activeTimesheet = await getActiveTimesheetForUser(userId);
  const latestTimesheet =
    activeTimesheet ||
    (await getTimesheetsForUser(userId)).find((item) => item.projectId || item.projectName);

  if (!latestTimesheet?.projectId) return null;

  const project = await getProjectById(latestTimesheet.projectId);
  if (project) return project;

  return {
    id: latestTimesheet.projectId,
    code: latestTimesheet.projectCode || "",
    name: latestTimesheet.projectName || "Proiect din pontaj",
    status: "activ",
    createdAt: latestTimesheet.createdAt,
    updatedAt: latestTimesheet.updatedAt,
    companyId: latestTimesheet.companyId,
  };
}

export async function getTimesheetById(timesheetId: string): Promise<TimesheetItem | null> {
  const snap = await getDoc(doc(db, "timesheets", timesheetId));
  if (!snap.exists()) return null;
  return mapTimesheetDoc(snap.id, snap.data());
}

export async function deleteTimesheet(item: TimesheetItem): Promise<void> {
  await dispatchNotificationEvent({
    module: "timesheets",
    eventType: "timesheet_deleted",
    entityId: item.id,
    title: "Pontaj sters",
    message: `Pontajul lui ${item.userName || "utilizator"} pentru ${item.projectName || item.projectCode || "proiect"} din ${item.workDate || "-"} a fost sters.`,
    directUserId: item.userId,
    ownerUserId: item.userId,
    notificationPath: "/timesheets",
  });
  await deleteDoc(doc(db, "timesheets", item.id));
}

export function computeTimesheetStats(
  timesheets: TimesheetItem[],
  nowTs: number = Date.now()
): TimesheetStatsSummary {
  const now = new Date(nowTs);
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const currentParts = getDateParts(nowTs);
  const weekKey = currentParts.weekKey;

  const todayMinutes = timesheets
    .filter((item) => item.workDate === todayKey)
    .reduce((sum, item) => sum + item.workedMinutes, 0);

  const weekMinutes = timesheets
    .filter((item) => item.weekKey === weekKey)
    .reduce((sum, item) => sum + item.workedMinutes, 0);

  const monthItems = timesheets.filter((item) => item.yearMonth === monthKey);
  const monthMinutes = monthItems.reduce((sum, item) => sum + item.workedMinutes, 0);

  const distinctWorkedDays = new Set(
    monthItems.filter((item) => item.workedMinutes > 0).map((item) => item.workDate)
  ).size;

  const avgMinutesPerWorkedDayMonth =
    distinctWorkedDays > 0 ? Math.round(monthMinutes / distinctWorkedDays) : 0;

  return {
    todayMinutes,
    weekMinutes,
    monthMinutes,
    avgMinutesPerWorkedDayMonth,
  };
}

export function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${String(mins).padStart(2, "0")}m`;
}
