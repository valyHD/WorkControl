import {
  createProject,
  getActiveTimesheetForUser,
  saveUserTimesheetProjectPreference,
  startTimesheet,
  stopTimesheet,
} from "../../../modules/timesheets/services/timesheetsService";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";
import type { TimesheetLocation } from "../../../types/timesheet";
import { reverseGeocode } from "../../../modules/timesheets/services/geocodingService";
import { resolveAssistantEntity } from "../runtime/assistantEntityResolver";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  authenticatedPermission,
  rolePermission,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";
import { toLegacyRuntimeContext } from "./adapterHelpers";

type StartInput = {
  projectId: string;
  projectQuery: string;
  createProjectIfMissing: boolean;
  explanation: string;
};

type ResolvedStart = StartInput & {
  project: ProjectItem | null;
  resolutionMessage: string;
};

type StopInput = { explanation: string };
type ResolvedStop = StopInput & { timesheet: TimesheetItem | null };
type CreateProjectInput = { name: string };

function recordInput(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStartInput(value: unknown): StartInput {
  const input = recordInput(value);
  return {
    projectId: String(input.projectId || "").trim(),
    projectQuery: String(input.projectQuery || input.entityQuery || "").trim(),
    createProjectIfMissing: input.createProjectIfMissing === true,
    explanation: String(input.explanation || "").trim(),
  };
}

function readStopInput(value: unknown): StopInput {
  return { explanation: String(recordInput(value).explanation || "").trim() };
}

function readCreateProjectInput(value: unknown): CreateProjectInput {
  const input = recordInput(value);
  const fields = recordInput(input.fields);
  return { name: String(input.name || input.entityQuery || fields.name || "").trim() };
}

export async function resolveAssistantTimesheetLocation(): Promise<TimesheetLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { lat: null, lng: null, label: "Locatie indisponibila" };
  }

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 60_000,
    });
  });
  if (!position) {
    return { lat: null, lng: null, label: "Locatie indisponibila" };
  }

  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const label = await reverseGeocode(latitude, longitude).catch(
    () => `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
  );
  return { lat: latitude, lng: longitude, label };
}

export function createStartTimesheetTool(): AssistantToolDefinition<unknown, ResolvedStart> {
  const definition: AssistantToolDefinition<unknown, ResolvedStart> = {
    id: "timesheets.start",
    description:
      "Porneste pontajul utilizatorului curent pe un proiect rezolvat; locatia vine numai din runtime.",
    aliases: ["start_timesheet"],
    module: "timesheets",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        projectQuery: { type: "string" },
        createProjectIfMissing: { type: "boolean" },
        explanation: { type: "string" },
      },
      required: ["projectId", "projectQuery", "createProjectIfMissing", "explanation"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: authenticatedPermission,
    resolve: async (input, context) => {
      const parsed = readStartInput(input);
      const query = parsed.projectId || parsed.projectQuery;
      if (!query)
        return { ...parsed, project: null, resolutionMessage: "Spune proiectul pentru pontaj." };
      const resolution = await resolveAssistantEntity(
        "project",
        query,
        toLegacyRuntimeContext(context)
      );
      return {
        ...parsed,
        project: resolution.status === "resolved" ? (resolution.entity?.data as ProjectItem) : null,
        resolutionMessage: resolution.message || "",
      };
    },
    validate: (input, context) => {
      if (!context.runtime.getTimesheetLocation) {
        return {
          ok: false,
          reason: "Runtime-ul nu poate furniza locatia pontajului.",
          missingInformation: ["timesheetLocation"],
        };
      }
      if (!input.project && !input.createProjectIfMissing) {
        return {
          ok: false,
          reason: input.resolutionMessage || "Proiectul nu a fost gasit.",
          missingInformation: ["project"],
        };
      }
      if (!input.project && !input.projectQuery) {
        return {
          ok: false,
          reason: "Lipseste numele proiectului.",
          missingInformation: ["project"],
        };
      }
      return { ok: true };
    },
    preview: (input) => `Pornesc pontajul pe ${input.project?.name || input.projectQuery}.`,
    execute: async (input, context) => {
      if (!context.actor || !context.runtime.getTimesheetLocation)
        throw new Error("Pontajul nu poate fi pornit in acest context.");
      const active = await getActiveTimesheetForUser(context.actor.uid);
      if (active) throw new Error("Exista deja un pontaj activ pentru acest utilizator.");
      let project = input.project;
      if (!project) {
        const projectId = await createProject({ name: input.projectQuery, status: "activ" });
        project = {
          id: projectId,
          code: "",
          name: input.projectQuery,
          status: "activ",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }
      const location = await context.runtime.getTimesheetLocation();
      const timesheetId = await startTimesheet({
        userId: context.actor.uid,
        userName: context.actor.displayName || context.actor.email || context.actor.uid,
        userThemeKey: context.actor.themeKey,
        projectId: project.id,
        projectCode: project.code || "",
        projectName: project.name,
        startLocation: location,
        startExplanation: input.explanation,
      });
      await saveUserTimesheetProjectPreference(context.actor.uid, project.id);
      return { message: `Am pornit pontajul pe ${project.name}.`, entityId: timesheetId };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        {
          projectId: input.project?.id || "",
          projectQuery: input.projectQuery,
          createProjectIfMissing: input.createProjectIfMissing,
        },
        outcome,
        context
      ),
  };
  return definition;
}

export function createStopTimesheetTool(): AssistantToolDefinition<unknown, ResolvedStop> {
  const definition: AssistantToolDefinition<unknown, ResolvedStop> = {
    id: "timesheets.stop",
    description: "Opreste pontajul activ al utilizatorului curent; locatia vine numai din runtime.",
    aliases: ["stop_timesheet"],
    module: "timesheets",
    inputSchema: {
      type: "object",
      properties: { explanation: { type: "string" } },
      required: ["explanation"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: authenticatedPermission,
    resolve: async (input, context) => ({
      ...readStopInput(input),
      timesheet: context.actor ? await getActiveTimesheetForUser(context.actor.uid) : null,
    }),
    validate: (input, context) => {
      if (!context.runtime.getTimesheetLocation) {
        return {
          ok: false,
          reason: "Runtime-ul nu poate furniza locatia pontajului.",
          missingInformation: ["timesheetLocation"],
        };
      }
      return input.timesheet ? { ok: true } : { ok: false, reason: "Nu exista un pontaj activ." };
    },
    preview: (input) =>
      `Opresc pontajul activ pentru ${input.timesheet?.projectName || "proiectul curent"}.`,
    execute: async (input, context) => {
      if (!input.timesheet || !context.runtime.getTimesheetLocation)
        throw new Error("Nu exista un pontaj activ executabil.");
      await stopTimesheet({
        timesheetId: input.timesheet.id,
        explanation: input.explanation,
        stopLocation: await context.runtime.getTimesheetLocation(),
      });
      return {
        message: `Am oprit pontajul pentru ${input.timesheet.projectName}.`,
        entityId: input.timesheet.id,
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        {
          timesheetId: input.timesheet?.id || "",
          explanation: input.explanation,
        },
        outcome,
        context
      ),
  };
  return definition;
}

export function createProjectTool(): AssistantToolDefinition<unknown, CreateProjectInput> {
  const definition: AssistantToolDefinition<unknown, CreateProjectInput> = {
    id: "timesheets.projects.create",
    description: "Creeaza un proiect activ prin timesheetsService.",
    aliases: ["create_project"],
    module: "timesheets",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: rolePermission("admin", "manager"),
    resolve: readCreateProjectInput,
    validate: (input) =>
      input.name.length >= 2
        ? { ok: true }
        : {
            ok: false,
            reason: "Numele proiectului lipseste.",
            missingInformation: ["projectName"],
          },
    preview: (input) => `Creez proiectul ${input.name}.`,
    execute: async (input) => {
      const id = await createProject({ name: input.name, status: "activ" });
      return {
        message: `Am creat proiectul ${input.name}.`,
        entityId: id,
        afterData: { name: input.name, status: "activ" },
      };
    },
    audit: (input, outcome, context) => auditAssistantTool(definition, input, outcome, context),
  };
  return definition;
}
