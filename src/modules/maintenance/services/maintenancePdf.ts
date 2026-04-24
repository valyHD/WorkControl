import type { LiftUnit, MaintenanceClient } from "../../../types/maintenance";
import type { MaintenanceCompanyBranding } from "../../../types/maintenance";
import { getBlob, ref } from "firebase/storage";
import { storage } from "../../../lib/firebase/firebase";

export type ReportType = "revizie" | "interventie" | string;

export type MaintenanceBranding = {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  logoUrl?: string;
  stampUrl?: string;
  logoPath?: string;
  stampPath?: string;
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
    logoPath: found.logoPath,
    stampPath: found.stampPath,
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

function parseFirebaseStoragePathFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const marker = "/o/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return "";
    const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
    return decodeURIComponent(encodedPath);
  } catch {
    return "";
  }
}

async function loadImageAsJpegHex(input: { url?: string; path?: string }): Promise<{ width: number; height: number; hex: string } | null> {
  const resolvedPath = input.path || parseFirebaseStoragePathFromUrl(input.url);
  if (!input.url && !resolvedPath) {
    return null;
  }

  try {
    let blob: Blob | null = null;
    if (resolvedPath) {
      blob = await getBlob(ref(storage, resolvedPath));
    } else if (input.url) {
      const response = await fetch(input.url);
      if (!response.ok) {
        return null;
      }
      blob = await response.blob();
    }
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.86);
    });

    if (!jpegBlob) {
      return null;
    }

    const buffer = await jpegBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const hex = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return {
      width: bitmap.width,
      height: bitmap.height,
      hex,
    };
  } catch {
    return null;
  }
}

function scaleInside(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number) {
  if (!sourceWidth || !sourceHeight) {
    return { width: maxWidth, height: maxHeight };
  }

  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  return {
    width: Math.max(1, sourceWidth * ratio),
    height: Math.max(1, sourceHeight * ratio),
  };
}

function buildPdfDocument(input: {
  lines: string[];
  title: string;
  logo: { width: number; height: number; hex: string } | null;
  stamp: { width: number; height: number; hex: string } | null;
}): Blob {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const lineHeight = 14;
  const { lines, title, logo, stamp } = input;

  const bodyCommands: string[] = ["BT", "/F1 10 Tf", `${margin} 760 Td`, `${lineHeight} TL`];
  lines.forEach((line, index) => {
    if (index > 0) bodyCommands.push("T*");
    bodyCommands.push(`(${escapePdfText(line)}) Tj`);
  });
  bodyCommands.push("ET");

  const titleWidthEstimate = title.length * 7;
  const titleX = Math.max(margin, Math.floor((pageWidth - titleWidthEstimate) / 2));
  bodyCommands.push(`BT /F1 18 Tf ${titleX} 800 Td (${escapePdfText(title)}) Tj ET`);

  if (logo) {
    const logoSize = scaleInside(logo.width, logo.height, 120, 60);
    const logoX = pageWidth - margin - logoSize.width;
    const logoY = pageHeight - margin - logoSize.height;
    bodyCommands.push(`q ${logoSize.width.toFixed(2)} 0 0 ${logoSize.height.toFixed(2)} ${logoX.toFixed(2)} ${logoY.toFixed(2)} cm /ImLogo Do Q`);
  }

  if (stamp) {
    const stampSize = scaleInside(stamp.width, stamp.height, 130, 90);
    const stampX = margin;
    const stampY = margin;
    bodyCommands.push(`q ${stampSize.width.toFixed(2)} 0 0 ${stampSize.height.toFixed(2)} ${stampX.toFixed(2)} ${stampY.toFixed(2)} cm /ImStamp Do Q`);
  }

  const contentStream = bodyCommands.join("\n");
  const contentLength = new TextEncoder().encode(contentStream).length;

  const xObjects: string[] = [];
  if (logo) xObjects.push("/ImLogo 5 0 R");
  if (stamp) xObjects.push(`/ImStamp ${logo ? 6 : 5} 0 R`);

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push(
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> ${
      xObjects.length ? `/XObject << ${xObjects.join(" ")} >>` : ""
    } >> /Contents ${logo && stamp ? 7 : logo || stamp ? 6 : 5} 0 R >> endobj`
  );
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");

  if (logo) {
    objects.push(
      `5 0 obj << /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logo.hex.length + 1} >> stream\n${logo.hex}>\nendstream endobj`
    );
  }

  if (stamp) {
    const stampObjectId = logo ? 6 : 5;
    objects.push(
      `${stampObjectId} 0 obj << /Type /XObject /Subtype /Image /Width ${stamp.width} /Height ${stamp.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${stamp.hex.length + 1} >> stream\n${stamp.hex}>\nendstream endobj`
    );
  }

  const contentObjectId = logo && stamp ? 7 : logo || stamp ? 6 : 5;
  objects.push(
    `${contentObjectId} 0 obj << /Length ${contentLength} >> stream\n${contentStream}\nendstream endobj`
  );

  let offset = new TextEncoder().encode("%PDF-1.4\n").length;
  const xrefRows = ["0000000000 65535 f "];
  const chunks: string[] = ["%PDF-1.4\n"];

  for (const object of objects) {
    xrefRows.push(`${String(offset).padStart(10, "0")} 00000 n `);
    const chunk = `${object}\n`;
    chunks.push(chunk);
    offset += new TextEncoder().encode(chunk).length;
  }

  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length + 1}\n${xrefRows.join("\n")}\n`;
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([chunks.join(""), xref, trailer], { type: "application/pdf" });
}

export async function buildMaintenancePdfBlob(input: PdfInput): Promise<Blob> {
  const { client, lift, report, branding } = input;

  const normalizedType = report.reportType === "interventie" ? "interventie" : "revizie";
  const title = normalizedType === "interventie" ? "RAPORT INTERVENTIE" : "RAPORT REVIZIE";

  const fallbackDate = formatCreatedAt(report.createdAt);
  const dateText = report.dateText || fallbackDate.dateText;
  const timeText = report.timeText || fallbackDate.timeText;

  const firma = branding?.companyName || "-";
  const address = report.address || report.locationText || "-";
  const technicianName = report.technicianName || "-";
  const reportText = report.continutRaport || report.notes || report.observations || "-";

  const lines = [
    `Client: ${getClientName(client)}`,
    `Adresa: ${address}`,
    `Lift: ${getLiftLabel(lift)}`,
    `Firma mentenanta: ${firma}`,
    `Data: ${dateText} ${timeText}`,
    `Tehnician: ${technicianName}`,
    "",
    normalizedType === "interventie" ? "Constatare interventie:" : "Continut revizie:",
    ...splitTextSafe(reportText, 95),
    "",
    "Semnatura beneficiar: _____________________",
    "Semnatura tehnician: _____________________",
  ];

  const [logo, stamp] = await Promise.all([
    loadImageAsJpegHex({ url: branding?.logoUrl, path: branding?.logoPath }),
    loadImageAsJpegHex({ url: branding?.stampUrl, path: branding?.stampPath }),
  ]);

  return buildPdfDocument({ lines, title, logo, stamp });
}

export function defaultEmailSubject(type: ReportType, dateText: string): string {
  return type === "interventie" ? `Raport Interventie ${dateText}` : `Raport Revizie ${dateText}`;
}

export function defaultEmailBody(type: ReportType, firma: string): string {
  return `Buna ziua,\n\nVa transmitem in atasament Raportul de ${
    type === "interventie" ? "Interventie" : "Revizie"
  }.\n\nO zi buna!\nEchipa ${firma}`;
}
