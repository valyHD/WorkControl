import {
  createProject,
  getProjectById,
  updateProject,
} from "../../../modules/timesheets/services/timesheetsService";
import { getAllUsers, updateUserProfile, updateUserWorkDetails } from "../../../modules/users/services/usersService";
import { getToolById, updateTool } from "../../../modules/tools/services/toolsService";
import { getVehicleById, updateVehicle } from "../../../modules/vehicles/services/vehiclesService";
import type { ProjectFormValues } from "../../../types/timesheet";
import type { ToolFormValues } from "../../../types/tool";
import type { AppUserItem, UserRole } from "../../../types/user";
import type { VehicleFormValues, VehicleItem } from "../../../types/vehicle";
import { resolveAssistantEntity } from "./assistantEntityResolver";
import { parseAssistantDate, resolveAssistantFieldChanges } from "./assistantFieldResolver";
import { fillCurrentPageFields, fillLeaveForm, fillMaintenanceClientForm } from "./assistantFormFill";
import { validateAssistantPlan } from "./assistantValidator";
import { normalizeAssistantText, scoreAssistantText } from "./assistantFuzzy";
import type {
  AssistantFieldChange,
  AssistantRuntimeContext,
  AssistantRuntimePlan,
  AssistantResolvedEntity,
} from "./assistantTypes";
import type { AssistantCommandInterpretation } from "../assistantCommandService";

function vehicleToFormValues(vehicle: VehicleItem): VehicleFormValues {
  return {
    plateNumber: vehicle.plateNumber || "",
    brand: vehicle.brand || "",
    model: vehicle.model || "",
    year: vehicle.year || "",
    vin: vehicle.vin || "",
    fuelType: vehicle.fuelType || "",
    status: vehicle.status || "activa",
    currentKm: Number(vehicle.currentKm || 0),
    initialRecordedKm: Number(vehicle.initialRecordedKm || vehicle.currentKm || 0),
    ownerUserId: vehicle.ownerUserId || "",
    ownerUserName: vehicle.ownerUserName || "",
    ownerThemeKey: vehicle.ownerThemeKey ?? null,
    currentDriverUserId: vehicle.currentDriverUserId || "",
    currentDriverUserName: vehicle.currentDriverUserName || "",
    currentDriverThemeKey: vehicle.currentDriverThemeKey ?? null,
    pendingDriverUserId: vehicle.pendingDriverUserId,
    pendingDriverUserName: vehicle.pendingDriverUserName,
    pendingDriverThemeKey: vehicle.pendingDriverThemeKey ?? null,
    pendingDriverRequestedAt: vehicle.pendingDriverRequestedAt,
    maintenanceNotes: vehicle.maintenanceNotes || "",
    serviceStrategy: vehicle.serviceStrategy || "interval",
    serviceIntervalKm: Number(vehicle.serviceIntervalKm || 15000),
    nextServiceKm: Number(vehicle.nextServiceKm || 0),
    nextItpDate: vehicle.nextItpDate || "",
    nextRcaDate: vehicle.nextRcaDate || "",
    nextCascoDate: vehicle.nextCascoDate || "",
    nextRovinietaDate: vehicle.nextRovinietaDate || "",
    nextOilServiceKm: Number(vehicle.nextOilServiceKm || 0),
    coverImageUrl: vehicle.coverImageUrl || "",
    coverThumbUrl: vehicle.coverThumbUrl || "",
    images: vehicle.images || [],
    documents: vehicle.documents || [],
  };
}

function toolToFormValues(tool: ToolFormValues & { id?: string }): ToolFormValues {
  return {
    name: tool.name || "",
    internalCode: tool.internalCode || "",
    qrCodeValue: tool.qrCodeValue || "",
    status: tool.status || "depozit",
    coverThumbUrl: tool.coverThumbUrl || "",
    ownerUserId: tool.ownerUserId || "",
    ownerUserName: tool.ownerUserName || "",
    ownerThemeKey: tool.ownerThemeKey ?? null,
    currentHolderUserId: tool.currentHolderUserId || "",
    currentHolderUserName: tool.currentHolderUserName || "",
    currentHolderThemeKey: tool.currentHolderThemeKey ?? null,
    pendingHolderUserId: tool.pendingHolderUserId,
    pendingHolderUserName: tool.pendingHolderUserName,
    pendingHolderThemeKey: tool.pendingHolderThemeKey ?? null,
    pendingHolderRequestedAt: tool.pendingHolderRequestedAt,
    locationType: tool.locationType || "depozit",
    locationLabel: tool.locationLabel || "",
    description: tool.description || "",
    warrantyText: tool.warrantyText || "",
    warrantyUntil: tool.warrantyUntil || "",
    coverImageUrl: tool.coverImageUrl || "",
    imageUrls: tool.imageUrls || [],
    images: tool.images || [],
  };
}

function projectToFormValues(data: Record<string, unknown>): ProjectFormValues {
  return {
    name: String(data.name || ""),
    status: data.status === "inactiv" || data.status === "finalizat" ? data.status : "activ",
  };
}

function userRoleValue(value: unknown): UserRole {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "manager" || normalized === "angajat") return normalized;
  return "angajat";
}

async function resolveUserValue(query: string) {
  const users = await getAllUsers();
  return users
    .map((user) => ({
      user,
      score: scoreAssistantText([user.fullName, user.email, user.roleTitle].filter(Boolean).join(" "), query),
    }))
    .filter((entry) => entry.score >= 0.3)
    .sort((a, b) => b.score - a.score)[0]?.user || null;
}

function compactDataForAudit(data: Record<string, unknown>, changes: AssistantFieldChange[]) {
  const result: Record<string, unknown> = {};
  changes.forEach((change) => {
    result[change.fieldKey] = data[change.fieldKey] ?? null;
  });
  return result;
}

function buildChangeMessage(entityLabel: string, changes: AssistantFieldChange[]) {
  return [
    `Am gasit: ${entityLabel}.`,
    "Vrei sa modific:",
    ...changes.map((change) => `${change.label}: ${change.displayOldValue} -> ${change.displayNewValue}`),
  ].join("\n");
}

async function applyVehicleChanges(entity: AssistantResolvedEntity, changes: AssistantFieldChange[]) {
  const vehicle = await getVehicleById(entity.entityId);
  if (!vehicle) throw new Error("Nu am mai gasit masina pentru actualizare.");
  const nextValues = vehicleToFormValues(vehicle);

  for (const change of changes) {
    if (change.fieldKey === "driver" || change.fieldKey === "owner") {
      const selectedUser = await resolveUserValue(String(change.newValue || ""));
      if (!selectedUser) throw new Error(`Nu am gasit utilizatorul ${change.newValue}.`);
      const selectedName = selectedUser.fullName || selectedUser.email || String(change.newValue);

      if (change.fieldKey === "driver") {
        nextValues.currentDriverUserId = selectedUser.id;
        nextValues.currentDriverUserName = selectedName;
        nextValues.currentDriverThemeKey = selectedUser.themeKey ?? null;
        nextValues.pendingDriverUserId = "";
        nextValues.pendingDriverUserName = "";
        nextValues.pendingDriverThemeKey = null;
        nextValues.pendingDriverRequestedAt = 0;
      } else {
        nextValues.ownerUserId = selectedUser.id;
        nextValues.ownerUserName = selectedName;
        nextValues.ownerThemeKey = selectedUser.themeKey ?? null;
      }
      continue;
    }

    (nextValues as unknown as Record<string, unknown>)[change.fieldKey] = change.newValue;
  }

  if (!nextValues.initialRecordedKm || nextValues.initialRecordedKm > nextValues.currentKm) {
    nextValues.initialRecordedKm = nextValues.currentKm;
  }

  await updateVehicle(entity.entityId, nextValues);
  return {
    result: `Am actualizat masina ${nextValues.plateNumber || entity.label}.`,
    afterData: compactDataForAudit(nextValues as unknown as Record<string, unknown>, changes),
  };
}

async function applyToolChanges(entity: AssistantResolvedEntity, changes: AssistantFieldChange[]) {
  const tool = await getToolById(entity.entityId);
  if (!tool) throw new Error("Nu am mai gasit scula pentru actualizare.");
  const nextValues = toolToFormValues(tool);

  for (const change of changes) {
    if (change.fieldKey === "owner" || change.fieldKey === "holder") {
      const selectedUser = await resolveUserValue(String(change.newValue || ""));
      if (!selectedUser) throw new Error(`Nu am gasit utilizatorul ${change.newValue}.`);
      const selectedName = selectedUser.fullName || selectedUser.email || String(change.newValue);

      if (change.fieldKey === "owner") {
        nextValues.ownerUserId = selectedUser.id;
        nextValues.ownerUserName = selectedName;
        nextValues.ownerThemeKey = selectedUser.themeKey ?? null;
      } else {
        nextValues.currentHolderUserId = selectedUser.id;
        nextValues.currentHolderUserName = selectedName;
        nextValues.currentHolderThemeKey = selectedUser.themeKey ?? null;
        nextValues.locationType = "utilizator";
        nextValues.locationLabel = selectedName;
        nextValues.pendingHolderUserId = "";
        nextValues.pendingHolderUserName = "";
        nextValues.pendingHolderThemeKey = null;
        nextValues.pendingHolderRequestedAt = 0;
      }
      continue;
    }

    (nextValues as unknown as Record<string, unknown>)[change.fieldKey] = change.newValue;
  }

  await updateTool(entity.entityId, nextValues);
  return {
    result: `Am actualizat scula ${nextValues.name || entity.label}.`,
    afterData: compactDataForAudit(nextValues as unknown as Record<string, unknown>, changes),
  };
}

async function applyProjectChanges(entity: AssistantResolvedEntity, changes: AssistantFieldChange[]) {
  const project = await getProjectById(entity.entityId);
  if (!project) throw new Error("Nu am mai gasit proiectul pentru actualizare.");
  const nextValues = projectToFormValues(project as unknown as Record<string, unknown>);

  changes.forEach((change) => {
    (nextValues as unknown as Record<string, unknown>)[change.fieldKey] = change.newValue;
  });

  await updateProject(entity.entityId, nextValues);
  return {
    result: `Am actualizat proiectul ${nextValues.name || entity.label}.`,
    afterData: compactDataForAudit(nextValues as unknown as Record<string, unknown>, changes),
  };
}

async function applyUserChanges(entity: AssistantResolvedEntity, changes: AssistantFieldChange[]) {
  const userData = entity.data as AppUserItem;
  const nextWorkDetails = {
    roleTitle: userData.roleTitle || "",
    department: userData.department || "",
  };
  const nextProfile = {
    fullName: userData.fullName || userData.email || entity.label,
    role: userData.role || "angajat",
    active: typeof userData.active === "boolean" ? userData.active : true,
  };
  let workDetailsChanged = false;
  let profileChanged = false;

  changes.forEach((change) => {
    if (change.fieldKey === "roleTitle" || change.fieldKey === "department") {
      nextWorkDetails[change.fieldKey] = String(change.newValue || "").trim();
      workDetailsChanged = true;
      return;
    }

    if (change.fieldKey === "fullName") {
      nextProfile.fullName = String(change.newValue || "").trim();
      profileChanged = true;
      return;
    }

    if (change.fieldKey === "role") {
      nextProfile.role = userRoleValue(change.newValue);
      profileChanged = true;
    }
  });

  if (workDetailsChanged) {
    await updateUserWorkDetails(entity.entityId, nextWorkDetails);
  }

  if (profileChanged) {
    await updateUserProfile(entity.entityId, nextProfile);
  }

  return {
    result: `Am actualizat utilizatorul ${nextProfile.fullName || entity.label}.`,
    afterData: compactDataForAudit(
      { ...userData, ...nextWorkDetails, ...nextProfile } as unknown as Record<string, unknown>,
      changes
    ),
  };
}

function fieldsObject(parsed: AssistantCommandInterpretation) {
  return parsed.fieldsToUpdate && typeof parsed.fieldsToUpdate === "object" ? parsed.fieldsToUpdate : {};
}

const ASSISTANT_MONTHS: Record<string, number> = {
  ianuarie: 1,
  ian: 1,
  februarie: 2,
  feb: 2,
  martie: 3,
  mar: 3,
  aprilie: 4,
  apr: 4,
  mai: 5,
  iunie: 6,
  iun: 6,
  iulie: 7,
  iul: 7,
  august: 8,
  aug: 8,
  septembrie: 9,
  sept: 9,
  sep: 9,
  octombrie: 10,
  oct: 10,
  noiembrie: 11,
  noi: 11,
  decembrie: 12,
  dec: 12,
};

function stringField(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function toIsoDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function splitLiftNumbers(value: unknown) {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .flatMap((item) => String(item ?? "").split(/[,;/]|\s+si\s+|\s+și\s+/i))
    .map((item) => item.trim().replace(/\s+/g, ""))
    .filter(Boolean);
}

function sanitizeMaintenanceClientNameValue(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const normalized = normalizeAssistantText(text);
  if (
    /\b(pagina|formular|formularul|mentenanta|maintenance|revizie|revizii|lift|liftul|lifturi|email|mail|firma|companie|adresa|telefon|contact)\b/.test(
      normalized
    )
  ) {
    return "";
  }
  if (normalized.split(/\s+/).length > 8) return "";
  return text;
}

function pickMaintenanceClientName(parsed: AssistantCommandInterpretation, fields: Record<string, unknown>) {
  const candidates = [
    stringField(fields, ["name", "nume", "client"]),
    parsed.entityQuery,
    parsed.targetText,
    parsed.spokenSummary,
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeMaintenanceClientNameValue(candidate);
    if (sanitized) return sanitized;
  }
  return "";
}

function normalizeMaintenanceClientFields(parsed: AssistantCommandInterpretation) {
  const fields = fieldsObject(parsed) as Record<string, unknown>;
  const addressParts = [
    stringField(fields, ["address", "adresa"]),
    stringField(fields, ["street", "strada"]),
    stringField(fields, ["city", "oras", "localitate"]),
  ].filter(Boolean);
  const address = Array.from(new Set(addressParts)).join(", ");
  const liftNumbers = [
    ...splitLiftNumbers(fields.liftNumbers),
    ...splitLiftNumbers(fields.liftNumber),
    ...splitLiftNumbers(fields.lift),
    ...splitLiftNumbers(fields.numarLift),
    ...splitLiftNumbers(fields["numar lift"]),
  ];
  const expiryDate = parseAssistantDate(
    stringField(fields, ["expiryDate", "inspectionExpiryDate", "expira", "expiraPe", "dataExpirare", "expDate"])
  );
  const revisionType = stringField(fields, ["revisionType", "tipRevizie", "revizie"]).toUpperCase();

  return {
    name: pickMaintenanceClientName(parsed, fields),
    email: stringField(fields, ["email", "mail"]),
    maintenanceCompany: stringField(fields, ["maintenanceCompany", "firmaMentenanta", "firma", "company"]),
    address,
    city: stringField(fields, ["city", "oras", "localitate"]),
    street: stringField(fields, ["street", "strada"]),
    contactPerson: stringField(fields, ["contactPerson", "persoanaContact", "contact"]),
    contactPhone: stringField(fields, ["contactPhone", "telefon", "phone"]),
    liftNumbers: Array.from(new Set(liftNumbers)),
    expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ? expiryDate : "",
    revisionType: revisionType === "R1" || revisionType === "R2" ? revisionType : "R2",
  };
}

function monthRangeFromLastFullWeek(text: string, year: number) {
  const normalized = normalizeAssistantText(text);
  const match = normalized.match(/ultima\s+saptamana\s+(?:din|de|in)?\s*([a-z]+)/);
  const month = match ? ASSISTANT_MONTHS[match[1]] : 0;
  if (!month) return null;

  const end = new Date(year, month, 0);
  while (end.getDay() !== 0) {
    end.setDate(end.getDate() - 1);
  }
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { startDate: toIsoDateValue(start), endDate: toIsoDateValue(end) };
}

function monthRangeFromSpokenDays(text: string, year: number) {
  const normalized = normalizeAssistantText(text);
  const match = normalized.match(
    /(?:intre|din)?\s*(\d{1,2})(?:\s+[a-z]+)?\s+(?:si|pana\s+pe|pana\s+la|pana|[-])\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/
  );
  if (!match) return null;

  const month = ASSISTANT_MONTHS[match[3]];
  if (!month) return null;
  const resolvedYear = match[4] ? Number(match[4].length === 2 ? `20${match[4]}` : match[4]) : year;
  return {
    startDate: toIsoDateValue(new Date(resolvedYear, month - 1, Number(match[1]))),
    endDate: toIsoDateValue(new Date(resolvedYear, month - 1, Number(match[2]))),
  };
}

function normalizeLeaveFields(parsed: AssistantCommandInterpretation) {
  const fields = fieldsObject(parsed) as Record<string, unknown>;
  const currentYear = new Date().getFullYear();
  const sourceText = [
    parsed.targetText,
    parsed.entityQuery,
    parsed.spokenSummary,
    stringField(fields, ["period", "perioada", "text", "range"]),
  ].filter(Boolean).join(" ");
  const inferredRange =
    monthRangeFromLastFullWeek(sourceText, currentYear) || monthRangeFromSpokenDays(sourceText, currentYear);
  const startDate = parseAssistantDate(
    stringField(fields, ["startDate", "periodStart", "dataInceput", "inceput"]) || parsed.startDate || inferredRange?.startDate || ""
  );
  const endDate = parseAssistantDate(
    stringField(fields, ["endDate", "periodEnd", "dataSfarsit", "sfarsit"]) || parsed.endDate || inferredRange?.endDate || startDate
  );

  return {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : "",
    endDate: /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : "",
    reason: stringField(fields, ["reason", "motiv", "observatii"]),
    requestType: stringField(fields, ["requestType", "tip", "tipSolicitare"]) || "concediu_odihna",
  };
}

function buildMaintenanceClientFormMessage(fields: ReturnType<typeof normalizeMaintenanceClientFields>) {
  return [
    "Am completat formularul cu:",
    fields.name ? `Client: ${fields.name}` : "",
    fields.liftNumbers.length ? `Lift: ${fields.liftNumbers.join(", ")}` : "",
    fields.maintenanceCompany ? `Firma mentenanta: ${fields.maintenanceCompany}` : "",
    fields.email ? `Email: ${fields.email}` : "",
    fields.contactPerson ? `Contact: ${fields.contactPerson}` : "",
    fields.contactPhone ? `Telefon: ${fields.contactPhone}` : "",
    fields.address ? `Adresa: ${fields.address}` : "",
    "Verifica datele si apasa Salveaza client.",
  ].filter(Boolean).join("\n");
}

function buildLeaveFormMessage(fields: ReturnType<typeof normalizeLeaveFields>) {
  return [
    "Am completat concediul:",
    fields.startDate && fields.endDate ? `${fields.startDate} - ${fields.endDate}.` : "Verifica perioada in formular.",
    fields.reason ? `Motiv: ${fields.reason}` : "",
    "Verifica semnatura, apoi apasa Trimite cererea.",
  ].filter(Boolean).join("\n");
}

export async function buildAssistantRuntimePlan(
  parsed: AssistantCommandInterpretation,
  context: AssistantRuntimeContext
): Promise<AssistantRuntimePlan | null> {
  const fieldsToUpdate = fieldsObject(parsed);
  const entityType = parsed.entityType === "vehicle" || parsed.entityType === "tool" || parsed.entityType === "project" || parsed.entityType === "user"
    ? parsed.entityType
    : "none";

  if (parsed.intent === "create_maintenance_client" || parsed.intent === "fill_maintenance_client_form") {
    const formFields = normalizeMaintenanceClientFields(parsed);
    const missingFields = (parsed.missingFields || []).filter((field) => {
      const normalized = normalizeAssistantText(field);
      if (formFields.name && ["name", "nume", "client"].includes(normalized)) return false;
      if (formFields.liftNumbers.length && ["lift", "liftnumber", "numar lift", "numarlift"].includes(normalized)) return false;
      return true;
    });
    if (!formFields.name) missingFields.push("name");
    if (formFields.liftNumbers.length === 0) missingFields.push("liftNumber");
    const targetPage = parsed.targetPage || "/maintenance?tab=clients&assistant=client";
    const message = missingFields.length
      ? `Lipsesc date pentru clientul de mentenanta: ${Array.from(new Set(missingFields)).join(", ")}.`
      : buildMaintenanceClientFormMessage(formFields);

    return {
      intent: parsed.intent,
      entityType: "maintenanceClient",
      parsedIntent: { ...parsed, targetPage, missingFields: Array.from(new Set(missingFields)) },
      fieldsToUpdate: formFields,
      changes: [],
      afterData: formFields,
      risk: "medium",
      confidence: parsed.confidence || 0.82,
      needsConfirmation: false,
      spokenSummary: missingFields.length ? message : `Completez clientul ${formFields.name} in mentenanta.`,
      status: missingFields.length ? "needs_clarification" : "ready",
      message,
      run: missingFields.length
        ? undefined
        : async () => {
            await fillMaintenanceClientForm(formFields);
            return { result: buildMaintenanceClientFormMessage(formFields), afterData: formFields };
          },
    };
  }

  if (parsed.intent === "schedule_leave" || parsed.intent === "fill_leave_form") {
    const formFields = normalizeLeaveFields(parsed);
    const missingFields = (parsed.missingFields || []).filter((field) => {
      const normalized = normalizeAssistantText(field);
      if (formFields.startDate && ["startdate", "periodstart", "datainceput", "inceput"].includes(normalized)) return false;
      if (formFields.endDate && ["enddate", "periodend", "datasfarsit", "sfarsit"].includes(normalized)) return false;
      return true;
    });
    if (!formFields.startDate) missingFields.push("startDate");
    if (!formFields.endDate) missingFields.push("endDate");
    const targetPage = parsed.targetPage || "/my-leave?assistant=leave#leave-form";
    const message = missingFields.length
      ? `Lipsesc date pentru concediu: ${Array.from(new Set(missingFields)).join(", ")}.`
      : buildLeaveFormMessage(formFields);

    return {
      intent: parsed.intent,
      entityType: "currentPage",
      parsedIntent: { ...parsed, targetPage, missingFields: Array.from(new Set(missingFields)) },
      fieldsToUpdate: formFields,
      changes: [],
      afterData: formFields,
      risk: "medium",
      confidence: parsed.confidence || 0.82,
      needsConfirmation: false,
      spokenSummary: missingFields.length ? message : "Completez formularul de concediu.",
      status: missingFields.length ? "needs_clarification" : "ready",
      message,
      run: missingFields.length
        ? undefined
        : async () => {
            await fillLeaveForm(formFields);
            return { result: buildLeaveFormMessage(formFields), afterData: formFields };
          },
    };
  }

  if (parsed.intent === "fill_current_page" || parsed.intent === "update_current_page_field") {
    const targetPage = parsed.targetPage || parsed.pageHint || "";
    return {
      intent: parsed.intent,
      entityType: "currentPage",
      parsedIntent: { ...parsed, targetPage },
      fieldsToUpdate,
      changes: [],
      risk: parsed.risk || "medium",
      confidence: parsed.confidence || 0.76,
      needsConfirmation: parsed.needsConfirmation !== false,
      spokenSummary: parsed.spokenSummary || "Completez campurile cerute pe pagina curenta.",
      status: Object.keys(fieldsToUpdate).length ? "ready" : "needs_clarification",
      message: Object.keys(fieldsToUpdate).length
        ? "Completez campurile cerute pe pagina curenta. Confirmi?"
        : "Spune ce camp si ce valoare trebuie completate.",
      run: Object.keys(fieldsToUpdate).length
        ? async () => {
            await fillCurrentPageFields(fieldsToUpdate);
            return { result: "Am trimis datele catre formularul curent.", afterData: fieldsToUpdate };
          }
        : undefined,
    };
  }

  if (parsed.intent === "create_project") {
    const projectName = parsed.entityQuery || parsed.targetText || String(fieldsToUpdate.name || "");
    if (!projectName.trim()) {
      return {
        intent: parsed.intent,
        entityType: "project",
        parsedIntent: parsed,
        fieldsToUpdate,
        changes: [],
        risk: "medium",
        confidence: parsed.confidence,
        needsConfirmation: true,
        spokenSummary: parsed.spokenSummary,
        status: "needs_clarification",
        message: "Spune numele proiectului.",
      };
    }
    return {
      intent: parsed.intent,
      entityType: "project",
      parsedIntent: parsed,
      fieldsToUpdate: { name: projectName, status: "activ" },
      changes: [],
      risk: "medium",
      confidence: parsed.confidence,
      needsConfirmation: true,
      spokenSummary: parsed.spokenSummary || `Creez proiectul ${projectName}.`,
      status: "ready",
      message: `Creez proiectul ${projectName}. Confirmi?`,
      run: async () => {
        await createProject({ name: projectName, status: "activ" });
        return { result: `Am creat proiectul ${projectName}.`, afterData: { name: projectName, status: "activ" } };
      },
    };
  }

  if (!["update_vehicle", "update_tool", "update_project", "update_user"].includes(parsed.intent) || entityType === "none") {
    return null;
  }

  const resolution = await resolveAssistantEntity(entityType, parsed.entityQuery || parsed.targetText || "", context);
  if (resolution.status !== "resolved" || !resolution.entity) {
    return {
      intent: parsed.intent,
      entityType,
      parsedIntent: parsed,
      options: resolution.options,
      fieldsToUpdate,
      changes: [],
      risk: parsed.risk || "medium",
      confidence: parsed.confidence,
      needsConfirmation: false,
      spokenSummary: parsed.spokenSummary,
      status: "needs_clarification",
      message: resolution.message || "Nu am gasit entitatea ceruta.",
    };
  }

  const currentData = resolution.entity.data as Record<string, unknown>;
  const fieldResolution = resolveAssistantFieldChanges(entityType, fieldsToUpdate, currentData);
  const changes = fieldResolution.changes;
  const basePlan: AssistantRuntimePlan = {
    intent: parsed.intent,
    entityType,
    parsedIntent: { ...parsed, missingFields: [...parsed.missingFields, ...fieldResolution.missingFields] },
    resolvedEntity: resolution.entity,
    fieldsToUpdate,
    changes,
    beforeData: compactDataForAudit(currentData, changes),
    risk: parsed.risk || "medium",
    confidence: parsed.confidence,
    needsConfirmation: parsed.needsConfirmation !== false,
    spokenSummary: parsed.spokenSummary || buildChangeMessage(resolution.entity.label, changes),
    status: "ready",
    message: buildChangeMessage(resolution.entity.label, changes),
  };

  const validation = validateAssistantPlan(basePlan, {
    intent: parsed.intent,
    user: context.user,
    entity: resolution.entity,
  });

  if (!validation.ok) {
    return {
      ...basePlan,
      status: "needs_clarification",
      message: validation.message || "Comanda are nevoie de clarificare.",
      needsConfirmation: false,
    };
  }

  const readyPlan = {
    ...basePlan,
    risk: validation.risk || basePlan.risk,
    needsConfirmation: validation.needsConfirmation ?? basePlan.needsConfirmation,
  };

  if (entityType === "vehicle") {
    readyPlan.run = () => applyVehicleChanges(resolution.entity!, changes);
  }
  if (entityType === "tool") {
    readyPlan.run = () => applyToolChanges(resolution.entity!, changes);
  }
  if (entityType === "project") {
    readyPlan.run = () => applyProjectChanges(resolution.entity!, changes);
  }
  if (entityType === "user") {
    readyPlan.run = () => applyUserChanges(resolution.entity!, changes);
  }

  return readyPlan;
}
