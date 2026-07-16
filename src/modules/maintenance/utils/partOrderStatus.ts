import type { MaintenancePartOrderStatus } from "../../../types/maintenance";

export const MAINTENANCE_PART_ORDER_STATUS_OPTIONS: Array<{
  value: MaintenancePartOrderStatus;
  label: string;
}> = [
  { value: "draft", label: "Ciorna" },
  { value: "requested", label: "Solicitata" },
  { value: "quote_requested", label: "Oferta ceruta" },
  { value: "quote_received", label: "Oferta primita" },
  { value: "ordered", label: "Comandata" },
  { value: "paid", label: "Platita" },
  { value: "partial", label: "Primita partial" },
  { value: "received", label: "Receptionata" },
  { value: "installed", label: "Montata" },
  { value: "cancelled", label: "Anulata" },
];

const VALID_STATUSES = new Set<MaintenancePartOrderStatus>(
  MAINTENANCE_PART_ORDER_STATUS_OPTIONS.map((option) => option.value)
);

export function normalizeMaintenancePartOrderStatus(value: unknown): MaintenancePartOrderStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  return VALID_STATUSES.has(normalized as MaintenancePartOrderStatus)
    ? (normalized as MaintenancePartOrderStatus)
    : "requested";
}

export function getMaintenancePartOrderStatusLabel(status: MaintenancePartOrderStatus): string {
  return MAINTENANCE_PART_ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label || status;
}
