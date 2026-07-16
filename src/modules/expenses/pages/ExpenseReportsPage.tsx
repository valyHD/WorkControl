import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, ReceiptText } from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import type { ExpenseCompanyOption, ExpenseDocumentItem, ExpenseFilters, ExpenseProjectOption } from "../../../types/expense";
import type { AppUser } from "../../../types/tool";
import {
  filterExpenseDocuments,
  getExpenseCompanies,
  getExpenseDocuments,
  getExpenseProjects,
  getExpenseUsers,
  summarizeExpenses,
} from "../services/expensesService";
import UserProfileLink from "../../../components/UserProfileLink";
import { getUserThemeClass } from "../../../lib/ui/userTheme";

const initialFilters: ExpenseFilters = {
  yearMonth: new Date().toISOString().slice(0, 7),
  userId: "",
  projectId: "",
  companyName: "",
  supplierName: "",
  documentKind: "",
  reimbursable: "",
};

function money(value: number, currency = "RON") {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function splitMoney(value: number, currency = "RON") {
  const parts = new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).formatToParts(value || 0);
  return {
    amount: parts
      .filter((part) => part.type !== "currency")
      .map((part) => part.value)
      .join("")
      .trim(),
    currency: parts.find((part) => part.type === "currency")?.value || currency,
  };
}

function MoneyValue({ value, currency = "RON" }: { value: number; currency?: string }) {
  const parts = splitMoney(value, currency);
  return (
    <span className="expense-money-value" title={money(value, currency)}>
      <span>{parts.amount}</span>
      <span className="expense-money-currency">{parts.currency}</span>
    </span>
  );
}

function groupByLabel(items: ExpenseDocumentItem[], getLabel: (item: ExpenseDocumentItem) => string) {
  const map = new Map<string, { label: string; total: number; vat: number; count: number; reimbursable: number }>();
  for (const item of items) {
    const label = getLabel(item) || "Nesetat";
    const current = map.get(label) || { label, total: 0, vat: 0, count: 0, reimbursable: 0 };
    current.total += item.totalAmount || 0;
    current.vat += item.vatAmount || 0;
    current.count += 1;
    if (item.reimbursable) current.reimbursable += item.totalAmount || 0;
    map.set(label, current);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function BarList({ title, items }: { title: string; items: ReturnType<typeof groupByLabel> }) {
  const max = Math.max(1, ...items.map((item) => item.total));
  return (
    <div className="panel expense-report-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          <p className="panel-subtitle">Total, TVA si decontari pe fiecare linie.</p>
        </div>
      </div>
      <div className="expense-bars">
        {items.length === 0 ? (
          <p className="tools-subtitle">Nu exista date pentru filtrul ales.</p>
        ) : (
          items.slice(0, 12).map((item) => (
            <div key={item.label} className="expense-bar-row">
              <div className="expense-bar-head">
                <strong>{item.label}</strong>
                <span>{money(item.total)}</span>
              </div>
              <div className="expense-bar-track">
                <div className="expense-bar-fill" style={{ width: `${Math.max(5, (item.total / max) * 100)}%` }} />
              </div>
              <div className="expense-bar-meta">
                {item.count} documente - TVA {money(item.vat)} - Decontari {money(item.reimbursable)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ExpenseReportsPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseDocumentItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<ExpenseProjectOption[]>([]);
  const [companies, setCompanies] = useState<ExpenseCompanyOption[]>([]);
  const [filters, setFilters] = useState<ExpenseFilters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "admin") return;
    setLoading(true);
    Promise.all([getExpenseDocuments(), getExpenseUsers(), getExpenseProjects(), getExpenseCompanies()])
      .then(([nextItems, nextUsers, nextProjects, nextCompanies]) => {
        setItems(nextItems);
        setUsers(nextUsers);
        setProjects(nextProjects);
        setCompanies(nextCompanies);
      })
      .catch((err) => {
        console.error("[ExpenseReportsPage][load]", err);
        setError("Nu am putut incarca rapoartele.");
      })
      .finally(() => setLoading(false));
  }, [role]);

  const companyOptions = useMemo(
    () =>
      Array.from(
        new Set([...companies.map((item) => item.companyName), ...items.map((item) => item.companyName).filter(Boolean)])
      ).sort(),
    [companies, items]
  );

  const filtered = useMemo(() => filterExpenseDocuments(items, filters), [filters, items]);
  const summary = useMemo(() => summarizeExpenses(filtered), [filtered]);
  const invoices = useMemo(
    () => filtered.filter((item) => item.documentKind === "factura" || item.documentKind === "proforma"),
    [filtered]
  );
  const receipts = useMemo(
    () => filtered.filter((item) => item.documentKind === "bon" || item.documentKind === "chitanta"),
    [filtered]
  );
  const invoiceSummary = useMemo(() => summarizeExpenses(invoices), [invoices]);
  const receiptSummary = useMemo(() => summarizeExpenses(receipts), [receipts]);

  const bySupplier = useMemo(() => groupByLabel(filtered, (item) => item.supplierName), [filtered]);
  const byUser = useMemo(() => groupByLabel(filtered, (item) => item.assignedUserName), [filtered]);
  const byProject = useMemo(() => groupByLabel(filtered, (item) => item.projectName || item.projectCode), [filtered]);
  const byCompany = useMemo(() => groupByLabel(filtered, (item) => item.companyName), [filtered]);
  const userThemeById = useMemo(
    () => new Map(users.map((userItem) => [userItem.id, userItem.themeKey ?? null])),
    [users]
  );

  if (role !== "admin") {
    return <Navigate to="/expenses/scan" replace />;
  }

  return (
    <section className="page-section expense-reports-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Rapoarte cheltuieli</h2>
            <p className="panel-subtitle">Rapoarte lunare, TVA, decontari, facturi si bonuri pe user, proiect si firma.</p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => navigate("/expenses/scan")}>
            <ArrowLeft size={16} />
            Inapoi
          </button>
        </div>

        <div className="panel-body">
          <div className="tool-form-grid expense-filter-grid">
            <div className="tool-form-block">
              <label className="tool-form-label">Luna</label>
              <input
                className="tool-input"
                type="month"
                value={filters.yearMonth}
                onChange={(event) => setFilters((prev) => ({ ...prev, yearMonth: event.target.value }))}
              />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">User</label>
              <select className="tool-input" value={filters.userId} onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}>
                <option value="">Toti userii</option>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>{item.fullName || item.email}</option>
                ))}
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Proiect</label>
              <select className="tool-input" value={filters.projectId} onChange={(event) => setFilters((prev) => ({ ...prev, projectId: event.target.value }))}>
                <option value="">Toate proiectele</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name || "Fara nume"}</option>
                ))}
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Firma</label>
              <select className="tool-input" value={filters.companyName} onChange={(event) => setFilters((prev) => ({ ...prev, companyName: event.target.value }))}>
                <option value="">Toate firmele</option>
                {companyOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Tip</label>
              <select className="tool-input" value={filters.documentKind} onChange={(event) => setFilters((prev) => ({ ...prev, documentKind: event.target.value as ExpenseFilters["documentKind"] }))}>
                <option value="">Toate</option>
                <option value="factura">Facturi</option>
                <option value="bon">Bonuri</option>
                <option value="chitanta">Chitante</option>
                <option value="proforma">Proforme</option>
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Decontare</label>
              <select className="tool-input" value={filters.reimbursable} onChange={(event) => setFilters((prev) => ({ ...prev, reimbursable: event.target.value as ExpenseFilters["reimbursable"] }))}>
                <option value="">Toate</option>
                <option value="yes">Doar decontari</option>
                <option value="no">Fara decontare</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="tool-message">{error}</div>}
      </div>

      <div className="expense-kpi-grid expense-kpi-grid-wide">
        <div className="kpi-card"><div className="kpi-label">Total cu TVA</div><div className="kpi-value"><MoneyValue value={summary.total} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Total fara TVA</div><div className="kpi-value"><MoneyValue value={summary.subtotal} /></div></div>
        <div className="kpi-card"><div className="kpi-label">TVA total</div><div className="kpi-value"><MoneyValue value={summary.vat} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Decontari</div><div className="kpi-value"><MoneyValue value={summary.reimbursableTotal} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Facturi</div><div className="kpi-value">{summary.invoiceCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Bonuri</div><div className="kpi-value">{summary.receiptCount}</div></div>
      </div>

      <div className="expense-split-grid">
        <div className="panel">
          <div className="panel-head"><h2 className="panel-title"><FileText size={16} /> Facturi luna</h2></div>
          <div className="panel-body expense-mini-summary">
            <strong>{money(invoiceSummary.total)}</strong>
            <span>Fara TVA {money(invoiceSummary.subtotal)} - TVA {money(invoiceSummary.vat)} - {invoiceSummary.count} documente</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2 className="panel-title"><ReceiptText size={16} /> Bonuri luna</h2></div>
          <div className="panel-body expense-mini-summary">
            <strong>{money(receiptSummary.total)}</strong>
            <span>Fara TVA {money(receiptSummary.subtotal)} - TVA {money(receiptSummary.vat)} - {receiptSummary.count} documente</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="placeholder-page"><h2>Se incarca rapoartele...</h2></div>
      ) : (
        <>
          <div className="expense-report-grid">
            <BarList title="Cheltuieli pe furnizor" items={bySupplier} />
            <BarList title="Cheltuieli pe user" items={byUser} />
            <BarList title="Cheltuieli pe proiect" items={byProject} />
            <BarList title="Cheltuieli pe firma" items={byCompany} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Registru detaliat</h2>
                <p className="panel-subtitle">Toate documentele filtrate, cu TVA si fara TVA.</p>
              </div>
            </div>
            <div className="expense-table-wrap">
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Data</th><th>Tip</th><th>Furnizor</th><th>User</th><th>Proiect</th><th>Firma</th><th>Fara TVA</th><th>TVA</th><th>Total</th><th>Decont</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className={`user-table-row ${getUserThemeClass(userThemeById.get(item.assignedUserId))}`}>
                      <td>{item.documentDate || "-"}</td>
                      <td>{item.documentKind}</td>
                      <td>{item.supplierName || "-"}</td>
                      <td><UserProfileLink userId={item.assignedUserId} name={item.assignedUserName} themeKey={userThemeById.get(item.assignedUserId)} /></td>
                      <td>{item.projectName || item.projectCode || "-"}</td>
                      <td>{item.companyName || "-"}</td>
                      <td>{money(item.subtotalAmount || Math.max(0, item.totalAmount - item.vatAmount), item.currency)}</td>
                      <td>{money(item.vatAmount, item.currency)}</td>
                      <td>{money(item.totalAmount, item.currency)}</td>
                      <td>{item.reimbursable ? "Da" : "Nu"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
