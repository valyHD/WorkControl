export type NotificationRuleModule =
  | "tools"
  | "vehicles"
  | "timesheets"
  | "users"
  | "general";

export type NotificationRuleEventType =
  | "tool_holder_changed"
  | "tool_status_changed"
  | "vehicle_driver_changed"
  | "vehicle_status_changed"
  | "timesheet_started"
  | "timesheet_stopped"
  | "user_created"
  | "user_role_changed";

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
  enabled: boolean;
  recipients: NotificationRuleRecipients;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationRuleFormValues {
  name: string;
  module: NotificationRuleModule;
  eventType: NotificationRuleEventType;
  enabled: boolean;
  recipients: NotificationRuleRecipients;
}