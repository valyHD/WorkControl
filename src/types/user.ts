export type UserRole = "admin" | "manager" | "angajat";

export interface AppUserItem {
  id: string;
  uid: string;
  fullName: string;
  email: string;
  active: boolean;
  role: UserRole;
  themeKey?: string;
  createdAt?: number;
  updatedAt?: number;
}