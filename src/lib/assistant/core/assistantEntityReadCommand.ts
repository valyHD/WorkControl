import type { AssistantCommandContext } from "../assistantCommandService";
import { cleanAssistantCommandTranscript } from "./assistantCommandText";
import type {
  AssistantV3Contract,
  AssistantV3EntityType,
  AssistantV3ToolCall,
} from "./assistantV3Types";
import { normalizeAssistantText } from "../runtime/assistantFuzzy";
import { getAssistantFieldDefinitions } from "../runtime/assistantFieldResolver";
type ReadableEntityType = "vehicle" | "tool" | "project" | "user";

const MUTATION_PATTERN =
  /\b(?:modifica|schimba|pune|seteaza|actualizeaza|corecteaza|trece|sterge|creeaza|adauga|porneste|opreste|trimite|genereaza)\b/;
const QUESTION_PATTERN =
  /\b(?:cat|cati|cate|care|ce|cine|unde|cand|arata(?:-mi)?|spune(?:-mi)?|zi(?:-mi)?|vreau sa stiu|verifica|datele|detaliile|informatiile)\b/;
const NAVIGATION_PATTERN = /\b(?:du(?:-|\s*)ma|duma|deschide|mergi|intra|arata-mi pagina)\b/;

const ENTITY_MARKERS: Record<ReadableEntityType, string[]> = {
  vehicle: ["masina", "masinii", "vehicul", "vehiculul", "duba", "auto", "gps"],
  tool: ["scula", "sculei", "unealta", "echipament", "aparat"],
  project: ["proiect", "proiectul", "lucrare", "santier"],
  user: ["utilizator", "angajat", "coleg", "om", "profil"],
};

const DEFAULT_FIELDS: Record<ReadableEntityType, string[]> = {
  vehicle: ["plateNumber", "brand", "model", "status", "currentKm", "driver", "owner"],
  tool: ["name", "internalCode", "status", "holder", "locationLabel", "owner"],
  project: ["name", "status"],
  user: ["fullName", "roleTitle", "department", "role"],
};

const QUERY_FILLERS = new Set([
  "a",
  "ai",
  "al",
  "ale",
  "am",
  "are",
  "arata",
  "arata-mi",
  "cat",
  "cati",
  "cate",
  "care",
  "ce",
  "cine",
  "cu",
  "da",
  "datele",
  "de",
  "deschide",
  "detaliile",
  "du-ma",
  "e",
  "este",
  "eu",
  "in",
  "informatiile",
  "la",
  "lui",
  "ma",
  "mea",
  "mei",
  "mele",
  "meu",
  "mi",
  "mine",
  "pe",
  "pentru",
  "pagina",
  "sa",
  "si",
  "spune",
  "spune-mi",
  "te",
  "un",
  "unde",
  "verifica",
  "vreau",
  "zi",
  "zi-mi",
]);

function includesPhrase(command: string, phrase: string) {
  const normalizedPhrase = normalizeAssistantText(phrase);
  if (!normalizedPhrase) return false;
  const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escapedPhrase}(?:$|\\s)`).test(command);
}

function inferEntityType(
  command: string,
  context?: AssistantCommandContext
): ReadableEntityType | null {
  for (const [entityType, markers] of Object.entries(ENTITY_MARKERS) as Array<
    [ReadableEntityType, string[]]
  >) {
    if (markers.some((marker) => includesPhrase(command, marker))) return entityType;
  }

  const fieldScores = (Object.keys(ENTITY_MARKERS) as ReadableEntityType[]).map((entityType) => ({
    entityType,
    score: getAssistantFieldDefinitions(entityType).filter((field) =>
      field.aliases.some((alias) => includesPhrase(command, alias))
    ).length,
  }));
  fieldScores.sort((a, b) => b.score - a.score);
  if (fieldScores[0]?.score && fieldScores[0].score > (fieldScores[1]?.score || 0)) {
    return fieldScores[0].entityType;
  }

  const selectedType = context?.selectedEntity?.type;
  return selectedType && selectedType in ENTITY_MARKERS ? (selectedType as ReadableEntityType) : null;
}

function requestedFields(entityType: ReadableEntityType, command: string) {
  const definitions = getAssistantFieldDefinitions(entityType);
  const matched = definitions
    .filter((field) =>
      [field.key, field.label, ...field.aliases].some((alias) => includesPhrase(command, alias))
    )
    .map((field) => field.key);
  if (entityType === "tool" && /\bunde\s+(?:e|este|se afla)\b/.test(command)) {
    matched.push("locationLabel");
  }

  if (matched.length > 0) return [...new Set(matched)];
  if (/\b(?:datele|detaliile|informatiile|ce stii)\b/.test(command)) {
    return DEFAULT_FIELDS[entityType];
  }
  return [];
}

function isPersonalQuery(entityType: ReadableEntityType, command: string) {
  if (entityType === "vehicle") {
    return /\b(?:masina|vehiculul|gps-ul|gpsul)\s+me[au]\b/.test(command) ||
      /\b(?:cati|cat)\s+(?:de\s+)?(?:km|kilometri)\s+(?:mai\s+)?am\b/.test(command);
  }
  if (entityType === "user") {
    return /\b(?:profilul|contul|functia|departamentul|rolul)\s+me[au]\b/.test(command);
  }
  return false;
}

function extractEntityQuery(
  entityType: ReadableEntityType,
  command: string,
  fields: string[],
  context?: AssistantCommandContext
) {
  if (isPersonalQuery(entityType, command)) {
    return entityType === "vehicle" ? "__current_vehicle__" : "__current_user__";
  }

  const selected = context?.selectedEntity;
  const hasExplicitEntityMarker = ENTITY_MARKERS[entityType].some((marker) =>
    includesPhrase(command, marker)
  );
  if (selected?.type === entityType && !hasExplicitEntityMarker) return "";

  const removablePhrases = [
    ...ENTITY_MARKERS[entityType],
    ...getAssistantFieldDefinitions(entityType).flatMap((field) =>
      fields.includes(field.key) ? [field.key, field.label, ...field.aliases] : []
    ),
  ]
    .map(normalizeAssistantText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let query = command;
  for (const phrase of removablePhrases) {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query = query.replace(new RegExp(`\\b${escapedPhrase}\\b`, "g"), " ");
  }

  return query
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !QUERY_FILLERS.has(token))
    .join(" ")
    .trim();
}

function navigationCalls(
  entityType: ReadableEntityType,
  entityQuery: string,
  command: string
): AssistantV3ToolCall[] {
  if (!NAVIGATION_PATTERN.test(command)) return [];
  if (entityType === "vehicle" && entityQuery === "__current_vehicle__") {
    return [{ id: "navigation.open", input: { path: "/my-vehicle", query: "" } }];
  }
  if (entityType === "vehicle" && entityQuery) {
    return [{ id: "vehicles.open", input: { entityQuery, destination: "details" } }];
  }
  return [];
}

export function buildLocalEntityReadContract(
  command: string,
  context?: AssistantCommandContext
): AssistantV3Contract | null {
  const normalized = normalizeAssistantText(cleanAssistantCommandTranscript(command));
  if (!normalized || MUTATION_PATTERN.test(normalized) || !QUESTION_PATTERN.test(normalized)) {
    return null;
  }

  const entityType = inferEntityType(normalized, context);
  if (!entityType) return null;
  const fields = requestedFields(entityType, normalized);
  if (fields.length === 0) return null;
  const entityQuery = extractEntityQuery(entityType, normalized, fields, context);
  if (!entityQuery && context?.selectedEntity?.type !== entityType) return null;

  const fieldFlags = Object.fromEntries(fields.map((field) => [field, true]));
  const toolCalls = [
    ...navigationCalls(entityType, entityQuery, normalized),
    { id: "entities.read", input: { entityQuery, fields: fieldFlags } },
  ];

  return {
    version: "3",
    commandType: "question",
    intent: "read_entity",
    toolCalls,
    targetPage: "",
    entityReferences: [
      { type: entityType as AssistantV3EntityType, query: entityQuery, id: "" },
    ],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: false,
    response: "Citesc datele cerute fara sa modific nimic.",
  };
}
