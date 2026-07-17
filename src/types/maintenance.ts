export type LiftUnit = {
  id: string;
  label: string;
  serialNumber: string;
  revisionType?: "R1" | "R2" | string;
  manufacturer: string;
  installYear: string;
  maintenanceCompany: string;
  maintenanceEmail: string;
  inspectionExpiryDate: string;
  notes: string;
};

export type ClientAddress = {
  id: string;
  label: string;
  city: string;
  street: string;
  postalCode: string;
  contactPerson: string;
  contactPhone: string;
  lifts: LiftUnit[];
};

export type MaintenanceClientStatus = "active" | "inactive";

export type MaintenanceClient = {
  id: string;
  companyId?: string;
  status?: MaintenanceClientStatus;
  name: string;
  email: string;
  emails: string[];
  address: string;
  liftNumber: string;
  liftNumbers: string[];
  liftExpiryDates?: Record<string, string>;
  liftRevisionTypes?: Record<string, "R1" | "R2" | string>;
  expiryDate: string;
  maintenanceCompany: string;
  contactPerson: string;
  contactPhone: string;
  createdAt: number;
  updatedAt: number;
  addresses: ClientAddress[];
};

export type MaintenanceCompanyBranding = {
  id: string;
  companyId?: string;
  companyName: string;
  companyKey: string;
  logoUrl: string;
  stampUrl: string;
  logoPath: string;
  stampPath: string;
  createdAt: number;
  updatedAt: number;
};

export type MaintenanceReportAttachment = {
  name: string;
  url: string;
  path: string;
  contentType: string;
};

export type MaintenanceReportHistoryItem = {
  id: string;
  companyId?: string;
  clientId: string;
  clientName: string;
  reportType: "revizie" | "interventie" | string;
  address: string;
  lift: string;
  technicianName: string;
  comments: string;
  pdfUrl: string;
  pdfPath: string;
  images: MaintenanceReportAttachment[];
  fileName: string;
  createdAt: number;
  dateText: string;
  timeText: string;
};

export type MaintenancePartOrderStatus =
  | "draft"
  | "requested"
  | "quote_requested"
  | "quote_received"
  | "ordered"
  | "partial"
  | "received"
  | "installed"
  | "cancelled";

export type MaintenancePartOrderPriority = "low" | "normal" | "urgent";

export type MaintenancePartOrderLine = {
  id: string;
  name: string;
  code: string;
  quantity: number;
  unit: string;
  supplier: string;
  estimatedPrice: number;
  notes: string;
};

export type MaintenancePartOrder = {
  id: string;
  companyId?: string;
  title: string;
  status: MaintenancePartOrderStatus;
  priority: MaintenancePartOrderPriority;
  clientId: string;
  clientName: string;
  addressLabel: string;
  liftSerialNumber: string;
  requestedByUserId: string;
  requestedByUserName: string;
  notifyUserId: string;
  notifyUserName: string;
  reminderIntervalMinutes: number;
  notificationSeenAt: number | null;
  notificationSeenByUserId: string;
  notificationSeenByUserName: string;
  neededByDate: string;
  supplierName: string;
  supplierContact: string;
  supplierEmail: string;
  orderNumber: string;
  clientEmail: string;
  supplierEmailSentAt: number | null;
  supplierEmailSentByUserId: string;
  supplierEmailSentByUserName: string;
  supplierQuoteReceivedAt: number | null;
  supplierQuoteReceivedByUserId: string;
  supplierQuoteReceivedByUserName: string;
  supplierOfferAmount: number;
  clientOfferEmailSentAt: number | null;
  clientOfferEmailSentByUserId: string;
  clientOfferEmailSentByUserName: string;
  clientOfferAmount: number;
  clientOfferNotes: string;
  resolvedAt: number | null;
  resolvedByUserId: string;
  resolvedByUserName: string;
  lastReminderAt: number | null;
  nextReminderAt: number | null;
  notes: string;
  lines: MaintenancePartOrderLine[];
  totalEstimated: number;
  createdAt: number;
  updatedAt: number;
};
