import type { AppUser } from "../../../types/tool";
import { uploadAndAnalyzeExpenseDocument } from "./expensesService";
import type { ExpenseDocumentItem } from "../../../types/expense";

const DATABASE_NAME = "workcontrol-offline";
const STORE_NAME = "expenseUploads";
const DATABASE_VERSION = 1;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_QUEUE_ITEMS = 10;
let flushPromise: Promise<ExpenseDocumentItem[]> | null = null;

export type OfflineExpenseUpload = {
  id: string;
  createdAt: number;
  file: Blob;
  fileName: string;
  fileType: string;
  user: AppUser;
  assignedUserId: string;
  assignedUserName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  companyName: string;
  reimbursable: boolean;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB indisponibil."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Coada offline nu a putut fi accesata."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error || new Error("Tranzactia offline a esuat."));
  });
}

export async function getOfflineExpenseUploads() {
  const result = await withStore<OfflineExpenseUpload[]>("readonly", (store) => store.getAll());
  return result.sort((left, right) => left.createdAt - right.createdAt);
}

export async function queueOfflineExpenseUpload(input: Omit<OfflineExpenseUpload, "id" | "createdAt" | "file" | "fileName" | "fileType"> & { file: File }) {
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error("Pentru salvare offline, fisierul poate avea maximum 12 MB.");
  }
  const current = await getOfflineExpenseUploads();
  if (current.length >= MAX_QUEUE_ITEMS) {
    throw new Error("Coada offline are deja 10 documente. Sincronizeaza-le inainte de alt upload.");
  }
  const item: OfflineExpenseUpload = {
    ...input,
    id: `expense-${crypto.randomUUID()}`,
    createdAt: Date.now(),
    file: input.file,
    fileName: input.file.name,
    fileType: input.file.type,
  };
  await withStore<IDBValidKey>("readwrite", (store) => store.add(item));
  return item;
}

export async function removeOfflineExpenseUpload(id: string) {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export function offlineExpenseToFile(item: OfflineExpenseUpload) {
  return new File([item.file], item.fileName, { type: item.fileType || item.file.type });
}

export function flushOfflineExpenseUploads(
  userId: string,
  onProgress?: (message: string) => void
) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const saved: ExpenseDocumentItem[] = [];
    const queue = (await getOfflineExpenseUploads()).filter((item) => item.user.id === userId);
    for (const queued of queue) {
      const savedItem = await uploadAndAnalyzeExpenseDocument({
        file: offlineExpenseToFile(queued),
        user: queued.user,
        assignedUserId: queued.assignedUserId,
        assignedUserName: queued.assignedUserName,
        projectId: queued.projectId,
        projectCode: queued.projectCode,
        projectName: queued.projectName,
        companyName: queued.companyName,
        reimbursable: queued.reimbursable,
        onProgress: (_step, message) => onProgress?.(message),
      });
      await removeOfflineExpenseUpload(queued.id);
      saved.push(savedItem);
    }
    return saved;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}
