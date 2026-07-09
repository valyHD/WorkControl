export type AiCommandRisk = "low" | "medium" | "high";
export type AiFieldValue = string | number | boolean | null | string[] | number[];

export type AiEntityType =
  | "page"
  | "vehicle"
  | "tool"
  | "project"
  | "timesheet"
  | "user"
  | "notification"
  | "maintenanceClient"
  | "report"
  | "currentPage"
  | "unknown";

export type AiCommandName =
  | "open_page"
  | "open_vehicle_tracker"
  | "open_vehicle_live"
  | "open_gps_maps"
  | "update_vehicle"
  | "update_tool"
  | "update_project"
  | "update_user"
  | "update_profile"
  | "update_current_page"
  | "create_project"
  | "create_vehicle"
  | "create_tool"
  | "open_vehicle"
  | "open_tool"
  | "open_project"
  | "start_timesheet"
  | "stop_timesheet"
  | "open_latest_timesheet"
  | "open_user_activity"
  | "open_maintenance_report"
  | "create_maintenance_client"
  | "fill_maintenance_client_form"
  | "schedule_leave"
  | "fill_leave_form"
  | "submit_current_form"
  | "create_notification"
  | "click_button"
  | "fill_current_page"
  | "search_current_page"
  | "delete_entity"
  | "clarify"
  | "assistant_help"
  | "unknown";

export type AiFieldDefinition = {
  key: string;
  label: string;
  aliases: string[];
  type: "text" | "number" | "date" | "select" | "user" | "boolean";
  allowedValues?: string[];
  requiresSpecialConfirmation?: boolean;
};

export type AiCommandDefinition = {
  name: AiCommandName;
  description: string;
  module: string;
  entityType: AiEntityType;
  requiredParams: string[];
  optionalParams: string[];
  permissions: string[];
  risk: AiCommandRisk;
  needsConfirmation: boolean;
  aliases: string[];
};

export type StructuredAssistantIntent = {
  intent: AiCommandName;
  entityType: AiEntityType;
  entityQuery: string;
  fieldsToUpdate: Record<string, AiFieldValue>;
  needsConfirmation: boolean;
  confidence: number;
  missingFields: string[];
  spokenSummary: string;
  risk: AiCommandRisk;
  module: string;
};

export type AiEntityContext = {
  entityType: AiEntityType;
  entityId: string;
  label: string;
  query?: string;
};

export const AI_FIELD_REGISTRY: Record<Exclude<AiEntityType, "page" | "unknown">, AiFieldDefinition[]> = {
  vehicle: [
    { key: "currentKm", label: "km curenti", aliases: ["km", "kilometri", "kilometraj", "km curenti"], type: "number" },
    { key: "initialRecordedKm", label: "km la inregistrare", aliases: ["km initiali", "km la inregistrare"], type: "number" },
    { key: "plateNumber", label: "numar inmatriculare", aliases: ["numar", "inmatriculare", "placuta"], type: "text" },
    { key: "brand", label: "marca", aliases: ["marca", "brand"], type: "text" },
    { key: "model", label: "model", aliases: ["model"], type: "text" },
    { key: "vin", label: "serie sasiu", aliases: ["vin", "serie sasiu"], type: "text" },
    { key: "status", label: "status", aliases: ["status", "stare"], type: "select", allowedValues: ["activa", "in_service", "indisponibila", "avariata"] },
    { key: "driver", label: "sofer curent", aliases: ["sofer", "conducator", "driver"], type: "user" },
    { key: "owner", label: "responsabil principal", aliases: ["responsabil", "owner", "proprietar"], type: "user" },
    { key: "nextItpDate", label: "data ITP", aliases: ["itp", "data itp"], type: "date" },
    { key: "nextRcaDate", label: "data RCA", aliases: ["rca", "data rca"], type: "date" },
    { key: "nextCascoDate", label: "data CASCO", aliases: ["casco", "data casco"], type: "date" },
    { key: "nextRovinietaDate", label: "data rovinieta", aliases: ["rovinieta", "data rovinieta"], type: "date" },
    { key: "nextServiceKm", label: "prag service", aliases: ["service la km", "urmator service"], type: "number" },
    { key: "nextOilServiceKm", label: "revizie ulei", aliases: ["ulei", "service ulei", "revizie ulei"], type: "number" },
  ],
  tool: [
    { key: "name", label: "nume", aliases: ["nume", "denumire", "scula"], type: "text" },
    { key: "internalCode", label: "cod intern", aliases: ["cod", "cod intern"], type: "text" },
    { key: "qrCodeValue", label: "cod QR", aliases: ["qr", "cod qr"], type: "text" },
    { key: "status", label: "status", aliases: ["status", "stare"], type: "select", allowedValues: ["depozit", "atribuita", "defecta", "pierduta"] },
    { key: "owner", label: "responsabil principal", aliases: ["responsabil", "owner", "proprietar"], type: "user" },
    { key: "holder", label: "detinator curent", aliases: ["detinator", "utilizator", "la cine este"], type: "user" },
    { key: "locationLabel", label: "locatie", aliases: ["locatie", "unde este"], type: "text" },
    { key: "description", label: "observatii", aliases: ["observatii", "descriere", "note"], type: "text" },
    { key: "warrantyUntil", label: "garantie pana la", aliases: ["garantie", "data garantie"], type: "date" },
  ],
  project: [
    { key: "name", label: "nume proiect", aliases: ["nume", "proiect"], type: "text" },
    { key: "status", label: "status", aliases: ["status", "stare"], type: "select", allowedValues: ["activ", "inactiv", "finalizat"] },
  ],
  timesheet: [
    { key: "projectId", label: "proiect", aliases: ["proiect", "lucrare"], type: "text" },
    { key: "explanation", label: "explicatie", aliases: ["explicatie", "motiv", "observatii"], type: "text" },
  ],
  user: [
    { key: "roleTitle", label: "functie", aliases: ["functie", "meserie", "post"], type: "select" },
    { key: "department", label: "departament", aliases: ["departament", "echipa"], type: "select" },
    { key: "primaryCompanyId", label: "firma", aliases: ["firma", "companie"], type: "select" },
    { key: "role", label: "rol aplicatie", aliases: ["rol", "drepturi"], type: "select", allowedValues: ["admin", "manager", "angajat"], requiresSpecialConfirmation: true },
  ],
  notification: [
    { key: "title", label: "titlu", aliases: ["titlu"], type: "text" },
    { key: "message", label: "mesaj", aliases: ["mesaj", "text"], type: "text" },
    { key: "targetUserId", label: "destinatar", aliases: ["destinatar", "pentru"], type: "user" },
  ],
  maintenanceClient: [
    { key: "name", label: "nume client", aliases: ["nume", "client"], type: "text" },
    { key: "address", label: "adresa", aliases: ["adresa", "locatie"], type: "text" },
    { key: "liftNumber", label: "numar lift", aliases: ["lift", "numar lift"], type: "text" },
    { key: "email", label: "email", aliases: ["email", "mail"], type: "text" },
  ],
  report: [
    { key: "reportType", label: "tip raport", aliases: ["revizie", "interventie"], type: "select", allowedValues: ["revizie", "interventie"] },
    { key: "client", label: "client", aliases: ["client", "beneficiar"], type: "text" },
  ],
  currentPage: [
    { key: "dynamicField", label: "camp pagina curenta", aliases: ["camp", "rubrica"], type: "text" },
  ],
};

export const AI_COMMAND_REGISTRY: AiCommandDefinition[] = [
  {
    name: "assistant_help",
    description: "Arata ce comenzi poate executa asistentul.",
    module: "assistant",
    entityType: "unknown",
    requiredParams: [],
    optionalParams: ["topic"],
    permissions: ["authenticated"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["ce poti face", "ajutor", "exemple comenzi"],
  },
  {
    name: "open_page",
    description: "Navigheaza catre o pagina WorkControl.",
    module: "navigation",
    entityType: "page",
    requiredParams: ["path"],
    optionalParams: ["section"],
    permissions: ["authenticated"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["du-ma la", "deschide", "arata-mi"],
  },
  {
    name: "open_vehicle_tracker",
    description: "Deschide trackerul live al unei masini.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: ["vehicle"],
    optionalParams: ["section"],
    permissions: ["vehicles:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["gps masina", "tracker live", "harta masina"],
  },
  {
    name: "open_vehicle_live",
    description: "Deschide datele live GPS/OBD ale unei masini.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: ["vehicle"],
    optionalParams: [],
    permissions: ["vehicles:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["detalii live", "obd", "senzori masina"],
  },
  {
    name: "open_gps_maps",
    description: "Deschide harta cu toate GPS-urile si poate focaliza o masina.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: [],
    optionalParams: ["vehicle"],
    permissions: ["vehicles:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["toate gps", "harta cu toate gps", "lista harta gps"],
  },
  {
    name: "update_vehicle",
    description: "Actualizeaza datele unei masini dupa validare.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: ["vehicle", "fieldsToUpdate"],
    optionalParams: [],
    permissions: ["vehicles:update"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["modifica masina", "schimba km", "seteaza itp"],
  },
  {
    name: "update_tool",
    description: "Actualizeaza datele unei scule dupa validare.",
    module: "tools",
    entityType: "tool",
    requiredParams: ["tool", "fieldsToUpdate"],
    optionalParams: [],
    permissions: ["tools:update"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["modifica scula", "schimba status scula", "seteaza cod scula"],
  },
  {
    name: "update_project",
    description: "Actualizeaza numele sau statusul unui proiect.",
    module: "projects",
    entityType: "project",
    requiredParams: ["project", "fieldsToUpdate"],
    optionalParams: [],
    permissions: ["projects:update"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["modifica proiect", "schimba proiectul in finalizat", "seteaza proiect inactiv"],
  },
  {
    name: "update_user",
    description: "Actualizeaza date administrative ale unui utilizator, doar cu drepturi potrivite.",
    module: "users",
    entityType: "user",
    requiredParams: ["user", "fieldsToUpdate"],
    optionalParams: [],
    permissions: ["users:update"],
    risk: "high",
    needsConfirmation: true,
    aliases: ["modifica user", "schimba rol", "actualizeaza utilizator"],
  },
  {
    name: "update_profile",
    description: "Actualizeaza campuri din profilul utilizatorului logat.",
    module: "users",
    entityType: "user",
    requiredParams: ["fieldsToUpdate"],
    optionalParams: [],
    permissions: ["profile:update"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["modifica profil", "schimba functie", "schimba departament"],
  },
  {
    name: "update_current_page",
    description: "Completeaza un camp vizibil din pagina curenta.",
    module: "currentPage",
    entityType: "currentPage",
    requiredParams: ["field", "value"],
    optionalParams: ["save"],
    permissions: ["page:interact"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["completeaza camp", "selecteaza", "bifeaza"],
  },
  {
    name: "create_project",
    description: "Creeaza un proiect activ.",
    module: "projects",
    entityType: "project",
    requiredParams: ["name"],
    optionalParams: ["startTimesheet"],
    permissions: ["projects:create"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["creeaza proiect", "adauga proiect"],
  },
  {
    name: "create_vehicle",
    description: "Deschide formularul de masina noua si precompleteaza datele recunoscute.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: [],
    optionalParams: ["plateNumber", "brand", "model"],
    permissions: ["vehicles:create"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["creeaza masina", "adauga masina"],
  },
  {
    name: "create_tool",
    description: "Deschide formularul de scula noua si precompleteaza datele recunoscute.",
    module: "tools",
    entityType: "tool",
    requiredParams: [],
    optionalParams: ["name", "internalCode"],
    permissions: ["tools:create"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["creeaza scula", "adauga scula"],
  },
  {
    name: "open_vehicle",
    description: "Deschide pagina unei masini dupa numar, marca, model sau sofer.",
    module: "vehicles",
    entityType: "vehicle",
    requiredParams: ["vehicle"],
    optionalParams: [],
    permissions: ["vehicles:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["deschide masina", "du-ma la masina", "arata masina"],
  },
  {
    name: "open_tool",
    description: "Deschide pagina unei scule dupa nume, cod, QR sau detinator.",
    module: "tools",
    entityType: "tool",
    requiredParams: ["tool"],
    optionalParams: [],
    permissions: ["tools:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["deschide scula", "du-ma la unealta", "arata scula"],
  },
  {
    name: "open_project",
    description: "Deschide lista de proiecte si cauta proiectul cerut.",
    module: "projects",
    entityType: "project",
    requiredParams: ["project"],
    optionalParams: [],
    permissions: ["projects:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["deschide proiect", "arata proiect", "cauta proiect"],
  },
  {
    name: "start_timesheet",
    description: "Porneste pontajul pe proiectul ales sau pe ultimul proiect folosit.",
    module: "timesheets",
    entityType: "timesheet",
    requiredParams: ["project"],
    optionalParams: ["createProjectIfMissing"],
    permissions: ["timesheets:start"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["porneste pontaj", "incepe ziua", "da start la lucru"],
  },
  {
    name: "stop_timesheet",
    description: "Opreste pontajul activ al utilizatorului logat.",
    module: "timesheets",
    entityType: "timesheet",
    requiredParams: ["activeTimesheet"],
    optionalParams: [],
    permissions: ["timesheets:stop"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["opreste pontaj", "inchide ziua", "am terminat"],
  },
  {
    name: "open_latest_timesheet",
    description: "Deschide cel mai recent pontaj al unui utilizator.",
    module: "timesheets",
    entityType: "timesheet",
    requiredParams: [],
    optionalParams: ["user"],
    permissions: ["timesheets:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["ultimul pontaj", "arata pontaj recent"],
  },
  {
    name: "open_user_activity",
    description: "Deschide istoricul si focalizeaza ultima activitate a unui utilizator.",
    module: "history",
    entityType: "user",
    requiredParams: [],
    optionalParams: ["user"],
    permissions: ["history:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["ultima activitate", "ce a facut", "istoricul lui"],
  },
  {
    name: "open_maintenance_report",
    description: "Deschide generatorul de raport de revizie sau interventie.",
    module: "maintenance",
    entityType: "report",
    requiredParams: ["reportType"],
    optionalParams: ["client"],
    permissions: ["maintenance:read"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["raport revizie", "raport interventie"],
  },
  {
    name: "create_maintenance_client",
    description: "Deschide formularul de client mentenanta si precompleteaza date.",
    module: "maintenance",
    entityType: "maintenanceClient",
    requiredParams: [],
    optionalParams: ["name", "address", "lift"],
    permissions: ["maintenance:create"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["creeaza client mentenanta", "adauga lift"],
  },
  {
    name: "fill_maintenance_client_form",
    description: "Completeaza formularul de client mentenanta fara salvare automata.",
    module: "maintenance",
    entityType: "maintenanceClient",
    requiredParams: [],
    optionalParams: ["name", "email", "address", "liftNumbers"],
    permissions: ["maintenance:create"],
    risk: "medium",
    needsConfirmation: false,
    aliases: ["completeaza client mentenanta", "formular client mentenanta"],
  },
  {
    name: "schedule_leave",
    description: "Completeaza formularul de concediu si cere verificare inainte de trimitere.",
    module: "leave",
    entityType: "currentPage",
    requiredParams: [],
    optionalParams: ["startDate", "endDate", "reason"],
    permissions: ["leave:create"],
    risk: "medium",
    needsConfirmation: false,
    aliases: ["programeaza concediu", "cerere concediu", "completeaza concediu"],
  },
  {
    name: "fill_leave_form",
    description: "Completeaza formularul de concediu fara trimitere automata.",
    module: "leave",
    entityType: "currentPage",
    requiredParams: [],
    optionalParams: ["startDate", "endDate", "reason"],
    permissions: ["leave:create"],
    risk: "medium",
    needsConfirmation: false,
    aliases: ["completeaza concediu", "formular concediu"],
  },
  {
    name: "submit_current_form",
    description: "Pregateste sau trimite formularul curent doar cu confirmare.",
    module: "currentPage",
    entityType: "currentPage",
    requiredParams: [],
    optionalParams: ["form"],
    permissions: ["page:interact"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["trimite formular", "salveaza formular", "submit"],
  },
  {
    name: "create_notification",
    description: "Creeaza o notificare speciala dictata de utilizator.",
    module: "notifications",
    entityType: "notification",
    requiredParams: ["message"],
    optionalParams: ["targetUser"],
    permissions: ["notifications:create"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["creeaza notificare", "trimite notificare"],
  },
  {
    name: "click_button",
    description: "Apasa un buton vizibil din pagina curenta.",
    module: "currentPage",
    entityType: "currentPage",
    requiredParams: ["button"],
    optionalParams: [],
    permissions: ["page:interact"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["apasa", "click", "salveaza", "trimite"],
  },
  {
    name: "fill_current_page",
    description: "Completeaza un camp din pagina curenta cand nu exista executor dedicat.",
    module: "currentPage",
    entityType: "currentPage",
    requiredParams: ["field", "value"],
    optionalParams: [],
    permissions: ["page:interact"],
    risk: "medium",
    needsConfirmation: true,
    aliases: ["completeaza camp", "scrie in camp", "selecteaza valoarea"],
  },
  {
    name: "search_current_page",
    description: "Cauta sau filtreaza in pagina curenta.",
    module: "currentPage",
    entityType: "currentPage",
    requiredParams: ["query"],
    optionalParams: [],
    permissions: ["page:interact"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["cauta", "filtreaza", "gaseste"],
  },
  {
    name: "delete_entity",
    description: "Sterge o entitate doar cu confirmare explicita si permisiuni ridicate.",
    module: "system",
    entityType: "unknown",
    requiredParams: ["entity"],
    optionalParams: ["reason"],
    permissions: ["admin"],
    risk: "high",
    needsConfirmation: true,
    aliases: ["sterge", "elimina"],
  },
  {
    name: "clarify",
    description: "Cere detalii cand intentia sau entitatea nu este clara.",
    module: "assistant",
    entityType: "unknown",
    requiredParams: [],
    optionalParams: ["question"],
    permissions: ["authenticated"],
    risk: "low",
    needsConfirmation: false,
    aliases: ["clarifica"],
  },
  {
    name: "unknown",
    description: "Intentie necunoscuta sau prea riscanta pentru executie.",
    module: "assistant",
    entityType: "unknown",
    requiredParams: [],
    optionalParams: [],
    permissions: ["authenticated"],
    risk: "low",
    needsConfirmation: false,
    aliases: [],
  },
];

const COMMAND_BY_NAME = new Map(AI_COMMAND_REGISTRY.map((command) => [command.name, command]));

export function getAiCommandDefinition(name?: string | null) {
  if (!name) return COMMAND_BY_NAME.get("unknown")!;
  return COMMAND_BY_NAME.get(name as AiCommandName) || COMMAND_BY_NAME.get("unknown")!;
}

export function clampConfidence(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.72;
  return Math.max(0, Math.min(1, value));
}

export function buildStructuredAssistantIntent(params: {
  intent?: AiCommandName | string;
  entityType?: AiEntityType;
  entityQuery?: string;
  fieldsToUpdate?: Record<string, AiFieldValue>;
  confidence?: number;
  missingFields?: string[];
  spokenSummary?: string;
}): StructuredAssistantIntent {
  const definition = getAiCommandDefinition(params.intent);
  const fieldsToUpdate = params.fieldsToUpdate || {};
  const missingFields = params.missingFields || [];

  return {
    intent: definition.name,
    entityType: params.entityType || definition.entityType,
    entityQuery: params.entityQuery || "",
    fieldsToUpdate,
    needsConfirmation: definition.needsConfirmation || definition.risk !== "low",
    confidence: clampConfidence(params.confidence),
    missingFields,
    spokenSummary: params.spokenSummary || definition.description,
    risk: definition.risk,
    module: definition.module,
  };
}

export function validateStructuredAssistantIntent(intent: StructuredAssistantIntent) {
  const definition = getAiCommandDefinition(intent.intent);
  const missing = new Set(intent.missingFields);

  for (const param of definition.requiredParams) {
    if (param === "fieldsToUpdate") {
      if (Object.keys(intent.fieldsToUpdate).length === 0) missing.add(param);
      continue;
    }

    if (param === "vehicle" || param === "tool" || param === "user" || param === "project" || param === "entity") {
      if (!intent.entityQuery.trim()) missing.add(param);
      continue;
    }
  }

  return Array.from(missing);
}

export function buildAssistantConfirmationMessage(intent: StructuredAssistantIntent, entityLabel?: string) {
  const definition = getAiCommandDefinition(intent.intent);
  const lines = [
    `Am inteles: ${intent.spokenSummary || definition.description}.`,
    `Actiune: ${definition.description}.`,
  ];

  if (entityLabel || intent.entityQuery) {
    lines.push(`Element: ${entityLabel || intent.entityQuery}.`);
  }

  const fieldEntries = Object.entries(intent.fieldsToUpdate);
  if (fieldEntries.length > 0) {
    lines.push("Modificari:");
    fieldEntries.forEach(([field, value]) => {
      lines.push(`- ${field}: ${String(value ?? "")}`);
    });
  }

  lines.push(`Risc: ${intent.risk}. Incredere: ${Math.round(intent.confidence * 100)}%.`);

  if (intent.needsConfirmation) {
    lines.push("Confirmi?");
  }

  return lines.join("\n");
}

export function formatAiCommandRegistryForHelp() {
  return AI_COMMAND_REGISTRY
    .filter((command) => command.name !== "unknown" && command.name !== "clarify")
    .map((command) => `- ${command.description} Exemple: ${command.aliases.slice(0, 3).join(", ")}.`)
    .join("\n");
}
