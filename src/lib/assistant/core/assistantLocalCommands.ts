import type { AssistantV3Contract } from "./assistantV3Types";
import { correctRomanianKilometers } from "../speech/romanianSpeechCorrections";
import { resolveAssistantNavigationAction } from "../assistantActionCatalog";
import type { NavigationRole } from "../../../config/navigation";
import {
  getAssistantFieldDefinitions,
  resolveAssistantField,
} from "../runtime/assistantFieldResolver";
import type { AssistantRuntimeEntityType } from "../runtime/assistantTypes";
import { normalizeAssistantCommandText } from "./assistantCommandText";

const HELP_RESPONSE = [
  "Pot sa te ajut direct cu:",
  '- Navigare: "deschide pontajul meu" sau "du-ma pe GPS-ul Toyota".',
  '- Pontaj: "porneste pontaj pe proiectul X" sau "opreste pontajul".',
  '- Mentenanta: "genereaza raport revizie pentru Vali".',
  '- Setari personale: "pune-mi functia electrician" sau "schimba departamentul in Service".',
  '- Setari site: "fa interfata compacta", "pune tema pe violet" sau "opreste animatiile".',
  '- Reguli notificari: "opreste regula Pontaj dimineata" sau "pune ora regulii X la 07:00".',
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
    /\bce\s+(?:comenzi\s+)?(?:mai\s+)?(?:stii|poti)\s+(?:sa\s+)?(?:faci|face)\b/,
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
    /\bla\s+ce\s+te\s+pot\s+folosi\b/,
    /\bcum\s+(?:trebuie\s+sa\s+)?(?:iti|ti)\s+vorbesc\b/,
    /\bcum\s+(?:trebuie\s+sa\s+)?(?:iti|ti)\s+cer\b/,
    /\b(?:da|spune|arata)\s+mi\s+(?:niste\s+)?exemple\b/,
    /\bajuta\s+ma\s+cu\s+comenzile\b/,
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
    "deschide",
    "duba",
    "dubei",
    "du",
    "ma",
    "apoi",
    "si",
    "aici",
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

  if (value === null && afterField) {
    const tokens = afterField.split(" ").filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      const parsed = parseVehicleMileageValue(tokens.slice(index).join(" "));
      if (parsed === null) continue;
      value = parsed;
      queryPart = tokens.slice(0, index).join(" ");
      break;
    }
  }

  // Oamenii spun frecvent "pune masina la 7200 kilometri", cu valoarea
  // inaintea numelui campului. Pastreaza aceeasi actiune controlata si
  // extrage tinta numai din textul dintre verb si valoare.
  if (value === null && fieldMatch.index > actionMatch.index) {
    const beforeField = normalized
      .slice(actionMatch.index + actionMatch[0].length, fieldMatch.index)
      .trim();
    const numericMatches = [...beforeField.matchAll(/-?\d[\d.,]*(?:\s+\d{3})*/g)];
    const numeric = numericMatches[numericMatches.length - 1];
    if (numeric?.index !== undefined) {
      value = parseVehicleMileageValue(numeric[0]);
      queryPart = beforeField
        .slice(0, numeric.index)
        .replace(/\b(?:la|in|cu|pe|sa\s+fie|devina)\s*$/, "")
        .trim();
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
  let vehicleMarkerIndex = -1;

  tokens.forEach((token, index) => {
    const isTrackerMarker =
      token === "gps" ||
      token.startsWith("gpsul") ||
      token.startsWith("tracker") ||
      token === "harta";
    const isVehicleMarker = [
      "duba",
      "dubei",
      "dubita",
      "masina",
      "masinii",
      "vehicul",
      "vehiculul",
      "vehiculului",
      "autoturism",
      "autoturismul",
      "autoturismului",
    ].includes(token);
    if (isVehicleMarker) vehicleMarkerIndex = index;
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
    "cu",
    "pe",
    "la",
    "de",
    "din",
    "pentru",
    "masina",
    "masinii",
    "duba",
    "dubei",
    "dubita",
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
  const followUpIndex = queryTokens.findIndex(
    (token, index) =>
      token === "si" &&
      ["arata", "deschide", "spune", "vezi", "zi"].includes(queryTokens[index + 1] || "")
  );
  const boundedQueryTokens = followUpIndex >= 0 ? queryTokens.slice(0, followUpIndex) : queryTokens;
  const descriptorWords = new Set([
    "duba",
    "dubei",
    "dubita",
    "cu",
    "in",
    "numar",
    "numarul",
    "inmatriculare",
    "live",
    "tracker",
    "trackerul",
    "gps",
    "gpsul",
  ]);
  const queryAfterMarker = boundedQueryTokens
    .filter((token) => !descriptorWords.has(token) && !filler.has(token))
    .map(normalizeVehicleQueryToken)
    .join(" ")
    .trim();
  if (queryAfterMarker) return queryAfterMarker;

  if (destination === "tracker" && markerIndex > 0) {
    const navigationWords = new Set([
      "acceseaza",
      "arata",
      "deschide",
      "du",
      "ma",
      "imi",
      "mi",
      "mergi",
      "intra",
      "pagina",
      "vreau",
      "sa",
      "vad",
    ]);
    const start = vehicleMarkerIndex >= 0 ? vehicleMarkerIndex + 1 : 0;
    return tokens
      .slice(start, markerIndex)
      .filter(
        (token) => !navigationWords.has(token) && !descriptorWords.has(token) && !filler.has(token)
      )
      .map(normalizeVehicleQueryToken)
      .join(" ")
      .trim();
  }

  return "";
}

const PERSONAL_SETTING_FIELDS = [
  {
    key: "roleTitle",
    label: "functia",
    pattern: /\b(?:functie|functia|meserie|meseria|post|postul)\b/,
  },
  {
    key: "department",
    label: "departamentul",
    pattern: /\b(?:departament|departamentul|echipa)\b/,
  },
  {
    key: "fullName",
    label: "numele",
    pattern: /\b(?:nume\s+complet|numele|nume)\b/,
  },
] as const;

/** Builds a safe update for the authenticated user's own profile settings. */
export function buildLocalPersonalSettingsContract(command: string): AssistantV3Contract | null {
  const normalized = normalizeForMatching(normalizeAssistantCommandText(command));
  const action = normalized.match(
    /\b(?:actualizeaza|completeaza|corecteaza|modifica|pune|schimba|seteaza|trece)\b/
  );
  if (action?.index === undefined) return null;

  const payload = normalized.slice(action.index + action[0].length).trim();
  const field = PERSONAL_SETTING_FIELDS.find((candidate) => candidate.pattern.test(payload));
  if (!field) return null;

  const fieldMatch = field.pattern.exec(payload);
  if (fieldMatch?.index === undefined) return null;
  const prefix = payload.slice(0, fieldMatch.index).trim();
  if (/\b(?:lui|utilizatorului|angajatului|userului)\b/.test(prefix)) return null;

  const value = payload
    .slice(fieldMatch.index + fieldMatch[0].length)
    .trim()
    .replace(/^(?:meu|mea|pentru\s+mine|la\s+mine|mie|mi)\b\s*/, "")
    .replace(/^(?:la|in|cu|pe|sa\s+fie|devina|drept)\s+/, "")
    .replace(/\b(?:te\s+rog|acum)\s*$/g, "")
    .trim();
  if (!value || /^(?:lui|utilizatorului|angajatului|userului)\b/.test(value)) return null;

  return {
    version: "3",
    commandType: "entity_update",
    intent: "update_user",
    toolCalls: [
      {
        id: "users.update",
        input: { entityQuery: "__current_user__", fields: { [field.key]: value } },
      },
    ],
    targetPage: "",
    entityReferences: [{ type: "user", query: "__current_user__", id: "" }],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: true,
    response: `Schimb ${field.label} profilului tau in ${value}?`,
  };
}

function cleanNotificationRuleQuery(value: string) {
  return value
    .replace(/\b(?:te\s+rog|acum|pentru\s+mine)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNotificationSettingsContract(
  ruleQuery: string,
  fields: Record<string, string | number | boolean>,
  response: string
): AssistantV3Contract | null {
  const query = cleanNotificationRuleQuery(ruleQuery);
  if (!query) return null;
  return {
    version: "3",
    commandType: "entity_update",
    intent: "update_notification_rule",
    toolCalls: [
      {
        id: "notifications.rules.update",
        input: { ruleQuery: query, fields },
      },
    ],
    targetPage: "",
    entityReferences: [],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: true,
    response,
  };
}

/** Parses frequently used notification settings without relying on cloud guessing. */
export function buildLocalNotificationSettingsContract(
  command: string
): AssistantV3Contract | null {
  const normalized = normalizeForMatching(normalizeAssistantCommandText(command));
  const ruleMarker = "(?:regula|regulii|notificarea|notificarii|reminderul)";

  const sound = normalized.match(
    new RegExp(
      `\\b(activeaza|porneste|dezactiveaza|opreste)\\s+sunet(?:ul)?\\s+(?:la|pentru|din)\\s+${ruleMarker}\\s+(.+)$`
    )
  );
  if (sound) {
    const enabled = sound[1] === "activeaza" || sound[1] === "porneste";
    return buildNotificationSettingsContract(
      sound[2],
      { soundEnabled: enabled },
      `${enabled ? "Activez" : "Dezactivez"} sunetul regulii ${sound[2]}?`
    );
  }

  const enabled = normalized.match(
    new RegExp(`\\b(activeaza|porneste|reactiveaza|dezactiveaza|opreste)\\s+${ruleMarker}\\s+(.+)$`)
  );
  if (enabled) {
    const nextEnabled = ["activeaza", "porneste", "reactiveaza"].includes(enabled[1]);
    return buildNotificationSettingsContract(
      enabled[2],
      { enabled: nextEnabled },
      `${nextEnabled ? "Activez" : "Dezactivez"} regula ${enabled[2]}?`
    );
  }

  const time = normalized.match(
    new RegExp(
      `\\b(?:schimba|seteaza|pune|modifica)\\s+(ora(?:\\s+de\\s+(pornire|oprire))?|programul)\\s+(?:(?:la|pentru|din)\\s+)?${ruleMarker}\\s+(.+?)\\s+(?:la|pe|in)\\s+(\\d{1,2}(?::|\\s)\\d{2}|\\d{1,2})$`
    )
  );
  if (time) {
    const field = time[2] === "oprire" ? "stopTime" : "scheduleTime";
    return buildNotificationSettingsContract(
      time[3],
      { [field]: time[4] },
      `Schimb ${field === "stopTime" ? "ora de oprire" : "ora de pornire"} pentru regula ${time[3]} la ${time[4]}?`
    );
  }

  const repeat = normalized.match(
    new RegExp(
      `\\b(?:schimba|seteaza|pune|modifica)\\s+(?:repetarea|intervalul|repetitia)\\s+(?:(?:la|pentru|din)\\s+)?${ruleMarker}\\s+(.+?)\\s+(?:la|pe|in|din)\\s+(\\d+)\\s*(?:minute|min)?$`
    )
  );
  if (repeat) {
    return buildNotificationSettingsContract(
      repeat[1],
      { reminderRepeatMinutes: Number(repeat[2]) },
      `Schimb repetarea regulii ${repeat[1]} la ${repeat[2]} minute?`
    );
  }

  return null;
}

const SITE_SETTING_PALETTES: Array<{ value: string; pattern: RegExp }> = [
  { value: "violet", pattern: /\b(?:mov|violet|roz|purpuriu)\b/ },
  { value: "emerald", pattern: /\b(?:verde|smarald|emerald)\b/ },
  { value: "sunset", pattern: /\b(?:apus|sunset|portocaliu|orange|cald|rosu|rosiatica)\b/ },
  { value: "slate", pattern: /\b(?:gri|gray|slate|neutru|inchis)\b/ },
  { value: "blue", pattern: /\b(?:albastru|blue)\b/ },
];

const SITE_SETTING_FONTS: Array<{ value: string; pattern: RegExp }> = [
  { value: "inter", pattern: /\binter\b/ },
  { value: "poppins", pattern: /\bpoppins\b/ },
  { value: "roboto-slab", pattern: /\broboto(?:\s+slab)?\b/ },
  { value: "dm-sans", pattern: /\bdm(?:\s+sans)?\b/ },
];

function buildSiteSettingsContract(fields: Record<string, string | number>) {
  if (Object.keys(fields).length === 0) return null;
  return {
    version: "3",
    commandType: "entity_update",
    intent: "update_site_settings",
    toolCalls: [{ id: "settings.update", input: { fields } }],
    targetPage: "",
    entityReferences: [],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: true,
    response: "Schimb setarile site-ului?",
  } satisfies AssistantV3Contract;
}

/** Parses global UI setting changes without writing into visible form inputs. */
export function buildLocalSiteSettingsContract(command: string): AssistantV3Contract | null {
  const normalized = normalizeForMatching(normalizeAssistantCommandText(command));
  const mentionsSettings =
    /\b(?:site|siteul|aplicatie|aplicatia|interfata|aspect|design|tema|paleta|font|fontul|scris|scrisul|text|textul|litere|literele|card|carduri|cardurile|contrast|animatie|animatii|animatiile|densitate|compact|compacta|aerisit|aerisita|spatios|spatioasa|glass|sticla)\b/.test(
      normalized
    );
  const requestsMutation =
    /\b(?:fa|pune|schimba|seteaza|modifica|mareste|micsoreaza|opreste|scoate|redu|activeaza|dezactiveaza)\b/.test(
      normalized
    );
  if (!mentionsSettings || !requestsMutation) return null;

  const fields: Record<string, string | number> = {};

  if (/\b(?:compact|compacta|inghesuit|inghesuita|mai\s+strans|mai\s+mic)\b/.test(normalized)) {
    fields.uiDensity = "compact";
  } else if (/\b(?:aerisit|spatios|spatioasa|mai\s+larg|mai\s+lejera)\b/.test(normalized)) {
    fields.uiDensity = "spacious";
  } else if (
    /\b(?:confortabil|normal)\b/.test(normalized) &&
    /\b(?:densitate|interfata)\b/.test(normalized)
  ) {
    fields.uiDensity = "comfortable";
  }

  const palette = SITE_SETTING_PALETTES.find((candidate) => candidate.pattern.test(normalized));
  if (palette && /\b(?:tema|culoare|culori|paleta|interfata|site|aplicatie)\b/.test(normalized)) {
    fields.uiPalette = palette.value;
  }

  if (/\b(?:glass|sticla|transparent|transparente)\b/.test(normalized)) {
    fields.uiCardStyle = "glass";
  } else if (/\b(?:flat|plat|plate|simple|fara\s+umbra)\b/.test(normalized)) {
    fields.uiCardStyle = "flat";
  } else if (/\b(?:elevat|ridicat|umbra|premium)\b/.test(normalized) && /\bcard/.test(normalized)) {
    fields.uiCardStyle = "elevated";
  }

  if (/\b(?:contrast\s+mare|high\s+contrast|mai\s+vizibil)\b/.test(normalized)) {
    fields.uiContrast = "high";
  } else if (/\b(?:contrast\s+normal|contrastul\s+normal)\b/.test(normalized)) {
    fields.uiContrast = "normal";
  }

  if (/\b(?:opreste|dezactiveaza|scoate|fara)\b.{0,25}\banimati/.test(normalized)) {
    fields.uiAnimations = "none";
  } else if (/\b(?:redu|mai\s+putine|mai\s+usoare)\b.{0,25}\banimati/.test(normalized)) {
    fields.uiAnimations = "reduced";
  } else if (/\b(?:activeaza|porneste|da\s+drumul)\b.{0,25}\banimati/.test(normalized)) {
    fields.uiAnimations = "full";
  }

  const mentionsFont = /\b(?:font|fontul|scris|scrisul|text|textul|litere|literele)\b/.test(
    normalized
  );
  const font = SITE_SETTING_FONTS.find((candidate) => candidate.pattern.test(normalized));
  if (font && mentionsFont) fields.uiFontFamily = font.value;

  if (mentionsFont) {
    const exactScale = normalized.match(/\b(?:font|text|litere)\b[^0-9]{0,20}(\d+(?:[.,]\d+)?)\b/);
    if (exactScale) {
      fields.uiFontScale = Number(exactScale[1].replace(",", "."));
    } else if (/\b(?:mareste|mai\s+mare|marit|mare)\b/.test(normalized)) {
      fields.uiFontScale = "mai mare";
    } else if (/\b(?:micsoreaza|mai\s+mic|mic)\b/.test(normalized)) {
      fields.uiFontScale = "mai mic";
    }
  }

  return buildSiteSettingsContract(fields);
}

function referencesPersonalVehicle(normalizedCommand: string) {
  return [
    /\b(?:masina|masinii|vehicul|vehiculul|vehiculului|autoturism|autoturismul|autoturismului|duba|dubei)\s+(?:mea|meu|personala|personal)\b/,
    /\b(?:gps|gps\s+ul|gpsul|tracker|trackerul|harta)\s+(?:mea|meu)\b/,
    /\b(?:masina|vehiculul|autoturismul)\s+(?:pe\s+care\s+(?:o\s+)?conduc|asignat(?:a)?\s+mie|alocat(?:a)?\s+mie|de\s+serviciu)\b/,
  ].some((pattern) => pattern.test(normalizedCommand));
}

const VEHICLE_MAKE_TOKENS = new Set([
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

function asksForCurrentVehicleMileage(normalizedCommand: string) {
  return (
    /\b(?:cati|cat|ce)\s+(?:km|kilometri|kilometraj)\b/.test(normalizedCommand) ||
    /\b(?:km|kilometri|kilometrii|kilometraj|kilometrajul)\s+(?:actuali|curenti|are|am)\b/.test(
      normalizedCommand
    ) ||
    /\b(?:spune|arata|vezi)\s+(?:mi\s+)?(?:km|kilometrii?|kilometrajul)\b/.test(normalizedCommand)
  );
}

function extractLooseVehicleQuery(command: string) {
  const tokens = normalizeForMatching(command).split(" ").filter(Boolean);
  if (!tokens.some((token) => VEHICLE_MAKE_TOKENS.has(normalizeVehicleQueryToken(token)))) {
    return "";
  }
  const ignored = new Set([
    "acceseaza",
    "arata",
    "deschide",
    "du",
    "ma",
    "mi",
    "imi",
    "intra",
    "la",
    "masina",
    "masinii",
    "mergi",
    "pagina",
    "paginii",
    "pe",
    "spune",
    "vezi",
    "vreau",
    "sa",
    "vad",
  ]);
  return tokens
    .filter((token) => !ignored.has(token))
    .map(normalizeVehicleQueryToken)
    .join(" ")
    .trim();
}

export function buildLocalVehicleTrackerContract(command: string): AssistantV3Contract | null {
  const cleanCommand = normalizeAssistantCommandText(command);
  const normalized = normalizeForMatching(cleanCommand);
  const tokens = normalized.split(" ");
  const referencesMyVehicle = referencesPersonalVehicle(normalized);
  const asksMileage = asksForCurrentVehicleMileage(normalized);
  const mentionsTracker = tokens.some(
    (token) => token.startsWith("gps") || token.startsWith("tracker") || token === "harta"
  );
  const mentionsVehicle =
    tokens.some((token) =>
      [
        "duba",
        "dubei",
        "dubita",
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
    tokens.some((token) => VEHICLE_MAKE_TOKENS.has(normalizeVehicleQueryToken(token))) ||
    (tokens.some((token) => token === "pagina" || token === "detaliile") &&
      tokens.some((token) => VEHICLE_MAKE_TOKENS.has(normalizeVehicleQueryToken(token))));
  const requestsNavigation =
    /\b(?:du\s+ma|deschide|arata(?:\s+mi)?|mergi|intra|acceseaza|vreau\s+sa\s+vad)\b/.test(
      normalized
    ) ||
    /^(?:gps|gpsul|tracker|trackerul)\b/.test(normalized) ||
    (referencesMyVehicle && asksMileage);
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

  if (referencesMyVehicle) {
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
      response: asksMileage
        ? "Deschid masina ta. Kilometrajul curent este afisat in pagina masinii."
        : mentionsTracker
          ? "Deschid GPS-ul masinii tale."
          : "Deschid pagina masinii tale.",
    };
  }

  const destination = mentionsTracker ? "tracker" : "details";
  const entityQuery =
    extractVehicleQuery(cleanCommand, destination) || extractLooseVehicleQuery(cleanCommand);
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

function navigationIntent(actionId: string): AssistantV3Contract["intent"] {
  if (actionId === "dashboard") return "open_dashboard";
  if (actionId === "my-vehicle") return "open_my_vehicle";
  if (actionId === "my-timesheets") return "open_my_timesheets";
  if (actionId === "fleet-gps") return "open_gps_maps";
  if (actionId === "my-leave") return "open_leave";
  if (actionId === "expense-scan") return "open_expense_scan";
  if (actionId === "expense-invoices") return "open_expense_invoices";
  if (actionId === "maintenance-report") return "open_maintenance_report";
  return "open_page";
}

export function buildLocalPageNavigationContract(
  command: string,
  role: NavigationRole = "angajat"
): AssistantV3Contract | null {
  const normalized = normalizeForMatching(command);
  const requestsNavigation =
    /\b(?:deschide|arata(?:\s+mi)?|mergi|intra|acceseaza|du\s+ma|vreau\s+sa\s+vad|unde\s+(?:este|e|gasesc))\b/.test(
      normalized
    ) || /^(?:hai|la|pe|vreau)\s+/.test(normalized);
  const requestsMutation =
    /\b(?:adauga|completeaza|creeaza|modifica|porneste|salveaza|schimba|seteaza|sterge|trimite)\b/.test(
      normalized
    );
  if (!requestsNavigation || requestsMutation) return null;

  const action = resolveAssistantNavigationAction(command, role);
  if (!action) return null;

  return {
    version: "3",
    commandType: "navigation",
    intent: navigationIntent(action.id),
    toolCalls: [{ id: "navigation.open", input: { path: action.path, query: "" } }],
    targetPage: action.path,
    entityReferences: [],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: false,
    response: action.spokenOpenLabel,
  };
}

type LocalEntityContext = {
  selectedEntity?: { type?: string; id?: string; label?: string } | null;
  memory?: {
    lastEntity?: {
      type?: string;
      entityType?: string;
      id?: string;
      entityId?: string;
      label?: string;
      query?: string;
    };
  };
};

const LOCAL_UPDATE_TOOL: Partial<Record<AssistantRuntimeEntityType, string>> = {
  vehicle: "vehicles.update",
  tool: "tools.update",
  project: "timesheets.projects.update",
  user: "users.update",
};

const LOCAL_UPDATE_INTENT: Partial<
  Record<AssistantRuntimeEntityType, AssistantV3Contract["intent"]>
> = {
  vehicle: "update_vehicle",
  tool: "update_tool",
  project: "update_project",
  user: "update_user",
};

function contextualEntity(context?: LocalEntityContext) {
  const selected = context?.selectedEntity;
  const selectedType = selected?.type as AssistantRuntimeEntityType | undefined;
  if (selectedType && LOCAL_UPDATE_TOOL[selectedType]) {
    return { type: selectedType, query: selected?.label || selected?.id || "" };
  }
  const remembered = context?.memory?.lastEntity;
  const rememberedType = (remembered?.type || remembered?.entityType) as
    AssistantRuntimeEntityType | undefined;
  if (rememberedType && LOCAL_UPDATE_TOOL[rememberedType]) {
    return {
      type: rememberedType,
      query: remembered?.label || remembered?.query || remembered?.id || remembered?.entityId || "",
    };
  }
  return null;
}

function extractCurrentEntityFieldChange(command: string, entityType: AssistantRuntimeEntityType) {
  const normalized = normalizeForMatching(command);
  const action = normalized.match(
    /\b(?:actualizeaza|baga|corecteaza|fa|lasa|modifica|pune|schimba|seteaza|trece)\b/
  );
  let payload =
    action?.index === undefined
      ? normalized
      : normalized.slice(action.index + action[0].length).trim();
  payload = payload.replace(
    /^(?:si\s+)?(?:aici|la\s+(?:asta|ala)|pe\s+(?:asta|ala)|pentru\s+(?:asta|ala)|(?:asta|ala))\s+/,
    ""
  );
  payload = payload.replace(/^(?:la|pe|in)\s+(?=\S)/, "");
  if (!payload || /\b(?:lui|pentru\s+(?:masina|scula|proiectul|utilizatorul))\b/.test(payload)) {
    return null;
  }

  const connectors = [...payload.matchAll(/\b(?:la|in|cu|pe|sa\s+fie|devina)\b/g)].reverse();
  for (const connector of connectors) {
    const index = connector.index ?? -1;
    if (index <= 0) continue;
    const naturalField = payload
      .slice(0, index)
      .replace(/^(?:si\s+)?/, "")
      .trim();
    const value = payload.slice(index + connector[0].length).trim();
    const field = resolveAssistantField(entityType, naturalField);
    if (field && value) return { fieldKey: field.key, fieldLabel: field.label, value };
  }

  const tokens = payload.split(" ").filter(Boolean);
  const exactCandidates: Array<{
    fieldKey: string;
    fieldLabel: string;
    value: string;
    size: number;
  }> = [];
  for (let size = Math.min(3, tokens.length - 1); size >= 1; size -= 1) {
    const naturalField = tokens.slice(0, size).join(" ");
    const value = tokens.slice(size).join(" ").trim();
    const field = resolveAssistantField(entityType, naturalField);
    if (!field || !value) continue;
    const normalizedField = normalizeForMatching(naturalField);
    const exactNames = [field.key, field.label, ...field.aliases].map(normalizeForMatching);
    if (exactNames.includes(normalizedField)) {
      exactCandidates.push({ fieldKey: field.key, fieldLabel: field.label, value, size });
    }
  }
  const exact = exactCandidates.sort((left, right) => right.size - left.size)[0];
  if (exact) return { fieldKey: exact.fieldKey, fieldLabel: exact.fieldLabel, value: exact.value };
  return null;
}

export function buildLocalCurrentEntityUpdateContract(
  command: string,
  context?: LocalEntityContext
): AssistantV3Contract | null {
  const entity = contextualEntity(context);
  if (!entity?.query) return null;
  const change = extractCurrentEntityFieldChange(command, entity.type);
  const toolId = LOCAL_UPDATE_TOOL[entity.type];
  const intent = LOCAL_UPDATE_INTENT[entity.type];
  if (!change || !toolId || !intent) return null;

  return {
    version: "3",
    commandType: "entity_update",
    intent,
    toolCalls: [
      {
        id: toolId,
        input: { entityQuery: entity.query, fields: { [change.fieldKey]: change.value } },
      },
    ],
    targetPage: "",
    entityReferences: [
      {
        type: entity.type as "vehicle" | "tool" | "project" | "user",
        query: entity.query,
        id: "",
      },
    ],
    missingInformation: [],
    confidence: 0.96,
    confirmationRequired: true,
    response: `Schimb ${change.fieldLabel} pentru ${entity.query}?`,
  };
}

type NamedEntityMarker = {
  type: AssistantRuntimeEntityType;
  pattern: RegExp;
  implicitField?: string;
};

const NAMED_ENTITY_MARKERS: NamedEntityMarker[] = [
  {
    type: "vehicle",
    pattern:
      /\b(?:masina|masinii|vehiculul|vehiculului|autoturismul|autoturismului|duba|dubei|auto)\s+/,
    implicitField: "status",
  },
  {
    type: "tool",
    pattern:
      /\b(?:scula|sculei|unealta|uneltei|echipamentul|echipamentului|flexul|flexului|bormasina|bormasinii)\s+/,
    implicitField: "status",
  },
  {
    type: "project",
    pattern: /\b(?:proiectul|proiectului|santierul|santierului|lucrarea|lucrarii)\s+/,
    implicitField: "status",
  },
  {
    type: "user",
    pattern:
      /\b(?:utilizatorul|utilizatorului|userul|userului|angajatul|angajatului|colegul|colegului|salariatul|salariatului)\s+/,
  },
];

function inferEntityTypeFromUniqueField(value: string): AssistantRuntimeEntityType | null {
  const normalized = normalizeForMatching(value);
  if (
    /\b(?:itp|rca|casco|rovinieta|sofer|soferul|driver|vin|serie\s+sasiu|ulei|schimb\s+ulei|service)\b/.test(
      normalized
    )
  ) {
    return "vehicle";
  }
  if (/\b(?:garantie|garantia|cod\s+intern|qr|cod\s+qr|detinator|detinatorul)\b/.test(normalized)) {
    return "tool";
  }
  if (
    /\b(?:functie|functia|meserie|post|departament|departamentul|rol|drepturi)\b/.test(normalized)
  ) {
    return "user";
  }
  return null;
}

function splitNamedEntityAndValue(value: string) {
  const connectors = [...value.matchAll(/\b(?:la|in|cu|pe|sa\s+fie|devina)\b/g)].reverse();
  for (const connector of connectors) {
    const index = connector.index ?? -1;
    if (index <= 0) continue;
    const entityQuery = value
      .slice(0, index)
      .replace(/^(?:lui|pentru)\s+/, "")
      .trim();
    const fieldValue = value.slice(index + connector[0].length).trim();
    if (entityQuery && fieldValue) return { entityQuery, fieldValue };
  }
  return null;
}

function escapeLocalRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveEntityBeforeFieldPayload(payload: string) {
  const entityTypes: AssistantRuntimeEntityType[] = ["vehicle", "tool", "user"];
  for (const type of entityTypes) {
    const aliases = getAssistantFieldDefinitions(type)
      .flatMap((field) => [field.label, field.key, ...field.aliases].map(normalizeForMatching))
      .filter((alias) => inferEntityTypeFromUniqueField(alias) === type)
      .sort((left, right) => right.length - left.length);

    for (const alias of aliases) {
      const match = new RegExp(
        `\\s+(?:(?:la|pe|in|cu)\\s+)?${escapeLocalRegExp(alias)}(?=\\s|$)`
      ).exec(payload);
      if (match?.index === undefined || match.index <= 0) continue;
      const entityQuery = payload
        .slice(0, match.index)
        .replace(/^(?:l|o|i|pe)\s+/, "")
        .trim();
      const fieldValue = payload.slice(match.index + match[0].length).trim();
      const field = resolveAssistantField(type, alias);
      if (
        /^(?:campul|data|denumirea|numele|numarul|statusul|termenul|valoarea)$/i.test(entityQuery)
      ) {
        continue;
      }
      if (entityQuery && fieldValue && field) return { type, field, entityQuery, fieldValue };
    }
  }
  return null;
}

function namedEntityUpdateParts(command: string) {
  const normalized = normalizeForMatching(command);

  for (const marker of NAMED_ENTITY_MARKERS) {
    const entityMarker = marker.pattern.exec(normalized);
    if (entityMarker?.index === undefined) continue;
    const afterMarker = normalized.slice(entityMarker.index + entityMarker[0].length).trim();
    const nestedAction =
      /\b(?:actualizeaza|baga|corecteaza|fa|lasa|modifica|pune|schimba|seteaza|trece|marcheaza)\b/.exec(
        afterMarker
      );
    if (nestedAction?.index === undefined || nestedAction.index <= 0) continue;
    const entityQuery = afterMarker
      .slice(0, nestedAction.index)
      .replace(/\b(?:te\s+rog|acum)\b/g, " ")
      .trim();
    const fieldPayload = afterMarker.slice(nestedAction.index + nestedAction[0].length).trim();
    if (!entityQuery || !fieldPayload) continue;

    const fields = getAssistantFieldDefinitions(marker.type);
    const candidates = fields.flatMap((field) =>
      [field.label, field.key, ...field.aliases]
        .map(normalizeForMatching)
        .filter(Boolean)
        .map((alias) => ({ field, alias }))
        .filter(({ alias }) => fieldPayload === alias || fieldPayload.startsWith(`${alias} `))
    );
    const matched = candidates.sort((left, right) => right.alias.length - left.alias.length)[0];
    if (matched) {
      const fieldValue = fieldPayload
        .slice(matched.alias.length)
        .trim()
        .replace(/^(?:la|in|cu|pe|sa\s+fie|devina)\s+/, "")
        .trim();
      if (fieldValue) return { type: marker.type, field: matched.field, entityQuery, fieldValue };
    }

    if (marker.implicitField) {
      const field = resolveAssistantField(marker.type, marker.implicitField);
      if (field) return { type: marker.type, field, entityQuery, fieldValue: fieldPayload };
    }
  }

  const action = normalized.match(
    /\b(?:actualizeaza|baga|corecteaza|fa|lasa|modifica|pune|schimba|seteaza|trece|marcheaza)\b/
  );
  if (action?.index === undefined) return null;
  const payload = normalized.slice(action.index + action[0].length).trim();
  if (!payload) return null;

  for (const marker of NAMED_ENTITY_MARKERS) {
    const entityMarker = marker.pattern.exec(payload);
    if (entityMarker?.index === undefined) continue;
    const naturalField = payload.slice(0, entityMarker.index).trim() || marker.implicitField || "";
    const field = resolveAssistantField(marker.type, naturalField);
    const split = splitNamedEntityAndValue(
      payload.slice(entityMarker.index + entityMarker[0].length).trim()
    );
    if (field && split) return { type: marker.type, field, ...split };
  }

  const userMarker = /\blui\s+/.exec(payload);
  if (userMarker?.index !== undefined) {
    const naturalField = payload.slice(0, userMarker.index).trim();
    const field = resolveAssistantField("user", naturalField);
    const split = splitNamedEntityAndValue(
      payload.slice(userMarker.index + userMarker[0].length).trim()
    );
    if (field && split) return { type: "user" as const, field, ...split };
  }

  const firstConnector = /\b(?:la|pentru)\b/.exec(payload);
  if (firstConnector?.index !== undefined && firstConnector.index > 0) {
    const naturalField = payload.slice(0, firstConnector.index).trim();
    const inferredType = inferEntityTypeFromUniqueField(naturalField);
    const field = inferredType ? resolveAssistantField(inferredType, naturalField) : null;
    const split = splitNamedEntityAndValue(
      payload.slice(firstConnector.index + firstConnector[0].length).trim()
    );
    if (inferredType && field && split) {
      return { type: inferredType, field, ...split };
    }
  }

  const entityBeforeField = resolveEntityBeforeFieldPayload(payload);
  if (entityBeforeField) return entityBeforeField;

  return null;
}

/** Handles high-frequency named updates locally so casual wording does not depend on OpenAI. */
export function buildLocalNamedEntityUpdateContract(command: string): AssistantV3Contract | null {
  const parsed = namedEntityUpdateParts(command);
  if (!parsed) return null;
  const toolId = LOCAL_UPDATE_TOOL[parsed.type];
  const intent = LOCAL_UPDATE_INTENT[parsed.type];
  if (!toolId || !intent) return null;

  return {
    version: "3",
    commandType: "entity_update",
    intent,
    toolCalls: [
      {
        id: toolId,
        input: {
          entityQuery: parsed.entityQuery,
          fields: { [parsed.field.key]: parsed.fieldValue },
        },
      },
    ],
    targetPage: "",
    entityReferences: [
      {
        type: parsed.type as "vehicle" | "tool" | "project" | "user",
        query: parsed.entityQuery,
        id: "",
      },
    ],
    missingInformation: [],
    confidence: 0.97,
    confirmationRequired: true,
    response: `Schimb ${parsed.field.label} pentru ${parsed.entityQuery}?`,
  };
}

type LocalTimesheetContext = LocalEntityContext;

function contextualProject(context?: LocalTimesheetContext) {
  const selected = context?.selectedEntity;
  if (selected?.type === "project") return selected.label || selected.id || "";
  const remembered = context?.memory?.lastEntity;
  if (!remembered) return "";
  const type = remembered.type || remembered.entityType;
  return type === "project"
    ? remembered.label || remembered.query || remembered.id || remembered.entityId || ""
    : "";
}

function cleanExtractedProject(value: string) {
  return value
    .replace(/\b(?:acum|te\s+rog)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimesheetProject(command: string) {
  const normalized = normalizeForMatching(command);
  const createAndStart = normalized.match(
    /\bcreeaza\s+proiect(?:ul)?\s+(.+?)\s+(?:si\s+)?porneste\s+pontaj(?:ul)?\b/
  );
  if (createAndStart) {
    return { projectQuery: cleanExtractedProject(createAndStart[1]), createProjectIfMissing: true };
  }

  const selectAndStart = normalized.match(
    /\b(?:alege|selecteaza)\s+proiect(?:ul)?\s+(.+?)\s+(?:si\s+)?porneste\s+pontaj(?:ul)?\b/
  );
  if (selectAndStart) {
    return {
      projectQuery: cleanExtractedProject(selectAndStart[1]),
      createProjectIfMissing: false,
    };
  }

  const projectAfterStart = normalized.match(
    /\bporneste\s+pontaj(?:ul)?(?:\s+pe)?\s+(?:proiect(?:ul)?\s+)?(.+)$/
  );
  return {
    projectQuery: cleanExtractedProject(projectAfterStart?.[1] || ""),
    createProjectIfMissing: false,
  };
}

export function buildLocalTimesheetContract(
  command: string,
  context?: LocalTimesheetContext
): AssistantV3Contract | null {
  const normalized = normalizeForMatching(command);
  const requestsStop =
    /\b(?:opreste|inchide|termina)\s+(?:mi\s+)?(?:pontaj(?:ul)?|ceas(?:ul)?)\b/.test(normalized);
  if (requestsStop) {
    return {
      version: "3",
      commandType: "timesheet_action",
      intent: "stop_timesheet",
      toolCalls: [{ id: "timesheets.stop", input: { explanation: "" } }],
      targetPage: "",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.99,
      confirmationRequired: true,
      response: "Opresc pontajul activ?",
    };
  }

  const requestsStart = /\bporneste\s+(?:mi\s+)?pontaj(?:ul)?\b/.test(normalized);
  if (!requestsStart) return null;
  const parsed = extractTimesheetProject(command);
  const projectQuery = parsed.projectQuery || contextualProject(context);
  if (!projectQuery) {
    return {
      version: "3",
      commandType: "timesheet_action",
      intent: "start_timesheet",
      toolCalls: [],
      targetPage: "",
      entityReferences: [],
      missingInformation: ["proiectul pentru pontaj"],
      confidence: 0.6,
      confirmationRequired: false,
      response: "Pe ce proiect pornesc pontajul?",
    };
  }

  return {
    version: "3",
    commandType: "timesheet_action",
    intent: "start_timesheet",
    toolCalls: [
      {
        id: "timesheets.start",
        input: {
          projectId: "",
          projectQuery,
          createProjectIfMissing: parsed.createProjectIfMissing,
          explanation: "",
        },
      },
    ],
    targetPage: "",
    entityReferences: [{ type: "project", query: projectQuery, id: "" }],
    missingInformation: [],
    confidence: 0.98,
    confirmationRequired: true,
    response: `Pornesc pontajul pe proiectul ${projectQuery}?`,
  };
}
