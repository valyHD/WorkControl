import { normalizeAssistantText } from "./assistantFuzzy";

export type AssistantFormFieldKind = "text" | "number" | "date" | "email" | "phone" | "select" | "user" | "boolean";

export type AssistantFormFieldSchema = {
  key: string;
  label: string;
  kind: AssistantFormFieldKind;
  aliases: string[];
  required?: boolean;
  allowedValues?: string[];
};

export type AssistantFormSchema = {
  id: string;
  module: string;
  pagePatterns: string[];
  title: string;
  fields: AssistantFormFieldSchema[];
  submitAction?: string;
};

export const ASSISTANT_FORM_SCHEMAS: AssistantFormSchema[] = [
  {
    id: "maintenance-client",
    module: "maintenance",
    pagePatterns: ["/maintenance"],
    title: "Client mentenanta",
    submitAction: "maintenance-save-client",
    fields: [
      { key: "name", label: "Nume client", kind: "text", aliases: ["name", "nume", "client", "clientName"], required: true },
      { key: "email", label: "Email", kind: "email", aliases: ["email", "mail", "adresa email"] },
      { key: "maintenanceCompany", label: "Firma mentenanta", kind: "text", aliases: ["firma", "company", "maintenanceCompany", "firmaMentenanta"] },
      { key: "address", label: "Adresa", kind: "text", aliases: ["adresa", "address", "locatie", "strada"] },
      { key: "contactPerson", label: "Persoana contact", kind: "text", aliases: ["contact", "persoana contact", "contactPerson"] },
      { key: "contactPhone", label: "Telefon contact", kind: "phone", aliases: ["telefon", "phone", "contactPhone"] },
      { key: "liftNumbers", label: "Numar lift", kind: "text", aliases: ["lift", "liftNumber", "liftNumbers", "numar lift"], required: true },
      { key: "expiryDate", label: "Data expirare", kind: "date", aliases: ["expira", "expiryDate", "data expirare"] },
      { key: "revisionType", label: "Tip revizie", kind: "select", aliases: ["revizie", "revisionType", "tip revizie"], allowedValues: ["R1", "R2"] },
    ],
  },
  {
    id: "leave-request",
    module: "leave",
    pagePatterns: ["/my-leave"],
    title: "Cerere concediu",
    submitAction: "submit-leave-request",
    fields: [
      { key: "startDate", label: "Data inceput", kind: "date", aliases: ["startDate", "periodStart", "data inceput", "inceput"], required: true },
      { key: "endDate", label: "Data sfarsit", kind: "date", aliases: ["endDate", "periodEnd", "data sfarsit", "sfarsit"], required: true },
      { key: "reason", label: "Motiv", kind: "text", aliases: ["reason", "motiv", "observatii"] },
      { key: "requestType", label: "Tip cerere", kind: "select", aliases: ["tip", "requestType", "tip concediu"] },
    ],
  },
  {
    id: "vehicle",
    module: "vehicles",
    pagePatterns: ["/vehicles/new", "/vehicles/:id/edit"],
    title: "Masina",
    submitAction: "save-vehicle",
    fields: [
      { key: "plateNumber", label: "Numar inmatriculare", kind: "text", aliases: ["numar", "inmatriculare", "plateNumber"] },
      { key: "brand", label: "Marca", kind: "text", aliases: ["marca", "brand"] },
      { key: "model", label: "Model", kind: "text", aliases: ["model"] },
      { key: "currentKm", label: "Km curenti", kind: "number", aliases: ["km", "kilometri", "kilometraj", "currentKm"] },
      { key: "nextItpDate", label: "ITP", kind: "date", aliases: ["itp", "data itp", "nextItpDate"] },
      { key: "currentDriverUserId", label: "Sofer curent", kind: "user", aliases: ["sofer", "driver", "conducator"] },
      { key: "status", label: "Status", kind: "select", aliases: ["status", "stare"], allowedValues: ["activa", "in_service", "indisponibila", "avariata"] },
    ],
  },
  {
    id: "tool",
    module: "tools",
    pagePatterns: ["/tools/new", "/tools/:id/edit"],
    title: "Scula",
    submitAction: "save-tool",
    fields: [
      { key: "name", label: "Nume", kind: "text", aliases: ["nume", "denumire", "scula"] },
      { key: "internalCode", label: "Cod intern", kind: "text", aliases: ["cod", "cod intern", "internalCode"] },
      { key: "status", label: "Status", kind: "select", aliases: ["status", "stare"], allowedValues: ["depozit", "atribuita", "defecta", "pierduta"] },
      { key: "currentHolderUserId", label: "Detinator", kind: "user", aliases: ["detinator", "utilizator", "holder"] },
      { key: "locationLabel", label: "Locatie", kind: "text", aliases: ["locatie", "unde este"] },
      { key: "description", label: "Observatii", kind: "text", aliases: ["observatii", "descriere"] },
    ],
  },
  {
    id: "user",
    module: "users",
    pagePatterns: ["/users/:id/edit", "/my-profile"],
    title: "Utilizator",
    submitAction: "save-user",
    fields: [
      { key: "fullName", label: "Nume", kind: "text", aliases: ["nume", "nume complet"] },
      { key: "role", label: "Rol aplicatie", kind: "select", aliases: ["rol", "drepturi"], allowedValues: ["admin", "manager", "angajat"] },
      { key: "roleTitle", label: "Functie", kind: "select", aliases: ["functie", "meserie", "post", "roleTitle"] },
      { key: "department", label: "Departament", kind: "select", aliases: ["departament", "echipa", "department"] },
      { key: "active", label: "Activ", kind: "boolean", aliases: ["activ", "status activ"] },
    ],
  },
  {
    id: "timesheet",
    module: "timesheets",
    pagePatterns: ["/my-timesheets", "/timesheets"],
    title: "Pontaj",
    fields: [
      { key: "project", label: "Proiect", kind: "text", aliases: ["proiect", "lucrare", "project"], required: true },
      { key: "explanation", label: "Explicatie", kind: "text", aliases: ["explicatie", "motiv", "observatii"] },
    ],
  },
];

function pathMatchesPattern(pattern: string, pathname: string) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(":") || normalizeAssistantText(part) === normalizeAssistantText(pathParts[index]));
}

export function getAssistantFormSchemaById(schemaId?: string | null) {
  if (!schemaId) return null;
  const normalized = normalizeAssistantText(schemaId);
  return ASSISTANT_FORM_SCHEMAS.find((schema) => normalizeAssistantText(schema.id) === normalized) || null;
}

export function getAssistantFormSchemaForPage(pathname: string) {
  return ASSISTANT_FORM_SCHEMAS.find((schema) => schema.pagePatterns.some((pattern) => pathMatchesPattern(pattern, pathname))) || null;
}

export function resolveAssistantFormField(schema: AssistantFormSchema, naturalName: string) {
  const normalized = normalizeAssistantText(naturalName);
  return schema.fields.find((field) => {
    if (normalizeAssistantText(field.key) === normalized || normalizeAssistantText(field.label) === normalized) return true;
    return field.aliases.some((alias) => {
      const normalizedAlias = normalizeAssistantText(alias);
      return normalized === normalizedAlias || normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
    });
  }) || null;
}

export function normalizeAssistantFormFields(schema: AssistantFormSchema, fields: Record<string, unknown>) {
  const normalizedFields: Record<string, unknown> = {};
  const unknownFields: string[] = [];

  Object.entries(fields || {}).forEach(([fieldName, value]) => {
    const field = resolveAssistantFormField(schema, fieldName);
    if (!field) {
      unknownFields.push(fieldName);
      return;
    }
    normalizedFields[field.key] = value;
  });

  return { fields: normalizedFields, unknownFields };
}

export function getMissingAssistantFormFields(schema: AssistantFormSchema, fields: Record<string, unknown>) {
  return schema.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = fields[field.key];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === null || String(value).trim() === "";
    })
    .map((field) => field.key);
}
