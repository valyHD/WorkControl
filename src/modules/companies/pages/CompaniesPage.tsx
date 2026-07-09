import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CarFront,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  Phone,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import type { CompanyFormValues, CompanyItem, CompanyMaintenanceReportLite } from "../../../types/company";
import type { ExpenseDocumentItem } from "../../../types/expense";
import type { LeaveRequestItem } from "../../../types/leave";
import type { TimesheetItem } from "../../../types/timesheet";
import type { AppUser, ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import {
  buildCompanySummary,
  deleteCompanyEverywhere,
  getCompanyDirectoryData,
  saveCompany,
} from "../services/companiesService";

const emptyForm: CompanyFormValues = {
  companyName: "",
  legalName: "",
  taxId: "",
  registrationNumber: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  contactName: "",
  notes: "",
  active: true,
  assignedUserIds: [],
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function formatMonthKey(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value || "-";
  const date = new Date(`${value}-01T00:00:00`);
  return new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" }).format(date);
}

function sameText(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function getUserCompanyNames(user: AppUser) {
  return [...(user.companyNames || []), user.primaryCompanyName || ""].map((item) => item.trim()).filter(Boolean);
}

function userBelongsToCompany(user: AppUser, company: CompanyItem) {
  return (
    company.assignedUserIds.includes(user.id) ||
    user.primaryCompanyId === company.companyKey ||
    (user.companyIds || []).includes(company.companyKey) ||
    getUserCompanyNames(user).some((name) => sameText(name, company.companyName))
  );
}

function toForm(company: CompanyItem): CompanyFormValues {
  return {
    companyName: company.companyName,
    legalName: company.legalName,
    taxId: company.taxId,
    registrationNumber: company.registrationNumber,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    contactName: company.contactName,
    notes: company.notes,
    active: company.active,
    assignedUserIds: company.assignedUserIds,
  };
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDocumentItem[]>([]);
  const [maintenanceClients, setMaintenanceClients] = useState<
    Array<{ id: string; name: string; maintenanceCompany: string }>
  >([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [maintenanceReports, setMaintenanceReports] = useState<CompanyMaintenanceReportLite[]>([]);
  const [form, setForm] = useState<CompanyFormValues>(emptyForm);
  const [editingCompanyId, setEditingCompanyId] = useState("");
  const [expandedCompanyId, setExpandedCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingCompanyId, setDeletingCompanyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const data = await getCompanyDirectoryData();
      setCompanies(data.companies);
      setUsers(data.users);
      setExpenses(data.expenses);
      setMaintenanceClients(data.maintenanceClients);
      setTools(data.tools);
      setVehicles(data.vehicles);
      setTimesheets(data.timesheets);
      setLeaveRequests(data.leaveRequests);
      setMaintenanceReports(data.maintenanceReports);
    } catch (err) {
      console.error("[CompaniesPage][load]", err);
      setError("Nu am putut incarca firmele.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredCompanies = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((company) =>
      [
        company.companyName,
        company.legalName,
        company.taxId,
        company.registrationNumber,
        company.address,
        company.email,
        company.phone,
        company.contactName,
        ...company.assignedUserNames,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [companies, search]);

  const totals = useMemo(
    () =>
      companies.reduce(
        (acc, company) => {
          const summary = buildCompanySummary({ company, expenses, maintenanceClients });
          acc.expenseTotal += summary.expenseTotal;
          acc.expenseCount += summary.expenseCount;
          acc.maintenanceClientCount += summary.maintenanceClientCount;
          return acc;
        },
        { expenseTotal: 0, expenseCount: 0, maintenanceClientCount: 0 }
      ),
    [companies, expenses, maintenanceClients]
  );

  function toggleUser(userId: string) {
    setForm((prev) => ({
      ...prev,
      assignedUserIds: prev.assignedUserIds.includes(userId)
        ? prev.assignedUserIds.filter((id) => id !== userId)
        : [...prev.assignedUserIds, userId],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveCompany(form, users);
      setCompanies((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)].sort((a, b) =>
        a.companyName.localeCompare(b.companyName, "ro")
      ));
      setForm(emptyForm);
      setEditingCompanyId("");
      setExpandedCompanyId("");
      setMessage("Firma salvata.");
    } catch (err) {
      console.error("[CompaniesPage][save]", err);
      setError(err instanceof Error ? err.message : "Nu am putut salva firma.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompany() {
    const company = companies.find((item) => item.id === editingCompanyId);
    if (!company) return;

    const summary = buildCompanySummary({ company, expenses, maintenanceClients });
    const confirmed = window.confirm(
      `Stergi firma ${company.companyName}? Firma va disparea din lista, din userii alocati, din ${summary.expenseCount} documente si din ${summary.maintenanceClientCount} clienti mentenanta. Documentele si clientii raman, dar fara firma selectata.`
    );
    if (!confirmed) return;

    setDeletingCompanyId(company.id);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteCompanyEverywhere(company);
      setCompanies((prev) => prev.filter((item) => item.id !== company.id));
      setExpenses((prev) =>
        prev.map((item) =>
          item.companyName.trim().toLowerCase() === company.companyName.trim().toLowerCase()
            ? { ...item, companyName: "" }
            : item
        )
      );
      setMaintenanceClients((prev) =>
        prev.map((item) =>
          item.maintenanceCompany.trim().toLowerCase() === company.companyName.trim().toLowerCase()
            ? { ...item, maintenanceCompany: "" }
            : item
        )
      );
      setForm(emptyForm);
      setEditingCompanyId("");
      setExpandedCompanyId("");
      setMessage("Firma stearsa din toate locatiile.");
    } catch (err) {
      console.error("[CompaniesPage][delete]", err);
      setError("Nu am putut sterge firma complet.");
    } finally {
      setDeletingCompanyId("");
      setSaving(false);
    }
  }

  return (
    <section className="page-section companies-page">
      <div className="panel">
        <div className="panel-head companies-list-head">
          <div>
            <h2 className="panel-title">Firme</h2>
            <p className="panel-subtitle">
              Registru central pentru firmele pe care lucrati: cheltuieli, oameni alocati si legaturi cu mentenanta.
            </p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={16} />
            Actualizeaza
          </button>
        </div>

        <div className="companies-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Firme active</div>
            <div className="kpi-value">{companies.filter((item) => item.active).length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Cheltuieli legate</div>
            <div className="kpi-value">{totals.expenseCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total cheltuieli</div>
            <div className="kpi-value">{formatMoney(totals.expenseTotal)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Clienti mentenanta</div>
            <div className="kpi-value">{totals.maintenanceClientCount}</div>
          </div>
        </div>

        <form className="tool-form companies-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="tool-form-grid">
            <div className="tool-form-block">
              <label className="tool-form-label">Nume firma</label>
              <input
                className="tool-input"
                value={form.companyName}
                onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
                placeholder="Ex: Brex Lifts"
                required
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Denumire juridica</label>
              <input
                className="tool-input"
                value={form.legalName}
                onChange={(event) => setForm((prev) => ({ ...prev, legalName: event.target.value }))}
                placeholder="Denumirea completa din acte"
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">CUI</label>
              <input
                className="tool-input"
                value={form.taxId}
                onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Reg. Com.</label>
              <input
                className="tool-input"
                value={form.registrationNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, registrationNumber: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Telefon</label>
              <input
                className="tool-input"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Email</label>
              <input
                className="tool-input"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Contact principal</label>
              <input
                className="tool-input"
                value={form.contactName}
                onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Website</label>
              <input
                className="tool-input"
                value={form.website}
                onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
              />
            </div>
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Adresa</label>
              <input
                className="tool-input"
                value={form.address}
                onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
              />
            </div>
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Useri alocati firmei</label>
              <div className="companies-user-picker">
                {users.map((item) => (
                  <label key={item.id} className="companies-user-pill">
                    <input
                      type="checkbox"
                      checked={form.assignedUserIds.includes(item.id)}
                      onChange={() => toggleUser(item.id)}
                    />
                    <span>{item.fullName || item.email}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Observatii</label>
              <textarea
                className="tool-input"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </div>
          <div className="tool-form-actions expense-actions">
            <button className="primary-btn" type="submit" disabled={saving}>
              <Save size={16} />
              {saving ? "Se salveaza..." : editingCompanyId ? "Salveaza modificarile" : "Adauga firma"}
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setEditingCompanyId("");
                setExpandedCompanyId("");
              }}
              disabled={saving}
            >
              Firma noua
            </button>
            {editingCompanyId && (
              <button
                className="danger-btn"
                type="button"
                onClick={() => void handleDeleteCompany()}
                disabled={saving || deletingCompanyId === editingCompanyId}
              >
                <Trash2 size={16} />
                {deletingCompanyId === editingCompanyId ? "Se sterge..." : "Sterge firma"}
              </button>
            )}
          </div>
        </form>

        {message && <div className="tool-message success-message">{message}</div>}
        {error && <div className="tool-message">{error}</div>}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Lista firme</h2>
            <p className="panel-subtitle">Click pe o firma ca sa o editezi si sa vezi ce este legat de ea.</p>
          </div>
          <label className="companies-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cauta firma, CUI, user..." />
          </label>
        </div>

        <div className="companies-list">
          {loading ? (
            <div className="tool-empty-state">Se incarca firmele...</div>
          ) : filteredCompanies.length === 0 ? (
            <div className="tool-empty-state">Nu exista firme pentru filtrul ales.</div>
          ) : (
            filteredCompanies.map((company) => {
              const summary = buildCompanySummary({ company, expenses, maintenanceClients });
              const isExpanded = expandedCompanyId === company.id;
              const companyUsers = users.filter((item) => userBelongsToCompany(item, company));
              const companyUserIds = new Set(companyUsers.map((item) => item.id));
              const companyExpenses = expenses.filter((item) => sameText(item.companyName, company.companyName));
              const companyTimesheets = timesheets.filter((item) => companyUserIds.has(item.userId));
              const companyLeave = leaveRequests.filter(
                (item) => sameText(item.companyName, company.companyName) || companyUserIds.has(item.userId)
              );
              const companyTools = tools.filter(
                (item) => companyUserIds.has(item.ownerUserId) || companyUserIds.has(item.currentHolderUserId)
              );
              const companyVehicles = vehicles.filter(
                (item) => companyUserIds.has(item.ownerUserId) || companyUserIds.has(item.currentDriverUserId)
              );
              const companyClientIds = new Set(
                maintenanceClients
                  .filter((item) => sameText(item.maintenanceCompany, company.companyName))
                  .map((item) => item.id)
              );
              const companyReports = maintenanceReports.filter((item) => companyClientIds.has(item.clientId));
              const spendingRows = Object.values(
                companyExpenses.reduce<Record<string, { key: string; userName: string; month: string; total: number; reimbursable: number; count: number }>>(
                  (acc, item) => {
                    const month = item.yearMonth || item.documentDate.slice(0, 7) || "-";
                    const userName = item.assignedUserName || "Fara user";
                    const key = `${userName}__${month}`;
                    const current = acc[key] || { key, userName, month, total: 0, reimbursable: 0, count: 0 };
                    current.total += item.totalAmount || 0;
                    current.reimbursable += item.reimbursable ? item.totalAmount || 0 : 0;
                    current.count += 1;
                    acc[key] = current;
                    return acc;
                  },
                  {}
                )
              ).sort((a, b) => b.month.localeCompare(a.month) || a.userName.localeCompare(b.userName, "ro"));
              const timesheetRows = Object.values(
                companyTimesheets.reduce<Record<string, { key: string; userName: string; month: string; minutes: number; count: number }>>(
                  (acc, item) => {
                    const month = item.yearMonth || item.workDate.slice(0, 7) || "-";
                    const userName = item.userName || "Fara user";
                    const key = `${userName}__${month}`;
                    const current = acc[key] || { key, userName, month, minutes: 0, count: 0 };
                    current.minutes += item.workedMinutes || 0;
                    current.count += 1;
                    acc[key] = current;
                    return acc;
                  },
                  {}
                )
              ).sort((a, b) => b.month.localeCompare(a.month) || a.userName.localeCompare(b.userName, "ro"));
              return (
                <div key={company.id} className={`companies-card ${editingCompanyId === company.id ? "is-selected" : ""}`}>
                  <button
                    className="companies-card__button"
                    type="button"
                    onClick={() => {
                      setEditingCompanyId(company.id);
                      setExpandedCompanyId((prev) => (prev === company.id ? "" : company.id));
                      setForm(toForm(company));
                    }}
                  >
                    <span className="companies-card__head">
                      <span>
                        <strong>{company.companyName}</strong>
                        <small>{company.legalName || company.taxId || "Firma fara detalii juridice"}</small>
                      </span>
                      <span className={`companies-status ${company.active ? "is-active" : ""}`}>
                        {company.active ? <CheckCircle2 size={14} /> : null}
                        {company.active ? "Activa" : "Inactiva"}
                      </span>
                    </span>
                    <span className="companies-card__meta">
                      {company.phone && <span><Phone size={14} /> {company.phone}</span>}
                      {company.email && <span><Mail size={14} /> {company.email}</span>}
                      {companyUsers.length > 0 && <span><Users size={14} /> {companyUsers.map((item) => item.fullName || item.email).join(", ")}</span>}
                    </span>
                    <span className="companies-card__stats">
                      <span>
                        <Building2 size={15} />
                        {summary.maintenanceClientCount} clienti mentenanta
                      </span>
                      <span>{summary.expenseCount} documente</span>
                      <span>{formatMoney(summary.expenseTotal)}</span>
                      <span>Decont: {formatMoney(summary.reimbursableTotal)}</span>
                    </span>
                    {summary.maintenanceClientNames.length > 0 && (
                      <span className="companies-card__clients">
                        {summary.maintenanceClientNames.join(", ")}
                      </span>
                    )}
                    <span className="companies-card__hint">{isExpanded ? "Inchide detalii" : "Deschide detalii firma"}</span>
                  </button>
                  {isExpanded && (
                    <div className="companies-details">
                      <div className="companies-detail-grid">
                        <div className="companies-detail-box">
                          <h3><ReceiptText size={16} /> Cheltuieli per user / luna</h3>
                          {spendingRows.length === 0 ? <p>Nu sunt cheltuieli legate de firma.</p> : (
                            <div className="companies-mini-table">
                              {spendingRows.slice(0, 12).map((row) => (
                                <div key={row.key}>
                                  <span>{row.userName}</span>
                                  <span>{formatMonthKey(row.month)}</span>
                                  <strong>{formatMoney(row.total)}</strong>
                                  <small>{row.count} doc · decont {formatMoney(row.reimbursable)}</small>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box">
                          <h3><Clock3 size={16} /> Pontaje</h3>
                          {timesheetRows.length === 0 ? <p>Nu sunt pontaje pentru userii acestei firme.</p> : (
                            <div className="companies-mini-table">
                              {timesheetRows.slice(0, 12).map((row) => (
                                <div key={row.key}>
                                  <span>{row.userName}</span>
                                  <span>{formatMonthKey(row.month)}</span>
                                  <strong>{formatMinutes(row.minutes)}</strong>
                                  <small>{row.count} pontaje</small>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box">
                          <h3><Users size={16} /> Useri</h3>
                          {companyUsers.length === 0 ? <p>Niciun user alocat.</p> : (
                            <div className="companies-chip-list">
                              {companyUsers.map((item) => <span key={item.id}>{item.fullName || item.email}</span>)}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box">
                          <h3><CalendarDays size={16} /> Concedii</h3>
                          {companyLeave.length === 0 ? <p>Nu sunt cereri gasite.</p> : (
                            <div className="companies-compact-list">
                              {companyLeave.slice(0, 8).map((item) => (
                                <span key={item.id}>{item.userName} · {item.periodStart} - {item.periodEnd} · {item.status}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box">
                          <h3><Wrench size={16} /> Scule</h3>
                          {companyTools.length === 0 ? <p>Nu sunt scule legate prin useri.</p> : (
                            <div className="companies-compact-list">
                              {companyTools.slice(0, 10).map((item) => (
                                <span key={item.id}>{item.name} · {item.currentHolderUserName || item.ownerUserName || "fara detinator"}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box">
                          <h3><CarFront size={16} /> Masini</h3>
                          {companyVehicles.length === 0 ? <p>Nu sunt masini legate prin useri.</p> : (
                            <div className="companies-compact-list">
                              {companyVehicles.slice(0, 10).map((item) => (
                                <span key={item.id}>{item.plateNumber} · {item.currentDriverUserName || item.ownerUserName || "fara sofer"}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="companies-detail-box companies-detail-box-wide">
                          <h3><FileText size={16} /> Rapoarte mentenanta</h3>
                          {companyReports.length === 0 ? <p>Nu sunt rapoarte generate pentru clientii acestei firme.</p> : (
                            <div className="companies-compact-list">
                              {companyReports.slice(0, 12).map((item) => (
                                <span key={`${item.clientId}-${item.id}`}>
                                  {item.clientName || "Client"} · {item.reportType || "raport"} · {new Date(item.createdAt).toLocaleDateString("ro-RO")}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
