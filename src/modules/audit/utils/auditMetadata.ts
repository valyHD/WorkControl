export type AuditFieldDescriptor<T extends object> = {
  key: keyof T & string;
  label: string;
  format?: (value: unknown) => string;
};

function normalizeForCompare(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "da" : "nu";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "da" : "nu";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") return value.trim() || "-";
  if (Array.isArray(value)) return value.length ? `${value.length} elemente` : "-";
  if (typeof value === "object") return "date complexe";
  return String(value);
}

export function buildAuditChanges<T extends object>(
  before: Partial<T> | null | undefined,
  after: Partial<T>,
  fields: AuditFieldDescriptor<T>[]
): string[] {
  return fields
    .map((field) => {
      const beforeValue = before?.[field.key];
      const afterValue = after[field.key];
      const normalizedBefore = normalizeForCompare(beforeValue);
      const normalizedAfter = normalizeForCompare(afterValue);

      if (normalizedBefore === normalizedAfter) return "";

      const format = field.format ?? formatAuditValue;
      return `${field.label}: ${format(beforeValue)} -> ${format(afterValue)}`;
    })
    .filter(Boolean)
    .slice(0, 60);
}

export function buildAuditSnapshot<T extends object>(
  values: Partial<T>,
  fields: AuditFieldDescriptor<T>[]
): string[] {
  return fields
    .map((field) => {
      const value = values[field.key];
      const formatted = (field.format ?? formatAuditValue)(value);
      if (formatted === "-") return "";
      return `${field.label}: ${formatted}`;
    })
    .filter(Boolean)
    .slice(0, 60);
}
