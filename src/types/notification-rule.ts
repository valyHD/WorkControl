export type NotificationRuleModule =
  | "tools"
  | "vehicles"
  | "timesheets"
  | "users"
  | "web"
  | "server"
  | "system"
  | "general";

export type NotificationRuleEventType =
  | "tool_holder_changed"
  | "tool_status_changed"
  | "vehicle_driver_changed"
  | "vehicle_status_changed"
  | "vehicle_started"
  | "vehicle_block_start_requested"
  | "timesheet_started"
  | "timesheet_stopped"
  | "timesheet_updated"
  | "user_created"
  | "user_role_changed"
  | "vehicle_command_requested"
  | "vehicle_command_result"
  | "notification_rule_changed"
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
