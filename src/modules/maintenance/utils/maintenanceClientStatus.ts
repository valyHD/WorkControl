import type {
  MaintenanceClient,
  MaintenanceClientStatus,
} from "../../../types/maintenance";

export function normalizeMaintenanceClientStatus(value: unknown): MaintenanceClientStatus {
  return value === "inactive" ? "inactive" : "active";
}

export function isMaintenanceClientStatusActive(value: unknown): boolean {
  return normalizeMaintenanceClientStatus(value) === "active";
}

export function isMaintenanceClientActive(
  client: Pick<MaintenanceClient, "status">
): boolean {
  return isMaintenanceClientStatusActive(client.status);
}

export function filterActiveMaintenanceClients<T extends Pick<MaintenanceClient, "status">>(
  clients: T[]
): T[] {
  return clients.filter(isMaintenanceClientActive);
}
