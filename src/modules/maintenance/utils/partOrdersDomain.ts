import type {
  MaintenancePartOrder,
  MaintenancePartOrderLine,
  MaintenancePartOrderPreferences,
  MaintenancePartOrderStatus,
} from "../../../types/maintenance";

const orderedStatuses = new Set<MaintenancePartOrderStatus>([
  "ordered",
  "partial",
  "received",
  "installed",
]);

export type OrderedPartHistoryItem = {
  key: string;
  orderId: string;
  orderTitle: string;
  clientName: string;
  liftSerialNumber: string;
  orderedAt: number;
  status: MaintenancePartOrderStatus;
  line: MaintenancePartOrderLine;
};

export function isOrderedPartStatus(status: MaintenancePartOrderStatus): boolean {
  return orderedStatuses.has(status);
}

export function wasMaintenancePartOrderPlaced(order: MaintenancePartOrder): boolean {
  return Boolean(order.orderedAt) || isOrderedPartStatus(order.status);
}

export function buildOrderedPartHistory(orders: MaintenancePartOrder[]): OrderedPartHistoryItem[] {
  return orders
    .filter(wasMaintenancePartOrderPlaced)
    .flatMap((order) =>
      order.lines.map((line) => ({
        key: `${order.id}:${line.id}`,
        orderId: order.id,
        orderTitle: order.title,
        clientName: order.clientName,
        liftSerialNumber: order.liftSerialNumber,
        orderedAt: order.orderedAt || order.updatedAt || order.createdAt,
        status: order.status,
        line,
      }))
    )
    .sort((left, right) => right.orderedAt - left.orderedAt);
}

export function uniqueOrderedPartNames(orders: MaintenancePartOrder[]): string[] {
  return [...new Set(buildOrderedPartHistory(orders).map((item) => item.line.name.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ro"));
}

export function uniqueSupplierNames(orders: MaintenancePartOrder[]): string[] {
  const values = buildOrderedPartHistory(orders).flatMap((item) => [
    item.line.supplier.trim(),
    orders.find((order) => order.id === item.orderId)?.supplierName.trim() || "",
  ]);
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ro"));
}

export function calculateSupplierOfferTotal(lines: MaintenancePartOrderLine[]): number {
  return Number(
    lines
      .reduce(
        (sum, line) =>
          sum + Number(line.quantity || 0) * Number(line.supplierOfferUnitPrice || line.estimatedPrice || 0),
        0
      )
      .toFixed(2)
  );
}

export function calculateClientOfferTotal(lines: MaintenancePartOrderLine[]): number {
  return Number(
    lines
      .reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.clientOfferUnitPrice || 0), 0)
      .toFixed(2)
  );
}

export type PartOrderVisualState = "waiting" | "urgent" | "quoted" | "ordered" | "resolved" | "cancelled";

export function getPartOrderDisplayAmount(order: MaintenancePartOrder): { amount: number; label: string } {
  const clientTotal = Number(order.clientOfferAmount || calculateClientOfferTotal(order.lines) || 0);
  if (clientTotal > 0 && order.clientOfferEmailSentAt) {
    return { amount: clientTotal, label: "oferta client" };
  }

  const supplierTotal = Number(order.supplierOfferAmount || calculateSupplierOfferTotal(order.lines) || 0);
  if (supplierTotal > 0 && ["quote_received", "ordered", "partial", "received", "installed"].includes(order.status)) {
    return { amount: supplierTotal, label: "oferta furnizor" };
  }

  return { amount: Number(order.totalEstimated || 0), label: "estimat" };
}

export function getPartOrderVisualState(order: MaintenancePartOrder): PartOrderVisualState {
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "installed") return "resolved";
  if (order.priority === "urgent") return "urgent";
  if (order.status === "quote_received") return "quoted";
  if (["ordered", "partial", "received"].includes(order.status)) return "ordered";
  return "waiting";
}

export function applyPartOrderPreferences<T extends {
  supplierName: string;
  supplierContact: string;
  supplierEmail: string;
  lines: MaintenancePartOrderLine[];
}>(value: T, preferences: Partial<MaintenancePartOrderPreferences>): T {
  return {
    ...value,
    supplierName: value.supplierName || preferences.supplierName || "",
    supplierContact: value.supplierContact || preferences.supplierContact || "",
    supplierEmail: value.supplierEmail || preferences.supplierEmail || "",
    lines: value.lines.map((line, index) => ({
      ...line,
      name: line.name || (index === 0 ? preferences.lastPartName || "" : ""),
      supplier: line.supplier || preferences.lineSupplier || "",
    })),
  };
}
