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
  maintenanceCompany: string;
  expDate: string;
  status: LiftStatus;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type MaintenanceBranding = {
  id: string;
  nume: string;
  key: string;
  aliases: string[];
  logoUrl: string;
  stampilaUrl: string;
  semnaturaUrl?: string;
  emailDisplayName: string;
  emailImplicitCc: string[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type MaintenanceLocationOption = {
  id: string;
  label: string;
  address: string;
  email?: string;
  lifts: LiftUnit[];
};

export type MaintenanceReport = {
  id: string;
  reportId: string;
  clientId: string;
  clientName: string;
  locatieId?: string;
  locatieName: string;
  adresa: string;
  email: string;
  liftId: string;
  liftIdDocument: string;
  liftNumber: string;
  reportType: ReportType;
  createdAt: number;
  dateText: string;
  timeText: string;
  dataFolder: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsLocatie: string;
  technicianName: string;
  status: "draft" | "final";
  observations: string;
  standardText: string;
  constatareInterventie: string;
  continutRaport: string;
  pdfUrl: string;
  images: string[];
  firmaLogo: string;
  firmaMentenantaOriginala: string;
  brandingId: string;
  logoUrlFolosit: string;
  stampilaUrlFolosita: string;
  createdByUid: string;
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
