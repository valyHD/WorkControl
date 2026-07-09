import type { TimesheetLocation } from "../../../types/timesheet";

function isCoordinateLabel(value: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim());
}

export function removeRomanianDiacritics(value?: string | null): string {
  return (value || "")
    .replace(/[ăĂ]/g, (match) => (match === "Ă" ? "A" : "a"))
    .replace(/[âÂ]/g, (match) => (match === "Â" ? "A" : "a"))
    .replace(/[îÎ]/g, (match) => (match === "Î" ? "I" : "i"))
    .replace(/[șşȘŞ]/g, (match) => (match === "Ș" || match === "Ş" ? "S" : "s"))
    .replace(/[țţȚŢ]/g, (match) => (match === "Ț" || match === "Ţ" ? "T" : "t"));
}

function isNoiseAddressPart(value: string) {
  const clean = removeRomanianDiacritics(value).trim().toLowerCase();
  if (!clean) return true;
  if (clean === "romania") return true;
  if (/\b\d{5,6}\b/.test(clean)) return true;
  if (clean.includes("judet") || clean.includes("county")) return true;
  return false;
}

function pickLocality(value: string) {
  const candidates = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => !isNoiseAddressPart(part));

  if (!candidates.length) return "";
  return candidates[candidates.length - 1] || "";
}

export function simplifyTimesheetAddressLabel(label?: string | null): string {
  const clean = removeRomanianDiacritics(label).replace(/\s+/g, " ").trim();
  if (!clean || isCoordinateLabel(clean)) return clean;

  const dashParts = clean
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => !isNoiseAddressPart(part));

  if (dashParts.length >= 2) {
    const street = dashParts[0] || "";
    const locality = pickLocality(dashParts[1] || "");
    return [street, locality].filter(Boolean).join(", ") || clean;
  }

  const commaParts = clean
    .split(",")
    .map((part) => part.trim())
    .filter((part) => !isNoiseAddressPart(part));

  if (commaParts.length >= 2) {
    const street = commaParts.slice(0, Math.max(1, commaParts.length - 1)).join(", ");
    const locality = commaParts[commaParts.length - 1] || "";
    return [street, locality].filter(Boolean).join(", ");
  }

  return clean;
}

export function formatTimesheetLocation(location: TimesheetLocation | null | undefined): string {
  if (!location) return "-";
  const label = simplifyTimesheetAddressLabel(location.label);
  if (label) return label;
  if (location.lat != null && location.lng != null) {
    return `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
  }
  return "-";
}
