import type { LiftUnit, MaintenanceBranding, MaintenanceClient, MaintenanceReport, ReportType } from "../../../types/maintenance";

type PdfInput = {
  client: MaintenanceClient;
  lift: LiftUnit;
  branding: MaintenanceBranding | null;
  report: Omit<MaintenanceReport, "id" | "pdfUrl">;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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

  return new Blob([`%PDF-1.4\n${bodyParts.join("")}${xref}${trailer}`], { type: "application/pdf" });
}

export async function buildMaintenancePdfBlob(input: PdfInput): Promise<Blob> {
  const { client, lift, report, branding } = input;
  const title = report.reportType === "interventie" ? "RAPORT INTERVENTIE" : "RAPORT REVIZIE";
  const lines = [
    `${title}`,
    `Firma: ${branding?.nume || "DEFAULT"}`,
    `Logo URL: ${branding?.logoUrl || "-"}`,
    `Stampila URL: ${branding?.stampilaUrl || "-"}`,
    `Locatie generare raport: ${report.gpsLocatie || "Locatie indisponibila"}`,
    `Data: ${report.dateText} ${report.timeText}`,
    `Client: ${client.name}`,
    `Adresa: ${report.adresa}`,
    `Lift: ${lift.liftNumber}`,
    `Tehnician: ${report.technicianName}`,
    `Tip lucrare: ${report.reportType}`,
    "",
    report.reportType === "interventie" ? "Constatare interventie:" : "Continut revizie:",
    ...report.continutRaport.match(/.{1,95}(\s|$)/g)?.map((item) => item.trim()).filter(Boolean) || ["-"],
    "",
    "Semnatura beneficiar: _____________________",
    "Semnatura tehnician: _____________________",
  ];

  return buildPdf(lines);
}

export function defaultEmailSubject(type: ReportType, dateText: string): string {
  return type === "interventie" ? `Raport Interventie ${dateText}` : `Raport Revizie ${dateText}`;
}

export function defaultEmailBody(type: ReportType, firma: string): string {
  return `Buna ziua,\n\nVa transmitem in atasament Raportul de ${type === "interventie" ? "Interventie" : "Revizie"}.\n\nO zi buna!\nEchipa ${firma}`;
}
