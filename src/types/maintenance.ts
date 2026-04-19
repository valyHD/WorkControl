export type MaintenanceClientStatus = "active" | "inactive";
export type LiftStatus = "active" | "stopped" | "repair" | "overdue";
export type ReportType = "revizie" | "interventie";

export type MaintenanceClient = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  mainAddress: string;
  notes: string;
  internalCode: string;
  status: MaintenanceClientStatus;
  createdAt: number;
  updatedAt: number;
};

export type LiftUnit = {
  id: string;
  clientId: string;
  clientName: string;
  liftNumber: string;
  locationName: string;
  exactAddress: string;
  building: string;
  serialNumber: string;
  liftType: string;
  manufacturer: string;
  capacity: string;
  floors: string;
  installYear: string;
  commissioningDate: string;
  nextInspectionDate: string;
  contractExpiryDate: string;
  assignedTechnician: string;
  status: LiftStatus;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type MaintenanceReport = {
  id: string;
  clientId: string;
  clientName: string;
  liftId: string;
  liftNumber: string;
  reportType: ReportType;
  createdAt: number;
  dateText: string;
  timeText: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAddress: string;
  technicianName: string;
  status: "draft" | "final";
  observations: string;
  reviewChecklist: string[];
  standardText: string;
  complaint: string;
  finding: string;
  workPerformed: string;
  replacedParts: string;
  recommendations: string;
  pdfUrl: string;
};

export type MaintenanceDashboard = {
  totalClients: number;
  totalLifts: number;
  activeLifts: number;
  dueSoon30: number;
  dueSoon15: number;
  dueSoon7: number;
  expired: number;
  reportsLast7Days: number;
  latestReports: MaintenanceReport[];
};
