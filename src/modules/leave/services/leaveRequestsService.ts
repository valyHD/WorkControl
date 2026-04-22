import { addDoc, collection, getDocs, onSnapshot, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { LeaveRequestFormValues, LeaveRequestItem, LeaveRequestType } from "../../../types/leave";
import type { TimesheetItem } from "../../../types/timesheet";

const leaveRequestsCollection = collection(db, "leaveRequests");

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdfDataUrl(title: string, lines: string[]): string {
  const safeTitle = escapePdfText(title);
  const bodyLines = lines.map((line) => `(${escapePdfText(line)}) Tj`).join(" T*\n");
  const stream = `BT\n/F1 11 Tf\n14 TL\n1 0 0 1 56 790 Tm\n(${safeTitle}) Tj\n0 -22 Td\n${bodyLines}\nET`;
  const len = stream.length;

  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length ${len} >>\nstream\n${stream}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;

  const bytes = new TextEncoder().encode(pdf);
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return `data:application/pdf;base64,${btoa(binary)}`;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRequestedDays(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const diff = end.getTime() - start.getTime();
  if (Number.isNaN(diff) || diff < 0) return 0;
  return Math.floor(diff / 86_400_000) + 1;
}

function getLegalReasonByType(type: LeaveRequestType): string {
  return type === "concediu_odihna"
    ? "Art. 144-151 Codul muncii (concediu de odihna anual)"
    : "Art. 152 Codul muncii (invoiri / absente motivate)";
}

export function buildLeaveRequestPdf(values: LeaveRequestFormValues, issuedAt: number): string {
  const requestedDays = getRequestedDays(values.periodStart, values.periodEnd);
  const kind = values.requestType === "concediu_odihna" ? "Cerere concediu de odihna" : "Cerere invoire (zi libera)";

  const lines = [
    "Catre: Departamentul Resurse Umane / Angajator",
    `Subsemnatul(a): ${values.userName}`,
    `Email: ${values.userEmail}`,
    `Functia: ${values.roleTitle || "Nespecificata"}`,
    `Angajator: ${values.companyName}`,
    `Tip cerere: ${kind}`,
    `Perioada solicitata: ${values.periodStart} - ${values.periodEnd}`,
    `Numar zile calendaristice: ${requestedDays}`,
    `Temei legal: ${getLegalReasonByType(values.requestType)}`,
    `Motiv declarativ: ${values.reason}`,
    `Data intocmire: ${new Date(issuedAt).toLocaleString("ro-RO")}`,
    "Solicit aprobarea conform regulamentului intern si legislatiei muncii.",
    "Semnatura salariat: ___________________________",
    "Semnatura angajator: __________________________",
  ];

  return buildPdfDataUrl(kind, lines);
}

function mapLeaveDoc(id: string, data: Record<string, any>): LeaveRequestItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    userEmail: data.userEmail ?? "",
    companyName: data.companyName ?? "",
    roleTitle: data.roleTitle ?? "",
    requestType: data.requestType === "invoire" ? "invoire" : "concediu_odihna",
    legalReason: data.legalReason ?? "",
    periodStart: data.periodStart ?? "",
    periodEnd: data.periodEnd ?? "",
    requestedDays: Number(data.requestedDays ?? 0),
    requestedMinutes: Number(data.requestedMinutes ?? 0),
    reason: data.reason ?? "",
    issuedAt: Number(data.issuedAt ?? Date.now()),
    status: data.status === "aprobat" || data.status === "respins" ? data.status : "in_asteptare",
    pdfDataUrl: data.pdfDataUrl ?? "",
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

export async function saveLeaveRequest(userId: string, values: LeaveRequestFormValues): Promise<string> {
  const now = Date.now();
  const requestedDays = getRequestedDays(values.periodStart, values.periodEnd);
  const requestedMinutes = requestedDays * 8 * 60;

  if (requestedDays <= 0) {
    throw new Error("Perioada solicitata este invalida.");
  }

  const pdfDataUrl = buildLeaveRequestPdf(values, now);

  const refDoc = await addDoc(leaveRequestsCollection, {
    userId,
    userName: values.userName.trim(),
    userEmail: values.userEmail.trim(),
    companyName: values.companyName.trim(),
    roleTitle: values.roleTitle.trim(),
    requestType: values.requestType,
    legalReason: getLegalReasonByType(values.requestType),
    periodStart: values.periodStart,
    periodEnd: values.periodEnd,
    requestedDays,
    requestedMinutes,
    reason: values.reason.trim(),
    issuedAt: now,
    status: "in_asteptare",
    pdfDataUrl,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  return refDoc.id;
}


export function subscribeLeaveRequestsForUser(
  userId: string,
  onNext: (requests: LeaveRequestItem[]) => void
): () => void {
  const q = query(leaveRequestsCollection, where("userId", "==", userId), orderBy("createdAt", "desc"));

  return onSnapshot(q, (snap) => {
    onNext(snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data())));
  });
}

export async function getLeaveRequestsForUser(userId: string): Promise<LeaveRequestItem[]> {
  const snap = await getDocs(
    query(leaveRequestsCollection, where("userId", "==", userId), orderBy("createdAt", "desc"))
  );

  return snap.docs.map((docItem) => mapLeaveDoc(docItem.id, docItem.data()));
}

export function getLeaveDateSet(requests: LeaveRequestItem[]): Set<string> {
  const all = new Set<string>();

  requests.forEach((request) => {
    let cursor = new Date(`${request.periodStart}T00:00:00`);
    const end = new Date(`${request.periodEnd}T00:00:00`);

    while (cursor.getTime() <= end.getTime()) {
      all.add(toIsoDate(cursor));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  });

  return all;
}

export function getWorkedMinutesByDay(timesheets: TimesheetItem[]): Record<string, number> {
  return timesheets.reduce<Record<string, number>>((acc, entry) => {
    if (!entry.workDate) return acc;
    const existing = acc[entry.workDate] ?? 0;
    acc[entry.workDate] = existing + Math.max(0, Number(entry.workedMinutes ?? 0));
    return acc;
  }, {});
}
