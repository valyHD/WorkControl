import type {
  NotificationRuleEventType,
  NotificationRuleModule,
} from "../../types/notification-rule";

type NotificationNavigationInput = {
  module?: string;
  entityId?: string;
  eventType?: string;
  notificationPath?: string;
};

const moduleBasePath: Record<NotificationRuleModule, string> = {
  tools: "/tools",
  vehicles: "/vehicles",
  timesheets: "/timesheets",
  leave: "/my-leave",
  users: "/users",
  projects: "/projects",
  notifications: "/notifications",
  maintenance: "/maintenance",
  expenses: "/expenses/scan",
  web: "/control-panel",
  server: "/control-panel",
  system: "/control-panel",
  backup: "/control-panel",
  general: "/notifications",
};

export function resolveNotificationPath(input: NotificationNavigationInput): string {
  const explicitPath = (input.notificationPath ?? "").trim();
  if (explicitPath.startsWith("/")) return explicitPath;

  const moduleName = (input.module ?? "") as NotificationRuleModule;
  const entityId = (input.entityId ?? "").trim();
  const eventType = (input.eventType ?? "") as NotificationRuleEventType;

  if (moduleName === "tools" && entityId) return `/tools/${entityId}`;
  if (moduleName === "vehicles" && entityId) return `/vehicles/${entityId}`;
  if (moduleName === "timesheets" && entityId) return `/timesheets/${entityId}`;
  if (moduleName === "leave") return "/my-leave";
  if (moduleName === "users" && entityId) return `/users/${entityId}/edit`;
  if (moduleName === "projects") return "/projects";
  if (moduleName === "notifications") return "/notifications";
  if (moduleName === "maintenance" && entityId) return `/maintenance/${entityId}`;
  if (moduleName === "maintenance") return "/maintenance";
  if (moduleName === "expenses") return "/expenses/scan";

  if (eventType === "notification_rule_changed") return "/notification-rules";
  if (
    eventType === "backup_requested" ||
    eventType === "backup_completed" ||
    eventType === "backup_failed" ||
    eventType === "data_retention_cleanup"
  ) {
    return "/control-panel";
  }

  return moduleBasePath[moduleName] ?? "/notifications";
}
