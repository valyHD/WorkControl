import type { AssistantV3Contract } from "./assistantV3Types";
import { correctRomanianKilometers } from "../speech/romanianSpeechCorrections";

const HELP_RESPONSE = [
  "Pot sa te ajut direct cu:",
  '- Navigare: "deschide pontajul meu" sau "du-ma pe GPS-ul Toyota".',
  '- Pontaj: "porneste pontaj pe proiectul X" sau "opreste pontajul".',
  '- Mentenanta: "genereaza raport revizie pentru Vali".',
  "- Operatiuni: masini, scule, proiecte, concedii, bonuri, utilizatori si notificari.",
  "Poti cere si mai multi pasi intr-o singura comanda; daca exista doua rezultate, iti cer sa alegi.",
].join("\n");

function normalizeForMatching(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildLocalAssistantHelpContract(command: string): AssistantV3Contract | null {
  const normalized = normalizeForMatching(command)
    .replace(/\bcomezni\b/g, "comenzi")
    .replace(/\bsti\b/g, "stii");

  const asksCapabilities = [
    /\bce\s+(?:comenzi\s+)?(?:mai\s+)?(?:stii|poti)\s+(?:sa\s+)?faci\b/,
    /\bce\s+comenzi\s+(?:pot\s+)?(?:sa\s+)?(?:iti|ti)\s+dau\b/,
    /\bce\s+comenzi\s+(?:stii|cunosti)\b/,
    /\bce\s+(?:fel\s+de\s+)?comenzi\s+(?:accepti|intelegi|executi)\b/,
    /\b(?:spune|zi|arata)\s+mi\s+ce\s+comenzi\s+(?:pot\s+)?(?:folosi|da)\b/,
    /\b(?:fa|da|arata)\s+mi\s+(?:o\s+)?lista\s+cu\s+ce\s+comenzi\s+(?:pot\s+)?(?:sa\s+)?(?:iti|ti)\s+dau\b/,
    /\b(?:fa|da|arata)(?:\s+mi)?\s+(?:o\s+)?lista\s+(?:cu|de)?\s*comenzi\b/,
    /\blista\s+(?:cu|de)?\s*comenzi\b/,
    /\bcum\s+(?:te|pot\s+sa\s+te)\s+folosesc\b/,
    /\bcu\s+ce\s+ma\s+poti\s+ajuta\b/,
    /\bcum\s+ma\s+poti\s+ajuta\b/,
    /\bcomenzi(?:le)?\s+(?:disponibile|acceptate|cunoscute)\b/,
    /\bcapabilitat(?:i|ile)\b/,
    /\bexemple\s+(?:de\s+)?comenzi\b/,
    /^ajutor(?:\s+comenzi)?$/,
  ].some((pattern) => pattern.test(normalized));

  if (!asksCapabilities) return null;

  return {
    version: "3",
    commandType: "question",
    intent: "assistant_help",
    toolCalls: [],
    targetPage: "",
    entityReferences: [],
    missingInformation: [],
    confidence: 0.99,
    confirmationRequired: false,
    response: HELP_RESPONSE,
  };
}

function normalizeVehicleQueryToken(value: string) {
  const normalized = normalizeForMatching(value);
  if (normalized.endsWith("ului") && normalized.length > 6) return normalized.slice(0, -4);
  if (normalized.endsWith("ei") && normalized.length > 4) return `${normalized.slice(0, -2)}a`;
  return normalized;
}

const VEHICLE_MILEAGE_ACTION_PATTERN =
  /\b(?:modifica|schimba|pune|seteaza|actualizeaza|corecteaza|trece)\b/;
const VEHICLE_MILEAGE_FIELD_PATTERN = /\b(?:km|kilometri|kilometrii|kilometraj|kilometrajul)\b/;

function parseVehicleMileageValue(value: string) {
  const candidate = value.replace(/\s+/g, " ").trim();
  if (!candidate) return null;
  if (/^-?\d[\d\s.,]*$/.test(candidate)) {
    const compact = candidate.replace(/(?<=\d)[.\s](?=\d{3}\b)/g, "").replace(",", ".");
    const numeric = Number(compact);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return correctRomanianKilometers(candidate);
}

function cleanVehicleMileageQuery(value: string) {
  const filler = new Set([
    "a",
    "al",
    "actual",
    "actuali",
    "curent",
    "curenti",
    "in",
    "la",
    "lui",
    "masina",
    "masinii",
    "mea",
    "mei",
    "mele",
    "meu",
    "pe",
    "pentru",
    "vehicul",
    "vehiculului",
  ]);
  return normalizeForMatching(value)
    .split(" ")
    .filter((token) => token && !filler.has(token))
    .map(normalizeVehicleQueryToken)
    .join(" ")
    .trim();
}

function extractVehicleMileageParts(command: string) {
  const normalized = normalizeForMatching(command);
  const actionMatch = normalized.match(VEHICLE_MILEAGE_ACTION_PATTERN);
  const fieldMatch = normalized.match(VEHICLE_MILEAGE_FIELD_PATTERN);
  if (
    !actionMatch ||
    actionMatch.index === undefined ||
    !fieldMatch ||
    fieldMatch.index === undefined
  ) {
    return null;
  }

  const afterField = normalized.slice(fieldMatch.index + fieldMatch[0].length).trim();
  if (!afterField) return null;

  let value: number | null = null;
  let queryPart = "";
  const connectors = [...afterField.matchAll(/\b(?:la|in|cu|pe|sa\s+fie|devina)\b/g)].reverse();

  for (const connector of connectors) {
    const connectorIndex = connector.index ?? -1;
    if (connectorIndex < 0) continue;
    const candidate = afterField.slice(connectorIndex + connector[0].length);
    const parsed = parseVehicleMileageValue(candidate);
    if (parsed === null) continue;
    value = parsed;
    queryPart = afterField.slice(0, connectorIndex);
    break;
  }

  if (value === null) {
    const tokens = afterField.split(" ").filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      const parsed = parseVehicleMileageValue(tokens.slice(index).join(" "));
      if (parsed === null) continue;
      value = parsed;
      queryPart = tokens.slice(0, index).join(" ");
      break;
    }
  }

  if (value === null) return null;

  let entityQuery = cleanVehicleMileageQuery(queryPart);
  if (!entityQuery) {
    entityQuery = cleanVehicleMileageQuery(normalized.slice(0, actionMatch.index));
  }
  return { entityQuery, value };
}

export function buildLocalVehicleMileageContract(command: string): AssistantV3Contract | null {
  const parsed = extractVehicleMileageParts(command);
  if (!parsed) return null;

  return {
    version: "3",
    commandType: "entity_update",
    intent: "update_vehicle",
    toolCalls: [
      {
        id: "vehicles.update",
        input: { entityQuery: parsed.entityQuery, fields: { currentKm: parsed.value } },
      },
    ],
    targetPage: "",
    entityReferences: parsed.entityQuery
      ? [{ type: "vehicle", query: parsed.entityQuery, id: "" }]
      : [],
    missingInformation: [],
    confidence: 0.99,
    confirmationRequired: true,
    response: parsed.entityQuery
      ? `Schimb kilometrajul masinii ${parsed.entityQuery} la ${parsed.value} km.`
      : `Schimb kilometrajul masinii curente la ${parsed.value} km.`,
  };
}

function extractVehicleQuery(command: string, destination: "details" | "tracker") {
  const tokens = normalizeForMatching(command).split(" ").filter(Boolean);
  let markerIndex = -1;

  tokens.forEach((token, index) => {
    const isTrackerMarker =
      token === "gps" ||
      token.startsWith("gpsul") ||
      token.startsWith("tracker") ||
      token === "harta";
    const isVehicleMarker = [
      "masina",
      "masinii",
      "vehicul",
      "vehiculul",
      "vehiculului",
      "autoturism",
      "autoturismul",
      "autoturismului",
    ].includes(token);
    if (
      (destination === "tracker" && isTrackerMarker) ||
      (destination === "details" && isVehicleMarker)
    ) {
      markerIndex = index;
    }
  });

  if (markerIndex < 0 && destination === "details") {
    markerIndex = tokens.findIndex((token) => token === "pagina" || token === "detaliile");
  }

  if (markerIndex < 0) return "";
  const filler = new Set([
    "ul",
    "l",
    "a",
    "al",
    "ale",
    "lui",
    "pe",
    "la",
    "de",
    "din",
    "pentru",
    "masina",
    "masinii",
    "vehicul",
    "vehiculul",
    "vehiculului",
    "pagina",
    "paginii",
    "detalii",
    "detaliile",
  ]);
  const queryTokens = tokens.slice(markerIndex + 1);
  while (queryTokens.length > 0 && filler.has(queryTokens[0])) queryTokens.shift();
  const descriptorWords = new Set([
    "duba",
    "dubei",
    "dubita",
    "cu",
    "in",
    "numar",
    "numarul",
    "inmatriculare",
  ]);
  return queryTokens
    .filter((token) => !descriptorWords.has(token) && !filler.has(token))
    .map(normalizeVehicleQueryToken)
    .join(" ")
    .trim();
}

export function buildLocalVehicleTrackerContract(command: string): AssistantV3Contract | null {
  const normalized = normalizeForMatching(command);
  const tokens = normalized.split(" ");
  const mentionsTracker = tokens.some(
    (token) => token.startsWith("gps") || token.startsWith("tracker") || token === "harta"
  );
  const knownVehicleMakes = new Set([
    "audi",
    "bmw",
    "citroen",
    "dacia",
    "fiat",
    "ford",
    "hyundai",
    "iveco",
    "kia",
    "mercedes",
    "opel",
    "peugeot",
    "renault",
    "seat",
    "skoda",
    "toyota",
    "volkswagen",
    "volvo",
    "vw",
  ]);
  const mentionsVehicle =
    tokens.some((token) =>
      [
        "masina",
        "masinii",
        "vehicul",
        "vehiculul",
        "vehiculului",
        "autoturism",
        "autoturismul",
        "autoturismului",
      ].includes(token)
    ) ||
    (tokens.some((token) => token === "pagina" || token === "detaliile") &&
      tokens.some((token) => knownVehicleMakes.has(normalizeVehicleQueryToken(token))));
  const requestsNavigation =
    /\b(?:du\s+ma|deschide|arata(?:\s+mi)?|mergi|intra|acceseaza|vreau\s+sa\s+vad)\b/.test(
      normalized
    ) || /^(?:gps|gpsul|tracker|trackerul)\b/.test(normalized);
  if ((!mentionsTracker && !mentionsVehicle) || !requestsNavigation) return null;

  if (/\b(?:toate|flota|flotei)\b/.test(normalized)) {
    return {
      version: "3",
      commandType: "navigation",
      intent: "open_gps_maps",
      toolCalls: [{ id: "navigation.open", input: { path: "/vehicles/gps-map", query: "" } }],
      targetPage: "/vehicles/gps-map",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.99,
      confirmationRequired: false,
      response: "Deschid harta cu toate GPS-urile.",
    };
  }

  const destination = mentionsTracker ? "tracker" : "details";
  const entityQuery = extractVehicleQuery(command, destination);
  if (entityQuery === "meu" || entityQuery === "mea") {
    return {
      version: "3",
      commandType: "navigation",
      intent: "open_my_vehicle",
      toolCalls: [{ id: "navigation.open", input: { path: "/my-vehicle", query: "" } }],
      targetPage: "/my-vehicle",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.99,
      confirmationRequired: false,
      response: "Deschid GPS-ul masinii tale.",
    };
  }

  if (!entityQuery) return null;
  return {
    version: "3",
    commandType: "navigation",
    intent: destination === "tracker" ? "open_vehicle_tracker" : "open_vehicle",
    toolCalls: [{ id: "vehicles.open", input: { entityQuery, destination } }],
    targetPage: "",
    entityReferences: [{ type: "vehicle", query: entityQuery, id: "" }],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: false,
    response:
      destination === "tracker"
        ? `Deschid GPS-ul masinii ${entityQuery}.`
        : `Deschid pagina masinii ${entityQuery}.`,
  };
}
