import type { LiftUnit, MaintenanceClient } from "../../../types/maintenance";
import type { MaintenanceCompanyBranding } from "../../../types/maintenance";

export type ReportType = "revizie" | "interventie" | string;

export type MaintenanceBranding = {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  logoUrl?: string;
  stampUrl?: string;
  signatureUrl?: string;
};

export type MaintenanceReport = {
  reportType?: ReportType;
  continutRaport?: string;
  notes?: string;
  observations?: string;
  createdAt?: number | string;
  locationText?: string;
  technicianName?: string;
  dateText?: string;
  timeText?: string;
  address?: string;
};

export type PdfInput = {
  client: MaintenanceClient;
  lift: LiftUnit;
  branding: MaintenanceBranding | null;
  report: Omit<MaintenanceReport, "id" | "pdfUrl">;
};

function normalizeCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveBrandingForCompany(
  companyName: string,
  brandingList: MaintenanceCompanyBranding[]
): MaintenanceBranding | null {
  const targetKey = normalizeCompanyKey(companyName);
  if (!targetKey) {
    return null;
  }

  const found = brandingList.find((item) => item.companyKey === targetKey);
  if (!found) {
    return null;
  }

  return {
    companyName: found.companyName,
    logoUrl: found.logoUrl,
    stampUrl: found.stampUrl,
  };
}

function getLiftLabel(lift: LiftUnit): string {
  const candidate =
    (lift as { liftNumber?: string }).liftNumber ||
    (lift as { number?: string }).number ||
    (lift as { code?: string }).code ||
    (lift as { name?: string }).name ||
    (lift as { id?: string }).id ||
    "-";

  return String(candidate).trim() || "-";
}

function getClientName(client: MaintenanceClient): string {
  const candidate =
    (client as { name?: string }).name ||
    (client as { clientName?: string }).clientName ||
    (client as { companyName?: string }).companyName ||
    (client as { nume?: string }).nume ||
    (client as { id?: string }).id ||
    "-";

  return String(candidate).trim() || "-";
}

function splitTextSafe(value?: string, maxLen = 95): string[] {
  const text = String(value || "").trim();
  if (!text) return ["-"];

  const parts = text
    .match(new RegExp(`.{1,${maxLen}}(\\s|$)`, "g"))
    ?.map((item: string) => item.trim())
    .filter(Boolean);

  return parts && parts.length ? parts : [text];
}

function formatCreatedAt(value?: number | string): { dateText: string; timeText: string } {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return {
      dateText: date.toLocaleDateString("ro-RO"),
      timeText: date.toLocaleTimeString("ro-RO"),
    };
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        dateText: parsed.toLocaleDateString("ro-RO"),
        timeText: parsed.toLocaleTimeString("ro-RO"),
      };
    }

    return {
      dateText: value,
      timeText: "-",
    };
  }

  return {
    dateText: "-",
    timeText: "-",
  };
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildPdf(lines: string[]): Blob {
  const textCommands: string[] = ["BT", "/F1 10 Tf", "40 800 Td", "14 TL"];

  lines.forEach((line, index) => {
    if (index > 0) textCommands.push("T*");
    textCommands.push(`(${escapePdfText(line)}) Tj`);
  });

  textCommands.push("ET");

  const stream = textCommands.join("\n");
  const streamLength = new TextEncoder().encode(stream).length;

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${streamLength} >> stream\n${stream}\nendstream endobj`,
  ];

  let offset = 9;
  const bodyParts: string[] = [];
  const xrefRows = ["0000000000 65535 f "];

  for (const object of objects) {
    xrefRows.push(`${String(offset).padStart(10, "0")} 00000 n `);
    bodyParts.push(`${object}\n`);
    offset += new TextEncoder().encode(`${object}\n`).length;
  }

  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length + 1}\n${xrefRows.join("\n")}\n`;
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob(
    [`%PDF-1.4\n${bodyParts.join("")}${xref}${trailer}`],
    { type: "application/pdf" }
  );
}

export async function buildMaintenancePdfBlob(input: PdfInput): Promise<Blob> {
  const { client, lift, report, branding } = input;

  const normalizedType = report.reportType === "interventie" ? "interventie" : "revizie";
  const title =
    normalizedType === "interventie" ? "RAPORT INTERVENTIE" : "RAPORT REVIZIE";

  const fallbackDate = formatCreatedAt(report.createdAt);
  const dateText = report.dateText || fallbackDate.dateText;
  const timeText = report.timeText || fallbackDate.timeText;

  const firma =
    branding?.companyName ||
    "DEFAULT";

  const address =
    report.address ||
    report.locationText ||
    "-";

  const locationText =
    report.locationText ||
    "-";

  const technicianName =
    report.technicianName ||
    "-";

  const reportText =
    report.continutRaport ||
    report.notes ||
    report.observations ||
    "-";

  const lines = [
    title,
    `Firma: ${firma}`,
    `Logo URL: ${branding?.logoUrl || "-"}`,
    `Stampila URL: ${branding?.stampUrl || "-"}`,
    `Locatie generare raport: ${locationText}`,
    `Data: ${dateText} ${timeText}`,
    `Client: ${getClientName(client)}`,
    `Adresa: ${address}`,
    `Lift: ${getLiftLabel(lift)}`,
    `Tehnician: ${technicianName}`,
    `Tip lucrare: ${normalizedType}`,
    "",
    normalizedType === "interventie"
      ? "Constatare interventie:"
      : "Continut revizie:",
    ...splitTextSafe(reportText, 95),
    "",
    "Semnatura beneficiar: _____________________",
    "Semnatura tehnician: _____________________",
  ];

  return buildPdf(lines);
}

export function defaultEmailSubject(type: ReportType, dateText: string): string {
  return type === "interventie"
    ? `Raport Interventie ${dateText}`
    : `Raport Revizie ${dateText}`;
}

export function defaultEmailBody(type: ReportType, firma: string): string {
  return `Buna ziua,\n\nVa transmitem in atasament Raportul de ${
    type === "interventie" ? "Interventie" : "Revizie"
  }.\n\nO zi buna!\nEchipa ${firma}`;
}
