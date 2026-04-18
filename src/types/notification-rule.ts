export type NotificationRuleModule =
  | "tools"
  | "vehicles"
  | "timesheets"
  | "users"
  | "projects"
  | "notifications"
  | "web"
  | "server"
  | "system"
  | "backup"
  | "general";

export type NotificationRuleEventType =
  | "tool_created"
  | "tool_updated"
  | "tool_deleted"
  | "tool_holder_changed"
  | "tool_status_changed"
  | "vehicle_created"
  | "vehicle_updated"
  | "vehicle_deleted"
  | "vehicle_driver_changed"
  | "vehicle_status_changed"
  | "vehicle_started"
  | "vehicle_block_start_requested"
  | "timesheet_started"
  | "timesheet_stopped"
  | "timesheet_updated"
  | "project_created"
  | "project_updated"
  | "user_created"
  | "user_updated"
  | "user_role_changed"
  | "user_activation_changed"
  | "notification_created"
  | "notification_read"
  | "vehicle_command_requested"
  | "vehicle_command_result"
  | "vehicle_service_due_soon"
  | "vehicle_document_due_soon"
  | "notification_rule_changed"
  | "backup_requested"
  | "backup_completed"
  | "backup_failed"
  | "data_retention_cleanup"
  | "server_change_detected"
  | "web_change_detected"
  | "system_change_detected"
  | "any_change";

export interface NotificationRuleRecipients {
  notifyDirectUser: boolean;
  notifyOwner: boolean;
  notifyAdmins: boolean;
  notifyManagers: boolean;
  specificUserIds: string[];
}

export interface NotificationRuleItem {
  id: string;
  name: string;
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  entityId: string;
  entityLabel: string;
  enabled: boolean;
  recipients: NotificationRuleRecipients;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationRuleFormValues {
  name: string;
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  entityId: string;
  entityLabel: string;
  enabled: boolean;
  recipients: NotificationRuleRecipients;
}
