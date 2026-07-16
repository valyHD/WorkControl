import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Save, ScanLine, Trash2, UploadCloud } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { AppUser } from "../../../types/tool";
import type {
  ExpenseAiAnalysis,
  ExpenseCompanyOption,
  ExpenseDocumentItem,
  ExpenseDocumentKind,
  ExpenseFileDraft,
  ExpenseProjectOption,
} from "../../../types/expense";
import {
  analyzeExpenseUploadedFile,
  deleteExpenseDocument,
  EMPTY_EXPENSE_ANALYSIS,
  getExpenseCompanies,
  getExpenseDocuments,
  getExpenseProjects,
  getExpenseUsers,
  getUserExpenseFormPreference,
  saveExpenseDocument,
  saveExpenseCompanyOption,
  saveUserExpenseFormPreference,
  summarizeExpenses,
  uploadExpenseFile,
} from "../services/expensesService";
import UserProfileLink from "../../../components/UserProfileLink";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import { getUserThemeClass } from "../../../lib/ui/userTheme";

type InvoiceDraft = ExpenseAiAnalysis & {
  assignedUserId: string;
  projectId: string;
  companyName: string;
  reimbursable: boolean;
};

const emptyDraft: InvoiceDraft = {
  ...EMPTY_EXPENSE_ANALYSIS,
  documentKind: "factura",
  assignedUserId: "",
  projectId: "",
  companyName: "",
  reimbursable: false,
};

function currentAppUser(user: ReturnType<typeof useAuth>["user"]): AppUser | null {
  if (!user?.uid) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email || "",
    fullName: user.displayName || user.email || "Utilizator",
    active: true,
    themeKey: user.themeKey ?? null,
    companyIds: user.companyIds || [],
    companyNames: user.companyNames || [],
    primaryCompanyId: user.primaryCompanyId || "",
    primaryCompanyName: user.primaryCompanyName || "",
  };
}

function asNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function computeVatFields(totalAmount: number, hasVat: boolean) {
  const total = roundMoney(Math.max(0, totalAmount || 0));
  if (!hasVat) {
    return { totalAmount: total, subtotalAmount: total, vatAmount: 0 };
  }

  const subtotalAmount = roundMoney(total / 1.19);
  return {
    totalAmount: total,
    subtotalAmount,
    vatAmount: roundMoney(total - subtotalAmount),
  };
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(value: number, currency = "RON") {
  return `${(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function splitMoney(value: number, currency = "RON") {
  const formatted = formatMoney(value, currency);
  const lastSpace = formatted.lastIndexOf(" ");
  if (lastSpace === -1) return { amount: formatted, currency };
  return {
    amount: formatted.slice(0, lastSpace),
    currency: formatted.slice(lastSpace + 1),
  };
}

function MoneyValue({ value, currency = "RON" }: { value: number; currency?: string }) {
  const parts = splitMoney(value, currency);
  return (
    <span className="expense-money-value" title={formatMoney(value, currency)}>
      <span>{parts.amount}</span>
      <span className="expense-money-currency">{parts.currency}</span>
    </span>
  );
}

function formatDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function formatFileSize(file: File) {
  if (!file.size) return "fisier ales";
  if (file.size < 1024 * 1024) return `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueCompanyNames(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ro")
  );
}

function isInvoice(item: ExpenseDocumentItem) {
  return item.documentKind === "factura" || item.documentKind === "proforma";
}

export default function ExpenseInvoicesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const appUser = useMemo(() => currentAppUser(user), [user]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<ExpenseProjectOption[]>([]);
  const [companies, setCompanies] = useState<ExpenseCompanyOption[]>([]);
  const [documents, setDocuments] = useState<ExpenseDocumentItem[]>([]);
  const [draft, setDraft] = useState<InvoiceDraft>(emptyDraft);
  const [hasVat, setHasVat] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [fileDraft, setFileDraft] = useState<ExpenseFileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [invoiceMonth, setInvoiceMonth] = useState(currentMonth());
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [deletingItemId, setDeletingItemId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const previousProfileCompanyNameRef = useRef(appUser?.primaryCompanyName || "");

  useEffect(() => {
    setLoadingDocuments(true);
    Promise.all([getExpenseUsers(), getExpenseProjects(), getExpenseCompanies(), getExpenseDocuments()])
      .then(([nextUsers, nextProjects, nextCompanies, nextDocuments]) => {
        setUsers(nextUsers);
        setProjects(nextProjects);
        setCompanies(nextCompanies);
        setDocuments(nextDocuments);
      })
      .catch((err) => {
        console.error("[ExpenseInvoicesPage][load]", err);
        setError("Nu am putut incarca listele.");
      })
      .finally(() => setLoadingDocuments(false));
  }, []);

  useEffect(() => {
    if (!appUser?.id) return;
    const profileCompanyName = appUser.primaryCompanyName?.trim() || "";
    setDraft((prev) => ({
      ...prev,
      assignedUserId: prev.assignedUserId || appUser.id,
      companyName: profileCompanyName || prev.companyName,
    }));
    getUserExpenseFormPreference(appUser.id)
      .then((preference) => {
        setDraft((prev) => ({
          ...prev,
          assignedUserId: preference.assignedUserId || prev.assignedUserId || appUser.id,
          projectId: preference.projectId || prev.projectId,
          companyName: profileCompanyName || preference.companyName || prev.companyName,
        }));
      })
      .catch((err) => console.warn("[ExpenseInvoicesPage][form preference]", err));
  }, [appUser?.id, appUser?.primaryCompanyName]);

  useEffect(() => {
    const profileCompanyName = appUser?.primaryCompanyName?.trim() || "";
    const previousProfileCompanyName = previousProfileCompanyNameRef.current;

    setDraft((prev) => {
      if (!profileCompanyName) return prev;
      if (!prev.companyName || prev.companyName === previousProfileCompanyName) {
        return { ...prev, companyName: profileCompanyName };
      }
      return prev;
    });

    previousProfileCompanyNameRef.current = profileCompanyName;
  }, [appUser?.primaryCompanyName]);

  function updateDraftPreference(nextValues: Partial<InvoiceDraft>) {
    setDraft((prev) => ({ ...prev, ...nextValues }));
    if (!appUser?.id) return;
    void saveUserExpenseFormPreference(appUser.id, {
      assignedUserId: nextValues.assignedUserId,
      projectId: nextValues.projectId,
      companyName: nextValues.companyName,
    }).catch((err) => console.warn("[ExpenseInvoicesPage][save form preference]", err));
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === draft.projectId) || null,
    [draft.projectId, projects]
  );
  const selectedAssignedUser = useMemo(
    () => users.find((item) => item.id === draft.assignedUserId) || appUser,
    [appUser, draft.assignedUserId, users]
  );
  const companyOptions = useMemo(
    () =>
      uniqueCompanyNames([
        ...companies.map((item) => item.companyName),
        ...documents.map((item) => item.companyName),
        appUser?.primaryCompanyName || "",
        draft.companyName,
      ]),
    [appUser?.primaryCompanyName, companies, documents, draft.companyName]
  );

  const invoiceDocuments = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    return documents
      .filter(isInvoice)
      .filter((item) => !invoiceMonth || item.yearMonth === invoiceMonth)
      .filter((item) => {
        if (!q) return true;
        const haystack = [
          item.supplierName,
          item.supplierTaxId,
          item.documentNumber,
          item.companyName,
          item.assignedUserName,
          item.projectCode,
          item.projectName,
          item.notes,
          ...item.lineItems.map((line) => line.name),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
  }, [documents, invoiceMonth, invoiceSearch]);
  const userThemeById = useMemo(
    () => new Map([...users, ...(appUser ? [appUser] : [])].map((userItem) => [userItem.id, userItem.themeKey ?? null])),
    [appUser, users]
  );

  const invoiceSummary = useMemo(() => summarizeExpenses(invoiceDocuments), [invoiceDocuments]);
  const invoiceSupplierCount = useMemo(
    () => new Set(invoiceDocuments.map((item) => item.supplierName).filter(Boolean)).size,
    [invoiceDocuments]
  );

  function updateTotalAmount(rawValue: string) {
    const nextTotal = asNumber(rawValue);
    setDraft((prev) => ({
      ...prev,
      ...computeVatFields(nextTotal, hasVat),
    }));
  }

  function updateVatMode(nextHasVat: boolean) {
    setHasVat(nextHasVat);
    setDraft((prev) => ({
      ...prev,
      ...computeVatFields(prev.totalAmount, nextHasVat),
    }));
  }

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    setFileDraft(null);
    setError("");
    if (nextFile) {
      setMessage("Fisier incarcat. Acum apasa Scaneaza documentul acum ca sa citeasca factura.");
    } else {
      setMessage("");
    }
  }

  async function scanFile() {
    if (!appUser || !file) {
      setError("Alege un fisier pentru scanare.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Se incarca si se citesc datele din factura...");
    try {
      const uploaded = await uploadExpenseFile({ file, user: appUser });
      const analysis = await analyzeExpenseUploadedFile({
        storagePath: uploaded.filePath,
        fileName: uploaded.fileName,
        contentType: uploaded.contentType,
      });
      setFileDraft(uploaded);
      setHasVat((analysis.vatAmount || 0) > 0);
      setDraft((prev) => ({
        ...prev,
        ...analysis,
        documentKind: analysis.documentKind === "other" ? "factura" : analysis.documentKind,
        companyName: prev.companyName || analysis.buyerCompanyName || analysis.companyHint,
      }));
      setMessage("Datele au fost extrase. Verifica si salveaza factura.");
    } catch (err) {
      console.error("[ExpenseInvoicesPage][scan]", err);
      setError("Nu am putut scana documentul.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function saveInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appUser) {
      setError("Trebuie sa fii autentificat.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Se salveaza factura...");
    try {
      let uploaded = fileDraft;
      if (!uploaded && file) {
        uploaded = await uploadExpenseFile({ file, user: appUser });
      }
      if (draft.companyName) {
        await saveUserExpenseFormPreference(appUser.id, {
          assignedUserId: selectedAssignedUser?.id || appUser.id,
          projectId: selectedProject?.id || "",
          companyName: draft.companyName,
        });
        await saveExpenseCompanyOption(draft.companyName).catch((companyError) => {
          console.warn("[ExpenseInvoicesPage][company option]", companyError);
        });
      }
      const saved = await saveExpenseDocument({
        ...draft,
        fileName: uploaded?.fileName || "Factura introdusa manual",
        fileUrl: uploaded?.fileUrl || "",
        filePath: uploaded?.filePath || "",
        contentType: uploaded?.contentType || "",
        sizeBytes: uploaded?.sizeBytes || 0,
        extension: uploaded?.extension || "",
        uploadedByUserId: appUser.id,
        uploadedByUserName: appUser.fullName || appUser.email || "Utilizator",
        assignedUserId: selectedAssignedUser?.id || appUser.id,
        assignedUserName: selectedAssignedUser?.fullName || selectedAssignedUser?.email || appUser.fullName,
        projectId: selectedProject?.id || "",
        projectCode: "",
        projectName: selectedProject?.name || "",
        companyName: draft.companyName,
        reimbursable: draft.reimbursable,
      });
      setDocuments((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      setDraft((prev) => ({
        ...emptyDraft,
        assignedUserId: prev.assignedUserId,
        projectId: prev.projectId,
        companyName: prev.companyName,
      }));
      setHasVat(true);
      setFile(null);
      setFileDraft(null);
      setMessage("Factura salvata si adaugata in raport.");
    } catch (err) {
      console.error("[ExpenseInvoicesPage][save]", err);
      setError("Nu am putut salva factura.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteInvoice(item: ExpenseDocumentItem) {
    const label = item.supplierName || item.fileName || item.documentNumber || "factura selectata";
    const confirmed = window.confirm(`Stergi ${label}?`);
    if (!confirmed) return;

    setDeletingItemId(item.id);
    setError("");
    try {
      await deleteExpenseDocument(item);
      setDocuments((prev) => prev.filter((entry) => entry.id !== item.id));
      setMessage("Factura stearsa.");
    } catch (err) {
      console.error("[ExpenseInvoicesPage][delete]", err);
      setError("Nu am putut sterge factura.");
    } finally {
      setDeletingItemId("");
    }
  }

  async function handleDownloadInvoice(item: ExpenseDocumentItem) {
    await downloadFileFromUrl({
      url: item.fileUrl,
      fileName: item.fileName || item.documentNumber || item.supplierName || "factura",
    });
  }

  return (
    <section className="page-section expense-invoices-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Facturi</h2>
            <p className="panel-subtitle">Introducere manuala sau scanare document, cu date editabile inainte de salvare.</p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => navigate("/expenses/scan")}>
            <ArrowLeft size={16} />
            Inapoi
          </button>
        </div>

        <form className="tool-form expense-scan-form" onSubmit={(event) => void saveInvoice(event)}>
          <div className="expense-scan-steps" aria-label="Pasi scanare factura">
            <div className={`expense-scan-step ${file || fileDraft || busy ? "is-done" : "is-active"}`}>
              <span className="expense-scan-step__marker">
                {file || fileDraft || busy ? <CheckCircle2 size={15} /> : "1"}
              </span>
              <span>
                <strong>Incarca documentul</strong>
                <small>Apasa pe zona mare cu contur albastru.</small>
              </span>
            </div>
            <div className={`expense-scan-step ${busy ? "is-active" : fileDraft ? "is-done" : file ? "is-active" : ""}`}>
              <span className="expense-scan-step__marker">
                {fileDraft ? <CheckCircle2 size={15} /> : "2"}
              </span>
              <span>
                <strong>Scaneaza documentul</strong>
                <small>Apasa butonul albastru dupa ce ai ales fisierul.</small>
              </span>
            </div>
            <div className={`expense-scan-step ${fileDraft ? "is-active" : ""}`}>
              <span className="expense-scan-step__marker">3</span>
              <span>
                <strong>Verifica si salveaza</strong>
                <small>Corecteaza datele daca trebuie, apoi salveaza factura.</small>
              </span>
            </div>
          </div>

          <div className="tool-form-grid">
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label expense-upload-label">Pasul 1 - Fisier bon/factura</label>
              <label className={`expense-upload-dropzone ${file ? "has-file" : "expense-upload-dropzone--attention"}`}>
                <UploadCloud size={22} />
                <span className="expense-upload-dropzone__copy">
                  <strong>{file ? file.name : "APASA AICI ca sa incarci poza sau PDF-ul"}</strong>
                  <small>
                    {file
                      ? `${formatFileSize(file)} - pasul 1 este gata`
                      : "Dupa ce alegi fisierul, apasa butonul albastru Scaneaza documentul acum."}
                  </small>
                  <span className="expense-upload-dropzone__cta">{file ? "Fisier ales" : "Alege fisier"}</span>
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
                  disabled={busy}
                />
              </label>
              {file && !busy && !fileDraft && (
                <div className="expense-file-confirmation" role="status">
                  <CheckCircle2 size={18} />
                  <span>
                    <strong>Fisier incarcat.</strong>
                    <small>Mai ai un pas: apasa Scaneaza documentul acum ca sa citeasca datele.</small>
                  </span>
                </div>
              )}
              {fileDraft && !busy && (
                <div className="expense-file-confirmation" role="status">
                  <CheckCircle2 size={18} />
                  <span>
                    <strong>Date citite din document.</strong>
                    <small>Verifica campurile completate si apasa Salveaza factura.</small>
                  </span>
                </div>
              )}
              <div className="tool-form-actions expense-actions" style={{ marginTop: 10 }}>
                <button
                  className={`primary-btn expense-submit-button ${file && !busy ? "expense-submit-button--ready" : ""}`}
                  type="button"
                  disabled={busy || !file}
                  onClick={() => void scanFile()}
                >
                  <ScanLine size={16} />
                  {busy ? "Se scaneaza..." : file ? "Scaneaza documentul acum" : "Alege fisier intai"}
                </button>
              </div>
            </div>

            <div className="tool-form-block tool-form-block-full">
              <div className="expense-assignment-note">
                <strong>Pentru cine este factura?</strong>
                <span>
                  Alege userul, proiectul si firma pentru care incarci documentul. Selectiile raman salvate pentru tine
                  pana le schimbi.
                </span>
              </div>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Tip</label>
              <select className="tool-input" value={draft.documentKind} onChange={(event) => setDraft((prev) => ({ ...prev, documentKind: event.target.value as ExpenseDocumentKind }))}>
                <option value="factura">Factura</option>
                <option value="proforma">Proforma</option>
                <option value="bon">Bon</option>
                <option value="chitanta">Chitanta</option>
                <option value="other">Alt tip</option>
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Data</label>
              <input className="tool-input" type="date" value={draft.documentDate} onChange={(event) => setDraft((prev) => ({ ...prev, documentDate: event.target.value }))} />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Numar factura/bon</label>
              <input className="tool-input" value={draft.documentNumber} onChange={(event) => setDraft((prev) => ({ ...prev, documentNumber: event.target.value }))} />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Furnizor</label>
              <input className="tool-input" value={draft.supplierName} onChange={(event) => setDraft((prev) => ({ ...prev, supplierName: event.target.value }))} />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">CUI furnizor</label>
              <input className="tool-input" value={draft.supplierTaxId} onChange={(event) => setDraft((prev) => ({ ...prev, supplierTaxId: event.target.value }))} />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Firma</label>
              <input
                className="tool-input"
                list="invoice-company-options"
                value={draft.companyName}
                onChange={(event) => updateDraftPreference({ companyName: event.target.value })}
                placeholder="Alege sau scrie firma noua"
              />
              <datalist id="invoice-company-options">
                {companyOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">User</label>
              <select className="tool-input" value={draft.assignedUserId} onChange={(event) => updateDraftPreference({ assignedUserId: event.target.value })}>
                {appUser && <option value={appUser.id}>{appUser.fullName}</option>}
                {users.filter((item) => item.id !== appUser?.id).map((item) => <option key={item.id} value={item.id}>{item.fullName || item.email}</option>)}
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Proiect</label>
              <select className="tool-input" value={draft.projectId} onChange={(event) => updateDraftPreference({ projectId: event.target.value })}>
                <option value="">Fara proiect</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name || "Fara nume"}</option>)}
              </select>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Total de plata</label>
              <input className="tool-input" inputMode="decimal" value={draft.totalAmount || ""} onChange={(event) => updateTotalAmount(event.target.value)} placeholder="0,00" />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">TVA</label>
              <label className="tool-checkbox-inline">
                <input type="checkbox" checked={hasVat} onChange={(event) => updateVatMode(event.target.checked)} />
                Factura cu TVA
              </label>
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Fara TVA</label>
              <input className="tool-input" value={draft.subtotalAmount ? draft.subtotalAmount.toFixed(2) : ""} readOnly />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">TVA calculat</label>
              <input className="tool-input" value={draft.vatAmount ? draft.vatAmount.toFixed(2) : ""} readOnly />
            </div>
            <div className="tool-form-block">
              <label className="tool-form-label">Decontare</label>
              <select className="tool-input" value={draft.reimbursable ? "yes" : "no"} onChange={(event) => setDraft((prev) => ({ ...prev, reimbursable: event.target.value === "yes" }))}>
                <option value="no">Nu</option>
                <option value="yes">Da</option>
              </select>
            </div>
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Observatii</label>
              <textarea className="tool-input" rows={3} value={draft.notes} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} />
            </div>
          </div>

          <div className="tool-form-actions expense-actions">
            <button className="primary-btn" type="submit" disabled={busy}>
              <Save size={16} />
              {busy ? "Se lucreaza..." : "Salveaza factura"}
            </button>
          </div>
        </form>

        {message && <div className="tool-message success-message">{message}</div>}
        {error && <div className="tool-message">{error}</div>}
      </div>

      <div className="expense-kpi-grid expense-kpi-grid-wide">
        <div className="kpi-card"><div className="kpi-label">Facturi total cu TVA</div><div className="kpi-value"><MoneyValue value={invoiceSummary.total} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Fara TVA</div><div className="kpi-value"><MoneyValue value={invoiceSummary.subtotal} /></div></div>
        <div className="kpi-card"><div className="kpi-label">TVA</div><div className="kpi-value"><MoneyValue value={invoiceSummary.vat} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Decontari</div><div className="kpi-value"><MoneyValue value={invoiceSummary.reimbursableTotal} /></div></div>
        <div className="kpi-card"><div className="kpi-label">Facturi</div><div className="kpi-value">{invoiceSummary.invoiceCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Furnizori</div><div className="kpi-value">{invoiceSupplierCount}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Lista facturi si raport</h2>
            <p className="panel-subtitle">Facturile introduse manual sau scanate apar aici cu totaluri TVA si filtre.</p>
          </div>
        </div>

        <div className="tool-form-grid expense-filter-grid">
          <div className="tool-form-block">
            <label className="tool-form-label">Luna</label>
            <input className="tool-input" type="month" value={invoiceMonth} onChange={(event) => setInvoiceMonth(event.target.value)} />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Cautare</label>
            <input
              className="tool-input"
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder="Furnizor, numar, firma, proiect, produs"
            />
          </div>
        </div>

        {loadingDocuments ? (
          <p className="tools-subtitle">Se incarca facturile...</p>
        ) : invoiceDocuments.length === 0 ? (
          <p className="tools-subtitle">Nu exista facturi pentru filtrul curent.</p>
        ) : (
          <div className="expense-table-wrap">
            <table className="expense-table">
              <thead>
                <tr>
                  <th>Data / Numar</th>
                  <th>Furnizor</th>
                  <th>Firma / Proiect</th>
                  <th>User</th>
                  <th>Fara TVA</th>
                  <th>TVA</th>
                  <th>Total</th>
                  <th>Decontare</th>
                  <th>Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {invoiceDocuments.map((item) => (
                  <tr key={item.id} className={`user-table-row ${getUserThemeClass(userThemeById.get(item.assignedUserId))}`}>
                    <td>
                      <div className="expense-cell-main">{formatDate(item.documentDate)}</div>
                      <div className="expense-cell-muted">{item.documentNumber || "-"}</div>
                    </td>
                    <td>
                      <div className="expense-cell-main">{item.supplierName || "-"}</div>
                      <div className="expense-cell-muted">{item.supplierTaxId || "-"}</div>
                    </td>
                    <td>
                      <div className="expense-cell-main">{item.companyName || "-"}</div>
                      <div className="expense-cell-muted">{item.projectName || item.projectCode || "Fara proiect"}</div>
                    </td>
                    <td><UserProfileLink userId={item.assignedUserId} name={item.assignedUserName} themeKey={userThemeById.get(item.assignedUserId)} /></td>
                    <td>{formatMoney(item.subtotalAmount)}</td>
                    <td>{formatMoney(item.vatAmount)}</td>
                    <td>{formatMoney(item.totalAmount)}</td>
                    <td>{item.reimbursable ? "Da" : "Nu"}</td>
                    <td>
                      <div className="expense-row-actions">
                        {item.fileUrl && (
                          <>
                            <a className="secondary-btn" href={item.fileUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} />
                              Deschide
                            </a>
                            <button
                              className="secondary-btn"
                              type="button"
                              onClick={() => void handleDownloadInvoice(item)}
                            >
                              <Download size={14} />
                              Download
                            </button>
                          </>
                        )}
                        <button
                          className="danger-btn"
                          type="button"
                          onClick={() => void handleDeleteInvoice(item)}
                          disabled={deletingItemId === item.id}
                        >
                          <Trash2 size={15} />
                          {deletingItemId === item.id ? "Se sterge..." : "Sterge"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
