export type LeaveRequestType = "concediu_odihna" | "invoire";

export type LeaveRequestStatus = "in_asteptare" | "aprobat" | "respins";

export interface LeaveRequestItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  companyName: string;
  roleTitle: string;
  requestType: LeaveRequestType;
  legalReason: string;
  periodStart: string;
  periodEnd: string;
  requestedDays: number;
  requestedMinutes: number;
  reason: string;
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
  requestType: LeaveRequestType;
  periodStart: string;
  periodEnd: string;
  reason: string;
}
