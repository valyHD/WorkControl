import type { VehicleDocumentItem, VehicleDocumentSummary } from "../../../types/vehicle";

export const VEHICLE_DOCUMENT_MAX_BYTES = 18 * 1024 * 1024;
export const VEHICLE_DOCUMENT_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const VEHICLE_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function isValidDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 2000 &&
    year <= 2200 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function bucharestDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function isSupportedVehicleDocumentFile(file: Pick<File, "type" | "size">) {
  return (
    file.size > 0 &&
    file.size <= VEHICLE_DOCUMENT_MAX_BYTES &&
    VEHICLE_DOCUMENT_ACCEPTED_MIME_TYPES.includes(
      file.type as (typeof VEHICLE_DOCUMENT_ACCEPTED_MIME_TYPES)[number]
    )
  );
}

export function buildVehicleDocumentSummary(
  documents: VehicleDocumentItem[],
  now = new Date()
): VehicleDocumentSummary {
  const today = bucharestDateKey(now);
  const expiryDates = documents
    .map((item) => String(item.expiryDate || "").trim())
    .filter(isValidDateKey)
    .sort();

  return {
    count: documents.length,
    nextExpiryAt: expiryDates.find((dateKey) => dateKey >= today) || "",
    expiredCount: expiryDates.filter((dateKey) => dateKey < today).length,
    needsReviewCount: documents.filter((item) => item.intelligenceStatus === "needs_review").length,
    updatedAt: now.getTime(),
  };
}
