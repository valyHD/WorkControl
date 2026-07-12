import { normalizeAssistantText } from "../assistant/runtime/assistantFuzzy";
import { getVehiclesList } from "../../modules/vehicles/services/vehiclesService";
import { getToolsList } from "../../modules/tools/services/toolsService";
import { getAllUsers } from "../../modules/users/services/usersService";
import { getProjectsList } from "../../modules/timesheets/services/timesheetsService";
import { getMaintenanceClients } from "../../modules/maintenance/services/maintenanceService";

export type GlobalSearchResult = {
  id: string;
  type: "page" | "vehicle" | "tool" | "user" | "project" | "client" | "lift";
  title: string;
  subtitle: string;
  path: string;
  keywords?: string;
};

type SearchDataset = {
  vehicles: Awaited<ReturnType<typeof getVehiclesList>>;
  tools: Awaited<ReturnType<typeof getToolsList>>;
  projects: Awaited<ReturnType<typeof getProjectsList>>;
  users: Awaited<ReturnType<typeof getAllUsers>>;
  clients: Awaited<ReturnType<typeof getMaintenanceClients>>;
};

const SEARCH_CACHE_MS = 60_000;
let cached: { at: number; role: string; value: SearchDataset } | null = null;
let pending: { role: string; promise: Promise<SearchDataset> } | null = null;

async function loadSearchDataset(role: string): Promise<SearchDataset> {
  const privileged = role === "admin" || role === "manager";
  const [vehicles, tools, projects, users, clients] = await Promise.all([
    getVehiclesList().catch(() => []),
    getToolsList().catch(() => []),
    getProjectsList().catch(() => []),
    privileged ? getAllUsers().catch(() => []) : Promise.resolve([]),
    privileged ? getMaintenanceClients().catch(() => []) : Promise.resolve([]),
  ]);
  return { vehicles, tools, projects, users, clients };
}

async function getSearchDataset(role: string) {
  if (cached && cached.role === role && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.value;
  if (!pending || pending.role !== role) {
    const request = loadSearchDataset(role);
    pending = { role, promise: request };
    void request.then(
      () => {
        if (pending?.promise === request) pending = null;
      },
      () => {
        if (pending?.promise === request) pending = null;
      }
    );
  }
  const value = await pending.promise;
  cached = { at: Date.now(), role, value };
  return value;
}

function includesQuery(query: string, ...parts: unknown[]) {
  return normalizeAssistantText(parts.filter(Boolean).join(" ")).includes(query);
}

export async function searchWorkControlEntities(rawQuery: string, role: string): Promise<GlobalSearchResult[]> {
  const query = normalizeAssistantText(rawQuery);
  if (query.length < 2) return [];

  const data = await getSearchDataset(role);
  const results: GlobalSearchResult[] = [];

  data.vehicles.forEach((item) => {
    if (!includesQuery(query, item.plateNumber, item.brand, item.model, item.currentDriverUserName)) return;
    results.push({
      id: `vehicle:${item.id}`,
      type: "vehicle",
      title: item.plateNumber || `${item.brand || "Mașină"} ${item.model || ""}`.trim(),
      subtitle: `${item.brand || ""} ${item.model || ""}${item.currentDriverUserName ? ` · ${item.currentDriverUserName}` : ""}`.trim(),
      path: `/vehicles/${item.id}`,
    });
  });

  data.tools.forEach((item) => {
    if (!includesQuery(query, item.name, item.internalCode, item.currentHolderUserName, item.ownerUserName)) return;
    results.push({
      id: `tool:${item.id}`,
      type: "tool",
      title: item.name || "Sculă",
      subtitle: [item.internalCode, item.currentHolderUserName || item.ownerUserName].filter(Boolean).join(" · "),
      path: `/tools/${item.id}`,
    });
  });

  data.projects.forEach((item) => {
    if (!includesQuery(query, item.name, item.code, item.status)) return;
    results.push({
      id: `project:${item.id}`,
      type: "project",
      title: item.name || "Proiect",
      subtitle: [item.code, item.status].filter(Boolean).join(" · "),
      path: `/projects?search=${encodeURIComponent(item.name || item.code || "")}`,
    });
  });

  data.users.forEach((item) => {
    if (!includesQuery(query, item.fullName, item.email, item.department, item.roleTitle)) return;
    results.push({
      id: `user:${item.id}`,
      type: "user",
      title: item.fullName || item.email || "Utilizator",
      subtitle: [item.roleTitle, item.department].filter(Boolean).join(" · "),
      path: `/users/${item.uid || item.id}`,
    });
  });

  data.clients.forEach((item) => {
    if (includesQuery(query, item.name, item.maintenanceCompany, item.emails?.join(" "))) {
      results.push({
        id: `client:${item.id}`,
        type: "client",
        title: item.name || "Client mentenanță",
        subtitle: item.maintenanceCompany || "Client service lifturi",
        path: `/maintenance/${item.id}`,
      });
    }
    const lifts = (item.liftNumbers?.length ? item.liftNumbers : item.liftNumber ? [item.liftNumber] : []);
    lifts.forEach((lift) => {
      if (!includesQuery(query, lift, item.name, item.maintenanceCompany)) return;
      results.push({
        id: `lift:${item.id}:${lift}`,
        type: "lift",
        title: `Lift ${lift}`,
        subtitle: item.name || item.maintenanceCompany || "Client mentenanță",
        path: `/maintenance/${item.id}?lift=${encodeURIComponent(lift)}`,
      });
    });
  });

  return results.slice(0, 12);
}
