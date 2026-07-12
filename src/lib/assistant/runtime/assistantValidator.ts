import type { AssistantRuntimePlan, AssistantValidationResult } from "./assistantTypes";
import { checkAssistantPermission } from "./assistantPermissions";

const VALID_VEHICLE_STATUSES = new Set(["activa", "in_service", "indisponibila", "avariata"]);
const VALID_TOOL_STATUSES = new Set(["depozit", "atribuita", "defecta", "pierduta"]);
const VALID_PROJECT_STATUSES = new Set(["activ", "inactiv", "finalizat"]);
export const ASSISTANT_SAFE_CONFIDENCE_THRESHOLD = 0.85;

function isDateField(fieldKey: string) {
  return /date|Until/i.test(fieldKey);
}

function validIsoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateAssistantPlan(
  plan: AssistantRuntimePlan,
  roleContext: Parameters<typeof checkAssistantPermission>[0]
): AssistantValidationResult {
  const missingFields = [...(plan.parsedIntent.missingFields || [])];

  if (plan.confidence < ASSISTANT_SAFE_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      message:
        "Nu sunt destul de sigur ce trebuie sa fac. Confirmarea minima este 85%, deci mai bine intreab decat sa modific gresit.",
      missingFields,
    };
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      message: `Lipsesc date pentru executie: ${missingFields.join(", ")}.`,
      missingFields,
    };
  }

  if (plan.changes.length === 0 && plan.intent.startsWith("update_")) {
    return {
      ok: false,
      message: "Nu am gasit campuri valide de modificat.",
      missingFields: ["fieldsToUpdate"],
    };
  }

  for (const change of plan.changes) {
    if (
      plan.entityType === "user" &&
      change.fieldKey === "role" &&
      roleContext.user?.role !== "admin"
    ) {
      return { ok: false, message: "Doar administratorul poate modifica rolul aplicatiei." };
    }
    if (
      plan.entityType === "vehicle" &&
      change.fieldKey === "currentKm" &&
      Number(change.newValue) < 0
    ) {
      return { ok: false, message: "Km curenti trebuie sa fie un numar pozitiv." };
    }
    if (
      plan.entityType === "vehicle" &&
      change.fieldKey === "status" &&
      !VALID_VEHICLE_STATUSES.has(String(change.newValue))
    ) {
      return { ok: false, message: "Statusul masinii nu este valid." };
    }
    if (
      plan.entityType === "tool" &&
      change.fieldKey === "status" &&
      !VALID_TOOL_STATUSES.has(String(change.newValue))
    ) {
      return { ok: false, message: "Statusul sculei nu este valid." };
    }
    if (
      plan.entityType === "project" &&
      change.fieldKey === "status" &&
      !VALID_PROJECT_STATUSES.has(String(change.newValue))
    ) {
      return { ok: false, message: "Statusul proiectului nu este valid." };
    }
    if (isDateField(change.fieldKey) && !validIsoDate(change.newValue)) {
      return {
        ok: false,
        message: `Data pentru ${change.label} trebuie sa fie in format YYYY-MM-DD.`,
      };
    }
  }

  const permission = checkAssistantPermission(roleContext);
  if (!permission.ok) {
    return { ok: false, message: permission.message };
  }

  const needsSpecialConfirmation = plan.changes.some(
    (change) => change.requiresSpecialConfirmation
  );
  return {
    ok: true,
    risk: needsSpecialConfirmation ? "high" : plan.risk,
    needsConfirmation: needsSpecialConfirmation || plan.needsConfirmation,
  };
}
