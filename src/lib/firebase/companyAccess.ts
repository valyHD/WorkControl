import { doc, getDoc, where, type QueryConstraint } from "firebase/firestore";
import { auth, db } from "./firebase";
import { areCompanyIsolationReadsEnabled } from "./companyIsolationRollout";

export type CompanyAccessContext = {
  uid: string;
  role: "admin" | "manager" | "angajat";
  globalAdmin: boolean;
  primaryCompanyId: string;
  companyIds: string[];
};

function cleanCompanyIds(values: unknown, primaryCompanyId: string): string[] {
  const ids = Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  if (primaryCompanyId && !ids.includes(primaryCompanyId)) ids.unshift(primaryCompanyId);
  return [...new Set(ids)].slice(0, 30);
}

export function isGlobalAdminProfile(data: Record<string, unknown>): boolean {
  if (data.role !== "admin") return false;
  if (data.globalAdmin === true) return true;

  const primaryCompanyId =
    typeof data.primaryCompanyId === "string" ? data.primaryCompanyId.trim() : "";
  const companyIds = cleanCompanyIds(data.companyIds, primaryCompanyId);
  return companyIds.length === 0;
}

export async function getCurrentCompanyAccessContext(): Promise<CompanyAccessContext> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Trebuie sa fii autentificat.");

  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) throw new Error("Profilul intern nu exista.");
  const data = snap.data();
  if (data.active !== true || data.accessStatus !== "active") {
    throw new Error("Contul intern nu este activ.");
  }

  const role = data.role;
  if (role !== "admin" && role !== "manager" && role !== "angajat") {
    throw new Error("Rolul intern nu este valid.");
  }

  const primaryCompanyId =
    typeof data.primaryCompanyId === "string" ? data.primaryCompanyId.trim() : "";
  const companyIds = cleanCompanyIds(data.companyIds, primaryCompanyId);

  return {
    uid: currentUser.uid,
    role,
    globalAdmin: isGlobalAdminProfile(data),
    primaryCompanyId,
    companyIds,
  };
}

export function requirePrimaryCompanyId(context: CompanyAccessContext): string {
  if (context.primaryCompanyId) return context.primaryCompanyId;
  if (context.companyIds.length === 1) return context.companyIds[0];
  throw new Error("Selecteaza firma principala inainte de aceasta operatiune.");
}

export function canAccessCompany(
  context: CompanyAccessContext,
  companyId: string
): boolean {
  return context.globalAdmin || context.companyIds.includes(companyId);
}

export function requireCompanyScope(context: CompanyAccessContext): string[] {
  if (context.globalAdmin) return [];
  if (context.companyIds.length === 0) {
    throw new Error("Contul nu are nicio firma asociata.");
  }
  if (context.companyIds.length > 10) {
    throw new Error("Contul are prea multe firme pentru o interogare sigura.");
  }
  return context.companyIds;
}

export function buildCompanyScopeConstraints(
  context: CompanyAccessContext,
  fieldPath = "companyId"
): QueryConstraint[] {
  if (!areCompanyIsolationReadsEnabled()) return [];
  const companyIds = requireCompanyScope(context);
  if (companyIds.length === 0) return [];
  if (companyIds.length === 1) return [where(fieldPath, "==", companyIds[0])];
  return [where(fieldPath, "in", companyIds)];
}

export function buildUserDirectoryConstraints(
  context: CompanyAccessContext
): QueryConstraint[] {
  if (!areCompanyIsolationReadsEnabled()) return [];
  const constraints = buildCompanyScopeConstraints(context);
  if (context.role === "angajat") constraints.push(where("uid", "==", context.uid));
  return constraints;
}
