import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUserItem } from "../../../types/user";
import { formatMinutes } from "../services/timesheetsService";

export type TimesheetPeriodKey = "today" | "yesterday" | "week" | "month" | "custom" | "all";

export type TimesheetPeriodRange = {
  from: number;
  to: number;
  label: string;
};

export function getLocalDateKey(ts = Date.now()) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function getLocalMonthKey(ts = Date.now()) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function formatShortDate(ts: number) {
  return new Date(ts).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" });
}

export function getTimesheetPeriodRange(
  period: TimesheetPeriodKey,
  customFrom?: string,
  customTo?: string,
  nowTs = Date.now()
): TimesheetPeriodRange {
  const now = new Date(nowTs);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (period === "yesterday") {
    const yesterday = startOfDay(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      from: yesterday.getTime(),
      to: endOfDay(yesterday).getTime(),
      label: "Ieri",
    };
  }

  if (period === "week") {
    const from = startOfWeek(now);
    return {
      from: from.getTime(),
      to: todayEnd.getTime(),
      label: "Saptamana asta",
    };
  }

  if (period === "month") {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return {
      from: from.getTime(),
      to: todayEnd.getTime(),
      label: "Luna asta",
    };
  }

  if (period === "custom" && customFrom && customTo) {
    const from = startOfDay(new Date(`${customFrom}T00:00:00`));
    const to = endOfDay(new Date(`${customTo}T12:00:00`));
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from <= to) {
      return {
        from: from.getTime(),
        to: to.getTime(),
        label: `${formatShortDate(from.getTime())} - ${formatShortDate(to.getTime())}`,
      };
    }
  }

  if (period === "all") {
    return { from: 0, to: Number.MAX_SAFE_INTEGER, label: "Toate" };
  }

  return {
    from: todayStart.getTime(),
    to: todayEnd.getTime(),
    label: "Azi",
  };
}

export function isTimesheetInRange(item: TimesheetItem, range: TimesheetPeriodRange) {
  const startAt = item.startAt || 0;
  return startAt >= range.from && startAt <= range.to;
}

export function getEffectiveWorkedMinutes(item: TimesheetItem, nowTs = Date.now()) {
  if (item.status === "activ" && item.startAt) {
    return Math.max(item.workedMinutes || 0, Math.floor((nowTs - item.startAt) / 60000));
  }
  return item.workedMinutes || 0;
}

export function sumTimesheetMinutes(items: TimesheetItem[], nowTs = Date.now()) {
  return items.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item, nowTs), 0);
}

export function getTimesheetStatusLabel(status: TimesheetItem["status"] | "nepontat" | "pauza") {
  const labels: Record<string, string> = {
    activ: "Activ",
    inchis: "Inchis",
    intarziat: "Intarziat",
    neinchis: "Incomplet",
    corectat: "Corectat",
    nepontat: "Nepontat",
    pauza: "In pauza",
  };
  return labels[status] || status;
}

export function getTimesheetStatusTone(
  status: TimesheetItem["status"] | "nepontat" | "pauza"
): "green" | "orange" | "red" | "blue" | "muted" {
  if (status === "activ") return "blue";
  if (status === "inchis") return "green";
  if (status === "corectat" || status === "intarziat" || status === "pauza") return "orange";
  if (status === "neinchis" || status === "nepontat") return "red";
  return "muted";
}

export function getProjectLabel(item: TimesheetItem) {
  return item.projectName?.trim() || item.projectCode?.trim() || "Fara proiect";
}

export function getUserDisplayName(user: AppUserItem) {
  return user.fullName?.trim() || user.email || "Utilizator";
}

export function buildUserTimesheetIndex(items: TimesheetItem[]) {
  const map = new Map<string, TimesheetItem[]>();
  for (const item of items) {
    if (!item.userId) continue;
    const list = map.get(item.userId) ?? [];
    list.push(item);
    map.set(item.userId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
  }
  return map;
}

export function getActiveUsersToday(items: TimesheetItem[], todayKey = getLocalDateKey()) {
  return new Set(
    items
      .filter((item) => item.workDate === todayKey && item.status === "activ")
      .map((item) => item.userId)
  );
}

export function getUsersWithTimesheetToday(items: TimesheetItem[], todayKey = getLocalDateKey()) {
  return new Set(items.filter((item) => item.workDate === todayKey).map((item) => item.userId));
}

export function getUsersWithoutTimesheetToday(users: AppUserItem[], items: TimesheetItem[], todayKey = getLocalDateKey()) {
  const withTimesheet = getUsersWithTimesheetToday(items, todayKey);
  return users.filter((user) => user.active !== false && !withTimesheet.has(user.uid || user.id));
}

export function isIncompleteTimesheet(item: TimesheetItem) {
  return item.status === "neinchis" || (item.status === "activ" && !item.stopAt);
}

export function buildDayMinuteBuckets(items: TimesheetItem[], nowTs = Date.now()) {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = item.workDate || getLocalDateKey(item.startAt);
    map.set(key, (map.get(key) || 0) + getEffectiveWorkedMinutes(item, nowTs));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, minutes]) => ({
      label: label.slice(5),
      value: minutes,
      displayValue: formatMinutes(minutes),
    }));
}

export function buildProjectMinuteBuckets(items: TimesheetItem[], nowTs = Date.now(), limitCount = 6) {
  const map = new Map<string, number>();
  for (const item of items) {
    const label = getProjectLabel(item);
    map.set(label, (map.get(label) || 0) + getEffectiveWorkedMinutes(item, nowTs));
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitCount)
    .map(([label, minutes]) => ({
      label,
      value: minutes,
      displayValue: formatMinutes(minutes),
    }));
}

export function buildUserMinuteBuckets(items: TimesheetItem[], nowTs = Date.now(), limitCount = 8) {
  const map = new Map<string, { userId: string; userName: string; minutes: number }>();
  for (const item of items) {
    const key = item.userId || item.userName || "unknown";
    const current = map.get(key) ?? { userId: item.userId, userName: item.userName || "Utilizator", minutes: 0 };
    current.minutes += getEffectiveWorkedMinutes(item, nowTs);
    map.set(key, current);
  }
  return [...map.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limitCount)
    .map((item) => ({
      label: item.userName,
      value: item.minutes,
      displayValue: formatMinutes(item.minutes),
    }));
}

export function buildStatusBuckets(items: TimesheetItem[]) {
  const map = new Map<string, number>();
  for (const item of items) {
    const label = getTimesheetStatusLabel(item.status);
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      value: count,
      displayValue: count,
    }));
}

export function getWorkdaysInRange(range: TimesheetPeriodRange) {
  const days: string[] = [];
  const date = startOfDay(new Date(range.from));
  const end = startOfDay(new Date(Math.min(range.to, Date.now())));

  while (date <= end && days.length < 370) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      days.push(getLocalDateKey(date.getTime()));
    }
    date.setDate(date.getDate() + 1);
  }

  return days;
}

export function getMissingWorkdaysForUser(items: TimesheetItem[], range: TimesheetPeriodRange) {
  const worked = new Set(items.map((item) => item.workDate).filter(Boolean));
  return getWorkdaysInRange(range).filter((day) => !worked.has(day));
}

export function getUserTimesheetSummary(params: {
  user: AppUserItem;
  items: TimesheetItem[];
  range: TimesheetPeriodRange;
  nowTs?: number;
}) {
  const nowTs = params.nowTs ?? Date.now();
  const totalMinutes = sumTimesheetMinutes(params.items, nowTs);
  const workedDays = new Set(params.items.filter((item) => getEffectiveWorkedMinutes(item, nowTs) > 0).map((item) => item.workDate)).size;
  const missingDays = getMissingWorkdaysForUser(params.items, params.range);
  const incomplete = params.items.filter(isIncompleteTimesheet);
  const projectCount = new Set(params.items.map((item) => item.projectId || getProjectLabel(item))).size;

  return {
    user: params.user,
    totalMinutes,
    averageMinutesPerDay: workedDays > 0 ? Math.round(totalMinutes / workedDays) : 0,
    workedDays,
    missingDays,
    incomplete,
    projectCount,
  };
}
