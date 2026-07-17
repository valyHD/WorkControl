import type { AssistantCommandContext, AssistantCommandIntent } from "../assistantCommandService";
import {
  getAssistantFormSchemaForPage,
  type AssistantFormFieldSchema,
  type AssistantFormSchema,
} from "../runtime/assistantFormSchemas";
import { normalizeAssistantText } from "../runtime/assistantFuzzy";
import type { AssistantV3Contract, AssistantV3PageContext } from "./assistantV3Types";
import { normalizeAssistantCommandText } from "./assistantCommandText";

export type AssistantHumanAction =
  | "navigate"
  | "read"
  | "update"
  | "create"
  | "start"
  | "stop"
  | "send"
  | "prepare"
  | "question"
  | "unknown";

export type AssistantHumanLanguageHints = {
  action: AssistantHumanAction;
  actionSequence: AssistantHumanAction[];
  modules: string[];
  usesCurrentContext: boolean;
  hasMultipleSteps: boolean;
  isMutation: boolean;
  fieldWords: string[];
  clauses: string[];
  contextReferences: string[];
  possibleEntityTypes: string[];
  isContinuation: boolean;
  hasPreviousCommand: boolean;
  previousAction?: AssistantHumanAction;
  previousModules: string[];
  previousIntent?: string;
  previousToolId?: string;
  previousEntityType?: string;
  previousEntityQuery?: string;
  previousFieldKeys: string[];
  forbidsMutation: boolean;
};

const MODULE_TERMS: Record<string, string[]> = {
  vehicles: [
    "masina",
    "masini",
    "vehicul",
    "auto",
    "duba",
    "flota",
    "gps",
    "tracker",
    "harta",
    "itp",
    "rca",
    "casco",
    "rovinieta",
    "kilometri",
    "km",
    "bord",
    "odometru",
    "sofer",
  ],
  tools: [
    "scula",
    "scule",
    "unealta",
    "unelte",
    "echipament",
    "inventar",
    "flex",
    "bormasina",
    "hilti",
    "bosch",
    "qr",
    "detinator",
  ],
  timesheets: [
    "pontaj",
    "pontaje",
    "proiect",
    "proiecte",
    "lucrare",
    "santier",
    "ore lucrate",
    "program de lucru",
    "cronometru",
  ],
  leave: ["concediu", "cerere concediu", "zile libere", "vacanta", "liber", "medical"],
  maintenance: [
    "mentenanta",
    "service lifturi",
    "revizie",
    "interventie",
    "lift",
    "ascensor",
    "client",
    "piese",
    "raport tehnic",
  ],
  expenses: [
    "bon",
    "bonul",
    "bonuri",
    "factura",
    "facturi",
    "cheltuiala",
    "cheltuieli",
    "ocr",
    "decont",
    "document fiscal",
  ],
  users: [
    "utilizator",
    "user",
    "angajat",
    "coleg",
    "salariat",
    "om",
    "oameni",
    "personal",
    "profil",
    "functie",
    "departament",
    "rol",
    "drepturi",
  ],
  notifications: [
    "notificare",
    "notificari",
    "alerta",
    "mesaj",
    "regula",
    "reminder",
    "avertizare",
  ],
  settings: [
    "setare",
    "setari",
    "preferinta",
    "tema",
    "culoare",
    "interfata",
    "font",
    "animatii",
    "contrast",
    "densitate",
  ],
};

const FIELD_WORDS = [
  "nume",
  "email",
  "telefon",
  "adresa",
  "status",
  "stare",
  "functie",
  "departament",
  "rol",
  "kilometri",
  "km",
  "itp",
  "rca",
  "casco",
  "rovinieta",
  "sofer",
  "responsabil",
  "locatie",
  "observatii",
  "motiv",
  "proiect",
  "firma",
  "companie",
  "categorie",
  "detinator",
  "garantie",
  "cod",
  "data inceput",
  "data sfarsit",
];

const CONTEXT_REFERENCE_TERMS = [
  "asta",
  "acesta",
  "aceasta",
  "ala",
  "aia",
  "acolo",
  "aici",
  "al meu",
  "a mea",
  "pe el",
  "pe ea",
  "cel",
  "cea",
  "respectiv",
  "respectiva",
  "la fel",
  "tot acolo",
  "aceeasi",
  "acelasi",
  "curent",
  "curenta",
  "de aici",
  "din pagina asta",
  "pe cel selectat",
  "pe cea selectata",
  "ultimul",
  "ultima",
];

const ENTITY_TYPE_BY_MODULE: Record<string, string> = {
  vehicles: "vehicle",
  tools: "tool",
  timesheets: "project",
  maintenance: "maintenanceClient",
  users: "user",
  leave: "leaveRequest",
  expenses: "expense",
  notifications: "notificationRule",
  settings: "siteSettings",
};

function includesTerm(text: string, term: string) {
  const normalizedTerm = normalizeAssistantText(term);
  if (` ${text} `.includes(` ${normalizedTerm} `)) return true;
  if (normalizedTerm.length < 4) return false;
  return text
    .split(" ")
    .some((token) => token.startsWith(normalizedTerm) || normalizedTerm.startsWith(token));
}

function inferHumanAction(normalized: string): AssistantHumanAction {
  return /\b(?:opreste|stop|inchide|termina|dezactiveaza|anuleaza)\b/.test(normalized)
    ? "stop"
    : /\b(?:porneste|start|incepe|da drumul|activeaza|continua)\b/.test(normalized)
      ? "start"
      : /\b(?:trimite|expediaza|transmite|da send)\b/.test(normalized)
        ? "send"
        : /\b(?:pregateste|completeaza|draft|asteapta|precompleteaza)\b/.test(normalized)
          ? "prepare"
          : /\b(?:creeaza|adauga|genereaza|inregistreaza|fa un|fa o)\b/.test(normalized)
            ? "create"
            : /\b(?:modifica|schimba|seteaza|actualizeaza|corecteaza|pune|trece|marcheaza|muta|baga|fa sa fie|lasa|redenumeste|atribuie|asigneaza)\b/.test(
                  normalized
                )
              ? "update"
              : /\b(?:deschide|arata|mergi|intra|du ma|vreau sa vad|acceseaza|navigheaza)\b/.test(
                    normalized
                  )
                ? "navigate"
                : /\b(?:cat|cate|care|ce|unde|cand|cum|spune\s*-?\s*mi|zi\s*-?\s*mi)\b/.test(
                      normalized
                    )
                  ? "question"
                  : /\b(?:vad|vezi|afiseaza|citeste)\b/.test(normalized)
                    ? "read"
                    : "unknown";
}

function splitHumanClauses(normalized: string) {
  return normalized
    .split(
      /[;.!?]+|\b(?:si\s+apoi|iar\s+apoi|dupa\s+aia|dupa\s+aceea|dupa\s+care|pe\s+urma|iar\s+dupa|si\s+dupa)\b|\b(?:si|iar)\s+(?=(?:deschide|arata|mergi|intra|du\s+ma|modifica|schimba|pune|seteaza|actualizeaza|creeaza|adauga|porneste|opreste|trimite|genereaza|spune|afiseaza)\b)/g
    )
    .map((clause) => clause.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function analyzeAssistantHumanLanguage(command: string): AssistantHumanLanguageHints {
  const normalized = normalizeAssistantCommandText(command).toLocaleLowerCase("ro-RO");
  const forbidsMutation =
    /\b(?:nu|fara\s+sa)\s+(?:modifica|schimba|completa|salva|trimite|sterge|porni|opreste)\s+(?:nimic|ceva|datele?)\b/.test(
      normalized
    );
  const actionText = normalized.replace(
    /\b(?:si\s+)?(?:nu|fara\s+sa)\s+(?:modifica|schimba|completa|salva|trimite|sterge|porni|opreste)\s+(?:nimic|ceva|datele?)\b/g,
    " "
  );
  const action = inferHumanAction(actionText);
  const clauses = splitHumanClauses(normalized);
  const actionSequence = clauses
    .map((clause) =>
      inferHumanAction(
        clause.replace(
          /\b(?:nu|fara\s+sa)\s+(?:modifica|schimba|completa|salva|trimite|sterge|porni|opreste)\s+(?:nimic|ceva|datele?)\b/g,
          " "
        )
      )
    )
    .filter((item) => item !== "unknown");

  const modules = Object.entries(MODULE_TERMS)
    .filter(([, terms]) => terms.some((term) => includesTerm(normalized, term)))
    .map(([module]) => module);
  const fieldWords = FIELD_WORDS.filter((field) => includesTerm(normalized, field));
  const contextReferences = CONTEXT_REFERENCE_TERMS.filter((term) =>
    includesTerm(normalized, term)
  );
  const usesCurrentContext =
    contextReferences.length > 0 ||
    /\b(?:lui|ei|lor|si\s+(?:pe|la)\s+(?:el|ea)|mai\s+pune|mai\s+schimba|schimba\s+i|pune\s+i)\b/.test(
      normalized
    );
  const hasMultipleSteps = clauses.length > 1 || actionSequence.length > 1;
  const isContinuation =
    /^(?:si|iar|mai|tot|acum|atunci|inca)\b/.test(normalized) || usesCurrentContext;
  const possibleEntityTypes = Array.from(
    new Set(modules.map((module) => ENTITY_TYPE_BY_MODULE[module]).filter(Boolean))
  );

  return {
    action,
    actionSequence,
    modules,
    usesCurrentContext,
    hasMultipleSteps,
    isMutation: ["update", "create", "start", "stop", "send", "prepare"].includes(action),
    fieldWords,
    clauses,
    contextReferences,
    possibleEntityTypes,
    isContinuation,
    hasPreviousCommand: false,
    previousModules: [],
    previousFieldKeys: [],
    forbidsMutation,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldAliases(field: AssistantFormFieldSchema) {
  return Array.from(new Set([field.key, field.label, ...field.aliases].map(normalizeAssistantText)))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function locateFormFields(schema: AssistantFormSchema, command: string) {
  const candidates: Array<{ field: AssistantFormFieldSchema; start: number; end: number }> = [];
  schema.fields.forEach((field) => {
    for (const alias of fieldAliases(field)) {
      const match = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?=\\s|$)`, "i").exec(command);
      if (!match) continue;
      const leadingSpace = match[0].startsWith(" ") ? 1 : 0;
      candidates.push({
        field,
        start: match.index + leadingSpace,
        end: match.index + match[0].length,
      });
      break;
    }
  });

  return candidates
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((candidate, index, all) => index === 0 || candidate.start >= all[index - 1].end);
}

function cleanFormValue(value: string) {
  return value
    .replace(/^\s*(?::|-|=)?\s*(?:sa\s+fie|este|cu|la|in|pe|drept|ca)?\s*/i, "")
    .replace(/\s+(?:si\s+apoi|apoi|dupa\s+aia|dupa\s+aceea)\s*$/i, "")
    .replace(/[,.]+$/g, "")
    .trim();
}

function normalizeFormValue(field: AssistantFormFieldSchema, value: string) {
  if (field.kind === "number") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (field.kind === "boolean") {
    const normalized = normalizeAssistantText(value);
    if (/\b(?:nu|inactiv|oprit|dezactivat)\b/.test(normalized)) return false;
    if (/\b(?:da|activ|pornit|activat)\b/.test(normalized)) return true;
  }
  return value;
}

const FORM_TOOL_BY_SCHEMA: Record<
  string,
  {
    toolId: string;
    intent: AssistantCommandIntent;
    entityType: AssistantV3Contract["entityReferences"][number]["type"];
  }
> = {
  "maintenance-client": {
    toolId: "maintenance.draft",
    intent: "fill_maintenance_client_form",
    entityType: "maintenanceClient",
  },
  "leave-request": { toolId: "leave.draft", intent: "fill_leave_form", entityType: "none" },
  vehicle: { toolId: "vehicles.draft", intent: "create_vehicle", entityType: "vehicle" },
  tool: { toolId: "tools.draft", intent: "create_tool", entityType: "tool" },
  user: { toolId: "users.draft", intent: "fill_current_page", entityType: "user" },
  project: {
    toolId: "timesheets.projects.draft",
    intent: "create_project",
    entityType: "project",
  },
  expense: { toolId: "expenses.draft", intent: "fill_current_page", entityType: "none" },
};

function contextPath(context?: AssistantCommandContext) {
  const route = context?.route || context?.currentPathname || "";
  return route.split(/[?#]/)[0] || "";
}

/** Completes only the React form exposed by the current page schema; it never saves it. */
export function buildLocalContextualFormContract(
  command: string,
  context?: AssistantCommandContext
): AssistantV3Contract | null {
  const pathname = contextPath(context);
  if (!pathname) return null;
  const schema = getAssistantFormSchemaForPage(pathname);
  const tool = schema ? FORM_TOOL_BY_SCHEMA[schema.id] : null;
  if (!schema || !tool) return null;

  const normalized = normalizeAssistantCommandText(command).toLocaleLowerCase("ro-RO");
  const requestsFormChange =
    /\b(?:completeaza|scrie|pune|seteaza|trece|adauga|baga|modifica|schimba|fa sa fie|lasa)\b/.test(
      normalized
    );
  if (!requestsFormChange) return null;

  const matches = locateFormFields(schema, normalized);
  if (matches.length === 0) return null;
  const fields: Record<string, string | number | boolean> = {};
  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const value = cleanFormValue(normalized.slice(match.end, next?.start ?? normalized.length));
    if (value) fields[match.field.key] = normalizeFormValue(match.field, value);
  });
  if (Object.keys(fields).length === 0) return null;

  return {
    version: "3",
    commandType: "form_fill",
    intent: tool.intent,
    toolCalls: [{ id: tool.toolId, input: { fields } }],
    targetPage: pathname,
    entityReferences: [],
    missingInformation: [],
    confidence: 0.94,
    confirmationRequired: false,
    response: `Completez ${Object.keys(fields).length === 1 ? "campul cerut" : "campurile cerute"} in ${schema.title}. Verifica apoi datele.`,
  };
}

function safePreviousPage(value: string) {
  const path = value.trim();
  return path.startsWith("/") && !path.startsWith("//") && !/[\r\n]/.test(path) ? path : "";
}

/** Returns to the previous known WorkControl page without replaying any previous write. */
export function buildLocalContextualNavigationContract(
  command: string,
  context?: AssistantCommandContext
): AssistantV3Contract | null {
  const normalized = normalizeAssistantCommandText(command).toLocaleLowerCase("ro-RO");
  const requestsPreviousPage =
    /\b(?:revino|intoarce\s+ma|du\s+ma\s+inapoi|mergi\s+inapoi|deschide)\b.*\b(?:unde\s+(?:am\s+ramas|eram)|pagina\s+(?:anterioara|de\s+mai\s+devreme)|inapoi|acolo)\b/.test(
      normalized
    ) || /^(?:inapoi|tot\s+acolo|unde\s+am\s+ramas)$/.test(normalized);
  if (!requestsPreviousPage) return null;

  const current = contextPath(context);
  const memory = context?.memory as
    (AssistantCommandContext["memory"] & { previousPage?: string }) | undefined;
  const target = safePreviousPage(memory?.previousPage || memory?.lastPage || "");
  if (!target || target.split(/[?#]/)[0] === current) return null;

  return {
    version: "3",
    commandType: "navigation",
    intent: "open_page",
    toolCalls: [{ id: "navigation.open", input: { path: target, query: "" } }],
    targetPage: target,
    entityReferences: [],
    missingInformation: [],
    confidence: 0.99,
    confirmationRequired: false,
    response: "Revin la pagina anterioara.",
  };
}

export function buildAssistantLanguageHints(
  command: string,
  context?: AssistantCommandContext
): AssistantHumanLanguageHints {
  const hints = analyzeAssistantHumanLanguage(command);
  const previousCommand = context?.memory?.lastCommand?.trim() || "";
  const previous = previousCommand ? analyzeAssistantHumanLanguage(previousCommand) : null;
  const completed = context?.memory?.lastCompletedAction;
  return {
    ...hints,
    hasPreviousCommand: Boolean(previous),
    previousAction: previous?.action,
    previousModules: previous?.modules || [],
    previousIntent: completed?.intent,
    previousToolId: completed?.toolId,
    previousEntityType: completed?.entityType,
    previousEntityQuery: completed?.entityQuery,
    previousFieldKeys: Object.keys(completed?.fields || {}),
  };
}

export function buildSafeAssistantClarificationContract(
  command: string,
  context?: AssistantV3PageContext
): AssistantV3Contract {
  const hints = analyzeAssistantHumanLanguage(command);
  const selectedLabel = context?.selectedEntity?.label || context?.memory?.lastEntity?.label || "";
  let missingInformation = ["actiunea dorita"];
  let response =
    "Nu vreau sa ghicesc si sa modific gresit. Spune-mi ce vrei sa fac si cu ce element.";

  if (hints.action === "update") {
    missingInformation = selectedLabel
      ? ["campul si valoarea noua"]
      : ["elementul, campul si valoarea noua"];
    response = selectedLabel
      ? `Am inteles ca vrei sa modifici ${selectedLabel}. Spune-mi campul si valoarea noua.`
      : "Am inteles ca vrei o modificare. Spune-mi elementul, campul si valoarea noua.";
  } else if (hints.action === "navigate" || hints.action === "read") {
    missingInformation = ["pagina sau elementul cautat"];
    response = "Spune-mi pagina sau elementul pe care vrei sa il deschid.";
  } else if (hints.action === "create" || hints.action === "prepare" || hints.action === "send") {
    missingInformation = ["tipul si datele necesare"];
    response = "Am inteles actiunea, dar am nevoie de tipul si datele elementului.";
  }

  return {
    version: "3",
    commandType: "unknown",
    intent: "unknown",
    toolCalls: [],
    targetPage: "",
    entityReferences: [],
    missingInformation,
    confidence: 0.35,
    confirmationRequired: false,
    response,
  };
}
