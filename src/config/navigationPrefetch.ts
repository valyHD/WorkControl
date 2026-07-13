const navigationPrefetchers: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("../modules/dashboard/pages/DashboardPage"),
  "/my-profile": () => import("../modules/users/pages/MyProfilePage"),
  "/my-leave": () => import("../modules/leave/pages/LeavePlannerPage"),
  "/notification-rules": () => import("../modules/notifications/pages/NotificationRulesPage"),
  "/users": () => import("../modules/users/pages/UsersPage"),
  "/tools": () => import("../modules/tools/pages/ToolsPage"),
  "/vehicles": () => import("../modules/vehicles/pages/VehiclesPage"),
  "/my-vehicle": () => import("../modules/vehicles/pages/MyVehiclePage"),
  "/timesheets": () => import("../modules/timesheets/pages/TimesheetsPage"),
  "/my-timesheets": () => import("../modules/timesheets/pages/MyTimesheetsPage"),
  "/projects": () => import("../modules/timesheets/pages/ProjectsPage"),
  "/notifications": () => import("../modules/notifications/pages/NotificationsPage"),
  "/inbox": () => import("../modules/inbox/pages/OperationalInboxPage"),
  "/control-panel": () => import("../modules/reports/pages/ReportsPage"),
  "/maintenance": () => import("../modules/maintenance/pages/MaintenancePage"),
  "/maintenance/orders": () => import("../modules/maintenance/pages/MaintenancePartOrdersPage"),
  "/expenses/scan": () => import("../modules/expenses/pages/ExpenseScanPage"),
  "/expenses/invoices": () => import("../modules/expenses/pages/ExpenseInvoicesPage"),
  "/expenses/reports": () => import("../modules/expenses/pages/ExpenseReportsPage"),
  "/companies": () => import("../modules/companies/pages/CompaniesPage"),
  "/history": () => import("../modules/audit/pages/AuditLogPage"),
  "/control-panel/ui-lab": () => import("../modules/reports/pages/UiLabPage"),
};

const prefetchedPaths = new Set<string>();

export function prefetchNavigationPath(path: string) {
  if (prefetchedPaths.has(path)) return;
  const prefetch = navigationPrefetchers[path];
  if (!prefetch) return;
  prefetchedPaths.add(path);
  void prefetch().catch(() => prefetchedPaths.delete(path));
}
