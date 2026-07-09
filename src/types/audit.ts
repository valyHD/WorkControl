export type AuditLogCategory =
  | "auth"
  | "navigation"
  | "users"
  | "tools"
  | "vehicles"
  | "timesheets"
  | "leave"
  | "projects"
  | "notifications"
  | "maintenance"
  | "expenses"
  | "backup"
  | "system"
  | "web"
  | "server"
  | "general";

export interface AuditLogItem {
  id: string;
  category: AuditLogCategory;
  action: string;
  title: string;
  message: string;
  actorUserId: string;
  actorUserName: string;
  actorUserThemeKey?: string | null;
  targetUserId: string;
  targetUserName: string;
  targetUserThemeKey?: string | null;
  entityId: string;
  entityLabel: string;
  path: string;
  pageTitle: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  createdAtServer?: unknown;
  searchableText: string;
}

export interface AuditLogInput {
  category: AuditLogCategory;
  action: string;
  title: string;
  message?: string;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
  targetUserId?: string;
  targetUserName?: string;
  targetUserThemeKey?: string | null;
  entityId?: string;
  entityLabel?: string;
  path?: string;
  pageTitle?: string;
  metadata?: Record<string, unknown>;
}
