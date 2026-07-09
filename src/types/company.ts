export interface CompanyItem {
  id: string;
  companyKey: string;
  companyName: string;
  legalName: string;
  taxId: string;
  registrationNumber: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  contactName: string;
  notes: string;
  active: boolean;
  assignedUserIds: string[];
  assignedUserNames: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CompanyFormValues {
  companyName: string;
  legalName: string;
  taxId: string;
  registrationNumber: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  contactName: string;
  notes: string;
  active: boolean;
  assignedUserIds: string[];
}

export interface CompanySummary {
  expenseCount: number;
  expenseTotal: number;
  reimbursableTotal: number;
  maintenanceClientCount: number;
  maintenanceClientNames: string[];
}

export interface CompanyMaintenanceReportLite {
  id: string;
  clientId: string;
  clientName: string;
  reportType: string;
  lift: string;
  technicianName: string;
  pdfUrl: string;
  createdAt: number;
}
