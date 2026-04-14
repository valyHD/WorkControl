import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type {
  ProjectFormValues,
  ProjectItem,
  TimesheetItem,
  TimesheetLocation,
  TimesheetStatsSummary,
} from "../../../types/timesheet";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";

const projectsCollection = collection(db, "projects");
const timesheetsCollection = collection(db, "timesheets");

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

function mapTimesheetDoc(id: string, data: Record<string, any>): TimesheetItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",

    projectId: data.projectId ?? "",
    projectCode: data.projectCode ?? "",
    projectName: data.projectName ?? "",
userThemeKey: data.userThemeKey ?? null,
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

function getDateParts(ts: number) {
  const date = new Date(ts);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  const tmp = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return {
    workDate: `${y}-${m}-${d}`,
    yearMonth: `${y}-${m}`,
    weekKey: `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
  };
}

export async function getProjectsList(): Promise<ProjectItem[]> {
  const snap = await getDocs(query(projectsCollection, orderBy("name", "asc")));
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

export async function createProject(values: ProjectFormValues): Promise<string> {
  const now = Date.now();

  const refDoc = await addDoc(projectsCollection, {
    code: values.code.trim(),
    name: values.name.trim(),
    status: values.status,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  return refDoc.id;
}

export async function updateProject(
  projectId: string,
  values: ProjectFormValues
): Promise<void> {
  await updateDoc(doc(db, "projects", projectId), {
    code: values.code.trim(),
    name: values.name.trim(),
    status: values.status,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function isProjectCodeUsed(code: string, excludeId?: string): Promise<boolean> {
  const clean = code.trim();
  if (!clean) return false;

  const snap = await getDocs(
    query(projectsCollection, where("code", "==", clean), limit(10))
  );

  if (snap.empty) return false;
  return snap.docs.some((docItem) => docItem.id !== excludeId);
}

export async function getActiveTimesheetForUser(userId: string): Promise<TimesheetItem | null> {
  const snap = await getDocs(
    query(
      timesheetsCollection,
      where("userId", "==", userId),
      where("status", "==", "activ"),
      limit(1)
    )
  );

  if (snap.empty) return null;
  return mapTimesheetDoc(snap.docs[0].id, snap.docs[0].data());
}

export async function startTimesheet(params: {
  userId: string;
  userName: string;
  userThemeKey?: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  startLocation: TimesheetLocation;
}): Promise<string> {
  const existing = await getActiveTimesheetForUser(params.userId);
  if (existing) {
    throw new Error("Exista deja un pontaj activ pentru acest utilizator.");
  }

  const now = Date.now();
  const parts = getDateParts(now);

  const refDoc = await addDoc(timesheetsCollection, {
    userId: params.userId,
    userName: params.userName,

    projectId: params.projectId,
    projectCode: params.projectCode,
    projectName: params.projectName,
userThemeKey: params.userThemeKey ?? null,
    status: "activ",
    explanation: "",

    startAt: now,
    stopAt: null,
    workedMinutes: 0,

    startLocation: params.startLocation,
    stopLocation: null,

    startSource: "web",
    stopSource: "",

    workDate: parts.workDate,
    yearMonth: parts.yearMonth,
    weekKey: parts.weekKey,

    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "timesheets",
    eventType: "timesheet_started",
    entityId: refDoc.id,
    title: "Pontaj pornit",
    message: `${params.userName} a pornit pontajul pe ${params.projectCode} - ${params.projectName}.`,
    directUserId: params.userId,
    ownerUserId: params.userId,
    actorUserId: params.userId,
    actorUserName: params.userName,
    actorUserThemeKey: params.userThemeKey ?? null,
  });

  return refDoc.id;
}

export async function stopTimesheet(params: {
  timesheetId: string;
  explanation: string;
  stopLocation: TimesheetLocation;
}): Promise<void> {
  const refDoc = doc(db, "timesheets", params.timesheetId);
  const snap = await getDoc(refDoc);

  if (!snap.exists()) {
    throw new Error("Pontajul nu exista.");
  }

  const data = snap.data();
  const startAt = data.startAt ?? Date.now();
  const stopAt = Date.now();
  const workedMinutes = Math.max(1, Math.round((stopAt - startAt) / 60000));

  let status: TimesheetItem["status"] = "inchis";
  if (workedMinutes < 8 * 60) {
    status = "corectat";
  }
  if (workedMinutes > 9 * 60) {
    status = "neinchis";
  }

  await updateDoc(refDoc, {
    stopAt,
    workedMinutes,
    stopLocation: params.stopLocation,
    stopSource: "web",
    explanation: params.explanation.trim(),
    status,
    updatedAt: stopAt,
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "timesheets",
    eventType: "timesheet_stopped",
    entityId: params.timesheetId,
    title: "Pontaj oprit",
    message: `${data.userName ?? "Utilizator"} a oprit pontajul pentru ${data.projectCode ?? ""} - ${data.projectName ?? ""}.`,
    directUserId: data.userId ?? "",
    ownerUserId: data.userId ?? "",
    actorUserId: data.userId ?? "",
    actorUserName: data.userName ?? "Utilizator",
    actorUserThemeKey: data.userThemeKey ?? null,
  });
}

export async function getTimesheetsList(): Promise<TimesheetItem[]> {
  const snap = await getDocs(query(timesheetsCollection, orderBy("startAt", "desc")));
  return snap.docs.map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()));
}

export async function getTimesheetsForUser(userId: string): Promise<TimesheetItem[]> {
  const snap = await getDocs(query(timesheetsCollection, where("userId", "==", userId)));
  return snap.docs
    .map((docItem) => mapTimesheetDoc(docItem.id, docItem.data()))
    .sort((a, b) => b.startAt - a.startAt);
}

export async function getTimesheetById(timesheetId: string): Promise<TimesheetItem | null> {
  const snap = await getDoc(doc(db, "timesheets", timesheetId));
  if (!snap.exists()) return null;
  return mapTimesheetDoc(snap.id, snap.data());
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