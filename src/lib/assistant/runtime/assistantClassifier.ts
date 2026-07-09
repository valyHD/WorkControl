import { normalizeAssistantText } from "./assistantFuzzy";

export type AssistantCommandType =
  | "navigation"
  | "form_fill"
  | "entity_update"
  | "create_entity"
  | "timesheet_action"
  | "question"
  | "unknown";

export type AssistantCommandClassification = {
  type: AssistantCommandType;
  confidence: number;
  reason: string;
};

const NAVIGATION_VERBS = [
  "du te",
  "dute",
  "du ma",
  "duma",
  "deschide",
  "arata",
  "afiseaza",
  "mergi",
  "intra",
  "navigheaza",
  "pagina",
  "vezi",
];

const PAGE_TERMS = [
  "dashboard",
  "concedii",
  "concediu",
  "mentenanta",
  "pontaje",
  "pontaj",
  "masini",
  "masina mea",
  "vehicule",
  "scule",
  "bonuri",
  "facturi",
  "profil",
  "utilizatori",
  "notificari",
  "gps",
  "harta",
];

const CREATE_TERMS = ["adauga", "creeaza", "creaza", "client nou", "masina noua", "scula noua", "proiect nou"];
const UPDATE_TERMS = ["schimba", "modifica", "seteaza", "pune", "actualizeaza", "editeaza", "corecteaza"];
const FORM_TERMS = ["completeaza", "programeaza", "formular", "cerere"];
const TIMESHEET_TERMS = ["pontaj", "pontaaj", "start pontaj", "opreste pontaj", "porneste pontaj"];
const QUESTION_TERMS = ["ce poti", "ce stii", "ajutor", "cum pot", "lista comenzi", "scenariu"];

function includesAnyNormalized(value: string, terms: string[]) {
  return terms.some((term) => value.includes(normalizeAssistantText(term)));
}

function hasVehicleEntity(value: string) {
  return includesAnyNormalized(value, ["masina", "vehicul", "duba", "inmatriculare", "itp", "rca", "kilometri", "kilometraj", "km"]);
}

function hasManagedEntity(value: string) {
  return (
    hasVehicleEntity(value) ||
    includesAnyNormalized(value, ["scula", "unealta", "proiect", "utilizator", "user", "client", "mentenanta"])
  );
}

export function hasAssistantNavigationSafetyIntent(command: string) {
  const normalized = normalizeAssistantText(command);
  if (!normalized) return false;
  return includesAnyNormalized(normalized, NAVIGATION_VERBS) || includesAnyNormalized(normalized, PAGE_TERMS);
}

export function classifyAssistantCommand(command: string): AssistantCommandClassification {
  const normalized = normalizeAssistantText(command);
  if (!normalized) {
    return { type: "unknown", confidence: 0, reason: "Comanda goala." };
  }

  if (includesAnyNormalized(normalized, QUESTION_TERMS) || /\?$/.test(command.trim())) {
    return { type: "question", confidence: 0.82, reason: "Comanda cere informatii sau ajutor." };
  }

  if (includesAnyNormalized(normalized, TIMESHEET_TERMS) && /\b(porn|start|opresc|opreste|stop|inchid|inchei|termin)\w*/.test(normalized)) {
    return { type: "timesheet_action", confidence: 0.88, reason: "Comanda controleaza pontajul." };
  }

  if (
    includesAnyNormalized(normalized, CREATE_TERMS) &&
    (hasManagedEntity(normalized) || includesAnyNormalized(normalized, ["concediu", "cerere"]))
  ) {
    return { type: "create_entity", confidence: 0.86, reason: "Comanda creeaza o inregistrare sau un formular nou." };
  }

  if (
    includesAnyNormalized(normalized, FORM_TERMS) &&
    (includesAnyNormalized(normalized, ["concediu", "zi libera", "client", "mentenanta", "bon"]) || /\b\d{1,2}\b/.test(normalized))
  ) {
    return { type: "form_fill", confidence: 0.84, reason: "Comanda completeaza un formular explicit." };
  }

  if (includesAnyNormalized(normalized, UPDATE_TERMS) && hasManagedEntity(normalized)) {
    return { type: "entity_update", confidence: 0.85, reason: "Comanda modifica o entitate existenta prin servicii." };
  }

  const hasNavigationVerb = includesAnyNormalized(normalized, NAVIGATION_VERBS);
  const hasPageTerm = includesAnyNormalized(normalized, PAGE_TERMS);
  if (hasNavigationVerb || (hasPageTerm && !includesAnyNormalized(normalized, UPDATE_TERMS))) {
    return { type: "navigation", confidence: hasNavigationVerb ? 0.9 : 0.74, reason: "Comanda cere navigare sau afisarea unei pagini." };
  }

  return { type: "unknown", confidence: 0.35, reason: "Nu exista un tip sigur de actiune." };
}

export const ASSISTANT_PAGE_FIELD_ALLOWLIST: Array<{ pattern: RegExp; fields: string[] }> = [
  {
    pattern: /^\/vehicles\/[^/]+\/edit$/,
    fields: ["plateNumber", "brand", "model", "currentKm", "nextItpDate", "nextRcaDate", "status"],
  },
  {
    pattern: /^\/my-leave$/,
    fields: ["startDate", "periodStart", "endDate", "periodEnd", "reason", "requestType"],
  },
  {
    pattern: /^\/maintenance$/,
    fields: ["clientName", "name", "email", "address", "liftNumber", "liftNumbers", "maintenanceCompany", "contactPerson", "contactPhone"],
  },
];

export function isAssistantFieldAllowedForPage(pathname: string, fieldName: string) {
  const normalizedField = normalizeAssistantText(fieldName);
  const allowlist = ASSISTANT_PAGE_FIELD_ALLOWLIST.find((entry) => entry.pattern.test(pathname));
  if (!allowlist) return false;
  return allowlist.fields.some((field) => normalizeAssistantText(field) === normalizedField);
}
