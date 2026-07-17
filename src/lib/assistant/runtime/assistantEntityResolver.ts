import { getProjectsList } from "../../../modules/timesheets/services/timesheetsService";
import { getToolsList } from "../../../modules/tools/services/toolsService";
import { getAllUsers } from "../../../modules/users/services/usersService";
import {
  getVehicleById,
  getVehiclesList,
} from "../../../modules/vehicles/services/vehiclesService";
import type { ProjectItem } from "../../../types/timesheet";
import type { ToolItem } from "../../../types/tool";
import type { AppUserItem } from "../../../types/user";
import type { VehicleItem } from "../../../types/vehicle";
import {
  compactVehiclePlate,
  normalizeAssistantText,
  rankAssistantMatches,
  scoreAssistantText,
} from "./assistantFuzzy";
import {
  getToolIdFromAssistantPath,
  getVehicleIdFromAssistantPath,
} from "./assistantConversationMemory";
import type {
  AssistantEntityResolution,
  AssistantResolvedEntity,
  AssistantRuntimeContext,
  AssistantRuntimeEntityType,
} from "./assistantTypes";

function vehicleLabel(vehicle: VehicleItem) {
  return [vehicle.plateNumber, vehicle.brand, vehicle.model].filter(Boolean).join(" ");
}

function vehicleSearchText(vehicle: VehicleItem) {
  return [vehicleLabel(vehicle), vehicle.vin, vehicle.currentDriverUserName, vehicle.ownerUserName]
    .filter(Boolean)
    .join(" ");
}

function toolLabel(tool: ToolItem) {
  return [tool.name, tool.internalCode].filter(Boolean).join(" ");
}

function toolSearchText(tool: ToolItem) {
  return [
    toolLabel(tool),
    tool.qrCodeValue,
    tool.status,
    tool.currentHolderUserName,
    tool.ownerUserName,
    tool.locationLabel,
  ]
    .filter(Boolean)
    .join(" ");
}

function projectLabel(project: ProjectItem) {
  return [project.name, project.code, project.status].filter(Boolean).join(" ");
}

function userLabel(user: AppUserItem) {
  return user.fullName || user.email || user.id;
}

function userSearchText(user: AppUserItem) {
  return [userLabel(user), user.email, user.roleTitle, user.department].filter(Boolean).join(" ");
}

const ENTITY_QUERY_FILLER = new Set([
  "a",
  "al",
  "ale",
  "arata",
  "arata-mi",
  "as",
  "cauta",
  "care",
  "ce",
  "cu",
  "de",
  "deschide",
  "din",
  "du",
  "gaseste",
  "gasesti",
  "imi",
  "in",
  "la",
  "lui",
  "lu",
  "ma",
  "mi",
  "ne",
  "pagina",
  "pe",
  "pentru",
  "spre",
  "te",
  "rog",
  "ul",
  "vezi",
  "vreau",
]);

const ENTITY_QUERY_DESCRIPTORS: Partial<Record<AssistantRuntimeEntityType, Set<string>>> = {
  vehicle: new Set([
    "autoturism",
    "autoturismul",
    "auto",
    "duba",
    "dubei",
    "dubita",
    "flota",
    "flotei",
    "gps",
    "gpsul",
    "harta",
    "inmatriculare",
    "masina",
    "masinii",
    "numar",
    "numarul",
    "tracker",
    "trackerul",
    "utilitara",
    "autoutilitara",
    "vehicul",
    "vehiculul",
  ]),
  tool: new Set([
    "aparat",
    "echipament",
    "echipamentul",
    "echipamentului",
    "inventar",
    "scula",
    "sculei",
    "unealta",
    "uneltei",
  ]),
  project: new Set([
    "job",
    "lucrare",
    "lucrarii",
    "obiectiv",
    "proiect",
    "proiectul",
    "santier",
    "santierul",
  ]),
  user: new Set([
    "angajat",
    "angajatul",
    "coleg",
    "colegul",
    "muncitor",
    "muncitorul",
    "om",
    "omul",
    "salariat",
    "salariatul",
    "user",
    "userul",
    "utilizator",
    "utilizatorul",
  ]),
};

export function normalizeAssistantEntityQuery(
  entityType: AssistantRuntimeEntityType,
  query: string
) {
  const normalized = normalizeAssistantText(query);
  const descriptors = ENTITY_QUERY_DESCRIPTORS[entityType] || new Set<string>();
  const meaningful = normalized
    .split(" ")
    .filter((token) => token && !ENTITY_QUERY_FILLER.has(token) && !descriptors.has(token))
    .join(" ")
    .trim();
  return meaningful || normalized;
}

function buildResolution<T>(
  entityType: AssistantRuntimeEntityType,
  query: string,
  ranked: Array<{ item: T; score: number }>,
  getId: (item: T) => string,
  getLabel: (item: T) => string
): AssistantEntityResolution<T> {
  const options: AssistantResolvedEntity<T>[] = ranked.slice(0, 5).map((entry) => ({
    entityType,
    entityId: getId(entry.item),
    label: getLabel(entry.item),
    query,
    score: entry.score,
    data: entry.item,
  }));

  if (options.length === 0) {
    return {
      status: "not_found",
      options,
      message: `Nu am gasit ${entityType} pentru "${query}".`,
    };
  }

  const [first, second] = options;
  if (first.score >= 0.85 && (!second || first.score - second.score >= 0.08)) {
    return { status: "resolved", entity: first, options };
  }

  if (options.length >= 2 && first.score >= 0.3) {
    return {
      status: "ambiguous",
      options,
      message: "Am gasit mai multe rezultate posibile. Alege varianta corecta.",
    };
  }

  if (first.score >= 0.55 && (!second || first.score - second.score >= 0.15)) {
    return { status: "resolved", entity: first, options };
  }

  return { status: "not_found", options, message: `Nu am gasit ${entityType} pentru "${query}".` };
}

async function resolveContextEntity(
  entityType: AssistantRuntimeEntityType,
  context: AssistantRuntimeContext
) {
  const lastEntity =
    context.memory?.lastEntity?.entityType === entityType && context.memory.lastEntity.entityId
      ? context.memory.lastEntity
      : null;

  if (entityType === "vehicle") {
    const id =
      getVehicleIdFromAssistantPath(context.currentPathname) ||
      context.memory?.lastVehicleId ||
      lastEntity?.entityId ||
      "";
    if (id) {
      const vehicle = await getVehicleById(id);
      if (vehicle) {
        return {
          status: "resolved",
          entity: {
            entityType,
            entityId: vehicle.id,
            label: vehicleLabel(vehicle),
            score: 1,
            data: vehicle,
          },
          options: [],
        } satisfies AssistantEntityResolution<VehicleItem>;
      }
    }
  }

  if (entityType === "tool") {
    const id =
      getToolIdFromAssistantPath(context.currentPathname) ||
      context.memory?.lastToolId ||
      lastEntity?.entityId ||
      "";
    if (id) {
      const tools = await getToolsList();
      const tool = tools.find((item) => item.id === id);
      if (tool) {
        return {
          status: "resolved",
          entity: {
            entityType,
            entityId: tool.id,
            label: toolLabel(tool),
            score: 1,
            data: tool,
          },
          options: [],
        } satisfies AssistantEntityResolution<ToolItem>;
      }
    }
  }

  if (entityType === "project") {
    const id = context.memory?.lastProjectId || lastEntity?.entityId || "";
    if (id) {
      const projects = await getProjectsList();
      const project = projects.find((item) => item.id === id);
      if (project) {
        return {
          status: "resolved",
          entity: {
            entityType,
            entityId: project.id,
            label: projectLabel(project),
            score: 1,
            data: project,
          },
          options: [],
        } satisfies AssistantEntityResolution<ProjectItem>;
      }
    }
  }

  if (entityType === "user") {
    const id = context.memory?.lastUserId || lastEntity?.entityId || "";
    if (id) {
      const users = await getAllUsers();
      const user = users.find((item) => item.id === id);
      if (user) {
        return {
          status: "resolved",
          entity: {
            entityType,
            entityId: user.id,
            label: userLabel(user),
            score: 1,
            data: user,
          },
          options: [],
        } satisfies AssistantEntityResolution<AppUserItem>;
      }
    }
  }

  return null;
}

export async function resolveAssistantEntity(
  entityType: AssistantRuntimeEntityType,
  query: string,
  context: AssistantRuntimeContext
): Promise<AssistantEntityResolution> {
  const cleanQuery = query.trim();
  const searchQuery = normalizeAssistantEntityQuery(entityType, cleanQuery);
  const contextEntity = await resolveContextEntity(entityType, context);
  // Context is only a pronoun/omitted-target fallback. An explicit query must
  // always be resolved against the requested entity collection.
  if (contextEntity && !cleanQuery) return contextEntity;

  if (entityType === "vehicle") {
    const vehicles = await getVehiclesList();
    const ranked = vehicles
      .map((vehicle) => {
        const compactPlate = compactVehiclePlate(vehicle.plateNumber);
        const compactQuery = compactVehiclePlate(searchQuery);
        const plateBoost =
          compactPlate && compactQuery && compactPlate.includes(compactQuery) ? 0.35 : 0;
        return {
          item: vehicle,
          score: Math.min(
            1,
            scoreAssistantText(vehicleSearchText(vehicle), searchQuery) + plateBoost
          ),
        };
      })
      .filter((entry) => entry.score >= 0.25)
      .sort((a, b) => b.score - a.score);
    return buildResolution("vehicle", cleanQuery, ranked, (vehicle) => vehicle.id, vehicleLabel);
  }

  if (entityType === "tool") {
    const ranked = rankAssistantMatches(await getToolsList(), searchQuery, toolSearchText, 0.25);
    return buildResolution("tool", cleanQuery, ranked, (tool) => tool.id, toolLabel);
  }

  if (entityType === "project") {
    const ranked = rankAssistantMatches(await getProjectsList(), searchQuery, projectLabel, 0.25);
    return buildResolution("project", cleanQuery, ranked, (project) => project.id, projectLabel);
  }

  if (entityType === "user") {
    const users = await getAllUsers();
    const normalizedQuery = normalizeAssistantText(cleanQuery);
    const requestsCurrentUser =
      cleanQuery === "__current_user__" ||
      ["eu", "mine", "profilul meu", "contul meu", "utilizatorul curent"].includes(normalizedQuery);
    if (requestsCurrentUser && context.user?.uid) {
      const currentUser = users.find((item) => item.id === context.user?.uid);
      if (currentUser) {
        return {
          status: "resolved",
          entity: {
            entityType: "user",
            entityId: currentUser.id,
            label: userLabel(currentUser),
            query: cleanQuery,
            score: 1,
            data: currentUser,
          },
          options: [],
        };
      }
    }
    const ranked = rankAssistantMatches(users, searchQuery, userSearchText, 0.25);
    return buildResolution("user", cleanQuery, ranked, (user) => user.id, userLabel);
  }

  return { status: "not_found", options: [], message: "Nu am gasit entitatea ceruta." };
}
