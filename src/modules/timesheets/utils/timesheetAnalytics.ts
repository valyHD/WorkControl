import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUserItem } from "../../../types/user";
import { formatMinutes } from "../services/timesheetsService";

export type TimesheetPeriodKey = "today" | "yesterday" | "week" | "month" | "custom" | "all";

export type TimesheetPeriodRange = {
  from: number;
  to: number;
  label: string;
};

const APP_TIME_ZONE = "Europe/Bucharest";

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const bucharestDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getBucharestCalendarParts(ts: number): CalendarParts {
  const values = Object.fromEntries(
    bucharestDateTimeFormatter
      .formatToParts(new Date(ts))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function formatDateKey(parts: Pick<CalendarParts, "year" | "month" | "day">) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDateKey(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function addCalendarDays(dayKey: string, amount: number) {
  const parsed = parseDateKey(dayKey);
  if (!parsed) return dayKey;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));
  return formatDateKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function getWeekday(dayKey: string) {
  const parsed = parseDateKey(dayKey);
  if (!parsed) return 0;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function getBucharestEpoch(
  dayKey: string,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
) {
  const parsed = parseDateKey(dayKey);
  if (!parsed) return Number.NaN;
  const targetAsUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    hour,
    minute,
    second,
    millisecond
  );
  let candidate = targetAsUtc;

  // Resolve the IANA timezone offset at the target instant. Repeating also covers DST changes.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getBucharestCalendarParts(candidate);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      millisecond
    );
    const correction = targetAsUtc - actualAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  return candidate;
}

export function getLocalDateKey(ts = Date.now()) {
  return formatDateKey(getBucharestCalendarParts(ts));
}

export function getLocalMonthKey(ts = Date.now()) {
  const parts = getBucharestCalendarParts(ts);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function formatShortDate(ts: number) {
  return new Date(ts).toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

export function getTimesheetPeriodRange(
  period: TimesheetPeriodKey,
  customFrom?: string,
  customTo?: string,
  nowTs = Date.now()
): TimesheetPeriodRange {
  const todayKey = getLocalDateKey(nowTs);
  const todayBounds = getDayBounds(todayKey);
  if (!todayBounds) {
    return { from: nowTs, to: nowTs, label: "Azi" };
  }

  if (period === "yesterday") {
    const yesterdayKey = addCalendarDays(todayKey, -1);
    const yesterday = getDayBounds(yesterdayKey);
    return {
      from: yesterday?.from ?? todayBounds.from,
      to: (yesterday?.to ?? todayBounds.to) - 1,
      label: "Ieri",
    };
  }

  if (period === "week") {
    const weekday = getWeekday(todayKey) || 7;
    const fromKey = addCalendarDays(todayKey, -weekday + 1);
    const from = getDayBounds(fromKey);
    return {
      from: from?.from ?? todayBounds.from,
      to: todayBounds.to - 1,
      label: "Saptamana asta",
    };
  }

  if (period === "month") {
    const from = getDayBounds(`${todayKey.slice(0, 7)}-01`);
    return {
      from: from?.from ?? todayBounds.from,
      to: todayBounds.to - 1,
      label: "Luna asta",
    };
  }

  if (period === "custom" && customFrom && customTo) {
    const from = getDayBounds(customFrom);
    const to = getDayBounds(customTo);
    if (from && to && from.from <= to.from) {
      return {
        from: from.from,
        to: to.to - 1,
        label: `${formatShortDate(from.from)} - ${formatShortDate(to.from)}`,
      };
    }
  }

  if (period === "all") {
    return { from: 0, to: Number.MAX_SAFE_INTEGER, label: "Toate" };
  }

  return {
    from: todayBounds.from,
    to: todayBounds.to - 1,
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
  if (!parseDateKey(dayKey)) return null;
  const from = getBucharestEpoch(dayKey);
  const to = getBucharestEpoch(addCalendarDays(dayKey, 1));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to };
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
    const firstDay = getLocalDateKey(startAt || nowTs);
    const lastDay = getLocalDateKey(endAt || startAt || nowTs);
    let added = false;

    for (let key = firstDay, guard = 0; key <= lastDay && guard < 370; guard += 1) {
      const minutes = getTimesheetMinutesForDay(item, key, nowTs);
      if (minutes > 0) {
        map.set(key, (map.get(key) || 0) + minutes);
        added = true;
      }
      key = addCalendarDays(key, 1);
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
  let dayKey = getLocalDateKey(range.from);
  const endKey = getLocalDateKey(Math.min(range.to, Date.now()));

  while (dayKey <= endKey && days.length < 370) {
    const day = getWeekday(dayKey);
    if (day !== 0 && day !== 6) {
      days.push(dayKey);
    }
    dayKey = addCalendarDays(dayKey, 1);
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
