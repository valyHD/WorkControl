export function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/\//g, "_").replace(/\\/g, "_").replace(/\s+/g, " ").trim() || "-";
}

export function buildReportFolderDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

export function generateReportId(now = new Date()): string {
  return `RPT_${buildReportFolderDate(now)}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function reviewStandardText(liftNumber: string): string {
  const firstChar = liftNumber.trim()[0] ?? "";
  if (["1", "2", "7"].includes(firstChar)) {
    return "Declar ca am controlat echipamentul efectuand in conformitate cu P.T. ISCIR – R2, toate lucrarile necesare pentru a asigura bunul mers si siguranta functionarii. La terminarea reviziei am facut 5 (cinci) curse in ambele sensuri ale instalatiei si am constatat: Ascensorul functioneaza normal. Prezentul document atesta indeplinirea conditiilor de calitate a lucrarilor efectuate in conformitate cu legislatia in vigoare.";
  }

  return "Declar ca am controlat echipamentul efectuand in conformitate cu P.T. ISCIR – R1, toate lucrarile necesare pentru a asigura bunul mers si siguranta functionarii. La terminarea reviziei am efectuat 2 curse in ambele sensuri ale instalatiei si am constatat: Platforma functioneaza normal. Prezentul document atesta indeplinirea conditiilor de calitate a lucrarilor efectuate in conformitate cu legislatia in vigoare.";
}
