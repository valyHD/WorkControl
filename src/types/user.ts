export type UserRole = "admin" | "manager" | "angajat";

export interface AppUserItem {
  id: string;
  uid: string;
  fullName: string;
  email: string;
  active: boolean;
  role: UserRole;
  themeKey?: string;
  avatarUrl?: string;
  avatarThumbUrl?: string;
  roleTitle?: string;
  department?: string;
  createdAt?: number;
  updatedAt?: number;
  lastSeenAt?: number;
  lastActiveAt?: number;
  lastSiteEnteredAt?: number;
  isOnline?: boolean;
  companyIds?: string[];
  companyNames?: string[];
  primaryCompanyId?: string;
  primaryCompanyName?: string;
}
