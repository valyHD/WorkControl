export type LiftUnit = {
  id: string;
  label: string;
  serialNumber: string;
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

export type MaintenanceClient = {
  id: string;
  name: string;
  email: string;
  emails: string[];
  address: string;
  liftNumber: string;
  liftNumbers: string[];
  expiryDate: string;
  maintenanceCompany: string;
  createdAt: number;
  updatedAt: number;
  addresses: ClientAddress[];
};

export type MaintenanceCompanyBranding = {
  id: string;
  companyName: string;
  companyKey: string;
  logoUrl: string;
  stampUrl: string;
  logoPath: string;
  stampPath: string;
  createdAt: number;
  updatedAt: number;
};
