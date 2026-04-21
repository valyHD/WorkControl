import type {
  NotificationRuleEventType,
  NotificationRuleModule,
} from "../../types/notification-rule";

type NotificationNavigationInput = {
  module?: string;
  entityId?: string;
  eventType?: string;
};

const moduleBasePath: Record<NotificationRuleModule, string> = {
  tools: "/tools",
  vehicles: "/vehicles",
  timesheets: "/timesheets",
  users: "/users",
  projects: "/projects",
  notifications: "/notifications",
  web: "/control-panel",
  server: "/control-panel",
  system: "/control-panel",
  backup: "/control-panel",
  general: "/notifications",
};

export function resolveNotificationPath(input: NotificationNavigationInput): string {
  const moduleName = (input.module ?? "") as NotificationRuleModule;
  const entityId = (input.entityId ?? "").trim();
  const eventType = (input.eventType ?? "") as NotificationRuleEventType;

  if (moduleName === "tools" && entityId) return `/tools/${entityId}`;
  if (moduleName === "vehicles" && entityId) return `/vehicles/${entityId}`;
  if (moduleName === "timesheets" && entityId) return `/timesheets/${entityId}`;
  if (moduleName === "users" && entityId) return `/users/${entityId}/edit`;
  if (moduleName === "projects") return "/projects";
  if (moduleName === "notifications") return "/notifications";

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
