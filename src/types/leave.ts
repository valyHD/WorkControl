export type LeaveRequestType = "concediu_odihna" | "zi_libera_platita" | "zi_libera_eveniment";

export type LeaveRequestStatus = "in_asteptare" | "aprobat" | "respins";

export interface LeaveRequestItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  companyName: string;
  roleTitle: string;
  department: string;
  requestType: LeaveRequestType;
  legalReason: string;
  periodStart: string;
  periodEnd: string;
  requestedDays: number;
  requestedMinutes: number;
  reason: string;
  signatureData: string;
  issuedAt: number;
  status: LeaveRequestStatus;
  pdfDataUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface LeaveRequestFormValues {
  userName: string;
  userEmail: string;
  companyName: string;
  roleTitle: string;
  department: string;
  requestType: LeaveRequestType;
  periodStart: string;
  periodEnd: string;
  reason: string;
  signatureData: string;
}
