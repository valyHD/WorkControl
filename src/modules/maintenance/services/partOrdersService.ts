import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase/firebase";
import {
  buildCompanyScopeConstraints,
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import type { AppUser } from "../../../types/tool";
import type {
  MaintenancePartOrder,
  MaintenancePartOrderLine,
  MaintenancePartOrderPriority,
  MaintenancePartOrderStatus,
} from "../../../types/maintenance";
import { normalizeMaintenancePartOrderStatus } from "../utils/partOrderStatus";

const partOrdersCollection = collection(db, "maintenancePartOrders");
const ORDERS_PATH = "/maintenance/orders";

function toText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value: unknown): MaintenancePartOrderStatus {
  return normalizeMaintenancePartOrderStatus(value);
}

function normalizePriority(value: unknown): MaintenancePartOrderPriority {
  const safe = toText(value);
  if (["low", "normal", "urgent"].includes(safe)) return safe as MaintenancePartOrderPriority;
  return "normal";
}

function normalizeLine(line: Partial<MaintenancePartOrderLine>, index: number): MaintenancePartOrderLine {
  return {
    id: toText(line.id) || `line_${Date.now()}_${index}`,
    name: toText(line.name),
    code: toText(line.code),
    quantity: Math.max(1, toNumber(line.quantity, 1)),
    unit: toText(line.unit, "buc") || "buc",
    supplier: toText(line.supplier),
    estimatedPrice: Math.max(0, toNumber(line.estimatedPrice, 0)),
    notes: toText(line.notes),
  };
}

function calculateTotal(lines: MaintenancePartOrderLine[]) {
  return Number(
    lines
      .reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)) * Math.max(0, Number(line.estimatedPrice || 0)), 0)
      .toFixed(2)
  );
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampReminderMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(1440, Math.round(parsed)));
}

function mapOrder(id: string, data: Record<string, unknown>): MaintenancePartOrder {
  const lines = Array.isArray(data.lines)
    ? data.lines.map((line, index) => normalizeLine(line as Partial<MaintenancePartOrderLine>, index))
    : [];

  return {
    id,
    companyId: toText(data.companyId),
    title: toText(data.title),
    status: normalizeStatus(data.status),
    priority: normalizePriority(data.priority),
    clientId: toText(data.clientId),
    clientName: toText(data.clientName),
    addressLabel: toText(data.addressLabel),
    liftSerialNumber: toText(data.liftSerialNumber),
    requestedByUserId: toText(data.requestedByUserId),
    requestedByUserName: toText(data.requestedByUserName),
    notifyUserId: toText(data.notifyUserId),
    notifyUserName: toText(data.notifyUserName),
    reminderIntervalMinutes: clampReminderMinutes(data.reminderIntervalMinutes),
    notificationSeenAt: toNullableNumber(data.notificationSeenAt),
    notificationSeenByUserId: toText(data.notificationSeenByUserId),
    notificationSeenByUserName: toText(data.notificationSeenByUserName),
    neededByDate: toText(data.neededByDate),
    supplierName: toText(data.supplierName),
    supplierContact: toText(data.supplierContact),
    supplierEmail: toText(data.supplierEmail),
    orderNumber: toText(data.orderNumber),
    clientEmail: toText(data.clientEmail),
    supplierEmailSentAt: toNullableNumber(data.supplierEmailSentAt),
    supplierEmailSentByUserId: toText(data.supplierEmailSentByUserId),
    supplierEmailSentByUserName: toText(data.supplierEmailSentByUserName),
    supplierQuoteReceivedAt: toNullableNumber(data.supplierQuoteReceivedAt),
    supplierQuoteReceivedByUserId: toText(data.supplierQuoteReceivedByUserId),
    supplierQuoteReceivedByUserName: toText(data.supplierQuoteReceivedByUserName),
    supplierOfferAmount: toNumber(data.supplierOfferAmount, 0),
    clientOfferEmailSentAt: toNullableNumber(data.clientOfferEmailSentAt),
    clientOfferEmailSentByUserId: toText(data.clientOfferEmailSentByUserId),
    clientOfferEmailSentByUserName: toText(data.clientOfferEmailSentByUserName),
    clientOfferAmount: toNumber(data.clientOfferAmount, 0),
    clientOfferNotes: toText(data.clientOfferNotes),
    resolvedAt: toNullableNumber(data.resolvedAt),
    resolvedByUserId: toText(data.resolvedByUserId),
    resolvedByUserName: toText(data.resolvedByUserName),
    lastReminderAt: toNullableNumber(data.lastReminderAt),
    nextReminderAt: toNullableNumber(data.nextReminderAt),
    notes: toText(data.notes),
    lines,
    totalEstimated: toNumber(data.totalEstimated, calculateTotal(lines)),
    createdAt: toNumber(data.createdAt, Date.now()),
    updatedAt: toNumber(data.updatedAt, Date.now()),
  };
}

function actorName(actor: AppUser | null | undefined) {
  return actor?.fullName || actor?.email || "Utilizator";
}

function orderLabel(order: Pick<MaintenancePartOrder, "title" | "clientName" | "liftSerialNumber">) {
  return order.title || [order.clientName, order.liftSerialNumber].filter(Boolean).join(" - ") || "Comanda piese";
}

function buildFieldsText(order: MaintenancePartOrder) {
  return [
    `Client: ${order.clientName || "-"}`,
    `Lift: ${order.liftSerialNumber || "-"}`,
    `Status: ${order.status}`,
    `Prioritate: ${order.priority}`,
    `Notificat: ${order.notifyUserName || "-"}`,
    `Furnizor: ${order.supplierName || "-"}`,
    `Piese: ${order.lines.map((line) => `${line.name || "Piesa"} x ${line.quantity}`).join(", ") || "-"}`,
    `Total estimat: ${order.totalEstimated || 0} RON`,
  ];
}

export function subscribeMaintenancePartOrders(
  onData: (orders: MaintenancePartOrder[]) => void,
  onError?: (error: Error) => void
): () => void {
  let unsubscribe: () => void = () => {};
  let cancelled = false;
  void getCurrentCompanyAccessContext().then((context) => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      query(
        partOrdersCollection,
        ...buildCompanyScopeConstraints(context),
        orderBy("updatedAt", "desc"),
        limit(200)
      ),
      (snap) => onData(snap.docs.map((docItem) => mapOrder(
        docItem.id,
        docItem.data() as Record<string, unknown>
      ))),
      (error) => onError?.(error)
    );
  }).catch((error) => onError?.(error as Error));
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function createMaintenancePartOrder(
  input: Omit<MaintenancePartOrder, "id" | "createdAt" | "updatedAt" | "totalEstimated">,
  actor: AppUser | null
): Promise<string> {
  const context = await getCurrentCompanyAccessContext();
  const companyId = input.companyId || requirePrimaryCompanyId(context);
  const now = Date.now();
  const lines = input.lines.map((line, index) => normalizeLine(line, index)).filter((line) => line.name);
  const payload = {
    ...input,
    companyId,
    title: input.title.trim() || "Comanda piese lift",
    lines,
    totalEstimated: calculateTotal(lines),
    reminderIntervalMinutes: clampReminderMinutes(input.reminderIntervalMinutes),
    nextReminderAt: input.notifyUserId ? now + clampReminderMinutes(input.reminderIntervalMinutes) * 60_000 : null,
    lastReminderAt: null,
    notificationSeenAt: null,
    notificationSeenByUserId: "",
    notificationSeenByUserName: "",
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  };

  const docRef = await addDoc(partOrdersCollection, payload);
  const savedOrder = mapOrder(docRef.id, payload);
  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_part_order_created",
    entityId: docRef.id,
    title: "Comanda piese noua",
    message: `${actorName(actor)} a creat comanda ${orderLabel(savedOrder)}.`,
    notificationPath: ORDERS_PATH,
    ownerUserId: savedOrder.requestedByUserId,
    actorUserId: actor?.id || actor?.uid || "",
    actorUserName: actorName(actor),
    actorUserThemeKey: actor?.themeKey ?? null,
    metadata: {
      fieldsText: buildFieldsText(savedOrder),
    },
  });

  return docRef.id;
}

export async function updateMaintenancePartOrder(
  orderId: string,
  input: Omit<MaintenancePartOrder, "id" | "createdAt" | "updatedAt" | "totalEstimated">,
  actor: AppUser | null,
  previousStatus?: MaintenancePartOrderStatus
): Promise<void> {
  const lines = input.lines.map((line, index) => normalizeLine(line, index)).filter((line) => line.name);
  const payload = {
    ...input,
    title: input.title.trim() || "Comanda piese lift",
    lines,
    totalEstimated: calculateTotal(lines),
    reminderIntervalMinutes: clampReminderMinutes(input.reminderIntervalMinutes),
    nextReminderAt:
      input.notifyUserId && !input.notificationSeenAt && input.status !== "installed" && input.status !== "cancelled"
        ? input.nextReminderAt || Date.now() + clampReminderMinutes(input.reminderIntervalMinutes) * 60_000
        : null,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  };

  await updateDoc(doc(partOrdersCollection, orderId), payload);
  const savedOrder = mapOrder(orderId, payload);
  const statusChanged = previousStatus && previousStatus !== savedOrder.status;

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: statusChanged ? "maintenance_part_order_status_changed" : "maintenance_part_order_updated",
    entityId: orderId,
    title: statusChanged ? "Status comanda piese schimbat" : "Comanda piese actualizata",
    message: statusChanged
      ? `${actorName(actor)} a schimbat comanda ${orderLabel(savedOrder)} din ${previousStatus} in ${savedOrder.status}.`
      : `${actorName(actor)} a actualizat comanda ${orderLabel(savedOrder)}.`,
    notificationPath: ORDERS_PATH,
    ownerUserId: savedOrder.requestedByUserId,
    actorUserId: actor?.id || actor?.uid || "",
    actorUserName: actorName(actor),
    actorUserThemeKey: actor?.themeKey ?? null,
    metadata: {
      fieldsText: buildFieldsText(savedOrder),
      changesText: statusChanged ? [`Status: ${previousStatus} -> ${savedOrder.status}`] : buildFieldsText(savedOrder),
    },
  });
}

export async function updateMaintenancePartOrderStatus(
  order: MaintenancePartOrder,
  nextStatus: MaintenancePartOrderStatus,
  actor: AppUser | null
): Promise<void> {
  const status = normalizeMaintenancePartOrderStatus(nextStatus);
  if (status === order.status) return;

  const now = Date.now();
  const isResolved = status === "installed";
  const stopsReminders = isResolved || status === "cancelled";
  await updateDoc(doc(partOrdersCollection, order.id), {
    status,
    nextReminderAt: stopsReminders ? null : order.nextReminderAt ?? null,
    resolvedAt: isResolved ? now : null,
    resolvedByUserId: isResolved ? actor?.id || actor?.uid || "" : "",
    resolvedByUserName: isResolved ? actorName(actor) : "",
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });

  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_part_order_status_changed",
    entityId: order.id,
    title: "Status comanda piese schimbat",
    message: `${actorName(actor)} a schimbat comanda ${orderLabel(order)} din ${order.status} in ${status}.`,
    notificationPath: ORDERS_PATH,
    ownerUserId: order.requestedByUserId,
    actorUserId: actor?.id || actor?.uid || "",
    actorUserName: actorName(actor),
    actorUserThemeKey: actor?.themeKey ?? null,
    metadata: {
      fieldsText: buildFieldsText({ ...order, status }),
      changesText: [`Status: ${order.status} -> ${status}`],
    },
  });
}

export async function deleteMaintenancePartOrder(order: MaintenancePartOrder, actor: AppUser | null): Promise<void> {
  await dispatchNotificationEvent({
    module: "maintenance",
    eventType: "maintenance_part_order_deleted",
    entityId: order.id,
    title: "Comanda piese stearsa",
    message: `${actorName(actor)} a sters comanda ${orderLabel(order)}.`,
    notificationPath: ORDERS_PATH,
    ownerUserId: order.requestedByUserId,
    actorUserId: actor?.id || actor?.uid || "",
    actorUserName: actorName(actor),
    actorUserThemeKey: actor?.themeKey ?? null,
    metadata: {
      fieldsText: buildFieldsText(order),
    },
  });
  await deleteDoc(doc(partOrdersCollection, order.id));
}

export async function markMaintenancePartOrderSeen(order: MaintenancePartOrder, actor: AppUser | null): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(partOrdersCollection, order.id), {
    notificationSeenAt: now,
    notificationSeenByUserId: actor?.id || actor?.uid || "",
    notificationSeenByUserName: actorName(actor),
    nextReminderAt: null,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });
}

export async function markSupplierEmailSent(order: MaintenancePartOrder, actor: AppUser | null): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(partOrdersCollection, order.id), {
    status: "quote_requested",
    supplierEmailSentAt: now,
    supplierEmailSentByUserId: actor?.id || actor?.uid || "",
    supplierEmailSentByUserName: actorName(actor),
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });
}

export async function markSupplierQuoteReceived(
  order: MaintenancePartOrder,
  actor: AppUser | null,
  values: { supplierOfferAmount: number; clientOfferAmount?: number; clientOfferNotes?: string }
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(partOrdersCollection, order.id), {
    status: "quote_received",
    supplierQuoteReceivedAt: now,
    supplierQuoteReceivedByUserId: actor?.id || actor?.uid || "",
    supplierQuoteReceivedByUserName: actorName(actor),
    supplierOfferAmount: Math.max(0, Number(values.supplierOfferAmount || 0)),
    clientOfferAmount: Math.max(0, Number(values.clientOfferAmount || values.supplierOfferAmount || 0)),
    clientOfferNotes: toText(values.clientOfferNotes),
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });
}

export async function markClientOfferEmailSent(order: MaintenancePartOrder, actor: AppUser | null): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(partOrdersCollection, order.id), {
    clientOfferEmailSentAt: now,
    clientOfferEmailSentByUserId: actor?.id || actor?.uid || "",
    clientOfferEmailSentByUserName: actorName(actor),
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });
}

export async function markMaintenancePartOrderResolved(order: MaintenancePartOrder, actor: AppUser | null): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(partOrdersCollection, order.id), {
    status: "installed",
    resolvedAt: now,
    resolvedByUserId: actor?.id || actor?.uid || "",
    resolvedByUserName: actorName(actor),
    nextReminderAt: null,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  });
}

export async function getMaintenancePartOrder(orderId: string): Promise<MaintenancePartOrder | null> {
  const snap = await getDoc(doc(partOrdersCollection, orderId));
  if (!snap.exists()) return null;
  return mapOrder(snap.id, snap.data() as Record<string, unknown>);
}
