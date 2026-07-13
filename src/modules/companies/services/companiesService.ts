import {
  arrayRemove,
  collectionGroup,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase/firebase";
import {
  buildCompanyScopeConstraints,
  getCurrentCompanyAccessContext,
} from "../../../lib/firebase/companyAccess";
import type {
  CompanyFormValues,
  CompanyItem,
  CompanyMaintenanceReportLite,
  CompanySummary,
} from "../../../types/company";
import type { ExpenseDocumentItem } from "../../../types/expense";
import type { AppUser } from "../../../types/tool";
import type { LeaveRequestItem } from "../../../types/leave";
import type { TimesheetItem } from "../../../types/timesheet";
import type { ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import { getExpenseDocuments } from "../../expenses/services/expensesService";
import { getExpenseUsers } from "../../expenses/services/expensesService";
import { getTimesheetsList } from "../../timesheets/services/timesheetsService";
import { getToolsList } from "../../tools/services/toolsService";
import { getVehiclesList } from "../../vehicles/services/vehiclesService";

const companiesCollection = collection(db, "firmeMentenanta");
const maintenanceClientsCollection = collection(db, "maintenanceClients");
const expenseDocumentsCollection = collection(db, "expenseDocuments");
const usersCollection = collection(db, "users");
const leaveRequestsCollection = collection(db, "leaveRequests");
const FIRESTORE_BATCH_LIMIT = 450;

function toText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function optionalLoad<T>(_label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

export function normalizeCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCompanyDoc(id: string, data: Record<string, unknown>): CompanyItem {
  const companyName = toText(data.companyName);
  return {
    id,
    companyKey: toText(data.companyKey) || normalizeCompanyKey(companyName) || id,
    companyName,
    legalName: toText(data.legalName),
    taxId: toText(data.taxId).toUpperCase(),
    registrationNumber: toText(data.registrationNumber),
    address: toText(data.address),
    phone: toText(data.phone),
    email: toText(data.email).toLowerCase(),
    website: toText(data.website),
    contactName: toText(data.contactName),
    notes: toText(data.notes),
    active: data.active !== false,
    assignedUserIds: Array.isArray(data.assignedUserIds)
      ? data.assignedUserIds.map((item) => toText(item)).filter(Boolean)
      : [],
    assignedUserNames: Array.isArray(data.assignedUserNames)
      ? data.assignedUserNames.map((item) => toText(item)).filter(Boolean)
      : [],
    createdAt: toNumber(data.createdAt, Date.now()),
    updatedAt: toNumber(data.updatedAt, Date.now()),
  };
}

export async function getCompaniesList(): Promise<CompanyItem[]> {
  const context = await getCurrentCompanyAccessContext();
  const snap = await getDocs(query(
    companiesCollection,
    ...buildCompanyScopeConstraints(context),
    orderBy("companyName", "asc")
  ));
  return snap.docs
    .map((docItem) => mapCompanyDoc(docItem.id, docItem.data() as Record<string, unknown>))
    .filter((item) => item.companyName);
}

export async function saveCompany(values: CompanyFormValues, users: AppUser[]): Promise<CompanyItem> {
  const companyName = values.companyName.trim();
  const companyKey = normalizeCompanyKey(companyName);
  if (!companyName || !companyKey) {
    throw new Error("Numele firmei este obligatoriu.");
  }

  const assignedUsers = values.assignedUserIds
    .map((userId) => users.find((user) => user.id === userId))
    .filter(Boolean) as AppUser[];
  const now = Date.now();
  const payload = {
    companyId: companyKey,
    companyName,
    companyKey,
    legalName: values.legalName.trim(),
    taxId: values.taxId.trim().toUpperCase(),
    registrationNumber: values.registrationNumber.trim(),
    address: values.address.trim(),
    phone: values.phone.trim(),
    email: values.email.trim().toLowerCase(),
    website: values.website.trim(),
    contactName: values.contactName.trim(),
    notes: values.notes.trim(),
    active: values.active,
    assignedUserIds: assignedUsers.map((user) => user.id),
    assignedUserNames: assignedUsers.map((user) => user.fullName || user.email || user.id),
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  };

  await setDoc(
    doc(companiesCollection, companyKey),
    {
      ...payload,
      createdAt: now,
      createdAtServer: serverTimestamp(),
    },
    { merge: true }
  );

  if (assignedUsers.length > 0) {
    const assignUsers = httpsCallable<
      { companyId: string; userIds: string[] },
      { companyId: string; assignedCount: number }
    >(functions, "assignUsersToCompany");
    await assignUsers({ companyId: companyKey, userIds: assignedUsers.map((user) => user.id) });
  }

  return {
    id: companyKey,
    ...payload,
    createdAt: now,
  };
}

export async function setUserPrimaryCompany(params: {
  userId: string;
  company: Pick<CompanyItem, "companyKey" | "companyName"> | null;
}): Promise<void> {
  if (!params.userId) return;
  if (!params.company) throw new Error("Selecteaza o firma asignata contului.");
  const setPrimary = httpsCallable<
    { companyId: string },
    { companyId: string; companyName: string }
  >(functions, "setPrimaryCompany");
  await setPrimary({ companyId: params.company.companyKey });
}

async function commitBatchItems(
  items: Array<(batch: ReturnType<typeof writeBatch>) => void>
): Promise<void> {
  for (let index = 0; index < items.length; index += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    items.slice(index, index + FIRESTORE_BATCH_LIMIT).forEach((apply) => apply(batch));
    await batch.commit();
  }
}

export async function deleteCompanyEverywhere(company: CompanyItem): Promise<void> {
  const context = await getCurrentCompanyAccessContext();
  if (!context.globalAdmin) throw new Error("Numai administratorul global poate sterge o firma.");
  const companyKey = company.companyKey || company.id;
  const companyName = company.companyName.trim();
  if (!companyKey || !companyName) {
    throw new Error("Firma nu poate fi stearsa fara nume valid.");
  }

  const [usersSnap, expensesSnap, maintenanceSnap] = await Promise.all([
    getDocs(usersCollection),
    getDocs(query(expenseDocumentsCollection, where("companyName", "==", companyName))),
    getDocs(query(maintenanceClientsCollection, where("maintenanceCompany", "==", companyName))),
  ]);

  const now = Date.now();
  const writes: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  writes.push((batch) => batch.delete(doc(companiesCollection, companyKey)));

  usersSnap.docs.forEach((userDoc) => {
    const data = userDoc.data() as Record<string, unknown>;
    const primaryCompanyId = toText(data.primaryCompanyId);
    const primaryCompanyName = toText(data.primaryCompanyName);
    writes.push((batch) =>
      batch.set(
        userDoc.ref,
        {
          companyIds: arrayRemove(companyKey),
          companyNames: arrayRemove(companyName),
          ...(primaryCompanyId === companyKey || primaryCompanyName === companyName
            ? {
                primaryCompanyId: deleteField(),
                primaryCompanyName: deleteField(),
              }
            : {}),
          updatedAt: now,
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  expensesSnap.docs.forEach((expenseDoc) => {
    writes.push((batch) =>
      batch.set(
        expenseDoc.ref,
        {
          companyName: "",
          updatedAt: now,
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  maintenanceSnap.docs.forEach((clientDoc) => {
    writes.push((batch) =>
      batch.set(
        clientDoc.ref,
        {
          maintenanceCompany: "",
          updatedAt: now,
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  await commitBatchItems(writes);

  await deleteDoc(doc(companiesCollection, companyKey)).catch(() => null);
}

export async function getCompanyDirectoryData(): Promise<{
  companies: CompanyItem[];
  users: AppUser[];
  expenses: ExpenseDocumentItem[];
  maintenanceClients: Array<{ id: string; name: string; maintenanceCompany: string }>;
  tools: ToolItem[];
  vehicles: VehicleItem[];
  timesheets: TimesheetItem[];
  leaveRequests: LeaveRequestItem[];
  maintenanceReports: CompanyMaintenanceReportLite[];
}> {
  const context = await getCurrentCompanyAccessContext();
  const scope = buildCompanyScopeConstraints(context);
  const companies = await getCompaniesList();
  const [
    users,
    expenses,
    maintenanceSnap,
    tools,
    vehicles,
    timesheets,
    leaveSnap,
    reportsSnap,
  ] = await Promise.all([
    optionalLoad("users", getExpenseUsers, []),
    optionalLoad("expenses", getExpenseDocuments, []),
    optionalLoad("maintenance clients", () => getDocs(query(
      maintenanceClientsCollection,
      ...scope,
      orderBy("name", "asc")
    )), null),
    optionalLoad("tools", getToolsList, []),
    optionalLoad("vehicles", getVehiclesList, []),
    optionalLoad("timesheets", getTimesheetsList, []),
    optionalLoad("leave requests", () => getDocs(query(
      leaveRequestsCollection,
      ...scope,
      orderBy("createdAt", "desc")
    )), null),
    optionalLoad("maintenance reports", () => getDocs(query(
      collectionGroup(db, "rapoarte"),
      ...scope,
      orderBy("createdAt", "desc")
    )), null),
  ]);

  return {
    companies,
    users,
    expenses,
    maintenanceClients: maintenanceSnap?.docs.map((docItem) => {
      const data = docItem.data() as Record<string, unknown>;
      return {
        id: docItem.id,
        companyId: toText(data.companyId),
        name: toText(data.name),
        maintenanceCompany: toText(data.maintenanceCompany),
      };
    }) || [],
    tools,
    vehicles,
    timesheets,
    leaveRequests: leaveSnap?.docs.map((docItem) => {
      const data = docItem.data() as Record<string, unknown>;
      return {
        id: docItem.id,
        userId: toText(data.userId),
        userName: toText(data.userName),
        userEmail: toText(data.userEmail),
        companyName: toText(data.companyName),
        roleTitle: toText(data.roleTitle),
        department: toText(data.department),
        requestType:
          data.requestType === "zi_libera_platita" || data.requestType === "zi_libera_eveniment"
            ? data.requestType
            : "concediu_odihna",
        legalReason: toText(data.legalReason),
        periodStart: toText(data.periodStart),
        periodEnd: toText(data.periodEnd),
        requestedDays: toNumber(data.requestedDays),
        requestedMinutes: toNumber(data.requestedMinutes),
        reason: toText(data.reason),
        signatureData: toText(data.signatureData),
        issuedAt: toNumber(data.issuedAt, Date.now()),
        status: data.status === "aprobat" || data.status === "respins" ? data.status : "in_asteptare",
        pdfDataUrl: toText(data.pdfDataUrl),
        createdAt: toNumber(data.createdAt, Date.now()),
        updatedAt: toNumber(data.updatedAt, Date.now()),
      } as LeaveRequestItem;
    }) || [],
    maintenanceReports: reportsSnap?.docs.map((docItem) => {
      const data = docItem.data() as Record<string, unknown>;
      return {
        id: docItem.id,
        clientId: toText(data.clientId),
        clientName: toText(data.clientName),
        reportType: toText(data.reportType),
        lift: toText(data.lift),
        technicianName: toText(data.technicianName),
        pdfUrl: toText(data.pdfUrl),
        createdAt: toNumber(data.createdAt),
      };
    }) || [],
  };
}

export function buildCompanySummary(params: {
  company: CompanyItem;
  expenses: ExpenseDocumentItem[];
  maintenanceClients: Array<{ id: string; name: string; maintenanceCompany: string }>;
}): CompanySummary {
  const companyName = params.company.companyName.trim().toLowerCase();
  const companyExpenses = params.expenses.filter((item) => item.companyName.trim().toLowerCase() === companyName);
  const companyMaintenanceClients = params.maintenanceClients.filter(
    (item) => item.maintenanceCompany.trim().toLowerCase() === companyName
  );

  return {
    expenseCount: companyExpenses.length,
    expenseTotal: companyExpenses.reduce((sum, item) => sum + (item.totalAmount || 0), 0),
    reimbursableTotal: companyExpenses
      .filter((item) => item.reimbursable)
      .reduce((sum, item) => sum + (item.totalAmount || 0), 0),
    maintenanceClientCount: companyMaintenanceClients.length,
    maintenanceClientNames: companyMaintenanceClients.map((item) => item.name).filter(Boolean).slice(0, 8),
  };
}
