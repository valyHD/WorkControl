import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "../layouts/AppShell";
import DashboardPage from "../modules/dashboard/pages/DashboardPage";
import UsersPage from "../modules/users/pages/UsersPage";
import LoginPage from "../modules/auth/pages/LoginPage";
import { useAuth } from "../providers/AuthProvider";
import MyProfilePage from "../modules/users/pages/MyProfilePage";
import ToolsPage from "../modules/tools/pages/ToolsPage";
import ToolFormPage from "../modules/tools/pages/ToolFormPage";
import ToolDetailsPage from "../modules/tools/pages/ToolDetailsPage";
import ToolScanPage from "../modules/tools/pages/ToolScanPage";
import UserFormPage from "../modules/users/pages/UserFormPage";
import VehiclesPage from "../modules/vehicles/pages/VehiclesPage";
import VehicleFormPage from "../modules/vehicles/pages/VehicleFormPage";
import VehicleDetailsPage from "../modules/vehicles/pages/VehicleDetailsPage";
import MyVehiclePage from "../modules/vehicles/pages/MyVehiclePage";
import TimesheetsPage from "../modules/timesheets/pages/TimesheetsPage";
import TimesheetDetailsPage from "../modules/timesheets/pages/TimesheetDetailsPage";
import MyTimesheetsPage from "../modules/timesheets/pages/MyTimesheetsPage";
import ProjectsPage from "../modules/timesheets/pages/ProjectsPage";
import NotificationsPage from "../modules/notifications/pages/NotificationsPage";
import ControlPanelPage from "../modules/reports/pages/ReportsPage";
import NotificationRulesPage from "../modules/notifications/pages/NotificationRulesPage";
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
    element: <LoginPage />,
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "/dashboard", element: <DashboardPage /> },

      { path: "/my-profile", element: <MyProfilePage /> },
{ path: "/notification-rules", element: <NotificationRulesPage /> },
      { path: "/users", element: <UsersPage /> },
      { path: "/users/new", element: <UserFormPage /> },
      { path: "/users/:userId/edit", element: <UserFormPage /> },

      { path: "/tools", element: <ToolsPage /> },
      { path: "/tools/new", element: <ToolFormPage /> },
      { path: "/tools/scan", element: <ToolScanPage /> },
      { path: "/tools/:toolId", element: <ToolDetailsPage /> },
      { path: "/tools/:toolId/edit", element: <ToolFormPage /> },

      { path: "/vehicles", element: <VehiclesPage /> },
      { path: "/my-vehicle", element: <MyVehiclePage /> },
      { path: "/vehicles/new", element: <VehicleFormPage /> },
      { path: "/vehicles/:vehicleId", element: <VehicleDetailsPage /> },
      { path: "/vehicles/:vehicleId/edit", element: <VehicleFormPage /> },

      { path: "/timesheets", element: <TimesheetsPage /> },
      { path: "/my-timesheets", element: <MyTimesheetsPage /> },
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/timesheets/:timesheetId", element: <TimesheetDetailsPage /> },

      { path: "/notifications", element: <NotificationsPage /> },
      { path: "/control-panel", element: <ControlPanelPage /> },
      { path: "/reports", element: <Navigate to="/control-panel" replace /> },
    ],
  },
]);
