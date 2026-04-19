/**
 * safeData.ts — Centralized safe parsing utilities
 *
 * Use these helpers wherever Firestore data enters the app to prevent
 * undefined/null crashes and ensure consistent type coercion.
 */

/** Returns value if it's a non-empty string, otherwise fallback */
export function safeStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Returns value if it's a finite number, otherwise fallback */
export function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Returns value if it's an optional finite number, otherwise undefined */
export function safeOptNum(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Returns value if it's a boolean, otherwise fallback */
export function safeBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Returns value if it's a non-null object (not array), otherwise empty object */
export function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Returns value if it's an array, otherwise empty array */
export function safeArr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Clamps a number between min and max (both inclusive) */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Returns true only for valid lat/lng pairs (non-zero, within range) */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Returns a valid timestamp (between year 2000 and 2100) or null */
export function safeTs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 946_684_800_000 || n > 4_102_444_800_000) return null;
  return n;
}

/** Formats a timestamp for Romanian locale display, returns fallback on invalid input */
export function formatRoDate(ts: unknown, fallback = "—"): string {
  const n = safeTs(ts);
  if (n === null) return fallback;
  try {
    return new Date(n).toLocaleString("ro-RO");
  } catch {
    return fallback;
  }
}

/** Formats a date-only string for Romanian locale display */
export function formatRoDateOnly(ts: unknown, fallback = "—"): string {
  const n = safeTs(ts);
  if (n === null) return fallback;
  try {
    return new Date(n).toLocaleDateString("ro-RO");
  } catch {
    return fallback;
  }
}

/** Safely access a deeply nested value; returns undefined if any segment is missing */
export function safeGet<T>(
  obj: unknown,
  ...keys: string[]
): T | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
}

/** Wraps an async function; returns [result, null] or [null, error] */
export async function safeAsync<T>(
  fn: () => Promise<T>
): Promise<[T, null] | [null, Error]> {
  try {
    const result = await fn();
    return [result, null];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err))];
  }
}

/** Returns the initials (1-2 chars) from a full name */
export function getInitials(name: string): string {
  const clean = (name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

/** Debounce — returns a debounced version of the given function */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
