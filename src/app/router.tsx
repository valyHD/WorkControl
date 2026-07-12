import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "../layouts/AppShell";
import { useAuth } from "../providers/AuthProvider";
import { RouteErrorPage } from "../lib/errors/RouteErrorPage";
import { lazyWithRetry } from "../lib/routing/dynamicImportRecovery";
import { VehicleGpsVisibilityGate } from "../modules/vehicles/components/VehicleGpsVisibilityGate";
import { Skeleton } from "../components/experience";

const DashboardPage = lazyWithRetry(() => import("../modules/dashboard/pages/DashboardPage"));
const UsersPage = lazyWithRetry(() => import("../modules/users/pages/UsersPage"));
const LoginPage = lazyWithRetry(() => import("../modules/auth/pages/LoginPage"));
const PublicHomePage = lazyWithRetry(() => import("../modules/public/pages/PublicHomePage"));
const PrivacyPolicyPage = lazyWithRetry(() => import("../modules/public/pages/PrivacyPolicyPage"));
const TermsPage = lazyWithRetry(() => import("../modules/public/pages/TermsPage"));
const MyProfilePage = lazyWithRetry(() => import("../modules/users/pages/MyProfilePage"));
const UserActivityProfilePage = lazyWithRetry(() => import("../modules/users/pages/UserActivityProfilePage"));
const LeavePlannerPage = lazyWithRetry(() => import("../modules/leave/pages/LeavePlannerPage"));
const ToolsPage = lazyWithRetry(() => import("../modules/tools/pages/ToolsPage"));
const ToolFormPage = lazyWithRetry(() => import("../modules/tools/pages/ToolFormPage"));
const ToolDetailsPage = lazyWithRetry(() => import("../modules/tools/pages/ToolDetailsPage"));
const ToolScanPage = lazyWithRetry(() => import("../modules/tools/pages/ToolScanPage"));
const UserFormPage = lazyWithRetry(() => import("../modules/users/pages/UserFormPage"));
const VehiclesPage = lazyWithRetry(() => import("../modules/vehicles/pages/VehiclesPage"));
const VehicleGpsMapsPage = lazyWithRetry(() => import("../modules/vehicles/pages/VehicleGpsMapsPage"));
const VehicleFormPage = lazyWithRetry(() => import("../modules/vehicles/pages/VehicleFormPage"));
const VehicleDetailsPage = lazyWithRetry(() => import("../modules/vehicles/pages/VehicleDetailsPage"));
const VehicleLiveDiagnosticsPage = lazyWithRetry(
  () => import("../modules/vehicles/pages/VehicleLiveDiagnosticsPage")
);
const MyVehiclePage = lazyWithRetry(() => import("../modules/vehicles/pages/MyVehiclePage"));
const TimesheetsPage = lazyWithRetry(() => import("../modules/timesheets/pages/TimesheetsPage"));
const TimesheetDetailsPage = lazyWithRetry(
  () => import("../modules/timesheets/pages/TimesheetDetailsPage")
);
const MyTimesheetsPage = lazyWithRetry(() => import("../modules/timesheets/pages/MyTimesheetsPage"));
const ProjectsPage = lazyWithRetry(() => import("../modules/timesheets/pages/ProjectsPage"));
const NotificationsPage = lazyWithRetry(() => import("../modules/notifications/pages/NotificationsPage"));
const ControlPanelPage = lazyWithRetry(() => import("../modules/reports/pages/ReportsPage"));
const BackupPreviewPage = lazyWithRetry(() => import("../modules/reports/pages/BackupPreviewPage"));
const UiLabPage = lazyWithRetry(() => import("../modules/reports/pages/UiLabPage"));
const NotificationRulesPage = lazyWithRetry(
  () => import("../modules/notifications/pages/NotificationRulesPage")
);
const MaintenancePage = lazyWithRetry(() => import("../modules/maintenance/pages/MaintenancePage"));
const MaintenancePartOrdersPage = lazyWithRetry(
  () => import("../modules/maintenance/pages/MaintenancePartOrdersPage")
);
const MaintenanceClientDetailsPage = lazyWithRetry(
  () => import("../modules/maintenance/pages/MaintenanceClientDetailsPage")
);
const ExpenseScanPage = lazyWithRetry(() => import("../modules/expenses/pages/ExpenseScanPage"));
const ExpenseReportsPage = lazyWithRetry(() => import("../modules/expenses/pages/ExpenseReportsPage"));
const ExpenseInvoicesPage = lazyWithRetry(() => import("../modules/expenses/pages/ExpenseInvoicesPage"));
const CompaniesPage = lazyWithRetry(() => import("../modules/companies/pages/CompaniesPage"));
const AuditLogPage = lazyWithRetry(() => import("../modules/audit/pages/AuditLogPage"));

function RouteLoader() {
  return (
    <div className="wc-route-loader" aria-live="polite">
      <span>Se incarca pagina...</span>
      <Skeleton lines={4} label="Pregatim modulele necesare" />
    </div>
  );
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
}

function withVehicleGpsGate(element: ReactNode) {
  return withSuspense(<VehicleGpsVisibilityGate>{element}</VehicleGpsVisibilityGate>);
}

function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Se incarca...</h1>
          <p className="auth-subtitle">Verificam sesiunea ta.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <AppShell />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: withSuspense(<PublicHomePage />),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/privacy-policy",
    element: withSuspense(<PrivacyPolicyPage />),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/terms",
    element: withSuspense(<TermsPage />),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/login",
    element: withSuspense(<LoginPage />),
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/dashboard", element: withSuspense(<DashboardPage />) },

      { path: "/my-profile", element: withSuspense(<MyProfilePage />) },
      { path: "/my-leave", element: withSuspense(<LeavePlannerPage />) },
      { path: "/notification-rules", element: withSuspense(<NotificationRulesPage />) },
      { path: "/users", element: withSuspense(<UsersPage />) },
      { path: "/users/new", element: withSuspense(<UserFormPage />) },
      { path: "/users/:userId", element: withSuspense(<UserActivityProfilePage />) },
      { path: "/users/:userId/edit", element: withSuspense(<UserFormPage />) },

      { path: "/tools", element: withSuspense(<ToolsPage />) },
      { path: "/tools/new", element: withSuspense(<ToolFormPage />) },
      { path: "/tools/scan", element: withSuspense(<ToolScanPage />) },
      { path: "/tools/:toolId", element: withSuspense(<ToolDetailsPage />) },
      { path: "/tools/:toolId/edit", element: withSuspense(<ToolFormPage />) },

      { path: "/vehicles", element: withVehicleGpsGate(<VehiclesPage />) },
      { path: "/vehicles/gps-map", element: withVehicleGpsGate(<VehicleGpsMapsPage />) },
      { path: "/my-vehicle", element: withVehicleGpsGate(<MyVehiclePage />) },
      { path: "/vehicles/new", element: withVehicleGpsGate(<VehicleFormPage />) },
      { path: "/vehicles/:vehicleId", element: withVehicleGpsGate(<VehicleDetailsPage />) },
      { path: "/vehicles/:vehicleId/live", element: withVehicleGpsGate(<VehicleLiveDiagnosticsPage />) },
      { path: "/vehicles/:vehicleId/edit", element: withVehicleGpsGate(<VehicleFormPage />) },

      { path: "/timesheets", element: withSuspense(<TimesheetsPage />) },
      { path: "/my-timesheets", element: withSuspense(<MyTimesheetsPage />) },
      { path: "/projects", element: withSuspense(<ProjectsPage />) },
      { path: "/timesheets/:timesheetId", element: withSuspense(<TimesheetDetailsPage />) },

      { path: "/notifications", element: withSuspense(<NotificationsPage />) },
      { path: "/control-panel", element: withSuspense(<ControlPanelPage />) },
      { path: "/control-panel/backup-preview", element: withSuspense(<BackupPreviewPage />) },
      { path: "/control-panel/ui-lab", element: withSuspense(<UiLabPage />) },
      { path: "/maintenance", element: withSuspense(<MaintenancePage />) },
      { path: "/maintenance/manage", element: withSuspense(<MaintenancePage />) },
      { path: "/maintenance/parts", element: withSuspense(<MaintenancePartOrdersPage />) },
      { path: "/maintenance/orders", element: withSuspense(<MaintenancePartOrdersPage />) },
      { path: "/maintenance/:clientId", element: withSuspense(<MaintenanceClientDetailsPage />) },
      { path: "/expenses", element: <Navigate to="/expenses/scan" replace /> },
      { path: "/expenses/scan", element: withSuspense(<ExpenseScanPage />) },
      { path: "/expenses/reports", element: withSuspense(<ExpenseReportsPage />) },
      { path: "/expenses/invoices", element: withSuspense(<ExpenseInvoicesPage />) },
      { path: "/companies", element: withSuspense(<CompaniesPage />) },
      { path: "/history", element: withSuspense(<AuditLogPage />) },
      { path: "/reports", element: <Navigate to="/control-panel" replace /> },
    ],
  },
]);
