import { resolveAssistantEntity } from "../runtime/assistantEntityResolver";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  authenticatedPermission,
  rolePermission,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";
import { createServiceUpdateTool, toLegacyRuntimeContext } from "./adapterHelpers";

type VehicleTrackerInput = { entityQuery: string; destination: "details" | "tracker" };

type ResolvedVehicleTrackerInput = VehicleTrackerInput & {
  resolution: Awaited<ReturnType<typeof resolveAssistantEntity>>;
};

function readVehicleTrackerInput(value: unknown): VehicleTrackerInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    entityQuery: String(input.entityQuery || "").trim(),
    destination: input.destination === "details" ? "details" : "tracker",
  };
}

export function createVehicleOpenTool(): AssistantToolDefinition<
  unknown,
  ResolvedVehicleTrackerInput
> {
  const definition: AssistantToolDefinition<unknown, ResolvedVehicleTrackerInput> = {
    id: "vehicles.open",
    description: "Gaseste masina ceruta si deschide pagina ei sau sectiunea GPS.",
    aliases: ["vehicles.openTracker", "open_vehicle", "open_vehicle_tracker", "open_vehicle_live"],
    module: "vehicles",
    inputSchema: {
      type: "object",
      properties: {
        entityQuery: { type: "string" },
        destination: { type: "string", enum: ["details", "tracker"] },
      },
      required: ["entityQuery"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "low",
    permission: authenticatedPermission,
    resolve: async (input, context) => {
      const parsed = readVehicleTrackerInput(input);
      return {
        ...parsed,
        resolution: await resolveAssistantEntity(
          "vehicle",
          parsed.entityQuery,
          toLegacyRuntimeContext(context)
        ),
      };
    },
    validate: (input) => {
      if (input.resolution.status === "resolved" && input.resolution.entity) return { ok: true };
      return {
        ok: false,
        reason: input.resolution.message || "Nu am gasit masina ceruta.",
        missingInformation:
          input.resolution.status === "ambiguous" ? ["alegerea masinii"] : ["masina"],
        choices: input.resolution.options.map((option) => ({
          id: option.entityId,
          label: option.label,
        })),
      };
    },
    preview: (input) =>
      input.destination === "tracker"
        ? `Deschid GPS-ul pentru ${input.resolution.entity?.label || input.entityQuery}.`
        : `Deschid pagina pentru ${input.resolution.entity?.label || input.entityQuery}.`,
    execute: async (input, context) => {
      const vehicle = input.resolution.entity;
      if (!vehicle) throw new Error("Masina nu a fost rezolvata.");
      const path =
        input.destination === "tracker"
          ? `/vehicles/${encodeURIComponent(vehicle.entityId)}?tab=gps#vehicle-tracker-live-section`
          : `/vehicles/${encodeURIComponent(vehicle.entityId)}`;
      await context.runtime.navigate(path);
      return {
        message:
          input.destination === "tracker"
            ? `Am deschis GPS-ul pentru ${vehicle.label}.`
            : `Am deschis pagina masinii ${vehicle.label}.`,
        entityId: vehicle.entityId,
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        {
          entityQuery: input.entityQuery,
          destination: input.destination,
          entityId: input.resolution.entity?.entityId || "",
        },
        outcome,
        context
      ),
  };
  return definition;
}

export const createVehicleTrackerTool = createVehicleOpenTool;

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
