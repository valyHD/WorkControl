import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, Mail, PackagePlus, Pencil, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import type { AppUser } from "../../../types/tool";
import type { AppUserItem } from "../../../types/user";
import type {
  MaintenanceClient,
  MaintenancePartOrder,
  MaintenancePartOrderLine,
  MaintenancePartOrderPriority,
  MaintenancePartOrderStatus,
} from "../../../types/maintenance";
import { subscribeMaintenanceClients } from "../services/maintenanceService";
import {
  createMaintenancePartOrder,
  deleteMaintenancePartOrder,
  markMaintenancePartOrderResolved,
  markMaintenancePartOrderSeen,
  markSupplierQuoteReceived,
  subscribeMaintenancePartOrders,
  updateMaintenancePartOrder,
  updateMaintenancePartOrderStatus,
} from "../services/partOrdersService";
import { sendSharedMaintenancePartOrderEmail, SHARED_GMAIL_SENDER_EMAIL } from "../services/sharedGmailService";
import { subscribeUsers } from "../../users/services/usersService";
import {
  getMaintenancePartOrderStatusLabel,
  MAINTENANCE_PART_ORDER_STATUS_OPTIONS,
} from "../utils/partOrderStatus";

const statusOptions = MAINTENANCE_PART_ORDER_STATUS_OPTIONS;

const priorityOptions: Array<{ value: MaintenancePartOrderPriority; label: string }> = [
  { value: "low", label: "Scazuta" },
  { value: "normal", label: "Normala" },
  { value: "urgent", label: "Urgenta" },
];

const emptyLine = (): MaintenancePartOrderLine => ({
  id: `line_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  name: "",
  code: "",
  quantity: 1,
  unit: "buc",
  supplier: "",
  estimatedPrice: 0,
  notes: "",
});

type FormState = {
  title: string;
  status: MaintenancePartOrderStatus;
  priority: MaintenancePartOrderPriority;
  clientId: string;
  addressLabel: string;
  liftSerialNumber: string;
  notifyUserId: string;
  notifyUserName: string;
  reminderIntervalMinutes: number;
  neededByDate: string;
  supplierName: string;
  supplierContact: string;
  supplierEmail: string;
  orderNumber: string;
  clientEmail: string;
  notes: string;
  lines: MaintenancePartOrderLine[];
};

const emptyForm = (): FormState => ({
  title: "",
  status: "requested",
  priority: "normal",
  clientId: "",
  addressLabel: "",
  liftSerialNumber: "",
  notifyUserId: "",
  notifyUserName: "",
  reminderIntervalMinutes: 30,
  neededByDate: "",
  supplierName: "",
  supplierContact: "",
  supplierEmail: "",
  orderNumber: "",
  clientEmail: "",
  notes: "",
  lines: [emptyLine()],
});

function getCurrentAppUser(user: ReturnType<typeof useAuth>["user"]): AppUser | null {
  if (!user?.uid) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email || "",
    fullName: user.displayName || user.email || "Utilizator",
    active: true,
    themeKey: user.themeKey ?? null,
  };
}

function formatDateTime(value: number) {
  return new Date(value || Date.now()).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function orderTotal(lines: MaintenancePartOrderLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.estimatedPrice || 0), 0);
}

function getUserDisplayName(user: AppUserItem) {
  return user.fullName || user.email || user.id;
}

function getClientLiftOptions(client: MaintenanceClient | null) {
  if (!client) return [];
  const fromAddresses = client.addresses.flatMap((address) =>
    address.lifts.map((lift) => ({
      addressLabel: address.label || address.street || client.address,
      liftSerialNumber: lift.serialNumber || lift.label,
    }))
  );
  const fallback = client.liftNumbers.map((liftNumber) => ({
    addressLabel: client.address,
    liftSerialNumber: liftNumber,
  }));
  return [...fromAddresses, ...fallback].filter((item) => item.liftSerialNumber);
}

function orderToForm(order: MaintenancePartOrder): FormState {
  return {
    title: order.title,
    status: order.status,
    priority: order.priority,
    clientId: order.clientId,
    addressLabel: order.addressLabel,
    liftSerialNumber: order.liftSerialNumber,
    notifyUserId: order.notifyUserId,
    notifyUserName: order.notifyUserName,
    reminderIntervalMinutes: order.reminderIntervalMinutes || 30,
    neededByDate: order.neededByDate,
    supplierName: order.supplierName,
    supplierContact: order.supplierContact,
    supplierEmail: order.supplierEmail,
    orderNumber: order.orderNumber,
    clientEmail: order.clientEmail,
    notes: order.notes,
    lines: order.lines.length ? order.lines : [emptyLine()],
  };
}

export default function MaintenancePartOrdersPage() {
  const { user, role } = useAuth();
  const currentUser = useMemo(() => getCurrentAppUser(user), [user]);
  const canDelete = role === "admin" || role === "manager";

  const [orders, setOrders] = useState<MaintenancePartOrder[]>([]);
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editingOrder, setEditingOrder] = useState<MaintenancePartOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingEmailKey, setSendingEmailKey] = useState("");
  const [statusUpdatingOrderId, setStatusUpdatingOrderId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const unsubClients = subscribeMaintenanceClients(
      setClients,
      (err) => {
        console.error("[MaintenancePartOrdersPage][clients]", err);
        setError("Nu am putut incarca clientii de mentenanta.");
      }
    );
    const unsubOrders = subscribeMaintenancePartOrders(
      (nextOrders) => {
        setOrders(nextOrders);
        setLoading(false);
      },
      (err) => {
        console.error("[MaintenancePartOrdersPage][orders]", err);
        setError("Nu am putut incarca comenzile de piese.");
        setLoading(false);
      }
    );
    const unsubUsers = subscribeUsers(
      (items) => setUsers(items.filter((item) => item.active !== false)),
      (err) => console.error("[MaintenancePartOrdersPage][users]", err)
    );

    return () => {
      unsubClients();
      unsubOrders();
      unsubUsers();
    };
  }, []);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === form.clientId) || null,
    [clients, form.clientId]
  );

  const liftOptions = useMemo(() => getClientLiftOptions(selectedClient), [selectedClient]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter && order.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        order.title,
        order.clientName,
        order.addressLabel,
        order.liftSerialNumber,
        order.supplierName,
        order.supplierEmail,
        order.clientEmail,
        order.orderNumber,
        order.notifyUserName,
        order.notes,
        ...order.lines.flatMap((line) => [line.name, line.code, line.supplier, line.notes]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [orders, search, statusFilter]);

  function updateLine(lineId: string, patch: Partial<MaintenancePartOrderLine>) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  }

  function removeLine(lineId: string) {
    setForm((prev) => ({ ...prev, lines: prev.lines.length <= 1 ? prev.lines : prev.lines.filter((line) => line.id !== lineId) }));
  }

  function resetForm() {
    setForm(emptyForm());
    setEditingOrder(null);
    setError("");
    setStatus("");
  }

  function startEdit(order: MaintenancePartOrder) {
    setEditingOrder(order);
    setForm(orderToForm(order));
    setError("");
    setStatus("Editezi comanda selectata.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) {
      setError("Trebuie sa fii autentificat.");
      return;
    }

    const client = clients.find((item) => item.id === form.clientId) || null;
    const lines = form.lines.filter((line) => line.name.trim());
    if (!form.title.trim() && !client?.name) {
      setError("Completeaza titlul sau alege clientul.");
      return;
    }
    if (lines.length === 0) {
      setError("Adauga cel putin o piesa in comanda.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        clientName: client?.name || "",
        requestedByUserId: editingOrder?.requestedByUserId || currentUser.id,
        requestedByUserName: editingOrder?.requestedByUserName || currentUser.fullName || currentUser.email || "Utilizator",
        notificationSeenAt: editingOrder?.notificationSeenAt ?? null,
        notificationSeenByUserId: editingOrder?.notificationSeenByUserId || "",
        notificationSeenByUserName: editingOrder?.notificationSeenByUserName || "",
        supplierEmailSentAt: editingOrder?.supplierEmailSentAt ?? null,
        supplierEmailSentByUserId: editingOrder?.supplierEmailSentByUserId || "",
        supplierEmailSentByUserName: editingOrder?.supplierEmailSentByUserName || "",
        supplierQuoteReceivedAt: editingOrder?.supplierQuoteReceivedAt ?? null,
        supplierQuoteReceivedByUserId: editingOrder?.supplierQuoteReceivedByUserId || "",
        supplierQuoteReceivedByUserName: editingOrder?.supplierQuoteReceivedByUserName || "",
        supplierOfferAmount: editingOrder?.supplierOfferAmount || 0,
        clientOfferEmailSentAt: editingOrder?.clientOfferEmailSentAt ?? null,
        clientOfferEmailSentByUserId: editingOrder?.clientOfferEmailSentByUserId || "",
        clientOfferEmailSentByUserName: editingOrder?.clientOfferEmailSentByUserName || "",
        clientOfferAmount: editingOrder?.clientOfferAmount || 0,
        clientOfferNotes: editingOrder?.clientOfferNotes || "",
        resolvedAt: editingOrder?.resolvedAt ?? null,
        resolvedByUserId: editingOrder?.resolvedByUserId || "",
        resolvedByUserName: editingOrder?.resolvedByUserName || "",
        lastReminderAt: editingOrder?.lastReminderAt ?? null,
        nextReminderAt: editingOrder?.nextReminderAt ?? null,
        lines,
      };

      if (editingOrder) {
        await updateMaintenancePartOrder(editingOrder.id, payload, currentUser, editingOrder.status);
        setStatus("Comanda actualizata.");
      } else {
        await createMaintenancePartOrder(payload, currentUser);
        setStatus("Comanda creata si notificarea a fost generata dupa reguli.");
      }
      resetForm();
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][save]", err);
      setError("Nu am putut salva comanda de piese.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(order: MaintenancePartOrder) {
    if (!window.confirm(`Stergi comanda ${order.title || order.clientName || order.id}?`)) return;
    setError("");
    try {
      await deleteMaintenancePartOrder(order, currentUser);
      setStatus("Comanda stearsa.");
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][delete]", err);
      setError("Nu am putut sterge comanda.");
    }
  }

  async function handleSeen(order: MaintenancePartOrder) {
    setError("");
    try {
      await markMaintenancePartOrderSeen(order, currentUser);
      setStatus("Comanda a fost marcata ca vazuta. Reamintirile se opresc pentru utilizatorul notificat.");
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][seen]", err);
      setError("Nu am putut marca aceasta comanda ca vazuta.");
    }
  }

  async function handleSupplierEmail(order: MaintenancePartOrder) {
    const email = order.supplierEmail || order.supplierContact;
    if (!email.trim()) {
      setError("Completeaza emailul furnizorului in comanda.");
      return;
    }
    if (!window.confirm(`Trimiti cererea de oferta catre ${email}, din ${SHARED_GMAIL_SENDER_EMAIL}?`)) return;
    const key = `${order.id}:supplier`;
    setSendingEmailKey(key);
    setError("");
    try {
      await sendSharedMaintenancePartOrderEmail({ orderId: order.id, target: "supplier" });
      setStatus(`Cererea de oferta a fost trimisa din ${SHARED_GMAIL_SENDER_EMAIL}.`);
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][supplier-email]", err);
      setError("Emailul catre furnizor nu a putut fi trimis.");
    } finally {
      setSendingEmailKey("");
    }
  }

  async function handleQuoteReceived(order: MaintenancePartOrder) {
    const supplierAmountRaw = window.prompt("Suma oferta primita de la furnizor (RON)", String(order.supplierOfferAmount || order.totalEstimated || ""));
    if (supplierAmountRaw === null) return;
    const supplierOfferAmount = Number(String(supplierAmountRaw).replace(",", "."));
    if (!Number.isFinite(supplierOfferAmount) || supplierOfferAmount < 0) {
      setError("Suma oferta furnizor nu este valida.");
      return;
    }
    const clientAmountRaw = window.prompt("Suma oferta catre client (RON). Poti lasa aceeasi suma.", String(order.clientOfferAmount || supplierOfferAmount));
    if (clientAmountRaw === null) return;
    const clientOfferAmount = Number(String(clientAmountRaw).replace(",", "."));
    const clientOfferNotes = window.prompt("Observatii oferta client / montaj / OP", order.clientOfferNotes || "") || "";
    await markSupplierQuoteReceived(order, currentUser, {
      supplierOfferAmount,
      clientOfferAmount: Number.isFinite(clientOfferAmount) ? clientOfferAmount : supplierOfferAmount,
      clientOfferNotes,
    });
    setStatus("Oferta furnizor a fost marcata ca primita.");
  }

  async function handleClientOfferEmail(order: MaintenancePartOrder) {
    if (!order.clientEmail.trim()) {
      setError("Completeaza emailul clientului in comanda.");
      return;
    }
    if (!window.confirm(`Trimiti oferta catre ${order.clientEmail}, din ${SHARED_GMAIL_SENDER_EMAIL}?`)) return;
    const key = `${order.id}:client`;
    setSendingEmailKey(key);
    setError("");
    try {
      await sendSharedMaintenancePartOrderEmail({ orderId: order.id, target: "client" });
      setStatus(`Oferta a fost trimisa clientului din ${SHARED_GMAIL_SENDER_EMAIL}.`);
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][client-email]", err);
      setError("Emailul cu oferta nu a putut fi trimis clientului.");
    } finally {
      setSendingEmailKey("");
    }
  }

  async function handleResolved(order: MaintenancePartOrder) {
    if (!window.confirm("Marchezi comanda ca rezolvata, piesa primita si montata?")) return;
    await markMaintenancePartOrderResolved(order, currentUser);
    setStatus("Comanda a fost marcata ca rezolvata / montata.");
  }

  async function handleQuickStatusChange(
    order: MaintenancePartOrder,
    nextStatus: MaintenancePartOrderStatus
  ) {
    if (nextStatus === order.status) return;
    setStatusUpdatingOrderId(order.id);
    setError("");
    try {
      await updateMaintenancePartOrderStatus(order, nextStatus, currentUser);
      setStatus(`Comanda a fost marcata: ${getMaintenancePartOrderStatusLabel(nextStatus)}.`);
    } catch (err) {
      console.error("[MaintenancePartOrdersPage][status]", err);
      setError("Nu am putut schimba statusul comenzii.");
    } finally {
      setStatusUpdatingOrderId("");
    }
  }

  return (
    <section className="page-section maintenance-orders-page" data-assistant-action="maintenance-parts">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Comenzi piese lift</h2>
            <p className="panel-subtitle">
              Comenzi pentru piese, furnizori, status livrare si montaj. Notificarile se seteaza din Reguli notificari pe Mentenanta.
            </p>
          </div>
          <div className="expense-page-actions">
            <button className="secondary-btn" data-assistant-action="maintenance-parts" type="button" onClick={resetForm} disabled={saving}>
              <PackagePlus size={16} />
              Comanda noua
            </button>
          </div>
        </div>

        <form className="tool-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="tool-form-grid">
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Titlu comanda</label>
              <input
                className="tool-input"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Ex: Role usa, contactor, placuta comanda"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Client</label>
              <select
                className="tool-input"
                value={form.clientId}
                onChange={(event) => {
                  const client = clients.find((item) => item.id === event.target.value) || null;
                  const firstLift = getClientLiftOptions(client)[0];
                  setForm((prev) => ({
                    ...prev,
                    clientId: event.target.value,
                    addressLabel: firstLift?.addressLabel || "",
                    liftSerialNumber: firstLift?.liftSerialNumber || "",
                    clientEmail: client?.emails?.[0] || client?.email || "",
                  }));
                }}
              >
                <option value="">Fara client selectat</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name || client.address || client.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Lift / adresa</label>
              <select
                className="tool-input"
                value={`${form.addressLabel}|||${form.liftSerialNumber}`}
                onChange={(event) => {
                  const [addressLabel, liftSerialNumber] = event.target.value.split("|||");
                  setForm((prev) => ({ ...prev, addressLabel: addressLabel || "", liftSerialNumber: liftSerialNumber || "" }));
                }}
                disabled={!selectedClient || liftOptions.length === 0}
              >
                <option value={`${form.addressLabel}|||${form.liftSerialNumber}`}>
                  {form.liftSerialNumber || "Alege lift"}
                </option>
                {liftOptions.map((lift) => (
                  <option key={`${lift.addressLabel}-${lift.liftSerialNumber}`} value={`${lift.addressLabel}|||${lift.liftSerialNumber}`}>
                    {lift.liftSerialNumber} - {lift.addressLabel || "adresa"}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Notifica utilizator</label>
              <select
                className="tool-input"
                value={form.notifyUserId}
                onChange={(event) => {
                  const selectedUser = users.find((item) => item.id === event.target.value) || null;
                  setForm((prev) => ({
                    ...prev,
                    notifyUserId: event.target.value,
                    notifyUserName: selectedUser ? getUserDisplayName(selectedUser) : "",
                  }));
                }}
              >
                <option value="">Fara notificare repetata</option>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {getUserDisplayName(item)}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Repeta notificarea</label>
              <select
                className="tool-input"
                value={form.reminderIntervalMinutes}
                onChange={(event) => setForm((prev) => ({ ...prev, reminderIntervalMinutes: Number(event.target.value || 30) }))}
                disabled={!form.notifyUserId}
              >
                <option value={15}>la 15 minute</option>
                <option value={30}>la 30 minute</option>
                <option value={60}>la 1 ora</option>
                <option value={120}>la 2 ore</option>
                <option value={240}>la 4 ore</option>
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Status</label>
              <select
                className="tool-input"
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as MaintenancePartOrderStatus }))}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Prioritate</label>
              <select
                className="tool-input"
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as MaintenancePartOrderPriority }))}
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Necesar pana la</label>
              <input
                className="tool-input"
                type="date"
                value={form.neededByDate}
                onChange={(event) => setForm((prev) => ({ ...prev, neededByDate: event.target.value }))}
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Furnizor</label>
              <input
                className="tool-input"
                value={form.supplierName}
                onChange={(event) => setForm((prev) => ({ ...prev, supplierName: event.target.value }))}
                placeholder="Ex: Schindler, Kone, furnizor local"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Contact furnizor</label>
              <input
                className="tool-input"
                value={form.supplierContact}
                onChange={(event) => setForm((prev) => ({ ...prev, supplierContact: event.target.value }))}
                placeholder="telefon / email"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Email furnizor</label>
              <input
                className="tool-input"
                type="email"
                value={form.supplierEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, supplierEmail: event.target.value }))}
                placeholder="ofertare@furnizor.ro"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Numar comanda furnizor</label>
              <input
                className="tool-input"
                value={form.orderNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                placeholder="optional"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Email client</label>
              <input
                className="tool-input"
                type="email"
                value={form.clientEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, clientEmail: event.target.value }))}
                placeholder="client@firma.ro"
              />
            </div>

            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Observatii</label>
              <textarea
                className="tool-textarea"
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Defect constatat, urgenta, poze/verificari necesare, conditii de montaj."
              />
            </div>
          </div>

          <div className="maintenance-order-lines">
            <div className="maintenance-order-lines__head">
              <strong>Piese comandate</strong>
              <button className="secondary-btn" type="button" onClick={addLine}>
                <PackagePlus size={15} />
                Adauga piesa
              </button>
            </div>
            {form.lines.map((line) => (
              <div key={line.id} className="maintenance-order-line">
                <input className="tool-input" value={line.name} onChange={(event) => updateLine(line.id, { name: event.target.value })} placeholder="Denumire piesa" />
                <input className="tool-input" value={line.code} onChange={(event) => updateLine(line.id, { code: event.target.value })} placeholder="Cod piesa" />
                <input className="tool-input" type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value || 1) })} placeholder="Cant." />
                <input className="tool-input" value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })} placeholder="UM" />
                <input className="tool-input" type="number" min="0" step="0.01" value={line.estimatedPrice} onChange={(event) => updateLine(line.id, { estimatedPrice: Number(event.target.value || 0) })} placeholder="Pret estimat" />
                <input className="tool-input" value={line.supplier} onChange={(event) => updateLine(line.id, { supplier: event.target.value })} placeholder="Furnizor piesa" />
                <button className="danger-btn" type="button" onClick={() => removeLine(line.id)} disabled={form.lines.length <= 1}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="maintenance-order-total">Total estimat: {formatMoney(orderTotal(form.lines))}</div>
          </div>

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={saving}>
              {saving ? <RefreshCw className="expense-status-spin" size={16} /> : <Save size={16} />}
              {editingOrder ? "Salveaza modificarile" : "Creeaza comanda"}
            </button>
            {editingOrder && (
              <button className="secondary-btn" type="button" onClick={resetForm} disabled={saving}>
                Renunta la editare
              </button>
            )}
          </div>
        </form>

        {error && <div className="tool-message">{error}</div>}
        {status && !error && <div className="tool-message tool-message-success">{status}</div>}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Istoric comenzi piese</h2>
            <p className="panel-subtitle">Cauta dupa client, lift, piesa, cod, furnizor sau numar comanda.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="tool-form-grid">
            <div className="tool-form-block">
              <label className="tool-form-label">Status</label>
              <select className="tool-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">Toate statusurile</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Cautare</label>
              <input className="tool-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex: role usa, Kone, client, cod piesa" />
            </div>
          </div>
        </div>

        {loading ? (
          <p className="tools-subtitle">Se incarca comenzile...</p>
        ) : filteredOrders.length === 0 ? (
          <p className="tools-subtitle">Nu exista comenzi pentru filtrele selectate.</p>
        ) : (
          <div className="simple-list maintenance-orders-list">
            {filteredOrders.map((order) => (
              <details key={order.id} className={`simple-list-item maintenance-order-card maintenance-order-card--${order.priority}`}>
                <summary>
                  <span className="simple-list-text">
                    <span className="simple-list-label">{order.title || "Comanda piese"} - {order.clientName || "fara client"}</span>
                    <span className="simple-list-subtitle">
                      {getMaintenancePartOrderStatusLabel(order.status)} / {order.priority} - {order.lines.length} piese - {formatMoney(order.totalEstimated)} - {formatDateTime(order.updatedAt)}
                    </span>
                  </span>
                  <span className="maintenance-order-actions">
                    <button className="secondary-btn" type="button" onClick={(event) => { event.preventDefault(); startEdit(order); }}>
                      <Pencil size={15} />
                      Edit
                    </button>
                    {canDelete && (
                      <button className="danger-btn" type="button" onClick={(event) => { event.preventDefault(); void handleDelete(order); }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </span>
                </summary>

                <div className="maintenance-order-details">
                  <div><strong>Client:</strong> {order.clientName || "-"}</div>
                  <div><strong>Adresa:</strong> {order.addressLabel || "-"}</div>
                  <div><strong>Lift:</strong> {order.liftSerialNumber || "-"}</div>
                  <div><strong>Furnizor:</strong> {order.supplierName || "-"} {order.supplierContact ? `(${order.supplierContact})` : ""}</div>
                  <div><strong>Email furnizor:</strong> {order.supplierEmail || "-"}</div>
                  <div><strong>Email client:</strong> {order.clientEmail || "-"}</div>
                  <div><strong>Necesar pana la:</strong> {order.neededByDate || "-"}</div>
                  <div><strong>Cerut de:</strong> {order.requestedByUserName || "-"}</div>
                  <div><strong>Notificat:</strong> {order.notifyUserName || "-"} {order.notifyUserId && !order.notificationSeenAt ? `(repeta la ${order.reminderIntervalMinutes} min)` : ""}</div>
                  <div><strong>Vazut:</strong> {order.notificationSeenAt ? `${order.notificationSeenByUserName || "utilizator"} - ${formatDateTime(order.notificationSeenAt)}` : "nu"}</div>
                  <div><strong>Oferta furnizor:</strong> {order.supplierQuoteReceivedAt ? `${formatMoney(order.supplierOfferAmount)} - ${formatDateTime(order.supplierQuoteReceivedAt)}` : "-"}</div>
                  <div><strong>Oferta client:</strong> {order.clientOfferEmailSentAt ? `${formatMoney(order.clientOfferAmount || order.supplierOfferAmount)} - trimisa ${formatDateTime(order.clientOfferEmailSentAt)}` : "-"}</div>
                  {order.notes && <p>{order.notes}</p>}
                  <div className="maintenance-order-status-control">
                    <label htmlFor={`order-status-${order.id}`}>Status comanda</label>
                    <select
                      id={`order-status-${order.id}`}
                      className="tool-input"
                      value={order.status}
                      onChange={(event) => void handleQuickStatusChange(
                        order,
                        event.target.value as MaintenancePartOrderStatus
                      )}
                      disabled={statusUpdatingOrderId === order.id}
                    >
                      {statusOptions.map((option) => (
                        <option key={`${order.id}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span>{statusUpdatingOrderId === order.id ? "Se salveaza..." : "Actualizare rapida"}</span>
                  </div>
                  <div className="maintenance-order-workflow">
                    {order.notifyUserId && !order.notificationSeenAt && (
                      <button className="secondary-btn" type="button" onClick={() => void handleSeen(order)}>
                        <Eye size={15} />
                        Am vazut
                      </button>
                    )}
                    <button className="secondary-btn" type="button" onClick={() => void handleSupplierEmail(order)} disabled={Boolean(sendingEmailKey)}>
                      <Send size={15} />
                      {sendingEmailKey === `${order.id}:supplier` ? "Se trimite..." : "Cere oferta furnizor"}
                    </button>
                    <button className="secondary-btn" type="button" onClick={() => void handleQuoteReceived(order)}>
                      <CheckCircle2 size={15} />
                      Oferta primita
                    </button>
                    <button className="secondary-btn" type="button" onClick={() => void handleClientOfferEmail(order)} disabled={Boolean(sendingEmailKey)}>
                      <Mail size={15} />
                      {sendingEmailKey === `${order.id}:client` ? "Se trimite..." : "Trimite oferta client"}
                    </button>
                    <button className="primary-btn" type="button" onClick={() => void handleResolved(order)} disabled={order.status === "installed"}>
                      <CheckCircle2 size={15} />
                      Rezolvat
                    </button>
                  </div>
                  <div className="maintenance-order-parts">
                    {order.lines.map((line) => (
                      <div key={line.id} className="maintenance-order-part">
                        <span>{line.name || "Piesa"} {line.code ? `(${line.code})` : ""}</span>
                        <span>{line.quantity} {line.unit || "buc"}</span>
                        <strong>{formatMoney(Number(line.quantity || 0) * Number(line.estimatedPrice || 0))}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
