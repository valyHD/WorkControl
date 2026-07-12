import type { AssistantToolModule } from "../tools/assistantToolRegistry";
import {
  AssistantToolRegistry,
  type AssistantAdapterRuntime,
} from "../tools/assistantToolRegistry";
import {
  createProjectUpdateTool,
  createToolUpdateTool,
  createUserUpdateTool,
  createVehicleUpdateTool,
} from "./entityAdapters";
import {
  createExpenseDraftTool,
  createLeaveDraftTool,
  createMaintenanceDraftTool,
  createProjectDraftTool,
  createToolDraftTool,
  createUserDraftTool,
  createVehicleDraftTool,
} from "./formDraftAdapters";
import { dispatchAssistantFormDraftWhenReady } from "../runtime/assistantFormFill";
import { createNavigationTool } from "./navigationAdapter";
import {
  createProjectTool,
  createStartTimesheetTool,
  createStopTimesheetTool,
} from "./timesheetAdapter";

export type AssistantModuleAdapter = {
  module: AssistantToolModule;
  toolIds: readonly string[];
  register: (registry: AssistantToolRegistry) => void;
};

export function createAssistantModuleAdapters(): AssistantModuleAdapter[] {
  return [
    {
      module: "navigation",
      toolIds: ["navigation.open"],
      register: (registry) => {
        registry.register(createNavigationTool());
      },
    },
    {
      module: "vehicles",
      toolIds: ["vehicles.update", "vehicles.draft"],
      register: (registry) => {
        registry.register(createVehicleUpdateTool());
        registry.register(createVehicleDraftTool());
      },
    },
    {
      module: "tools",
      toolIds: ["tools.update", "tools.draft"],
      register: (registry) => {
        registry.register(createToolUpdateTool());
        registry.register(createToolDraftTool());
      },
    },
    {
      module: "timesheets",
      toolIds: [
        "timesheets.start",
        "timesheets.stop",
        "timesheets.projects.create",
        "timesheets.projects.update",
        "timesheets.projects.draft",
      ],
      register: (registry) => {
        registry.register(createStartTimesheetTool());
        registry.register(createStopTimesheetTool());
        registry.register(createProjectTool());
        registry.register(createProjectUpdateTool());
        registry.register(createProjectDraftTool());
      },
    },
    {
      module: "maintenance",
      toolIds: ["maintenance.draft"],
      register: (registry) => {
        registry.register(createMaintenanceDraftTool());
      },
    },
    {
      module: "leave",
      toolIds: ["leave.draft"],
      register: (registry) => {
        registry.register(createLeaveDraftTool());
      },
    },
    {
      module: "users",
      toolIds: ["users.update", "users.draft"],
      register: (registry) => {
        registry.register(createUserUpdateTool());
        registry.register(createUserDraftTool());
      },
    },
    {
      module: "expenses",
      toolIds: ["expenses.draft"],
      register: (registry) => {
        registry.register(createExpenseDraftTool());
      },
    },
  ];
}

export function registerAssistantV3Adapters(registry = new AssistantToolRegistry()) {
  for (const adapter of createAssistantModuleAdapters()) {
    adapter.register(registry);
  }
  return registry;
}

export function createBrowserAssistantAdapterRuntime(params: {
  navigate: AssistantAdapterRuntime["navigate"];
  getTimesheetLocation?: AssistantAdapterRuntime["getTimesheetLocation"];
  audit?: AssistantAdapterRuntime["audit"];
}): AssistantAdapterRuntime {
  return {
    navigate: params.navigate,
    getTimesheetLocation: params.getTimesheetLocation,
    audit: params.audit,
    dispatchFormDraft: dispatchAssistantFormDraftWhenReady,
  };
}
