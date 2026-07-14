export const COMPANY_SCOPED_COLLECTIONS = [
  "users",
  "userOperationalViews",
  "projects",
  "vehicles",
  "vehicleOperationalViews",
  "vehicleTrackerAdmin",
  "vehicleEvents",
  "vehiclePositionArchives",
  "vehicleMaintenanceAlerts",
  "tools",
  "toolEvents",
  "timesheets",
  "activeTimesheets",
  "leaveRequests",
  "leaveBalances",
  "leaveSettings",
  "holidays",
  "expenseDocuments",
  "expenseScanJobs",
  "notifications",
  "notificationRules",
  "pushTokens",
  "auditLogs",
  "aiCommandLogs",
  "maintenanceClients",
  "maintenanceLifts",
  "maintenanceReports",
  "maintenancePartOrders",
  "rapoarte",
  "appFeedback",
];

export function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values.map(cleanId).filter(Boolean))];
}

export function getUserCompanyIds(data) {
  return unique([data?.primaryCompanyId, ...(Array.isArray(data?.companyIds) ? data.companyIds : [])]);
}

export function resolveUniqueCompany(candidates, defaultCompanyId = "") {
  const resolved = unique(candidates);
  if (resolved.length === 1) return { companyId: resolved[0], confidence: "reference" };
  if (resolved.length > 1) return { companyId: "", confidence: "conflict", candidates: resolved };
  const fallback = cleanId(defaultCompanyId);
  return fallback
    ? { companyId: fallback, confidence: "explicit-default" }
    : { companyId: "", confidence: "unresolved", candidates: [] };
}

export function migrationDefaultCompanyId({
  collectionName,
  defaultResourceCompanyId,
  allowUserCompanySelection,
}) {
  if (collectionName === "users" && allowUserCompanySelection === true) return "";
  return cleanId(defaultResourceCompanyId);
}

export function requiresInitialCompanySelection({
  collectionName,
  data,
  result,
  allowUserCompanySelection,
}) {
  return collectionName === "users" &&
    allowUserCompanySelection === true &&
    getUserCompanyIds(data).length === 0 &&
    !cleanId(result?.companyId);
}

export function inferCompanyId({ collectionName, documentId, path, data, references, defaultCompanyId }) {
  const existing = cleanId(data?.companyId);
  if (existing) return { companyId: existing, confidence: "existing" };

  if (collectionName === "firmeMentenanta") {
    return { companyId: cleanId(documentId), confidence: "document-id" };
  }
  if (collectionName === "users") {
    return resolveUniqueCompany(getUserCompanyIds(data), defaultCompanyId);
  }

  const userIds = unique([
    data?.userId,
    data?.ownerUserId,
    data?.currentDriverUserId,
    data?.pendingDriverUserId,
    data?.currentHolderUserId,
    data?.pendingHolderUserId,
    data?.uploadedByUserId,
    data?.assignedUserId,
    data?.actorUserId,
    data?.targetUserId,
    data?.requestedByUserId,
    data?.notifyUserId,
  ]);
  const candidates = userIds.flatMap((userId) => references.userCompanies.get(userId) || []);

  const vehicleId = cleanId(data?.vehicleId);
  if (vehicleId && references.vehicleCompanies.has(vehicleId)) {
    candidates.push(references.vehicleCompanies.get(vehicleId));
  }
  if (
    ["vehicleOperationalViews", "vehicleTrackerAdmin"].includes(collectionName) &&
    references.vehicleCompanies.has(documentId)
  ) {
    candidates.push(references.vehicleCompanies.get(documentId));
  }
  const toolId = cleanId(data?.toolId);
  if (toolId && references.toolCompanies.has(toolId)) {
    candidates.push(references.toolCompanies.get(toolId));
  }
  const clientId = cleanId(data?.clientId || data?.maintenanceClientId);
  if (clientId && references.clientCompanies.has(clientId)) {
    candidates.push(references.clientCompanies.get(clientId));
  }

  const pathParts = String(path || "").split("/");
  const parentClientIndex = pathParts.lastIndexOf("maintenanceClients");
  if (parentClientIndex >= 0 && pathParts[parentClientIndex + 1]) {
    const parentCompany = references.clientCompanies.get(pathParts[parentClientIndex + 1]);
    if (parentCompany) candidates.push(parentCompany);
  }

  return resolveUniqueCompany(candidates, defaultCompanyId);
}

export function normalizeLegacyUser(data, inferredCompanyId) {
  const companyIds = unique([...(Array.isArray(data?.companyIds) ? data.companyIds : []), inferredCompanyId]);
  const primaryCompanyId = cleanId(data?.primaryCompanyId) || (companyIds.length === 1 ? companyIds[0] : "");
  return {
    companyId: inferredCompanyId,
    companyIds,
    primaryCompanyId,
    accessStatus: data?.accessStatus || (data?.active === true ? "active" : "disabled"),
  };
}

export function legacyUserUpdateNeeded(data, normalized) {
  const currentCompanyIds = Array.isArray(data?.companyIds) ? data.companyIds : [];
  return cleanId(data?.companyId) !== cleanId(normalized?.companyId) ||
    cleanId(data?.primaryCompanyId) !== cleanId(normalized?.primaryCompanyId) ||
    cleanId(data?.accessStatus) !== cleanId(normalized?.accessStatus) ||
    JSON.stringify(currentCompanyIds) !== JSON.stringify(normalized?.companyIds || []);
}

export function buildAccessBootstrapUpdate(data, email, globalAdminEmails) {
  const normalizedEmail = cleanId(email).toLowerCase();
  return {
    accessStatus: data?.active === true ? "active" : "disabled",
    globalAdmin: globalAdminEmails.has(normalizedEmail),
  };
}
