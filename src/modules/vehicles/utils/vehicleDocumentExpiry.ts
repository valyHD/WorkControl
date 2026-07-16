import type { VehicleItem } from "../../../types/vehicle";

export type VehicleDocumentExpiryItem = {
  id: string;
  vehicleId: string;
  plateNumber: string;
  documentType: "itp" | "rca" | "casco" | "rovinieta";
  label: string;
  expiryDate: string;
  daysLeft: number;
  status: "expired" | "today" | "critical" | "soon" | "ok";
};

const DOCUMENT_FIELDS = [
  { documentType: "itp", label: "ITP", field: "nextItpDate" },
  { documentType: "rca", label: "RCA", field: "nextRcaDate" },
  { documentType: "casco", label: "CASCO", field: "nextCascoDate" },
  { documentType: "rovinieta", label: "Rovinietă", field: "nextRovinietaDate" },
] as const;

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

function dateKeyToTimestamp(value: string) {
  if (!isValidDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function getBucharestDateKey(now = new Date()) {
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

export function getVehicleDocumentExpiryItems(
  vehicle: VehicleItem,
  now = new Date()
): VehicleDocumentExpiryItem[] {
  const today = dateKeyToTimestamp(getBucharestDateKey(now));
  if (today === null) return [];
  const legacyDates = new Map(
    (vehicle.documents || [])
      .filter((document) => document.expiryDate)
      .map((document) => [document.category, document.expiryDate] as const)
  );

  return DOCUMENT_FIELDS.flatMap((definition) => {
    const expiryDate = String(vehicle[definition.field] || legacyDates.get(definition.documentType) || "").trim();
    const expiry = dateKeyToTimestamp(expiryDate);
    if (expiry === null) return [];
    const daysLeft = Math.round((expiry - today) / 86_400_000);
    const status = daysLeft < 0
      ? "expired"
      : daysLeft === 0
        ? "today"
        : daysLeft <= 7
          ? "critical"
          : daysLeft <= 30
            ? "soon"
            : "ok";
    return [{
      id: `${vehicle.id}_${definition.documentType}`,
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber || "Fără număr",
      documentType: definition.documentType,
      label: definition.label,
      expiryDate,
      daysLeft,
      status,
    }];
  });
}

export function getVehicleDocumentAttentionItems(vehicles: VehicleItem[], now = new Date()) {
  return vehicles
    .flatMap((vehicle) => getVehicleDocumentExpiryItems(vehicle, now))
    .filter((item) => item.daysLeft <= 30)
    .sort((left, right) => left.daysLeft - right.daysLeft || left.plateNumber.localeCompare(right.plateNumber));
}
