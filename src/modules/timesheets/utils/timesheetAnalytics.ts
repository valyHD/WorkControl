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

function getTimesheetIntervalEnd(item: TimesheetItem, nowTs = Date.now()) {
  if (item.status === "activ") return nowTs;
  if (item.stopAt) return item.stopAt;
  if (item.startAt && item.workedMinutes > 0) {
    return item.startAt + item.workedMinutes * 60_000;
  }
  return item.startAt || 0;
}

export function getTimesheetMinutesForRange(
  item: TimesheetItem,
  range: TimesheetPeriodRange,
  nowTs = Date.now()
) {
  if (!item.startAt) return 0;
  const intervalStart = Math.max(item.startAt, range.from);
  const intervalEnd = Math.min(getTimesheetIntervalEnd(item, nowTs), range.to);
  return intervalEnd > intervalStart
    ? Math.max(0, Math.floor((intervalEnd - intervalStart) / 60_000))
    : 0;
}

export function isTimesheetInRange(
  item: TimesheetItem,
  range: TimesheetPeriodRange,
  nowTs = Date.now()
) {
  return getTimesheetMinutesForRange(item, range, nowTs) > 0;
}

export function getEffectiveWorkedMinutes(item: TimesheetItem, nowTs = Date.now()) {
  if (item.status === "activ" && item.startAt) {
    return Math.max(item.workedMinutes || 0, Math.floor((nowTs - item.startAt) / 60000));
  }
  return item.workedMinutes || 0;
}

function isValidDateKey(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function isStaleActiveTimesheet(item: TimesheetItem | null | undefined, nowTs = Date.now()) {
  if (!item || item.status !== "activ") return false;
  const todayKey = getLocalDateKey(nowTs);
  if (!item.startAt) return isValidDateKey(item.workDate) && item.workDate < todayKey;
  if (nowTs - item.startAt <= 12 * 60 * 60 * 1000) return false;
  return (
    getLocalDateKey(item.startAt) !== todayKey ||
    (isValidDateKey(item.workDate) && item.workDate < todayKey)
  );
}

export function sumTimesheetMinutes(items: TimesheetItem[], nowTs = Date.now()) {
  return items.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item, nowTs), 0);
}

function getDayBounds(dayKey: string): { from: number; to: number } | null {
  const from = new Date(`${dayKey}T00:00:00`);
  if (!Number.isFinite(from.getTime()) || getLocalDateKey(from.getTime()) !== dayKey) return null;
  const to = startOfDay(from);
  to.setDate(to.getDate() + 1);
  return { from: from.getTime(), to: to.getTime() };
}

export function getTimesheetMinutesForDay(
  item: TimesheetItem,
  dayKey = getLocalDateKey(),
  nowTs = Date.now()
) {
  if (item.status !== "activ") {
    if (item.workDate === dayKey) return Math.max(0, Number(item.workedMinutes || 0));
    const bounds = getDayBounds(dayKey);
    if (!bounds || !item.startAt || !item.stopAt) return 0;
    const intervalStart = Math.max(item.startAt, bounds.from);
    const intervalEnd = Math.min(item.stopAt, bounds.to);
    return intervalEnd > intervalStart
      ? Math.max(0, Math.floor((intervalEnd - intervalStart) / 60_000))
      : 0;
  }

  const bounds = getDayBounds(dayKey);
  if (!bounds || !item.startAt) return 0;
  const intervalStart = Math.max(item.startAt, bounds.from);
  const intervalEnd = Math.min(nowTs, bounds.to);
  if (intervalEnd <= intervalStart) return 0;

  const liveMinutes = Math.floor((intervalEnd - intervalStart) / 60_000);
  return item.workDate === dayKey
    ? Math.max(Math.max(0, Number(item.workedMinutes || 0)), liveMinutes)
    : liveMinutes;
}

export function sumTimesheetMinutesForDay(
  items: TimesheetItem[],
  dayKey = getLocalDateKey(),
  nowTs = Date.now()
) {
  return items.reduce((sum, item) => sum + getTimesheetMinutesForDay(item, dayKey, nowTs), 0);
}

export function getActiveTimesheetsNow(items: TimesheetItem[]) {
  return items.filter((item) => item.status === "activ");
}

export function getActiveUsersNow(items: TimesheetItem[]) {
  return new Set(
    getActiveTimesheetsNow(items)
      .map((item) => item.userId)
      .filter(Boolean)
  );
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

export function getUsersWithoutTimesheetToday(
  users: AppUserItem[],
  items: TimesheetItem[],
  todayKey = getLocalDateKey()
) {
  const withTimesheet = getUsersWithTimesheetToday(items, todayKey);
  return users.filter((user) => user.active !== false && !withTimesheet.has(user.uid || user.id));
}

export function isIncompleteTimesheet(item: TimesheetItem) {
  return item.status === "neinchis" || (item.status === "activ" && !item.stopAt);
}

export function buildDayMinuteBuckets(items: TimesheetItem[], nowTs = Date.now()) {
  const map = new Map<string, number>();
  for (const item of items) {
    const startAt = item.startAt || 0;
    const endAt = getTimesheetIntervalEnd(item, nowTs);
    const firstDay = startAt ? startOfDay(new Date(startAt)) : startOfDay(new Date(nowTs));
    const lastDay = endAt ? startOfDay(new Date(endAt)) : firstDay;
    let added = false;

    for (let day = new Date(firstDay), guard = 0; day <= lastDay && guard < 370; guard += 1) {
      const key = getLocalDateKey(day.getTime());
      const minutes = getTimesheetMinutesForDay(item, key, nowTs);
      if (minutes > 0) {
        map.set(key, (map.get(key) || 0) + minutes);
        added = true;
      }
      day.setDate(day.getDate() + 1);
    }

    if (!added && item.workDate) {
      const minutes = Math.max(0, Number(item.workedMinutes || 0));
      if (minutes > 0) map.set(item.workDate, (map.get(item.workDate) || 0) + minutes);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, minutes]) => ({
      label: label.slice(5),
      value: minutes,
      displayValue: formatMinutes(minutes),
    }));
}

export function buildProjectMinuteBuckets(
  items: TimesheetItem[],
  nowTs = Date.now(),
  limitCount = 6,
  range?: TimesheetPeriodRange
) {
  const map = new Map<string, number>();
  for (const item of items) {
    const label = getProjectLabel(item);
    const minutes = range
      ? getTimesheetMinutesForRange(item, range, nowTs)
      : getEffectiveWorkedMinutes(item, nowTs);
    if (minutes <= 0) continue;
    map.set(label, (map.get(label) || 0) + minutes);
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

export function buildUserMinuteBuckets(
  items: TimesheetItem[],
  nowTs = Date.now(),
  limitCount = 8,
  range?: TimesheetPeriodRange
) {
  const map = new Map<string, { userId: string; userName: string; minutes: number }>();
  for (const item of items) {
    const minutes = range
      ? getTimesheetMinutesForRange(item, range, nowTs)
      : getEffectiveWorkedMinutes(item, nowTs);
    if (minutes <= 0) continue;
    const key = item.userId || item.userName || "unknown";
    const current = map.get(key) ?? {
      userId: item.userId,
      userName: item.userName || "Utilizator",
      minutes: 0,
    };
    current.minutes += minutes;
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
  const totalMinutes = params.items.reduce(
    (sum, item) => sum + getTimesheetMinutesForRange(item, params.range, nowTs),
    0
  );
  const workedDays = new Set(
    getWorkdaysInRange(params.range).filter((day) =>
      params.items.some((item) => getTimesheetMinutesForDay(item, day, nowTs) > 0)
    )
  ).size;
  const missingDays = getMissingWorkdaysForUser(params.items, params.range);
  const incomplete = params.items.filter(isIncompleteTimesheet);
  const projectCount = new Set(params.items.map((item) => item.projectId || getProjectLabel(item)))
    .size;

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
