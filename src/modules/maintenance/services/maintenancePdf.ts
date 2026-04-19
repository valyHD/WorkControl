import type { LiftUnit, MaintenanceClient, MaintenanceReport } from "../../../types/maintenance";

type PdfInput = {
  client: MaintenanceClient;
  lift: LiftUnit;
  report: Omit<MaintenanceReport, "id" | "pdfUrl">;
  companyName: string;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatGps(report: Omit<MaintenanceReport, "id" | "pdfUrl">): string {
  if (report.gpsLat == null || report.gpsLng == null) return report.gpsAddress || "Locatie indisponibila";
  return `${report.gpsLat.toFixed(6)}, ${report.gpsLng.toFixed(6)}`;
}

export function buildMaintenancePdfBlob(input: PdfInput): Blob {
  const { client, lift, report, companyName } = input;
  const lines = [
    `${companyName}`,
    "RAPORT MENTENANTA LIFT",
    `Tip raport: ${report.reportType.toUpperCase()}`,
    "",
    `Client: ${client.name}`,
    `Persoana contact: ${client.contactPerson || "-"}`,
    `Telefon: ${client.phone || "-"}`,
    `Lift: ${lift.liftNumber}`,
    `Adresa: ${lift.exactAddress || client.mainAddress || "-"}`,
    `Tehnician: ${report.technicianName || "-"}`,
    `Data: ${report.dateText} ${report.timeText}`,
    `GPS: ${formatGps(report)}`,
    "",
    "CONTINUT",
    `Text standard: ${report.standardText || "-"}`,
    `Checklist: ${report.reviewChecklist.join(", ") || "-"}`,
    `Observatii: ${report.observations || "-"}`,
    `Reclamatie: ${report.complaint || "-"}`,
    `Constatare: ${report.finding || "-"}`,
    `Lucrare efectuata: ${report.workPerformed || "-"}`,
    `Piese schimbate: ${report.replacedParts || "-"}`,
    `Recomandari: ${report.recommendations || "-"}`,
    "",
    "Semnatura tehnician: _____________________",
  ];

  const textCommands: string[] = ["BT", "/F1 11 Tf", "50 790 Td", "14 TL"];
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

  const pdf = `%PDF-1.4\n${bodyParts.join("")}${xref}${trailer}`;
  return new Blob([pdf], { type: "application/pdf" });
}
