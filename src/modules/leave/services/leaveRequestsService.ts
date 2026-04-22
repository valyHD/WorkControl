import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import type { LeaveRequestFormValues, LeaveRequestItem, LeaveRequestType } from "../../../types/leave";
import type { TimesheetItem } from "../../../types/timesheet";

const leaveRequestsCollection = collection(db, "leaveRequests");

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdfDataUrlProfessional(
  title: string,
  lines: string[],
  signatureData: string,
  isApproved: boolean
): string {
  const safeTitle = escapePdfText(title);
  const content: string[] = [
    "BT",
    "/F1 16 Tf",
    "1 0 0 1 185 800 Tm",
    `(${safeTitle}) Tj`,
    "ET",
    "BT",
    "/F1 11 Tf",
    "14 TL",
    "1 0 0 1 56 760 Tm",
  ];

  lines.forEach((line, index) => {
    if (index > 0) content.push("T*");
    content.push(`(${escapePdfText(line)}) Tj`);
  });
  content.push("ET");

  if (isApproved) {
    content.push(
      "BT",
      "/F1 18 Tf",
      "0 0 1 rg",
      "1 0 0 1 415 110 Tm",
      "(Aprobat) Tj",
      "0 0 0 rg",
      "ET"
    );
  }

  try {
    const strokes = JSON.parse(signatureData) as Array<Array<{ x: number; y: number }>>;
    if (Array.isArray(strokes) && strokes.length > 0) {
      content.push("0 0 0 RG", "1.2 w");
      strokes.forEach((stroke) => {
        if (!Array.isArray(stroke) || stroke.length < 2) return;
        const first = stroke[0];
        content.push(`${56 + first.x} ${128 + (52 - first.y)} m`);
        stroke.slice(1).forEach((point) => {
          content.push(`${56 + point.x} ${128 + (52 - point.y)} l`);
        });
        content.push("S");
      });
    }
  } catch {
    // ignore invalid signature data
  }

  const stream = content.join("\n");
  const len = stream.length;
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length ${len} >>\nstream\n${stream}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;

  const bytes = new TextEncoder().encode(pdf);
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
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
  if (type === "concediu_odihna") return "Art. 144-151 Codul muncii (concediu de odihna anual)";
  if (type === "zi_libera_platita") return "Zi libera platita conform regulament intern / contract";
  return "Zi libera pentru evenimente deosebite (conform legislatiei muncii)";
}

export function buildLeaveRequestPdf(values: LeaveRequestFormValues, issuedAt: number, isApproved = false): string {
  const requestedDays = getRequestedDays(values.periodStart, values.periodEnd);
  const kind =
    values.requestType === "concediu_odihna"
      ? "concediu de odihna"
      : values.requestType === "zi_libera_platita"
        ? "zi libera platita"
        : "zi libera pentru evenimente deosebite";

  const lines = [
    "Domnule Director/Administrator,",
    "",
    `Subsemnatul/a: ${values.userName}, angajat in functia de ${values.roleTitle || "Nespecificata"} in cadrul departamentului ${values.department || "Nespecificat"}.`,
    `Solicit acordarea unui ${kind}.`,
    `Perioada: ${values.periodStart} - ${values.periodEnd}, insumand un numar de ${requestedDays} zile.`,
    `Motivul: ${values.reason.trim() || "Nespecificat"}.`,
    `Temei legal: ${getLegalReasonByType(values.requestType)}.`,
    "",
    "Va multumesc,",
    `Data: ${new Date(issuedAt).toLocaleDateString("ro-RO")}`,
    "Semnatura angajatului:",
  ];

  return buildPdfDataUrlProfessional("CERERE DE CONCEDIU/ZI LIBERA", lines, values.signatureData, isApproved);
}

function mapLeaveDoc(id: string, data: Record<string, any>): LeaveRequestItem {
  return {
    id,
    userId: data.userId ?? "",
    userName: data.userName ?? "",
    userEmail: data.userEmail ?? "",
    companyName: data.companyName ?? "",
    roleTitle: data.roleTitle ?? "",
    department: data.department ?? "",
    requestType: data.requestType === "zi_libera_platita" || data.requestType === "zi_libera_eveniment" ? data.requestType : "concediu_odihna",
    legalReason: data.legalReason ?? "",
    periodStart: data.periodStart ?? "",
    periodEnd: data.periodEnd ?? "",
    requestedDays: Number(data.requestedDays ?? 0),
    requestedMinutes: Number(data.requestedMinutes ?? 0),
    reason: data.reason ?? "",
    signatureData: data.signatureData ?? "",
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
    department: values.department.trim(),
    requestType: values.requestType,
    legalReason: getLegalReasonByType(values.requestType),
    periodStart: values.periodStart,
    periodEnd: values.periodEnd,
    requestedDays,
    requestedMinutes,
    reason: values.reason.trim(),
    signatureData: values.signatureData,
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

export async function approveLeaveRequest(requestId: string): Promise<void> {
  const requestRef = doc(db, "leaveRequests", requestId);
  const snap = await getDoc(requestRef);
  const data = snap.data();
  if (!data) throw new Error("Cererea nu exista.");
  const approvedPdf = buildLeaveRequestPdf(
    {
      userName: data.userName ?? "",
      userEmail: data.userEmail ?? "",
      companyName: data.companyName ?? "",
      roleTitle: data.roleTitle ?? "",
      department: data.department ?? "",
      requestType: data.requestType === "zi_libera_platita" || data.requestType === "zi_libera_eveniment" ? data.requestType : "concediu_odihna",
      periodStart: data.periodStart ?? "",
      periodEnd: data.periodEnd ?? "",
      reason: data.reason ?? "",
      signatureData: data.signatureData ?? "",
    },
    Number(data.issuedAt ?? Date.now()),
    true
  );

  await updateDoc(requestRef, {
    status: "aprobat",
    pdfDataUrl: approvedPdf,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function deleteLeaveRequest(requestId: string): Promise<void> {
  await deleteDoc(doc(db, "leaveRequests", requestId));
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
