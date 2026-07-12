import { authenticatedPermission, rolePermission } from "../tools/assistantToolRegistry";
import { createServiceUpdateTool } from "./adapterHelpers";

export function createVehicleUpdateTool() {
  return createServiceUpdateTool({
    id: "vehicles.update",
    description:
      "Rezolva si actualizeaza o masina prin vehiclesService, cu validare si confirmare.",
    aliases: ["update_vehicle", "update_vehicle_field"],
    module: "vehicles",
    intent: "update_vehicle",
    entityType: "vehicle",
    permission: authenticatedPermission,
  });
}

export function createToolUpdateTool() {
  return createServiceUpdateTool({
    id: "tools.update",
    description: "Rezolva si actualizeaza o scula prin toolsService, cu validare si confirmare.",
    aliases: ["update_tool"],
    module: "tools",
    intent: "update_tool",
    entityType: "tool",
    permission: authenticatedPermission,
  });
}

export function createProjectUpdateTool() {
  return createServiceUpdateTool({
    id: "timesheets.projects.update",
    description: "Rezolva si actualizeaza un proiect prin timesheetsService.",
    aliases: ["update_project"],
    module: "timesheets",
    intent: "update_project",
    entityType: "project",
    permission: rolePermission("admin", "manager"),
  });
}

export function createUserUpdateTool() {
  return createServiceUpdateTool({
    id: "users.update",
    description:
      "Actualizeaza profilul propriu sau, pentru administrator, datele altui utilizator.",
    aliases: ["update_user", "update_profile_field"],
    module: "users",
    intent: "update_user",
    entityType: "user",
    permission: authenticatedPermission,
  });
}
