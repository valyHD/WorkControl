const LEAVE_MONTHS: Record<string, number> = {
  ianuarie: 1,
  ian: 1,
  februarie: 2,
  feb: 2,
  martie: 3,
  mar: 3,
  aprilie: 4,
  apr: 4,
  mai: 5,
  iunie: 6,
  iun: 6,
  iulie: 7,
  iul: 7,
  august: 8,
  aug: 8,
  septembrie: 9,
  sept: 9,
  sep: 9,
  octombrie: 10,
  oct: 10,
  noiembrie: 11,
  noi: 11,
  decembrie: 12,
  dec: 12,
};

export type LeaveDateRange = {
  startDate: string;
  endDate: string;
};

type LeaveDateParts = {
  year: number;
  month: number;
  day: number;
};

const DAY_MS = 86_400_000;

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidLeaveDateParts(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= 1000 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= getDaysInMonth(year, month)
  );
}

function formatLeaveDateParts(year: number, month: number, day: number): string {
  if (!isValidLeaveDateParts(year, month, day)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoDateParts(value: string): LeaveDateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValidLeaveDateParts(parts.year, parts.month, parts.day) ? parts : null;
}

export function toLeaveIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeLeaveDateText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAssistantLeaveDate(value: unknown, fallbackYear = new Date().getFullYear()) {
  const raw = String(value ?? "").trim();
  const isoParts = parseIsoDateParts(raw);
  if (isoParts) return formatLeaveDateParts(isoParts.year, isoParts.month, isoParts.day);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";

  const numeric = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : fallbackYear;
    return formatLeaveDateParts(year, Number(numeric[2]), Number(numeric[1]));
  }

  const normalized = normalizeLeaveDateText(raw);
  const named = normalized.match(/\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?\b/);
  if (named) {
    const month = LEAVE_MONTHS[named[2]];
    const year = named[3]
      ? Number(named[3].length === 2 ? `20${named[3]}` : named[3])
      : fallbackYear;
    if (month) return formatLeaveDateParts(year, month, Number(named[1]));
  }

  return "";
}

export function inferAssistantLeaveRange(
  text: string,
  fallbackYear = new Date().getFullYear()
): LeaveDateRange | null {
  const normalized = normalizeLeaveDateText(text);
  const lastWeek = normalized.match(
    /ultima\s+saptamana\s+(?:din|de|in)?\s*([a-z]+)(?:\s+(\d{2,4}))?/
  );

  if (lastWeek) {
    const month = LEAVE_MONTHS[lastWeek[1]];
    const year = lastWeek[2]
      ? Number(lastWeek[2].length === 2 ? `20${lastWeek[2]}` : lastWeek[2])
      : fallbackYear;
    if (month && isValidLeaveDateParts(year, month, 1)) {
      const lastDay = getDaysInMonth(year, month);
      const lastDayOfWeek = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
      const endDay = lastDay - lastDayOfWeek;
      const startDay = endDay - 6;
      const startDate = formatLeaveDateParts(year, month, startDay);
      const endDate = formatLeaveDateParts(year, month, endDay);
      if (startDate && endDate) return { startDate, endDate };
    }
  }

  const range = normalized.match(
    /(?:intre|din)?\s*(\d{1,2})(?:\s+[a-z]+)?\s+(?:si|pana\s+pe|pana\s+la|pana|-)\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/
  );
  if (!range) return null;

  const month = LEAVE_MONTHS[range[3]];
  if (!month) return null;
  const year = range[4] ? Number(range[4].length === 2 ? `20${range[4]}` : range[4]) : fallbackYear;

  const startDate = formatLeaveDateParts(year, month, Number(range[1]));
  const endDate = formatLeaveDateParts(year, month, Number(range[2]));
  return startDate && endDate ? { startDate, endDate } : null;
}

export function calculateLeaveIntervalDays(startIso: string, endIso: string): number {
  const start = parseIsoDateParts(startIso);
  const end = parseIsoDateParts(endIso);
  if (!start || !end) return 0;

  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  if (endUtc < startUtc) return 0;
  return Math.floor((endUtc - startUtc) / DAY_MS) + 1;
}
