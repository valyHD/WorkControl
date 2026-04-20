import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "../layouts/AppShell";
import { useAuth } from "../providers/AuthProvider";

const DashboardPage = lazy(() => import("../modules/dashboard/pages/DashboardPage"));
const UsersPage = lazy(() => import("../modules/users/pages/UsersPage"));
const LoginPage = lazy(() => import("../modules/auth/pages/LoginPage"));
const MyProfilePage = lazy(() => import("../modules/users/pages/MyProfilePage"));
const ToolsPage = lazy(() => import("../modules/tools/pages/ToolsPage"));
const ToolFormPage = lazy(() => import("../modules/tools/pages/ToolFormPage"));
const ToolDetailsPage = lazy(() => import("../modules/tools/pages/ToolDetailsPage"));
const ToolScanPage = lazy(() => import("../modules/tools/pages/ToolScanPage"));
const UserFormPage = lazy(() => import("../modules/users/pages/UserFormPage"));
const VehiclesPage = lazy(() => import("../modules/vehicles/pages/VehiclesPage"));
const VehicleFormPage = lazy(() => import("../modules/vehicles/pages/VehicleFormPage"));
const VehicleDetailsPage = lazy(() => import("../modules/vehicles/pages/VehicleDetailsPage"));
const MyVehiclePage = lazy(() => import("../modules/vehicles/pages/MyVehiclePage"));
const TimesheetsPage = lazy(() => import("../modules/timesheets/pages/TimesheetsPage"));
const TimesheetDetailsPage = lazy(
  () => import("../modules/timesheets/pages/TimesheetDetailsPage")
);
const MyTimesheetsPage = lazy(() => import("../modules/timesheets/pages/MyTimesheetsPage"));
const ProjectsPage = lazy(() => import("../modules/timesheets/pages/ProjectsPage"));
const NotificationsPage = lazy(() => import("../modules/notifications/pages/NotificationsPage"));
const ControlPanelPage = lazy(() => import("../modules/reports/pages/ReportsPage"));
const NotificationRulesPage = lazy(
  () => import("../modules/notifications/pages/NotificationRulesPage")
);
const MaintenancePage = lazy(() => import("../modules/maintenance/pages/MaintenancePage"));

function RouteLoader() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Se incarca pagina...</h1>
        <p className="auth-subtitle">Pregatim modulele necesare.</p>
      </div>
    </div>
  );
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
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
    path: "/login",
    element: withSuspense(<LoginPage />),
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "/dashboard", element: withSuspense(<DashboardPage />) },

      { path: "/my-profile", element: withSuspense(<MyProfilePage />) },
      { path: "/notification-rules", element: withSuspense(<NotificationRulesPage />) },
      { path: "/users", element: withSuspense(<UsersPage />) },
      { path: "/users/new", element: withSuspense(<UserFormPage />) },
      { path: "/users/:userId/edit", element: withSuspense(<UserFormPage />) },

      { path: "/tools", element: withSuspense(<ToolsPage />) },
      { path: "/tools/new", element: withSuspense(<ToolFormPage />) },
      { path: "/tools/scan", element: withSuspense(<ToolScanPage />) },
      { path: "/tools/:toolId", element: withSuspense(<ToolDetailsPage />) },
      { path: "/tools/:toolId/edit", element: withSuspense(<ToolFormPage />) },

      { path: "/vehicles", element: withSuspense(<VehiclesPage />) },
      { path: "/my-vehicle", element: withSuspense(<MyVehiclePage />) },
      { path: "/vehicles/new", element: withSuspense(<VehicleFormPage />) },
      { path: "/vehicles/:vehicleId", element: withSuspense(<VehicleDetailsPage />) },
      { path: "/vehicles/:vehicleId/edit", element: withSuspense(<VehicleFormPage />) },

      { path: "/timesheets", element: withSuspense(<TimesheetsPage />) },
      { path: "/my-timesheets", element: withSuspense(<MyTimesheetsPage />) },
      { path: "/projects", element: withSuspense(<ProjectsPage />) },
      { path: "/timesheets/:timesheetId", element: withSuspense(<TimesheetDetailsPage />) },

      { path: "/notifications", element: withSuspense(<NotificationsPage />) },
      { path: "/control-panel", element: withSuspense(<ControlPanelPage />) },
      { path: "/maintenance", element: withSuspense(<MaintenancePage />) },
      { path: "/reports", element: <Navigate to="/control-panel" replace /> },
    ],
  },
]);
