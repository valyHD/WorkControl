import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, functions, storage } from "../../../lib/firebase/firebase";
import {
  buildCompanyScopeConstraints,
  buildUserDirectoryConstraints,
  getCurrentCompanyAccessContext,
  requirePrimaryCompanyId,
} from "../../../lib/firebase/companyAccess";
import { getUserDirectoryCollectionName } from "../../../lib/firebase/companyIsolationRollout";
import { dispatchNotificationEvent } from "../../notifications/services/notificationsService";
import type { AppUser } from "../../../types/tool";
import type {
  ExpenseAiAnalysis,
  ExpenseCompanyOption,
  ExpenseDocumentItem,
  ExpenseDocumentKind,
  ExpenseDocumentPayload,
  ExpenseFileDraft,
  ExpenseFilters,
  ExpenseFormPreference,
  ExpenseProjectOption,
  ExpenseSummary,
} from "../../../types/expense";
import { getActiveProjectsList } from "../../timesheets/services/timesheetsService";

const expensesCollection = collection(db, "expenseDocuments");
const expenseScanJobsCollection = collection(db, "expenseScanJobs");
const userOperationalViewsCollection = collection(db, "userOperationalViews");
const usersCollection = collection(db, "users");
const maintenanceCompaniesCollection = collection(db, "firmeMentenanta");

export type ExpenseScanProgressStep = "prepare" | "upload" | "analyze" | "save" | "done";
type ExpenseScanProgressHandler = (step: ExpenseScanProgressStep, message: string) => void;

export const EMPTY_EXPENSE_ANALYSIS: ExpenseAiAnalysis = {
  documentKind: "other",
  supplierName: "",
  supplierTaxId: "",
  buyerCompanyName: "",
  buyerTaxId: "",
  documentNumber: "",
  documentDate: "",
  dueDate: "",
  currency: "RON",
  subtotalAmount: 0,
  vatAmount: 0,
  totalAmount: 0,
  paymentMethod: "",
  expenseCategory: "",
  projectHint: "",
  userHint: "",
  companyHint: "",
  lineItems: [],
  confidence: 0,
  notes: "",
};

function toSafeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKind(value: unknown): ExpenseDocumentKind {
  const safeValue = toSafeString(value).toLowerCase();
  if (["bon", "factura", "chitanta", "proforma", "other"].includes(safeValue)) {
    return safeValue as ExpenseDocumentKind;
  }
  return "other";
}

function normalizeDate(value: unknown) {
  const safeValue = toSafeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(safeValue) ? safeValue : "";
}

function getYearMonth(dateString: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString.slice(0, 7);
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function mapAnalysis(data: Partial<ExpenseAiAnalysis> | null | undefined): ExpenseAiAnalysis {
  const lineItems = Array.isArray(data?.lineItems)
    ? data.lineItems.slice(0, 60).map((item) => ({
        name: toSafeString(item?.name),
        quantity: toSafeNumber(item?.quantity, 0),
        unitPrice: toSafeNumber(item?.unitPrice, 0),
        total: toSafeNumber(item?.total, 0),
      }))
    : [];

  return {
    documentKind: normalizeKind(data?.documentKind),
    supplierName: toSafeString(data?.supplierName),
    supplierTaxId: toSafeString(data?.supplierTaxId).toUpperCase(),
    buyerCompanyName: toSafeString(data?.buyerCompanyName),
    buyerTaxId: toSafeString(data?.buyerTaxId).toUpperCase(),
    documentNumber: toSafeString(data?.documentNumber),
    documentDate: normalizeDate(data?.documentDate),
    dueDate: normalizeDate(data?.dueDate),
    currency: toSafeString(data?.currency, "RON").toUpperCase() || "RON",
    subtotalAmount: toSafeNumber(data?.subtotalAmount, 0),
    vatAmount: toSafeNumber(data?.vatAmount, 0),
    totalAmount: toSafeNumber(data?.totalAmount, 0),
    paymentMethod: toSafeString(data?.paymentMethod),
    expenseCategory: toSafeString(data?.expenseCategory),
    projectHint: toSafeString(data?.projectHint),
    userHint: toSafeString(data?.userHint),
    companyHint: toSafeString(data?.companyHint),
    lineItems,
    confidence: Math.max(0, Math.min(1, toSafeNumber(data?.confidence, 0))),
    notes: toSafeString(data?.notes),
  };
}

function waitForExpenseScanJob(params: {
  jobId: string;
  onProgress?: ExpenseScanProgressHandler;
}): Promise<ExpenseDocumentItem> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Scanarea dureaza prea mult. Jobul continua in fundal."));
    }, 180_000);

    const unsubscribe = onSnapshot(
      doc(db, "expenseScanJobs", params.jobId),
      (snapshot) => {
        const data = snapshot.data() || {};
        const status = toSafeString(data.status);

        if (status === "queued") {
          params.onProgress?.("analyze", "Document incarcat. Scanarea asteapta procesarea in fundal...");
          return;
        }

        if (status === "processing") {
          params.onProgress?.("analyze", "Se citeste documentul in fundal...");
          return;
        }

        if (status === "failed") {
          window.clearTimeout(timeout);
          unsubscribe();
          reject(new Error(toSafeString(data.errorMessage) || "Scanarea in fundal a esuat."));
          return;
        }

        if (status === "completed") {
          const expenseDocumentId = toSafeString(data.expenseDocumentId);
          if (!expenseDocumentId) return;

          window.clearTimeout(timeout);
          unsubscribe();
          params.onProgress?.("done", "Rezolvat - document incarcat si salvat.");

          getDoc(doc(db, "expenseDocuments", expenseDocumentId))
            .then((expenseSnap) => {
              if (!expenseSnap.exists()) {
                reject(new Error("Documentul scanat nu a fost gasit."));
                return;
              }
              resolve(mapExpenseDoc(expenseSnap.id, expenseSnap.data()));
            })
            .catch(reject);
        }
      },
      (error) => {
        window.clearTimeout(timeout);
        unsubscribe();
        reject(error);
      }
    );
  });
}

function mapExpenseDoc(id: string, data: Record<string, any>): ExpenseDocumentItem {
  return {
    id,
    companyId: toSafeString(data.companyId),
    fileName: toSafeString(data.fileName),
    fileUrl: toSafeString(data.fileUrl),
    filePath: toSafeString(data.filePath),
    contentType: toSafeString(data.contentType),
    sizeBytes: toSafeNumber(data.sizeBytes, 0),
    extension: toSafeString(data.extension),
    uploadedByUserId: toSafeString(data.uploadedByUserId),
    uploadedByUserName: toSafeString(data.uploadedByUserName),
    assignedUserId: toSafeString(data.assignedUserId),
    assignedUserName: toSafeString(data.assignedUserName),
    projectId: toSafeString(data.projectId),
    projectCode: toSafeString(data.projectCode),
    projectName: toSafeString(data.projectName),
    companyName: toSafeString(data.companyName),
    reimbursable: Boolean(data.reimbursable),
    yearMonth: toSafeString(data.yearMonth),
    createdAt: toSafeNumber(data.createdAt, Date.now()),
    updatedAt: toSafeNumber(data.updatedAt, Date.now()),
    ...mapAnalysis(data),
  };
}

export async function getExpenseUsers(): Promise<AppUser[]> {
  const context = await getCurrentCompanyAccessContext();
  const source = getUserDirectoryCollectionName() === "userOperationalViews"
    ? userOperationalViewsCollection
    : usersCollection;
  const snap = await getDocs(query(
    source,
    ...buildUserDirectoryConstraints(context),
    orderBy("fullName", "asc")
  ));
  const users = new Map<string, AppUser>();
  snap.docs.forEach((docItem) => {
    const data = docItem.data();
    const uid = toSafeString(data.uid) || docItem.id;
    users.set(uid, {
      id: uid,
      email: toSafeString(data.email),
      fullName: toSafeString(data.fullName) || toSafeString(data.displayName) || toSafeString(data.email),
      role: data.role ?? "user",
      active: data.active !== false,
      themeKey: data.themeKey ?? null,
      avatarUrl: toSafeString(data.avatarUrl),
      avatarThumbUrl: toSafeString(data.avatarThumbUrl) || toSafeString(data.avatarUrl),
      companyIds: [toSafeString(data.companyId)].filter(Boolean),
      companyNames: [],
      primaryCompanyId: toSafeString(data.companyId),
      primaryCompanyName: "",
      createdAt: toSafeNumber(data.createdAt, Date.now()),
      updatedAt: toSafeNumber(data.updatedAt, Date.now()),
    } as AppUser);
  });
  return [...users.values()];
}

export async function getExpenseProjects(): Promise<ExpenseProjectOption[]> {
  return getActiveProjectsList();
}

export async function getExpenseCompanies(): Promise<ExpenseCompanyOption[]> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(query(
    maintenanceCompaniesCollection,
    ...buildCompanyScopeConstraints(context),
    orderBy("companyName", "asc")
  ));
  return snap.docs
    .map((docItem) => {
      const data = docItem.data();
      const companyName = toSafeString(data.companyName);
      return {
        id: docItem.id,
        companyName,
        companyKey: toSafeString(data.companyKey) || docItem.id,
      };
    })
    .filter((item) => item.companyName);
}

export async function getUserExpenseCompanyPreference(userId: string): Promise<string> {
  if (!userId) return "";
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return "";
  const data = snap.data();
  return toSafeString(data.lastExpenseCompanyName) || toSafeString(data.expenseCompanyName);
}

export async function getUserExpenseFormPreference(userId: string): Promise<ExpenseFormPreference> {
  if (!userId) return { assignedUserId: "", projectId: "", companyName: "" };
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return { assignedUserId: "", projectId: "", companyName: "" };
  const data = snap.data();
  return {
    assignedUserId: toSafeString(data.lastExpenseAssignedUserId),
    projectId: toSafeString(data.lastExpenseProjectId),
    companyName: toSafeString(data.lastExpenseCompanyName) || toSafeString(data.expenseCompanyName),
  };
}

export async function saveUserExpenseCompanyPreference(userId: string, companyName: string): Promise<void> {
  if (!userId || !companyName.trim()) return;
  await setDoc(
    doc(db, "users", userId),
    {
      lastExpenseCompanyName: companyName.trim(),
      expenseCompanyName: companyName.trim(),
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function saveUserExpenseFormPreference(
  userId: string,
  preference: Partial<ExpenseFormPreference>
): Promise<void> {
  if (!userId) return;
  const cleanCompanyName = toSafeString(preference.companyName);
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  };

  if (preference.assignedUserId !== undefined) {
    payload.lastExpenseAssignedUserId = toSafeString(preference.assignedUserId);
  }
  if (preference.projectId !== undefined) {
    payload.lastExpenseProjectId = toSafeString(preference.projectId);
  }
  if (preference.companyName !== undefined) {
    payload.lastExpenseCompanyName = cleanCompanyName;
    payload.expenseCompanyName = cleanCompanyName;
  }

  await setDoc(doc(db, "users", userId), payload, { merge: true });
}

export async function saveExpenseCompanyOption(companyName: string): Promise<void> {
  const context = await getCurrentCompanyAccessContext();
  if (context.role === "angajat") return;
  const cleanName = companyName.trim();
  const companyKey = normalizeCompanyKey(cleanName);
  if (!cleanName || !companyKey) return;

  await setDoc(
    doc(maintenanceCompaniesCollection, companyKey),
    {
      companyId: companyKey,
      companyName: cleanName,
      companyKey,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getExpenseDocuments(maxItems = 1000): Promise<ExpenseDocumentItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(maxItems)));
  if (context.role !== "angajat") {
    const snap = await getDocs(query(
      expensesCollection,
      ...buildCompanyScopeConstraints(context),
      orderBy("documentDate", "desc"),
      limit(safeLimit)
    ));
    return snap.docs.map((docItem) => mapExpenseDoc(docItem.id, docItem.data()));
  }
  const snapshots = await Promise.all(["uploadedByUserId", "assignedUserId"].map((field) => getDocs(query(
    expensesCollection,
    ...buildCompanyScopeConstraints(context),
    where(field, "==", context.uid),
    orderBy("documentDate", "desc"),
    limit(safeLimit)
  ))));
  const unique = new Map<string, ExpenseDocumentItem>();
  snapshots.forEach((snap) => snap.docs.forEach((docItem) => {
    unique.set(docItem.id, mapExpenseDoc(docItem.id, docItem.data()));
  }));
  return [...unique.values()]
    .sort((a, b) => b.documentDate.localeCompare(a.documentDate))
    .slice(0, safeLimit);
}

export function filterExpenseDocuments(
  items: ExpenseDocumentItem[],
  filters: ExpenseFilters
): ExpenseDocumentItem[] {
  return items.filter((item) => {
    if (filters.yearMonth && item.yearMonth !== filters.yearMonth) return false;
    if (filters.userId && item.assignedUserId !== filters.userId) return false;
    if (filters.projectId && item.projectId !== filters.projectId) return false;
    if (filters.companyName && item.companyName !== filters.companyName) return false;
    if (filters.documentKind && item.documentKind !== filters.documentKind) return false;
    if (filters.reimbursable === "yes" && !item.reimbursable) return false;
    if (filters.reimbursable === "no" && item.reimbursable) return false;
    if (
      filters.supplierName &&
      !item.supplierName.toLowerCase().includes(filters.supplierName.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

export async function uploadExpenseFile(params: {
  file: File;
  user: AppUser;
}): Promise<ExpenseFileDraft> {
  const context = await getCurrentCompanyAccessContext();
  if (params.user.id !== context.uid) throw new Error("Poti incarca numai documentele proprii.");
  const file = params.file;
  if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
    throw new Error("Fisierul trebuie sa aiba maximum 15 MB.");
  }
  if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.type)) {
    throw new Error("Sunt acceptate numai PDF, JPG, PNG sau WEBP.");
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() || "" : "";
  const safeBaseName = `${Date.now()}_${file.name.replace(/\s+/g, "_").replace(/[^\w.-]/g, "")}`;
  const filePath = `expenses/${params.user.id}/${safeBaseName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "private,max-age=604800",
  });

  return {
    fileName: file.name,
    fileUrl: await getDownloadURL(fileRef),
    filePath,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size || 0,
    extension: ext,
  };
}

export async function analyzeExpenseUploadedFile(params: {
  storagePath: string;
  fileName: string;
  contentType: string;
  scanMode?: "fast" | "full";
}): Promise<ExpenseAiAnalysis> {
  const analyzeDocument = httpsCallable<typeof params, Partial<ExpenseAiAnalysis>>(
    functions,
    "analyzeExpenseDocument"
  );
  const result = await analyzeDocument(params);
  return mapAnalysis(result.data);
}

export async function saveExpenseDocument(payload: ExpenseDocumentPayload): Promise<ExpenseDocumentItem> {
  const context = await getCurrentCompanyAccessContext();
  if (payload.uploadedByUserId !== context.uid) throw new Error("Documentul poate fi salvat numai de autor.");
  const companyId = payload.companyId || requirePrimaryCompanyId(context);
  const now = Date.now();
  const analysis = mapAnalysis(payload);
  const documentDate = analysis.documentDate || new Date(now).toISOString().slice(0, 10);
  const yearMonth = getYearMonth(documentDate);
  const companyName = payload.companyName || analysis.buyerCompanyName || analysis.companyHint || "";

  const storedPayload = {
    companyId,
    ...analysis,
    documentDate,
    yearMonth,
    fileName: payload.fileName,
    fileUrl: payload.fileUrl,
    filePath: payload.filePath,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    extension: payload.extension,
    uploadedByUserId: payload.uploadedByUserId,
    uploadedByUserName: payload.uploadedByUserName,
    assignedUserId: payload.assignedUserId,
    assignedUserName: payload.assignedUserName,
    projectId: payload.projectId,
    projectCode: payload.projectCode,
    projectName: payload.projectName,
    companyName,
    reimbursable: Boolean(payload.reimbursable),
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  };

  const docRef = await addDoc(expensesCollection, storedPayload);
  const eventType = storedPayload.reimbursable
     ? "expense_reimbursable_created"
    : storedPayload.documentKind === "factura" || storedPayload.documentKind === "proforma"
       ? "expense_invoice_created"
      : "expense_document_created";

  await dispatchNotificationEvent({
    module: "expenses",
    eventType,
    entityId: docRef.id,
    title: storedPayload.reimbursable ? "Decontare noua" : "Cheltuiala noua",
    message: `${storedPayload.assignedUserName || "Utilizator"} a introdus ${storedPayload.documentKind} ${storedPayload.documentNumber || ""} de la ${storedPayload.supplierName || "furnizor necunoscut"} (${storedPayload.totalAmount || 0} ${storedPayload.currency || "RON"}).`,
    notificationPath: "/expenses/scan",
    directUserId: storedPayload.assignedUserId,
    ownerUserId: storedPayload.assignedUserId,
    actorUserId: storedPayload.uploadedByUserId,
    actorUserName: storedPayload.uploadedByUserName,
    metadata: {
      fieldsText: [
        `Tip document: ${storedPayload.documentKind || "-"}`,
        `Numar document: ${storedPayload.documentNumber || "-"}`,
        `Furnizor: ${storedPayload.supplierName || "-"}`,
        `Firma: ${storedPayload.companyName || "-"}`,
        `Total: ${storedPayload.totalAmount || 0} ${storedPayload.currency || "RON"}`,
        `TVA: ${storedPayload.vatAmount || 0} ${storedPayload.currency || "RON"}`,
        `Data document: ${storedPayload.documentDate || "-"}`,
        `User alocat: ${storedPayload.assignedUserName || "-"}`,
        `Proiect: ${storedPayload.projectName || "-"}`,
        `Decont: ${storedPayload.reimbursable ? "da" : "nu"}`,
      ],
      fieldsCount: 10,
    },
  });

  return mapExpenseDoc(docRef.id, storedPayload);
}

export async function deleteExpenseDocument(
  item: Pick<ExpenseDocumentItem, "id" | "filePath">
): Promise<void> {
  if (!item.id) return;

  if (item.filePath) {
    await deleteObject(ref(storage, item.filePath)).catch((error) => {
      console.warn("[deleteExpenseDocument][storage]", error);
    });
  }

  await deleteDoc(doc(expensesCollection, item.id));
}

export async function uploadAndAnalyzeExpenseDocument(params: {
  file: File;
  user: AppUser;
  assignedUserId: string;
  assignedUserName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  companyName: string;
  reimbursable: boolean;
  onProgress?: ExpenseScanProgressHandler;
}): Promise<ExpenseDocumentItem> {
  params.onProgress?.("prepare", "Se pregateste documentul pentru scanare in fundal...");

  const preferencePromise = params.companyName
     ? Promise.all([
        saveUserExpenseCompanyPreference(params.user.id, params.companyName),
        saveExpenseCompanyOption(params.companyName),
      ]).catch((error) => {
        console.warn("[uploadAndAnalyzeExpenseDocument][companyPreference]", error);
      })
    : Promise.resolve();

  params.onProgress?.("upload", "Se incarca documentul original...");
  const uploaded = await uploadExpenseFile({ file: params.file, user: params.user });

  params.onProgress?.("analyze", "Document incarcat. Scanarea continua in fundal...");
  const jobRef = await addDoc(expenseScanJobsCollection, {
    companyId: requirePrimaryCompanyId(await getCurrentCompanyAccessContext()),
    status: "queued",
    scanMode: "full",
    fileName: uploaded.fileName,
    fileUrl: uploaded.fileUrl,
    filePath: uploaded.filePath,
    contentType: uploaded.contentType,
    sizeBytes: uploaded.sizeBytes,
    extension: uploaded.extension,
    uploadedByUserId: params.user.id,
    uploadedByUserName: params.user.fullName || params.user.email || "Utilizator",
    assignedUserId: params.assignedUserId,
    assignedUserName: params.assignedUserName,
    projectId: params.projectId,
    projectCode: params.projectCode,
    projectName: params.projectName,
    companyName: params.companyName,
    reimbursable: params.reimbursable,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });

  const savedDocument = await waitForExpenseScanJob({
    jobId: jobRef.id,
    onProgress: params.onProgress,
  });

  await preferencePromise;
  params.onProgress?.("done", "Rezolvat - document incarcat si salvat.");

  return savedDocument;
}

export function summarizeExpenses(items: ExpenseDocumentItem[]): ExpenseSummary {
  const total = items.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  const vat = items.reduce((sum, item) => sum + (item.vatAmount || 0), 0);
  const subtotal = items.reduce((sum, item) => {
    const explicitSubtotal = item.subtotalAmount || 0;
    return sum + (explicitSubtotal || Math.max(0, (item.totalAmount || 0) - (item.vatAmount || 0)));
  }, 0);
  const reimbursableItems = items.filter((item) => item.reimbursable);
  const reimbursableTotal = reimbursableItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  const reimbursableVat = reimbursableItems.reduce((sum, item) => sum + (item.vatAmount || 0), 0);
  const suppliers = new Set(items.map((item) => item.supplierName).filter(Boolean));

  return {
    count: items.length,
    total: Number(total.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    vat: Number(vat.toFixed(2)),
    reimbursableTotal: Number(reimbursableTotal.toFixed(2)),
    reimbursableVat: Number(reimbursableVat.toFixed(2)),
    supplierCount: suppliers.size,
    invoiceCount: items.filter((item) => item.documentKind === "factura" || item.documentKind === "proforma").length,
    receiptCount: items.filter((item) => item.documentKind === "bon" || item.documentKind === "chitanta").length,
  };
}
