import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Download, ExternalLink, FilePlus2, FileSearch, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { AppUser } from "../../../types/tool";
import type {
  ExpenseCompanyOption,
  ExpenseDocumentItem,
  ExpenseFilters,
  ExpenseProjectOption,
} from "../../../types/expense";
import {
  deleteExpenseDocument,
  filterExpenseDocuments,
  getExpenseCompanies,
  getExpenseDocuments,
  getExpenseProjects,
  getExpenseUsers,
  getUserExpenseFormPreference,
  saveUserExpenseFormPreference,
  summarizeExpenses,
  uploadAndAnalyzeExpenseDocument,
} from "../services/expensesService";
import UserProfileLink from "../../../components/UserProfileLink";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import WorkflowStepper from "../../../components/product/WorkflowStepper";
import { getLatestTimesheetProjectForUser } from "../../timesheets/services/timesheetsService";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import { ASSISTANT_FILL_EXPENSE_FORM_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { registerAssistantFormDraftAdapter } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import {
  getOfflineExpenseUploads,
  flushOfflineExpenseUploads,
  queueOfflineExpenseUpload,
} from "../services/offlineExpenseQueue";
import { useFeatureFlags } from "../../../lib/productIntelligence";
import { getUserThemeClass } from "../../../lib/ui/userTheme";

const emptyFilters: ExpenseFilters = {
  yearMonth: new Date().toISOString().slice(0, 7),
  userId: "",
  projectId: "",
  companyName: "",
  supplierName: "",
  documentKind: "",
  reimbursable: "",
};

function formatMoney(value: number, currency = "RON") {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: currency || "RON",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function splitMoney(value: number, currency = "RON") {
  const parts = new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: currency || "RON",
    maximumFractionDigits: 2,
  }).formatToParts(value || 0);
  return {
    amount: parts
      .filter((part) => part.type !== "currency")
      .map((part) => part.value)
      .join("")
      .trim(),
    currency: parts.find((part) => part.type === "currency")?.value || currency || "RON",
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
  if (file.size < 1024 * 1024) return `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueCompanyNames(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ro")
  );
}

function getCurrentAppUser(user: ReturnType<typeof useAuth>["user"]): AppUser | null {
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

export default function ExpenseScanPage() {
  const { user, role } = useAuth();
  const { flags } = useFeatureFlags();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useMemo(() => getCurrentAppUser(user), [user]);
  const isAdmin = role === "admin";

  const [items, setItems] = useState<ExpenseDocumentItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<ExpenseProjectOption[]>([]);
  const [companies, setCompanies] = useState<ExpenseCompanyOption[]>([]);
  const [filters, setFilters] = useState<ExpenseFilters>(emptyFilters);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [assignedUserId, setAssignedUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [projectAutoStatus, setProjectAutoStatus] = useState("");
  const [scanDone, setScanDone] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [error, setError] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [deletingItemId, setDeletingItemId] = useState("");
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const deferredDetailsSearch = useDeferredValue(detailsSearch);
  const userThemeById = useMemo(
    () => new Map([...users, ...(currentUser ? [currentUser] : [])].map((userItem) => [userItem.id, userItem.themeKey ?? null])),
    [currentUser, users]
  );
  const lastAutoProjectUserRef = useRef("");
  const previousProfileCompanyNameRef = useRef(currentUser?.primaryCompanyName || "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const offlineSyncInProgress = useRef(false);

  async function refreshOfflineQueueCount() {
    if (!flags.offlineReceipts || typeof indexedDB === "undefined") return;
    try {
      setOfflineQueueCount((await getOfflineExpenseUploads()).length);
    } catch (queueError) {
      console.warn("[ExpenseScanPage][offline-queue-count]", queueError);
    }
  }

  async function syncOfflineReceipts() {
    if (!currentUser || !navigator.onLine || offlineSyncInProgress.current || !flags.offlineReceipts) return;
    offlineSyncInProgress.current = true;
    try {
      const queue = await getOfflineExpenseUploads();
      if (!queue.length) return;
      setStatus(`Se sincronizeaza ${queue.length} documente salvate offline...`);
      const savedItems = await flushOfflineExpenseUploads(currentUser.id, (message) => setStatus(message));
      for (const savedItem of savedItems) {
        setItems((current) => current.some((item) => item.id === savedItem.id) ? current : [savedItem, ...current]);
      }
      setStatus("Documentele salvate offline au fost sincronizate.");
    } catch (queueError) {
      console.warn("[ExpenseScanPage][offline-sync]", queueError);
      setStatus("Documentele offline asteapta o conexiune stabila.");
    } finally {
      offlineSyncInProgress.current = false;
      await refreshOfflineQueueCount();
    }
  }

  useEffect(() => {
    const handleDraft = (fields: Readonly<Record<string, unknown>>) => {
      if (fields.projectId !== undefined) setProjectId(String(fields.projectId));
      if (fields.companyName !== undefined) setCompanyName(String(fields.companyName));
    };
    return registerAssistantFormDraftAdapter(ASSISTANT_FILL_EXPENSE_FORM_EVENT, handleDraft);
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [nextUsers, nextProjects, nextCompanies, nextItems] = await Promise.all([
        getExpenseUsers(),
        getExpenseProjects(),
        getExpenseCompanies(),
        getExpenseDocuments(),
      ]);
      setUsers(nextUsers);
      setProjects(nextProjects);
      setCompanies(nextCompanies);
      setItems(nextItems);
    } catch (err) {
      console.error("[ExpenseScanPage][loadData]", err);
      setError("Nu am putut incarca bonurile si facturile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!flags.offlineReceipts || !currentUser) return;
    void refreshOfflineQueueCount();
    const handleOnline = () => void syncOfflineReceipts();
    window.addEventListener("online", handleOnline);
    if (navigator.onLine) void syncOfflineReceipts();
    return () => window.removeEventListener("online", handleOnline);
  }, [currentUser?.id, flags.offlineReceipts]);

  useEffect(() => {
    if (!assignedUserId && currentUser?.id) {
      setAssignedUserId(currentUser.id);
    }
  }, [assignedUserId, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    const profileCompanyName = currentUser.primaryCompanyName?.trim() || "";
    getUserExpenseFormPreference(currentUser.id)
      .then((preference) => {
        if (!active) return;
        if (preference.assignedUserId) setAssignedUserId(preference.assignedUserId);
        if (preference.projectId) setProjectId(preference.projectId);
        if (profileCompanyName || preference.companyName) {
          setCompanyName(profileCompanyName || preference.companyName);
        }
      })
      .catch((err) => console.warn("[ExpenseScanPage][form preference]", err));
    return () => {
      active = false;
    };
  }, [currentUser?.id, currentUser?.primaryCompanyName]);

  useEffect(() => {
    const profileCompanyName = currentUser?.primaryCompanyName?.trim() || "";
    const previousProfileCompanyName = previousProfileCompanyNameRef.current;

    setCompanyName((prev) => {
      if (!profileCompanyName) return prev;
      if (!prev || prev === previousProfileCompanyName) return profileCompanyName;
      return prev;
    });

    previousProfileCompanyNameRef.current = profileCompanyName;
  }, [currentUser?.primaryCompanyName]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("assistant") !== "upload") return;

    setStatus("Asistentul a deschis scanarea. Alege poza sau PDF-ul, apoi apasa Scaneaza si salveaza.");
    window.setTimeout(() => {
      fileInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      fileInputRef.current?.focus();
    }, 150);
  }, [location.search]);

  function updateAssignedUserPreference(nextUserId: string) {
    setAssignedUserId(nextUserId);
    setProjectAutoStatus("");
    lastAutoProjectUserRef.current = "";
    if (currentUser?.id) {
      void saveUserExpenseFormPreference(currentUser.id, { assignedUserId: nextUserId }).catch((err) =>
        console.warn("[ExpenseScanPage][save assigned user preference]", err)
      );
    }
  }

  function updateProjectPreference(nextProjectId: string) {
    lastAutoProjectUserRef.current = assignedUserId || "";
    setProjectAutoStatus(nextProjectId ? "Proiect schimbat manual. Se pastreaza alegerea ta." : "");
    setProjectId(nextProjectId);
    if (currentUser?.id) {
      void saveUserExpenseFormPreference(currentUser.id, { projectId: nextProjectId }).catch((err) =>
        console.warn("[ExpenseScanPage][save project preference]", err)
      );
    }
  }

  useEffect(() => {
    if (!assignedUserId || projects.length === 0) return;
    if (lastAutoProjectUserRef.current === assignedUserId) return;

    let active = true;
    lastAutoProjectUserRef.current = assignedUserId;
    setProjectAutoStatus("Caut proiectul din ultimul pontaj al userului...");

    getLatestTimesheetProjectForUser(assignedUserId)
      .then((project) => {
        if (!active) return;

        if (!project?.id) {
          setProjectAutoStatus("Userul ales nu are pontaj cu proiect. Poti selecta manual.");
          return;
        }

        setProjectId(project.id);
        setProjectAutoStatus(`Proiect completat automat din pontaj: ${project.name || "Fara nume"}.`);

        if (currentUser?.id) {
          void saveUserExpenseFormPreference(currentUser.id, { projectId: project.id }).catch((err) =>
            console.warn("[ExpenseScanPage][save auto project preference]", err)
          );
        }
      })
      .catch((err) => {
        console.warn("[ExpenseScanPage][auto project from timesheet]", err);
        if (active) setProjectAutoStatus("Nu am putut citi proiectul din pontaj. Poti selecta manual.");
      });

    return () => {
      active = false;
    };
  }, [assignedUserId, currentUser?.id, projects.length]);

  function updateCompanyPreference(nextCompanyName: string) {
    setCompanyName(nextCompanyName);
    if (currentUser?.id) {
      void saveUserExpenseFormPreference(currentUser.id, { companyName: nextCompanyName }).catch((err) =>
        console.warn("[ExpenseScanPage][save company preference]", err)
      );
    }
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projectId, projects]
  );

  const selectedAssignedUser = useMemo(() => {
    if (!assignedUserId) return currentUser;
    return users.find((item) => item.id === assignedUserId) || currentUser;
  }, [assignedUserId, currentUser, users]);

  const filteredItems = useMemo(
    () => filterExpenseDocuments(items, filters),
    [filters, items]
  );

  const summary = useMemo(() => summarizeExpenses(filteredItems), [filteredItems]);

  const searchableDetailsItems = useMemo(
    () => filteredItems.filter((item) => item.lineItems.length > 0 || item.notes),
    [filteredItems]
  );

  const detailsItems = useMemo(() => {
    const needle = deferredDetailsSearch.trim().toLowerCase();
    if (!needle) return searchableDetailsItems;
    return searchableDetailsItems.filter((item) => {
      const searchableText = [
        item.supplierName,
        item.supplierTaxId,
        item.buyerCompanyName,
        item.buyerTaxId,
        item.documentNumber,
        item.documentDate,
        item.dueDate,
        item.currency,
        item.paymentMethod,
        item.expenseCategory,
        item.projectCode,
        item.projectName,
        item.companyName,
        item.assignedUserName,
        item.notes,
        item.totalAmount,
        item.vatAmount,
        item.subtotalAmount,
        ...item.lineItems.flatMap((line) => [
          line.name,
          line.quantity,
          line.unitPrice,
          line.total,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(needle);
    });
  }, [deferredDetailsSearch, searchableDetailsItems]);

  const configuredCompanyOptions = useMemo(
    () =>
      uniqueCompanyNames([
        ...companies.map((item) => item.companyName),
        ...items.map((item) => item.companyName),
        currentUser?.primaryCompanyName || "",
        companyName,
      ]),
    [companies, companyName, currentUser?.primaryCompanyName, items]
  );

  const companyFilterOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...companies.map((item) => item.companyName),
          ...items.map((item) => item.companyName).filter(Boolean),
        ])
      ).sort(),
    [companies, items]
  );

  const duplicateCandidate = useMemo(() => {
    if (!selectedFile) return null;
    const normalizedName = selectedFile.name.trim().toLowerCase();
    return (
      items.find(
        (item) =>
          item.fileName.trim().toLowerCase() === normalizedName &&
          Number(item.sizeBytes || 0) === selectedFile.size
      ) ?? null
    );
  }, [items, selectedFile]);

  const selectedFilePreviewUrl = useMemo(
    () =>
      selectedFile && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(selectedFile)
        : "",
    [selectedFile]
  );

  useEffect(() => {
    return () => {
      if (selectedFilePreviewUrl) URL.revokeObjectURL(selectedFilePreviewUrl);
    };
  }, [selectedFilePreviewUrl]);

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setScanDone(false);
    setAllowDuplicate(false);
    setError("");
    setStatus(file ? "Poza/PDF incarcat. Acum apasa Scaneaza si salveaza." : "");
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    setScanDone(false);
    setAllowDuplicate(false);
    setError("");
    setStatus("");
  }

  async function handleDeleteDocument(item: ExpenseDocumentItem) {
    const label = item.supplierName || item.fileName || item.documentNumber || "documentul selectat";
    const confirmed = window.confirm(`Stergi ${label}?`);
    if (!confirmed) return;

    setDeletingItemId(item.id);
    setError("");
    try {
      await deleteExpenseDocument(item);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setStatus("Document sters.");
    } catch (err) {
      console.error("[ExpenseScanPage][delete]", err);
      setError("Nu am putut sterge documentul.");
    } finally {
      setDeletingItemId("");
    }
  }

  async function handleDownloadDocument(item: ExpenseDocumentItem) {
    await downloadFileFromUrl({
      url: item.fileUrl,
      fileName: item.fileName || item.documentNumber || item.supplierName || "document-cheltuiala",
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) {
      setError("Trebuie sa fii autentificat.");
      return;
    }
    if (!selectedFile) {
      setError("Alege poza sau PDF-ul cu bonul/factura.");
      return;
    }
    if (duplicateCandidate && !allowDuplicate) {
      setError("Acest fisier pare deja incarcat. Verifica duplicatul sau confirma incarcarea repetata.");
      return;
    }

    setSubmitting(true);
    setScanDone(false);
    setError("");
    setStatus("Se pregateste documentul...");

    try {
      const assignedUserName =
        selectedAssignedUser?.fullName || selectedAssignedUser?.email || currentUser.fullName;
      await saveUserExpenseFormPreference(currentUser.id, {
        assignedUserId: selectedAssignedUser?.id || currentUser.id,
        projectId: selectedProject?.id || "",
        companyName: companyName.trim(),
      }).catch((preferenceError) => {
        console.warn("[ExpenseScanPage][save form preference before upload]", preferenceError);
      });

      if (flags.offlineReceipts && !navigator.onLine) {
        await queueOfflineExpenseUpload({
          file: selectedFile,
          user: currentUser,
          assignedUserId: selectedAssignedUser?.id || currentUser.id,
          assignedUserName,
          projectId: selectedProject?.id || "",
          projectCode: "",
          projectName: selectedProject?.name || "",
          companyName: companyName.trim(),
          reimbursable,
        });
        setSelectedFile(null);
        setReimbursable(false);
        setStatus("Document salvat pe dispozitiv. Se va incarca automat cand revine internetul.");
        setScanDone(true);
        await refreshOfflineQueueCount();
        return;
      }

      const savedItem = await uploadAndAnalyzeExpenseDocument({
        file: selectedFile,
        user: currentUser,
        assignedUserId: selectedAssignedUser?.id || currentUser.id,
        assignedUserName,
        projectId: selectedProject?.id || "",
        projectCode: "",
        projectName: selectedProject?.name || "",
        companyName: companyName.trim(),
        reimbursable,
        onProgress: (_step, message) => setStatus(message),
      });

      setItems((prev) => [savedItem, ...prev]);
      setSelectedFile(null);
      setReimbursable(false);
      setScanDone(true);
      setStatus("Rezolvat - document incarcat si salvat.");
    } catch (err) {
      console.error("[ExpenseScanPage][submit]", err);
      setError("Nu am putut citi documentul clar. Incearca o poza mai dreapta/luminoasa sau reincarca documentul.");
      setStatus("");
      setScanDone(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-section expense-scan-page">
      <ActionBar
        title="Scanare bonuri si facturi"
        subtitle="Incarci poza sau PDF-ul, iar ChatGPT extrage furnizorul, suma, data, numarul si liniile documentului."
        actions={[
          {
            label: "Facturi",
            icon: <FilePlus2 size={16} />,
            onClick: () => navigate("/expenses/invoices"),
            tooltip: "Deschide lista de facturi incarcate",
          },
          ...(isAdmin
            ? [
                {
                  label: "Rapoarte",
                  icon: <BarChart3 size={16} />,
                  onClick: () => navigate("/expenses/reports"),
                  tooltip: "Vezi rapoartele de cheltuieli",
                },
              ]
            : []),
        ]}
      />

      <PageQuickActions
        actions={[
          {
            label: "Incarca poza",
            href: "#expense-upload",
            icon: <UploadCloud size={16} />,
            assistantAction: "upload-receipt",
            tooltip: "Incarca poza sau PDF cu bonul",
            variant: "primary",
          },
          {
            label: "Scaneaza",
            href: "#expense-scan-button",
            icon: <FileSearch size={16} />,
            assistantAction: "scan-receipt",
            tooltip: "Scaneaza si salveaza documentul incarcat",
          },
          {
            label: "Vezi istoric",
            href: "#expense-history",
            icon: <Download size={16} />,
            assistantSection: "expense-history",
            tooltip: "Coboara la documentele scanate",
          },
        ]}
      />

      {offlineQueueCount ? (
        <div className="wc-offline-queue-status" role="status">
          <strong>{offlineQueueCount} documente asteapta sincronizarea</strong>
          <span>Fisierele sunt pastrate local si se incarca automat dupa reconectare.</span>
        </div>
      ) : null}

      <div className="panel" data-assistant-section="expense-scan">

        <form ref={formRef} className="tool-form expense-scan-form" onSubmit={(event) => void handleSubmit(event)}>
          <WorkflowStepper
            activeStep={scanDone ? 4 : submitting ? 2 : selectedFile ? 1 : 0}
            steps={[
              { id: "upload", label: "Încarcă", description: "Poză sau PDF" },
              { id: "ocr", label: "OCR", description: "Citire automată" },
              { id: "verify", label: "Verifică", description: "Date extrase" },
              { id: "allocate", label: "Alocare", description: "User, proiect, firmă" },
              { id: "save", label: "Salvează", description: "Istoric bonuri" },
            ]}
          />

          <div className="tool-form-grid">
            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label expense-upload-label">Pasul 1 - Fisier bon/factura</label>
              <label
                id="expense-upload"
                className={`expense-upload-dropzone ${selectedFile ? "has-file" : "expense-upload-dropzone--attention"}`}
                data-assistant-action="upload-receipt"
                title="Incarca poza sau PDF cu bonul"
              >
                <UploadCloud size={22} />
                <span className="expense-upload-dropzone__copy">
                  <strong>{selectedFile ? selectedFile.name : "APASA AICI ca sa incarci poza sau PDF-ul"}</strong>
                  <small>
                    {selectedFile
                      ? `${formatFileSize(selectedFile)} - pasul 1 este gata`
                      : "Nu se citeste automat doar dupa alegere. Dupa ce alegi fisierul, apasa butonul albastru Scaneaza si salveaza."}
                  </small>
                  <span className="expense-upload-dropzone__cta">{selectedFile ? "Fisier ales" : "Alege fisier"}</span>
                </span>
                <input
                  ref={fileInputRef}
                  data-assistant-action="upload-receipt"
                  data-assistant-field="expense-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
                  disabled={submitting}
                />
              </label>
              {selectedFile && !submitting && !scanDone && (
                <div className="expense-file-confirmation" role="status">
                  <CheckCircle2 size={18} />
                  <span>
                    <strong>Fisier incarcat.</strong>
                    <small>Mai ai un pas: apasa Scaneaza si salveaza ca sa citeasca documentul.</small>
                  </span>
                </div>
              )}
              {selectedFilePreviewUrl ? (
                <div className="expense-document-preview" aria-label="Previzualizare document selectat">
                  {selectedFile?.type.startsWith("image/") ? (
                    <img src={selectedFilePreviewUrl} alt="Previzualizare bon selectat" />
                  ) : (
                    <iframe src={selectedFilePreviewUrl} title="Previzualizare document selectat" />
                  )}
                </div>
              ) : null}
              {duplicateCandidate ? (
                <div className="tool-message" role="alert">
                  <strong>Posibil duplicat:</strong> {duplicateCandidate.fileName}
                  <label className="wc-filter-check">
                    <input
                      type="checkbox"
                      checked={allowDuplicate}
                      onChange={(event) => setAllowDuplicate(event.target.checked)}
                    />
                    Incarca totusi acest document
                  </label>
                </div>
              ) : null}
              <div className="tool-form-actions expense-actions expense-actions-under-upload">
                <button
                  id="expense-scan-button"
                  className={`primary-btn expense-submit-button ${selectedFile && !submitting ? "expense-submit-button--ready" : ""}`}
                  data-assistant-action="scan-receipt"
                  type="submit"
                  title="Scaneaza documentul si il salveaza in istoric"
                  disabled={submitting || !selectedFile || Boolean(duplicateCandidate && !allowDuplicate)}
                >
                  <FileSearch size={16} />
                  {submitting ? "Se scaneaza..." : selectedFile ? "Scaneaza si salveaza" : "Alege poza intai"}
                </button>
                <button
                  className="danger-btn"
                  data-assistant-action="clear-receipt-file"
                  type="button"
                  onClick={clearSelectedFile}
                  title="Sterge fisierul ales si reia incarcarea"
                  disabled={submitting || !selectedFile}
                >
                  <Trash2 size={16} />
                  Sterge fisier ales
                </button>
                <button
                  className="secondary-btn"
                  data-assistant-action="refresh-receipts"
                  type="button"
                  onClick={() => void loadData()}
                  title="Actualizeaza lista de documente scanate"
                  disabled={loading || submitting}
                >
                  <RefreshCw size={16} />
                  Actualizeaza
                </button>
              </div>
            </div>

            <div className="tool-form-block tool-form-block-full">
              <div className="expense-assignment-note">
                <strong>Pentru cine este documentul?</strong>
                <span>
                  Alege userul, proiectul si firma pentru care incarci bonul/factura. Selectiile raman salvate pentru
                  tine pana le schimbi, ca sa nu le alegi la fiecare document.
                </span>
              </div>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">User cheltuiala</label>
              <select
                className="tool-input"
                data-assistant-field="expense-user"
                value={assignedUserId}
                onChange={(event) => updateAssignedUserPreference(event.target.value)}
                disabled={submitting}
              >
                {currentUser && (
                  <option value={currentUser.id}>{currentUser.fullName}</option>
                )}
                {users
                  .filter((item) => item.id !== currentUser?.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName || item.email}
                    </option>
                  ))}
              </select>
            </div>

            <div className={`tool-form-block ${projectId ? "attention-pulse-soft" : "attention-pulse"}`}>
              <label className="tool-form-label">Proiect</label>
              <select
                className="tool-input"
                data-assistant-field="expense-project"
                value={projectId}
                onChange={(event) => updateProjectPreference(event.target.value)}
                disabled={submitting}
              >
                <option value="">Fara proiect</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || "Fara nume"}
                  </option>
                ))}
              </select>
              <small className="tool-form-hint">
                {projectAutoStatus || "Se completeaza automat dupa ultimul pontaj al userului ales, dar il poti schimba."}
              </small>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Firma</label>
              <input
                className="tool-input"
                data-assistant-field="expense-company"
                list="expense-company-options"
                value={companyName}
                onChange={(event) => updateCompanyPreference(event.target.value)}
                placeholder="Alege sau scrie firma noua"
                disabled={submitting}
              />
              <datalist id="expense-company-options">
                {configuredCompanyOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Decontare</label>
              <select
                className="tool-input"
                data-assistant-field="expense-reimbursable"
                value={reimbursable ? "yes" : "no"}
                onChange={(event) => setReimbursable(event.target.value === "yes")}
                disabled={submitting}
              >
                <option value="no">Nu</option>
                <option value="yes">Da</option>
              </select>
            </div>

            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Status</label>
              <div className={`expense-status-box ${scanDone ? "is-done" : submitting ? "is-loading" : ""}`}>
                {scanDone ? (
                  <CheckCircle2 size={17} />
                ) : submitting ? (
                  <RefreshCw className="expense-status-spin" size={16} />
                ) : null}
                <span>{status || "Pasul 1: incarca poza sau PDF-ul."}</span>
              </div>
            </div>
          </div>

          {submitting && (
            <div className="expense-scan-loading" role="status" aria-live="polite">
              <RefreshCw className="expense-status-spin" size={20} />
              <span>
                <strong>Se scaneaza si se salveaza documentul...</strong>
                <small>{status || "Te rog asteapta, procesarea poate dura cateva secunde."}</small>
              </span>
            </div>
          )}

        </form>

        {error && <div className="tool-message">{error}</div>}
        {error && selectedFile ? (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={submitting || Boolean(duplicateCandidate && !allowDuplicate)}
          >
            <RefreshCw size={15} /> Reincearca procesarea
          </button>
        ) : null}
      </div>

      {isAdmin && (
        <div className="expense-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total luna/filtru</div>
            <div className="kpi-value"><MoneyValue value={summary.total} /></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Fara TVA</div>
            <div className="kpi-value"><MoneyValue value={summary.subtotal} /></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">TVA</div>
            <div className="kpi-value"><MoneyValue value={summary.vat} /></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Decontari</div>
            <div className="kpi-value"><MoneyValue value={summary.reimbursableTotal} /></div>
          </div>
        </div>
      )}

      <div id="expense-history" className="panel" data-assistant-section="expense-history">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Cheltuieli scanate</h2>
            <p className="panel-subtitle">Filtrare pe luna, user, proiect, firma si furnizor.</p>
          </div>
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
              <select
                className="tool-input"
                value={filters.userId}
                onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
              >
                <option value="">Toti userii</option>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName || item.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Proiect</label>
              <select
                className="tool-input"
                value={filters.projectId}
                onChange={(event) => setFilters((prev) => ({ ...prev, projectId: event.target.value }))}
              >
                <option value="">Toate proiectele</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || "Fara nume"}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Firma</label>
              <select
                className="tool-input"
                value={filters.companyName}
                onChange={(event) => setFilters((prev) => ({ ...prev, companyName: event.target.value }))}
              >
                <option value="">Toate firmele</option>
                {companyFilterOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="tool-form-block tool-form-block-full">
              <label className="tool-form-label">Cauta furnizor</label>
              <input
                className="tool-input"
                value={filters.supplierName}
                onChange={(event) => setFilters((prev) => ({ ...prev, supplierName: event.target.value }))}
                placeholder="Ex: OMV, Dedeman, eMAG"
              />
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Tip document</label>
              <select
                className="tool-input"
                value={filters.documentKind}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    documentKind: event.target.value as ExpenseFilters["documentKind"],
                  }))
                }
              >
                <option value="">Toate</option>
                <option value="bon">Bonuri</option>
                <option value="factura">Facturi</option>
                <option value="chitanta">Chitante</option>
                <option value="proforma">Proforme</option>
                <option value="other">Altele</option>
              </select>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Decontare</label>
              <select
                className="tool-input"
                value={filters.reimbursable}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    reimbursable: event.target.value as ExpenseFilters["reimbursable"],
                  }))
                }
              >
                <option value="">Toate</option>
                <option value="yes">Doar decontari</option>
                <option value="no">Fara decontare</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="tools-subtitle">Se incarca documentele...</p>
        ) : filteredItems.length === 0 ? (
          <p className="tools-subtitle">Nu exista cheltuieli pentru filtrele selectate.</p>
        ) : (
          <div className="expense-table-wrap">
            <table className="expense-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tip</th>
                  <th>Furnizor</th>
                  <th>Nr doc</th>
                  <th>Suma</th>
                  <th>TVA</th>
                  <th>User</th>
                  <th>Proiect</th>
                  <th>Firma</th>
                  <th>Decontare</th>
                  <th>Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id} className={`user-table-row ${getUserThemeClass(userThemeById.get(item.assignedUserId))}`}>
                    <td>{formatDate(item.documentDate)}</td>
                    <td>{item.documentKind}</td>
                    <td>
                      <div className="expense-cell-main">{item.supplierName || "-"}</div>
                      <div className="expense-cell-muted">{item.supplierTaxId || item.expenseCategory}</div>
                    </td>
                    <td>{item.documentNumber || "-"}</td>
                    <td>{formatMoney(item.totalAmount, item.currency)}</td>
                    <td>{formatMoney(item.vatAmount, item.currency)}</td>
                    <td>
                      <UserProfileLink userId={item.assignedUserId} name={item.assignedUserName} themeKey={userThemeById.get(item.assignedUserId)} />
                    </td>
                    <td>{item.projectName || item.projectCode || "-"}</td>
                    <td>{item.companyName || item.buyerCompanyName || "-"}</td>
                    <td>{item.reimbursable ? "Da" : "Nu"}</td>
                    <td>
                      <div className="expense-row-actions">
                        <a className="secondary-btn" href={item.fileUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={15} />
                          Deschide
                        </a>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => void handleDownloadDocument(item)}
                        >
                          <Download size={15} />
                          Download
                        </button>
                        <button
                          className="danger-btn"
                          type="button"
                          onClick={() => void handleDeleteDocument(item)}
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

      {searchableDetailsItems.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Detalii produse si observatii</h2>
              <p className="panel-subtitle">Cauta in furnizor, numar document, observatii, produse, sume, firma, user sau proiect.</p>
            </div>
          </div>

          <div className="panel-body expense-details-search">
            <div className="tool-form-block">
              <label className="tool-form-label">Search detalii</label>
              <input
                className="tool-input"
                value={detailsSearch}
                onChange={(event) => setDetailsSearch(event.target.value)}
                placeholder="Ex: motorina, Lukoil, 89.25, TVA, numar bon, proiect"
              />
            </div>
          </div>

          <div className="simple-list expense-details-list">
            {detailsItems.length === 0 ? (
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">Nu exista rezultate</div>
                  <div className="simple-list-subtitle">Schimba termenul cautat sau filtrele de mai sus.</div>
                </div>
              </div>
            ) : (
              detailsItems.map((item) => (
                <details key={item.id} className="simple-list-item expense-details-item">
                  <summary>
                    <span className="simple-list-text">
                      <span className="simple-list-label">
                        {item.supplierName || "Document"} - {formatDate(item.documentDate)}
                      </span>
                      <span className="simple-list-subtitle">
                        {item.lineItems.length} linii, incredere {Math.round((item.confidence || 0) * 100)}%
                      </span>
                    </span>
                  </summary>

                  {item.notes && <p className="expense-note">{item.notes}</p>}
                  {item.lineItems.length > 0 && (
                    <div className="expense-line-items">
                      {item.lineItems.map((line, index) => (
                        <div key={`${item.id}-${index}`} className="expense-line-item">
                          <span>{line.name || "Produs"}</span>
                          <span>
                            {line.quantity || 0} x {formatMoney(line.unitPrice, item.currency)}
                          </span>
                          <strong>{formatMoney(line.total, item.currency)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
