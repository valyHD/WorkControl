import type { AssistantFieldChange, AssistantRuntimeEntityType } from "./assistantTypes";
import { normalizeAssistantText, tokenMatches } from "./assistantFuzzy";

type FieldMapItem = {
  key: string;
  label: string;
  aliases: string[];
  kind: "text" | "number" | "date" | "status" | "user";
};

const VEHICLE_FIELDS: FieldMapItem[] = [
  { key: "currentKm", label: "Km curenti", aliases: ["kilometri", "km", "kilometraj"], kind: "number" },
  { key: "nextItpDate", label: "ITP", aliases: ["itp"], kind: "date" },
  { key: "nextRcaDate", label: "RCA", aliases: ["rca", "asigurare"], kind: "date" },
  { key: "nextCascoDate", label: "CASCO", aliases: ["casco"], kind: "date" },
  { key: "nextRovinietaDate", label: "Rovinieta", aliases: ["rovinieta"], kind: "date" },
  { key: "nextOilServiceKm", label: "Schimb ulei", aliases: ["ulei", "schimb ulei"], kind: "number" },
  { key: "nextServiceKm", label: "Revizie", aliases: ["revizie", "service"], kind: "number" },
  { key: "plateNumber", label: "Numar inmatriculare", aliases: ["numar", "numar inmatriculare", "placuta"], kind: "text" },
  { key: "brand", label: "Marca", aliases: ["marca", "brand"], kind: "text" },
  { key: "model", label: "Model", aliases: ["model"], kind: "text" },
  { key: "vin", label: "VIN", aliases: ["vin", "serie sasiu"], kind: "text" },
  { key: "status", label: "Status", aliases: ["status", "stare"], kind: "status" },
  { key: "driver", label: "Sofer", aliases: ["sofer", "conducator", "driver"], kind: "user" },
  { key: "owner", label: "Responsabil", aliases: ["responsabil", "proprietar", "owner"], kind: "user" },
];

const TOOL_FIELDS: FieldMapItem[] = [
  { key: "name", label: "Nume", aliases: ["nume", "denumire"], kind: "text" },
  { key: "internalCode", label: "Cod intern", aliases: ["cod", "cod intern"], kind: "text" },
  { key: "qrCodeValue", label: "Cod QR", aliases: ["qr", "cod qr"], kind: "text" },
  { key: "status", label: "Status", aliases: ["status", "stare"], kind: "status" },
  { key: "owner", label: "Responsabil", aliases: ["responsabil", "proprietar", "owner"], kind: "user" },
  { key: "holder", label: "Detinator", aliases: ["detinator", "utilizator", "la cine este"], kind: "user" },
  { key: "locationLabel", label: "Locatie", aliases: ["locatie", "locatia", "unde este"], kind: "text" },
  { key: "description", label: "Observatii", aliases: ["observatii", "descriere", "note"], kind: "text" },
  { key: "warrantyUntil", label: "Garantie", aliases: ["garantie"], kind: "date" },
];

const PROJECT_FIELDS: FieldMapItem[] = [
  { key: "name", label: "Nume proiect", aliases: ["nume", "proiect"], kind: "text" },
  { key: "status", label: "Status", aliases: ["status", "stare"], kind: "status" },
];

const USER_FIELDS: FieldMapItem[] = [
  { key: "roleTitle", label: "Functie", aliases: ["functie", "meserie", "post", "functia"], kind: "text" },
  { key: "department", label: "Departament", aliases: ["departament", "echipa", "departamentul"], kind: "text" },
  { key: "role", label: "Rol aplicatie", aliases: ["rol", "drepturi", "rol aplicatie"], kind: "status" },
  { key: "fullName", label: "Nume", aliases: ["nume", "nume complet"], kind: "text" },
];

const MONTHS: Record<string, number> = {
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

function getFieldMap(entityType: AssistantRuntimeEntityType) {
  if (entityType === "vehicle") return VEHICLE_FIELDS;
  if (entityType === "tool") return TOOL_FIELDS;
  if (entityType === "project") return PROJECT_FIELDS;
  if (entityType === "user") return USER_FIELDS;
  return [];
}

export function getAssistantFieldDefinitions(entityType: AssistantRuntimeEntityType) {
  return getFieldMap(entityType).map((field) => ({ ...field, aliases: [...field.aliases] }));
}

export function resolveAssistantField(entityType: AssistantRuntimeEntityType, naturalName: string) {
  const normalized = normalizeAssistantText(naturalName);
  const fields = getFieldMap(entityType);

  return fields
    .map((field) => {
      let score = 0;
      if (normalizeAssistantText(field.key) === normalized) score += 2;
      if (normalizeAssistantText(field.label) === normalized) score += 1.5;
      field.aliases.forEach((alias) => {
        const normalizedAlias = normalizeAssistantText(alias);
        if (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)) score += 1;
        if (tokenMatches(normalizedAlias, normalized)) score += 0.5;
      });
      return { field, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.field || null;
}

function toIsoDate(day: number, month: number, year: number) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseAssistantDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const normalized = normalizeAssistantText(raw);
  const numeric = normalized.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : new Date().getFullYear();
    return toIsoDate(Number(numeric[1]), Number(numeric[2]), year);
  }
  const named = normalized.match(/\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?\b/);
  if (named) {
    const month = MONTHS[named[2]];
    const year = named[3] ? Number(named[3].length === 2 ? `20${named[3]}` : named[3]) : new Date().getFullYear();
    if (month) return toIsoDate(Number(named[1]), month, year);
  }
  return raw;
}

export function normalizeVehicleStatus(value: unknown) {
  const normalized = normalizeAssistantText(String(value ?? ""));
  if (["activa", "activ", "functionala", "buna", "merge"].some((term) => normalized.includes(term))) return "activa";
  if (["in service", "la service", "service", "revizie"].some((term) => normalized.includes(term))) return "in_service";
  if (["indisponibila", "indisponibil", "nu merge"].some((term) => normalized.includes(term))) return "indisponibila";
  if (["avariata", "avariat", "lovita", "defecta", "defect"].some((term) => normalized.includes(term))) return "avariata";
  return normalized;
}

export function normalizeToolStatus(value: unknown) {
  const normalized = normalizeAssistantText(String(value ?? ""));
  if (["depozit", "disponibila", "disponibil", "libera", "liber"].some((term) => normalized.includes(term))) return "depozit";
  if (["atribuita", "la utilizator", "folosita"].some((term) => normalized.includes(term))) return "atribuita";
  if (["defecta", "defect", "stricata"].some((term) => normalized.includes(term))) return "defecta";
  if (["pierduta", "pierdut", "disparuta"].some((term) => normalized.includes(term))) return "pierduta";
  return normalized;
}

export function normalizeProjectStatus(value: unknown) {
  const normalized = normalizeAssistantText(String(value ?? ""));
  if (["activ", "activa"].some((term) => normalized.includes(term))) return "activ";
  if (["inactiv", "inactiva"].some((term) => normalized.includes(term))) return "inactiv";
  if (["finalizat", "terminat", "inchis"].some((term) => normalized.includes(term))) return "finalizat";
  return normalized;
}

function normalizeFieldValue(entityType: AssistantRuntimeEntityType, field: FieldMapItem, value: unknown) {
  if (field.kind === "number") {
    const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.kind === "date") return parseAssistantDate(value);
  if (field.kind === "status" && entityType === "vehicle") return normalizeVehicleStatus(value);
  if (field.kind === "status" && entityType === "tool") return normalizeToolStatus(value);
  if (field.kind === "status" && entityType === "project") return normalizeProjectStatus(value);
  if (field.key === "plateNumber" || field.key === "vin" || field.key === "internalCode" || field.key === "qrCodeValue") {
    return String(value ?? "").replace(/\s+/g, "").toUpperCase();
  }
  return String(value ?? "").trim();
}

export function resolveAssistantFieldChanges(
  entityType: AssistantRuntimeEntityType,
  fieldsToUpdate: Record<string, unknown>,
  currentData: Record<string, unknown>
): { changes: AssistantFieldChange[]; missingFields: string[] } {
  const changes: AssistantFieldChange[] = [];
  const missingFields: string[] = [];

  Object.entries(fieldsToUpdate || {}).forEach(([naturalName, rawValue]) => {
    const field = resolveAssistantField(entityType, naturalName);
    if (!field) {
      missingFields.push(naturalName);
      return;
    }

    const normalizedValue = normalizeFieldValue(entityType, field, rawValue);
    if (normalizedValue === null || normalizedValue === "") {
      missingFields.push(naturalName);
      return;
    }

    const oldValue = currentData[field.key] ?? "";
    changes.push({
      naturalName,
      fieldKey: field.key,
      label: field.label,
      oldValue,
      newValue: normalizedValue,
      displayOldValue: String(oldValue || "-"),
      displayNewValue: String(normalizedValue),
      requiresSpecialConfirmation:
        entityType === "vehicle" && field.key === "currentKm" && Number(normalizedValue) < Number(oldValue || 0),
    });
  });

  return { changes, missingFields };
}
