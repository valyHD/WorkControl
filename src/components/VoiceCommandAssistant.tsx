import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Loader2, Mic, Send, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../providers/AuthProvider";
import { getMyVehicleForUser, getVehicleById, getVehiclesList, updateVehicle } from "../modules/vehicles/services/vehiclesService";
import { getMaintenanceClients } from "../modules/maintenance/services/maintenanceService";
import {
  createProject,
  getActiveProjectsList,
  getActiveTimesheetForUser,
  getLatestTimesheetProjectForUser,
  getProjectById,
  getUserTimesheetProjectPreference,
  saveUserTimesheetProjectPreference,
  startTimesheet,
  stopTimesheet,
} from "../modules/timesheets/services/timesheetsService";
import { reverseGeocode } from "../modules/timesheets/services/geocodingService";
import { interpretAssistantCommand, type AssistantCommandInterpretation } from "../lib/assistant/assistantCommandService";
import {
  buildAssistantConfirmationMessage,
  buildStructuredAssistantIntent,
  formatAiCommandRegistryForHelp,
  type AiCommandName,
  type AiFieldValue,
  type AiCommandRisk,
  type AiEntityContext,
  type AiEntityType,
  type StructuredAssistantIntent,
} from "../lib/assistant/aiCommandRegistry";
import { logAssistantAudit } from "../lib/assistant/runtime/assistantAudit";
import { createAssistantConversationMemory } from "../lib/assistant/runtime/assistantConversationMemory";
import { buildAssistantRuntimePlan } from "../lib/assistant/runtime/assistantExecutor";
import { normalizeAssistantInterpretation } from "../lib/assistant/runtime/assistantIntentParser";
import { scheduleAssistantNextStepHighlight } from "../lib/assistant/runtime/assistantButtonHighlighter";
import {
  classifyAssistantCommand,
  hasAssistantNavigationSafetyIntent,
  type AssistantCommandClassification,
} from "../lib/assistant/runtime/assistantClassifier";
import { getAssistantNextStepMessage } from "../lib/assistant/runtime/assistantPageFlow";
import { resolveAssistantKnownPageNavigation } from "../lib/assistant/runtime/assistantNavigation";
import { resolveAssistantControlledPageAction } from "../lib/assistant/runtime/assistantPageActions";
import type { AssistantExecutionPlanStep, AssistantResolvedEntity, AssistantRuntimePlan } from "../lib/assistant/runtime/assistantTypes";
import { db } from "../lib/firebase/firebase";
import { getAllUsers, updateUserWorkDetails } from "../modules/users/services/usersService";
import { getToolsList, updateTool } from "../modules/tools/services/toolsService";
import type { ProjectItem, TimesheetLocation } from "../types/timesheet";
import type { ToolFormValues, ToolItem, ToolStatus } from "../types/tool";
import { VEHICLE_STATUSES, type VehicleFormValues, type VehicleItem, type VehicleStatus } from "../types/vehicle";
import type { MaintenanceClient } from "../types/maintenance";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionResultLike = {
  [index: number]: { transcript: string };
  length: number;
  isFinal?: boolean;
};

type SpeechRecognitionEventLike = {
  results: {
    [index: number]: SpeechRecognitionResultLike;
    length: number;
  };
  resultIndex?: number;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onstart?: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onnomatch?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type AssistantActionBase = {
  label: string;
  result: string;
  note?: string;
  commandName?: AiCommandName;
  risk?: AiCommandRisk;
  confidence?: number;
  needsConfirmation?: boolean;
  structuredIntent?: StructuredAssistantIntent;
  entityContext?: AiEntityContext;
  fieldsToUpdate?: Record<string, AiFieldValue>;
  changeSummaries?: AssistantChangeSummary[];
  choices?: AssistantChoiceOption[];
  auditBeforeData?: Record<string, unknown> | null;
  auditAfterData?: Record<string, unknown> | null;
  executionPlan?: AssistantExecutionPlanStep[];
};

type AssistantChangeSummary = {
  label: string;
  oldValue: string;
  newValue: string;
};

type AssistantChoiceOption = {
  id: string;
  label: string;
  entityType: AiEntityType;
  query?: string;
};

type AssistantAction =
  | (AssistantActionBase & {
      type: "info";
    })
  | (AssistantActionBase & {
      type: "navigate";
      path: string;
    })
  | (AssistantActionBase & {
      type: "field-update";
      run: () => Promise<string>;
    })
  | (AssistantActionBase & {
      type: "start-timesheet";
      projectQuery?: string;
      createProjectIfMissing?: boolean;
    })
  | (AssistantActionBase & {
      type: "stop-timesheet";
    })
  | (AssistantActionBase & {
      type: "sequence";
      actions: AssistantAction[];
    });

type AssistantConversationContext = {
  lastEntity?: AiEntityContext;
  lastVehicleId?: string;
  lastToolId?: string;
  lastProjectId?: string;
  lastUserId?: string;
};

type AssistantCommandHistoryItem = {
  id: string;
  transcript: string;
  summary: string;
  status: "success" | "failed" | "cancelled" | "pending";
  createdAt: number;
};

type AssistantDebugInfo = {
  transcript: string;
  commandType: string;
  reason: string;
  intent: string;
  entityType: string;
  entityQuery: string;
  fieldsToUpdate: Record<string, unknown>;
  targetPage: string;
  confidence: number;
  nextAction: string;
  executionPlan?: AssistantExecutionPlanStep[];
};

type AssistantState = "idle" | "listening" | "thinking" | "confirming" | "executing";
const TIMESHEETS_CHANGED_EVENT = "workcontrol:timesheets-changed";
const ASSISTANT_AGENT_CONFIDENCE_THRESHOLD = 0.85;

const MONTHS_RO: Record<string, number> = {
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
  sep: 9,
  sept: 9,
  octombrie: 10,
  oct: 10,
  noiembrie: 11,
  noi: 11,
  decembrie: 12,
  dec: 12,
};

const ASSISTANT_SCENARIO_TEXT = [
  "Exemple utile:",
  "1. Masini: du-ma la masina B 33 LGR cu tracker live; modifica km masinii in 6180; schimba ITP la 12.08.2026; apasa salveaza.",
  "2. GPS: arata toate GPS-urile in dreptul lui Dacia Spring; deschide detalii live pentru Toyota.",
  "3. Pontaj: creeaza proiect Service 2 si porneste pontajul; selecteaza proiectul Vali Mare Boss si dai start pontaj; opreste pontajul.",
  "4. Istoric pontaj: arata ultimul pontaj al lui Razvan; du-ma la pontaje globale, cauta Razvan, deschide primul rezultat.",
  "5. Formulare: completeaza campul telefon cu 0722...; selecteaza firma WorkControl; bifeaza activ; apasa salveaza.",
  "6. Mentenanta: creeaza client mentenanta Lift Nord cu lift A12; cauta Lift Nord; deschide primul rezultat; apasa genereaza raport.",
  "7. Scule: du-ma la scule, cauta bormasina, deschide primul rezultat, completeaza observatii cu verificat, apasa salveaza.",
  "8. Cheltuieli si concedii: du-ma la scanare bonuri; du-ma la facturi; du-ma la concedii, completeaza motiv cu medical, apasa trimite.",
  "9. Flux lung: du-ma la masini, cauta Toyota, deschide primul rezultat, du-ma la sectiunea documente, apasa adauga document.",
].join("\n");

const ASSISTANT_CAPABILITY_SECTIONS = [
  {
    title: "Navigare si control pagina",
    keywords: ["site", "pagina", "navigare", "formular", "cautare", "buton"],
    items: [
      "deschid orice pagina din meniu: dashboard, profil, utilizatori, masini, GPS-uri, pontaje, proiecte, concedii, scule, mentenanta, bonuri, facturi, notificari, firme, istoric si panou control",
      "caut in liste, filtrez rezultate, deschid primul rezultat, merg la sectiuni din pagina si apas butoane vizibile",
      "completez campuri, selectez optiuni, bifez/debifez checkbox-uri si pot executa pasi unul dupa altul in pagini diferite",
    ],
  },
  {
    title: "Profilul meu",
    keywords: ["profil", "cont", "firma", "functie", "departament", "avatar"],
    items: [
      "deschid profilul tau si te duc la sectiunile cu firma, functie, departament, avatar, masina, scule, pontaje si notificari",
      "completez campuri din profil si pot salva datele cand imi spui explicit sa apas salvare",
    ],
  },
  {
    title: "Masini si GPS",
    keywords: ["masina", "masini", "vehicul", "gps", "tracker", "obd", "harta", "kilometri", "itp", "rca", "casco", "rovinieta"],
    items: [
      "deschid masina ta sau o masina dupa numar, marca, model ori sofer",
      "deschid tracker live, detalii live OBD/GPS, harta cu toate GPS-urile si pot focaliza o masina anume",
      "modific date de masina: kilometri curenti, ITP, RCA, CASCO, rovinieta, revizie, sofer, numar, marca, model, VIN si status",
      "creez masina noua si completez automat numar, marca sau model daca le spui in comanda",
    ],
  },
  {
    title: "Pontaj si proiecte",
    keywords: ["pontaj", "pontaje", "proiect", "proiecte", "ore", "program", "tura"],
    items: [
      "deschid Pontajul meu, pornesc pontaj pe proiectul ales, opresc pontajul activ si creez proiect nou daca lipseste",
      "selectez proiectul, pornesc pontajul, opresc pontajul si actualizez pagina live dupa actiune",
      "deschid pontajele globale, caut un user si arat ultimul pontaj al unui coleg",
      "creez, caut, editez si sterg proiecte unde exista butonul disponibil pentru rolul tau",
    ],
  },
  {
    title: "Concedii",
    keywords: ["concediu", "concedii", "liber", "cerere", "semnatura"],
    items: [
      "deschid concediile, aleg userul tau in calendar si merg la formularul de cerere",
      "completez nume, companie, functie, departament, perioada, motiv si pot trimite cererea dupa semnatura",
      "te duc la cererea depusa, la cereri in asteptare sau la istoricul cererilor aprobate",
    ],
  },
  {
    title: "Scule",
    keywords: ["scula", "scule", "unealta", "unelte", "qr", "scanner"],
    items: [
      "deschid lista de scule, caut o scula, deschid primul rezultat si merg la detalii sau editare",
      "creez scula noua, completez nume/cod, schimb responsabilul, statusul, observatiile si salvez",
      "deschid scanarea QR pentru scule",
    ],
  },
  {
    title: "Mentenanta lifturi",
    keywords: ["mentenanta", "lift", "lifturi", "client", "revizie", "interventie", "piese"],
    items: [
      "deschid mentenanta, caut client, creez client nou si adaug lifturi sau adrese",
      "generez raport de revizie sau interventie pentru clientul cerut si il pregatesc pentru trimitere",
      "deschid comenzile de piese, caut si apas actiunile vizibile pentru fluxul de comanda",
    ],
  },
  {
    title: "Bonuri, facturi si cheltuieli",
    keywords: ["bon", "bonuri", "factura", "facturi", "cheltuieli", "scanare", "poza"],
    items: [
      "deschid scanarea bonurilor, te duc la alegerea fisierului si apoi la scanare/salvare",
      "completez automat firma din profil si proiectul din ultimul pontaj, dar poti cere schimbarea lor",
      "deschid facturi, rapoarte cheltuieli, caut furnizori si filtrez dupa user, proiect, firma, luna sau tip document",
    ],
  },
  {
    title: "Utilizatori, notificari si istoric",
    keywords: ["utilizator", "utilizatori", "angajat", "angajati", "notificare", "notificari", "istoric", "audit"],
    items: [
      "deschid utilizatori, profil public sau ultima activitate a unui user",
      "creez notificari speciale dictate de tine si deschid lista de notificari",
      "marchez notificarile citite, caut in istoric si deschid panoul de control pentru rolurile care au acces",
    ],
  },
] as const;

function formatCapabilitySections(sections: typeof ASSISTANT_CAPABILITY_SECTIONS[number][]) {
  return [
    "Pot sa te ajut in WorkControl cu:",
    ...sections.flatMap((section) => [
      "",
      section.title,
      ...section.items.map((item) => `- ${item}.`),
    ]),
    "",
    ASSISTANT_SCENARIO_TEXT,
    "",
    "Comenzi din registrul AI:",
    formatAiCommandRegistryForHelp(),
  ].join("\n");
}

function isMutationLikeAssistantCommand(classification: AssistantCommandClassification, normalized: string) {
  if (["entity_update", "form_fill", "create_entity", "timesheet_action"].includes(classification.type)) return true;
  return (
    /\b(schimb|modific|seteaz|pune|actualizeaz|editeaz|corecteaz|completeaz|creeaz|creaz|adauga|porneste|opreste|start|stop)\w*/.test(
      normalized
    ) &&
    !/\b(doar|numai)\s+(deschide|arata|du|navigheaza)\b/.test(normalized)
  );
}

function buildAgentClarificationAction(message: string, confidence = 0): AssistantAction {
  return {
    type: "info",
    commandName: "clarify",
    risk: "low",
    needsConfirmation: false,
    confidence,
    label: message,
    result: message,
    executionPlan: [
      {
        id: "stop-unsafe",
        type: "confirm",
        label: "Nu execut fara plan sigur.",
        requiresConfirmation: false,
      },
    ],
    structuredIntent: buildStructuredAssistantIntent({
      intent: "clarify",
      entityType: "unknown",
      confidence,
      missingFields: ["safeExecutionPlan"],
      spokenSummary: message,
    }),
  };
}

function inferEntityTypeFromAction(action: AssistantAction): AiEntityType {
  if (action.entityContext?.entityType) return action.entityContext.entityType;
  if (action.commandName?.includes("vehicle")) return "vehicle";
  if (action.commandName?.includes("tool")) return "tool";
  if (action.commandName?.includes("timesheet")) return "timesheet";
  if (action.commandName?.includes("notification")) return "notification";
  if (action.commandName === "update_profile" || action.commandName === "open_user_activity") return "user";
  if (action.commandName === "open_maintenance_report") return "report";
  if (action.commandName === "create_maintenance_client") return "maintenanceClient";
  if (action.type === "navigate") return "page";
  return "unknown";
}

function inferCommandNameFromAction(action: AssistantAction): AiCommandName {
  if (action.commandName) return action.commandName;
  if (action.type === "start-timesheet") return "start_timesheet";
  if (action.type === "stop-timesheet") return "stop_timesheet";
  if (action.type === "info") return "assistant_help";
  if (action.type === "navigate") {
    if (action.path.includes("/live")) return "open_vehicle_live";
    if (action.path.includes("gps-map")) return "open_gps_maps";
    if (action.path.includes("vehicle-tracker-live-section")) return "open_vehicle_tracker";
    if (action.path.includes("/history")) return "open_user_activity";
    if (action.path.includes("/maintenance")) return "open_maintenance_report";
    return "open_page";
  }
  if (action.type === "field-update") return "update_current_page";
  if (action.type === "sequence") return "update_current_page";
  return "unknown";
}

function attachAssistantIntent(_command: string, action: AssistantAction): AssistantAction {
  const commandName = inferCommandNameFromAction(action);
  const entityContext = action.entityContext;
  const structuredIntent =
    action.structuredIntent ||
    buildStructuredAssistantIntent({
      intent: commandName,
      entityType: inferEntityTypeFromAction(action),
      entityQuery: entityContext?.query || entityContext?.label || "",
      fieldsToUpdate: action.fieldsToUpdate,
      confidence: action.confidence,
      spokenSummary: action.label,
    });

  return {
    ...action,
    commandName,
    risk: action.risk || structuredIntent.risk,
    confidence: action.confidence ?? structuredIntent.confidence,
    needsConfirmation: action.needsConfirmation ?? structuredIntent.needsConfirmation,
    structuredIntent,
  };
}

function assistantChoiceFromResolvedEntity(option: AssistantResolvedEntity): AssistantChoiceOption {
  return {
    id: option.entityId,
    label: option.label,
    entityType: option.entityType === "none" ? "unknown" : option.entityType,
    query: option.query,
  };
}

const ASSISTANT_ORDINAL_CHOICES: Array<{ index: number; terms: string[] }> = [
  { index: 0, terms: ["prima", "primul", "unu", "1", "varianta 1", "alege prima"] },
  { index: 1, terms: ["a doua", "al doilea", "doi", "2", "varianta 2"] },
  { index: 2, terms: ["a treia", "al treilea", "trei", "3", "varianta 3"] },
  { index: 3, terms: ["a patra", "al patrulea", "patru", "4", "varianta 4"] },
  { index: 4, terms: ["a cincea", "al cincilea", "cinci", "5", "varianta 5"] },
];

function resolveAssistantChoiceFromText(command: string, choices: AssistantChoiceOption[]) {
  const normalized = normalizeText(command);
  const ordinalMatch = ASSISTANT_ORDINAL_CHOICES.find((entry) =>
    entry.terms.some((term) => normalized === normalizeText(term) || normalized.includes(normalizeText(term)))
  );
  if (ordinalMatch && choices[ordinalMatch.index]) return choices[ordinalMatch.index];

  return choices.find((choice) => {
    const normalizedLabel = normalizeText(choice.label);
    const compactLabel = compactText(choice.label);
    const compactCommand = compactText(command);
    const commandTokens = alphaNumericTokens(command).filter((token) => token.length >= 3);
    const tokenHits = commandTokens.filter((token) => compactLabel.includes(token) || normalizedLabel.includes(token)).length;
    return (
      normalizedLabel.includes(normalized) ||
      normalized.includes(normalizedLabel) ||
      compactLabel.includes(compactCommand) ||
      (commandTokens.length > 0 && tokenHits >= Math.min(2, commandTokens.length))
    );
  }) || null;
}

function parseAssistantNavigationTarget(path: string) {
  const [pathAndSearch] = path.split("#");
  const [pathname, search = ""] = pathAndSearch.split("?");
  return {
    pathname: pathname || "/",
    search: search ? `?${search}` : "",
  };
}

function getAssistantPreview(action: AssistantAction) {
  if (!action.structuredIntent) return action.note ? `${action.label} ${action.note}` : action.label;
  const planText = action.executionPlan?.length
    ? `Plan:\n${action.executionPlan.map((step, index) => `${index + 1}. ${step.label}`).join("\n")}`
    : "";
  if (action.auditBeforeData || action.label.includes("->")) {
    return [
      action.label,
      planText,
      `Risc: ${action.risk || action.structuredIntent.risk}. Incredere: ${Math.round((action.confidence ?? action.structuredIntent.confidence) * 100)}%.`,
      action.note || "",
      action.needsConfirmation !== false ? "Confirmi?" : "",
    ].filter(Boolean).join("\n");
  }
  const preview = buildAssistantConfirmationMessage(action.structuredIntent, action.entityContext?.label);
  return [preview, planText, action.note || ""].filter(Boolean).join("\n");
}

function getAssistantConfirmationRows(action: AssistantAction) {
  return [
    { label: "Ce a inteles", value: action.label },
    { label: "Entitate", value: action.entityContext?.label || action.structuredIntent?.entityQuery || "Pagina curenta" },
    {
      label: "Modificari",
      value: action.changeSummaries?.length
        ? action.changeSummaries.map((change) => `${change.label}: ${change.oldValue} -> ${change.newValue}`).join("\n")
        : action.fieldsToUpdate && Object.keys(action.fieldsToUpdate).length > 0
          ? Object.entries(action.fieldsToUpdate).map(([key, value]) => `${key}: ${String(value ?? "-")}`).join("\n")
          : "Fara modificare directa de camp",
    },
    { label: "Risc", value: action.risk || action.structuredIntent?.risk || "low" },
    { label: "Incredere", value: `${Math.round((action.confidence ?? action.structuredIntent?.confidence ?? 0.7) * 100)}%` },
    {
      label: "Plan executie",
      value: action.executionPlan?.length
        ? action.executionPlan.map((step, index) => `${index + 1}. ${step.label}`).join("\n")
        : "Plan simplu fara pasi suplimentari",
    },
    {
      label: "De ce confirmare",
      value:
        action.needsConfirmation === false
          ? "Actiune cu risc mic"
          : action.risk === "high"
            ? "Poate afecta date sensibile sau poate suprascrie valori importante"
            : "Poate modifica date sau declansa o actiune in aplicatie",
    },
  ];
}

function commandNameFromRuntimeIntent(intent: AssistantRuntimePlan["intent"]): AiCommandName {
  if (intent === "update_vehicle") return "update_vehicle";
  if (intent === "update_tool") return "update_tool";
  if (intent === "update_project") return "update_project";
  if (intent === "update_user") return "update_user";
  if (intent === "create_project") return "create_project";
  if (intent === "create_maintenance_client") return "create_maintenance_client";
  if (intent === "fill_maintenance_client_form") return "fill_maintenance_client_form";
  if (intent === "schedule_leave") return "schedule_leave";
  if (intent === "fill_leave_form") return "fill_leave_form";
  if (intent === "submit_current_form") return "submit_current_form";
  return "update_current_page";
}

function actionFromRuntimePlan(plan: AssistantRuntimePlan): AssistantAction {
  if (plan.status !== "ready" || !plan.run) {
    return {
      type: "info",
      commandName: "clarify",
      risk: "low",
      needsConfirmation: false,
      confidence: plan.confidence,
      structuredIntent: buildStructuredAssistantIntent({
        intent: "clarify",
        entityType: plan.entityType === "none" ? "unknown" : plan.entityType,
        entityQuery: plan.parsedIntent.entityQuery,
        fieldsToUpdate: plan.fieldsToUpdate,
        confidence: plan.confidence,
        missingFields: plan.parsedIntent.missingFields,
        spokenSummary: plan.message,
      }),
      label: plan.message,
      result: [
        plan.message,
        ...(plan.options || []).map((option, index) => `${index + 1}. ${option.label}`),
      ].filter(Boolean).join("\n"),
      choices: (plan.options || []).slice(0, 5).map(assistantChoiceFromResolvedEntity),
      executionPlan: plan.executionPlan,
    };
  }

  const commandName = commandNameFromRuntimeIntent(plan.intent);
  const action: AssistantAction = {
    type: "field-update",
    commandName,
    risk: plan.risk,
    needsConfirmation: plan.needsConfirmation,
    confidence: plan.confidence,
    entityContext: plan.resolvedEntity
      ? {
          entityType: plan.resolvedEntity.entityType === "none" ? "unknown" : plan.resolvedEntity.entityType,
          entityId: plan.resolvedEntity.entityId,
          label: plan.resolvedEntity.label,
          query: plan.parsedIntent.entityQuery,
        }
      : undefined,
    fieldsToUpdate: plan.fieldsToUpdate,
    changeSummaries: plan.changes.map((change) => ({
      label: change.label,
      oldValue: change.displayOldValue,
      newValue: change.displayNewValue,
    })),
    auditBeforeData: plan.beforeData || null,
    executionPlan: plan.executionPlan,
    structuredIntent: buildStructuredAssistantIntent({
      intent: commandName,
      entityType: plan.entityType === "none" ? "unknown" : plan.entityType,
      entityQuery: plan.parsedIntent.entityQuery,
      fieldsToUpdate: plan.fieldsToUpdate,
      confidence: plan.confidence,
      missingFields: plan.parsedIntent.missingFields,
      spokenSummary: plan.message,
    }),
    label: plan.message,
    result: plan.spokenSummary || plan.message,
    run: async () => {
      const execution = await plan.run?.();
      action.auditAfterData = execution?.afterData || plan.afterData || null;
      return execution?.result || plan.spokenSummary || plan.message;
    },
  };

  const targetPage = plan.parsedIntent.targetPage || "";
  if (
    targetPage &&
    ["create_maintenance_client", "fill_maintenance_client_form", "schedule_leave", "fill_leave_form"].includes(plan.intent)
  ) {
    return {
      type: "sequence",
      commandName,
      risk: plan.risk,
      needsConfirmation: plan.needsConfirmation,
      confidence: plan.confidence,
      entityContext: action.entityContext,
      fieldsToUpdate: plan.fieldsToUpdate,
      auditBeforeData: plan.beforeData || null,
      auditAfterData: plan.afterData || null,
      structuredIntent: action.structuredIntent,
      executionPlan: plan.executionPlan,
      label: plan.spokenSummary || plan.message,
      result: plan.message,
      actions: [
        {
          type: "navigate",
          commandName: "open_page",
          risk: "low",
          needsConfirmation: false,
          confidence: plan.confidence,
          label: `Deschid ${targetPage}.`,
          path: targetPage,
          result: "Am deschis pagina potrivita.",
        },
        action,
      ],
    };
  }

  return action;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function alphaNumericTokens(value: string): string[] {
  return compactText(value).match(/[a-z]+|\d+/g) || [];
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(normalizeText(term)));
}

const PROJECT_TERMS = ["proiect", "proiectul", "proiectului", "poriect", "poriectul", "proect", "project"];

function hasProjectConcept(value: string) {
  return PROJECT_TERMS.some((term) => value.includes(term));
}

function hasPontajWord(value: string) {
  return /\bponta?aj/.test(value);
}

function hasTimesheetConcept(value: string) {
  return hasPontajWord(value) || /\b(tura|program|lucru|ziua\s+de\s+lucru)\b/.test(value);
}

function hasPontajStartVerb(value: string) {
  return /\b(porn|start|incep|activez|dau\s+drumul)\w*/.test(value);
}

function hasPontajStopVerb(value: string) {
  return /\b(opr|stop|inchid|finaliz|termin|inchei)\w*/.test(value);
}

function hasNavigationVerb(value: string) {
  return /\b(deschid|deschide|du|duc|merg|intra|arata|afiseaza|vezi|navigheaz|muta|sari)\w*/.test(value);
}

function wordsFromText(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function cleanSpeechText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function notifyTimesheetsChanged(userId?: string, reason = "assistant") {
  if (typeof window === "undefined") return;
  const detail = { userId: userId || "", reason, at: Date.now() };
  window.dispatchEvent(new CustomEvent(TIMESHEETS_CHANGED_EVENT, { detail }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(TIMESHEETS_CHANGED_EVENT, { detail: { ...detail, at: Date.now() } }));
  }, 180);
}

function collapseRepeatedSpeech(value: string) {
  const originalWords = cleanSpeechText(value).split(/\s+/).filter(Boolean);
  const output: string[] = [];

  for (const word of originalWords) {
    output.push(word);

    for (let size = Math.min(8, Math.floor(output.length / 2)); size >= 1; size -= 1) {
      const last = output.slice(output.length - size).join(" ").toLowerCase();
      const previous = output.slice(output.length - size * 2, output.length - size).join(" ").toLowerCase();
      if (last && last === previous) {
        output.splice(output.length - size, size);
        break;
      }
    }
  }

  return output.join(" ").trim();
}

function splitCompoundCommands(command: string) {
  return command
    .split(/\s*(?:[,;]\s+|\s+(?:si|și|iar|apoi|dupa aceea|după aceea|dupa asta|după asta)\s+)\s*/i)
    .map((part) => cleanSpeechText(part))
    .filter((part) => part.length >= 3);
}

function isActionLikeSegment(segment: string) {
  const normalized = normalizeText(segment);
  return (
    hasNavigationVerb(normalized) ||
    hasTimesheetConcept(normalized) ||
    isCreateCommand(normalized) ||
    isFieldEditCommand(normalized) ||
    /\b(cauta|filtreaza|gaseste|apasa|apas|click|salveaza|trimite|confirma|sectiune|zona|formular|camp)\b/.test(normalized) ||
    includesAny(normalized, [
      "masina mea",
      "pontajul meu",
      "pontaje",
      "gps",
      "scanare bon",
      "facturi",
      "concediu",
      "concedii",
      "raport",
      "notificare",
      "masina",
      "duba",
      "dubita",
      "autoutilitara",
      "utilitara",
      "scula",
      "client",
      "istoric",
    ])
  );
}

function editDistanceWithin(left: string, right: string, maxDistance: number) {
  if (Math.abs(left.length - right.length) > maxDistance) return false;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
      rowMin = Math.min(rowMin, current[rightIndex]);
    }

    if (rowMin > maxDistance) return false;

    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] <= maxDistance;
}

function textMatchesToken(text: string, token: string) {
  if (!token) return false;
  if (text.includes(token)) return true;
  if (token.length < 4) return false;

  return wordsFromText(text).some((word) => {
    if (word.includes(token) || token.includes(word)) return true;
    const maxDistance = token.length >= 6 ? 2 : 1;
    return editDistanceWithin(word, token, maxDistance);
  });
}

function resolveKnownPageNavigation(normalized: string): AssistantAction | null {
  const pages: Array<{ terms: string[]; label: string; path: string; result: string }> = [
    {
      terms: ["dashboard", "pagina principala", "acasa"],
      label: "Deschid dashboard-ul.",
      path: "/dashboard",
      result: "Am deschis dashboard-ul.",
    },
    {
      terms: ["profilul meu", "profil meu", "contul meu", "profil personal", "datele mele"],
      label: "Deschid profilul meu.",
      path: "/my-profile",
      result: "Am deschis profilul meu.",
    },
    {
      terms: ["pontajul meu", "pontaajul meu", "pontaj meu", "pontajele mele", "pagina pontaj"],
      label: "Deschid pagina Pontajul meu.",
      path: "/my-timesheets",
      result: "Am deschis Pontajul meu.",
    },
    {
      terms: ["pontaje globale", "toate pontajele", "pontaje angajati", "pontaje utilizatori", "dashboard pontaje", "istoric pontaje"],
      label: "Deschid pontajele globale.",
      path: "/timesheets",
      result: "Am deschis pontajele globale.",
    },
    {
      terms: ["concedii", "concediul meu", "cerere concediu", "zi libera", "liber", "planificare concediu"],
      label: "Deschid concediile.",
      path: "/my-leave",
      result: "Am deschis Concedii.",
    },
    {
      terms: ["masini", "lista masini", "vehicule", "flota"],
      label: "Deschid lista de masini.",
      path: "/vehicles",
      result: "Am deschis lista de masini.",
    },
    {
      terms: ["masina noua", "adauga masina", "formular masina", "creeaza masina"],
      label: "Deschid formularul de masina.",
      path: "/vehicles/new",
      result: "Am deschis formularul de masina.",
    },
    {
      terms: ["proiecte", "lista proiecte"],
      label: "Deschid proiectele.",
      path: "/projects",
      result: "Am deschis Proiecte.",
    },
    {
      terms: ["scule", "unelte", "tools"],
      label: "Deschid pagina Scule.",
      path: "/tools",
      result: "Am deschis Scule.",
    },
    {
      terms: ["scula noua", "adauga scula", "formular scula", "creeaza scula"],
      label: "Deschid formularul de scula.",
      path: "/tools/new",
      result: "Am deschis formularul de scula.",
    },
    {
      terms: ["scanare scula", "scanare qr", "scanner scule", "scaneaza scula"],
      label: "Deschid scanarea de scule.",
      path: "/tools/scan",
      result: "Am deschis scanarea de scule.",
    },
    {
      terms: ["utilizatori", "angajati", "useri"],
      label: "Deschid utilizatorii.",
      path: "/users",
      result: "Am deschis Utilizatori.",
    },
    {
      terms: ["notificari", "notificarile"],
      label: "Deschid notificarile.",
      path: "/notifications",
      result: "Am deschis Notificari.",
    },
    {
      terms: ["reguli notificari", "setari notificari"],
      label: "Deschid regulile de notificari.",
      path: "/notification-rules",
      result: "Am deschis regulile de notificari.",
    },
    {
      terms: ["clienti mentenanta", "gestiune mentenanta", "formular client mentenanta"],
      label: "Deschid gestiunea de mentenanta.",
      path: "/maintenance?tab=clients",
      result: "Am deschis gestiunea de mentenanta.",
    },
    {
      terms: ["generare raport mentenanta", "genereaza raport mentenanta", "raport revizie", "raport interventie"],
      label: "Deschid generarea de raport.",
      path: "/maintenance?tab=report&assistant=report#maintenance-report-generator",
      result: "Am deschis generarea de raport.",
    },
    {
      terms: ["firme mentenanta", "branding mentenanta", "logo mentenanta", "stampila mentenanta"],
      label: "Deschid firmele si brandingul de mentenanta.",
      path: "/maintenance?tab=companies",
      result: "Am deschis firmele de mentenanta.",
    },
    {
      terms: ["istoric rapoarte mentenanta", "istoricul rapoartelor", "rapoarte generate mentenanta"],
      label: "Deschid istoricul rapoartelor.",
      path: "/maintenance?tab=history",
      result: "Am deschis istoricul rapoartelor.",
    },
    {
      terms: ["verificari lunare mentenanta", "verifica reviziile lunare", "revizii lunare mentenanta"],
      label: "Deschid verificarile lunare.",
      path: "/maintenance?tab=checks",
      result: "Am deschis verificarile lunare.",
    },
    {
      terms: ["mentenanta", "rapoarte mentenanta"],
      label: "Deschid mentenanta.",
      path: "/maintenance",
      result: "Am deschis Mentenanta.",
    },
    {
      terms: ["comenzi piese", "piese mentenanta"],
      label: "Deschid comenzile de piese.",
      path: "/maintenance?tab=parts",
      result: "Am deschis comenzile de piese.",
    },
    {
      terms: ["scanare bon", "scanare bonuri", "bonuri", "incarca bon", "bon nou", "cheltuieli scanare"],
      label: "Deschid scanarea de bonuri.",
      path: "/expenses/scan",
      result: "Am deschis scanarea de bonuri.",
    },
    {
      terms: ["facturi", "factura", "lista facturi", "invoices"],
      label: "Deschid facturile.",
      path: "/expenses/invoices",
      result: "Am deschis Facturi.",
    },
    {
      terms: ["rapoarte cheltuieli", "cheltuieli", "raport cheltuieli"],
      label: "Deschid rapoartele de cheltuieli.",
      path: "/expenses/reports",
      result: "Am deschis rapoartele de cheltuieli.",
    },
    {
      terms: ["firme", "companii"],
      label: "Deschid firmele.",
      path: "/companies",
      result: "Am deschis Firme.",
    },
    {
      terms: ["istoric", "audit"],
      label: "Deschid istoricul.",
      path: "/history",
      result: "Am deschis Istoric.",
    },
    {
      terms: ["panou control", "control panel", "rapoarte", "raport general"],
      label: "Deschid panoul de control.",
      path: "/control-panel",
      result: "Am deschis panoul de control.",
    },
  ];

  for (const page of pages) {
    if (includesAny(normalized, page.terms)) {
      return {
        type: "navigate",
        label: page.label,
        path: page.path,
        result: page.result,
      };
    }
  }

  return null;
}

type FieldTarget = {
  key: string;
  fieldLabel: string;
  aliases: string[];
  transform?: (value: string) => string;
};

function isFieldEditCommand(normalized: string) {
  return /\b(modific|schimb|edit|editeaz|actualizeaz|corecteaz|select|aleg|seteaz|setez|pune|pun|completeaz|completez|alege|scrie|introdu|bifeaz|debifeaz)\w*/.test(normalized);
}

function cleanFieldValue(value: string) {
  return value
    .replace(/\b(te rog|multumesc|acum|de acum|in formular|in pagina)\b/gi, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedValue(command: string) {
  const normalized = normalizeText(command);
  if (/\b(alt|alta|altul|urmatorul|urmatoarea)\b/.test(normalized)) {
    return "__NEXT__";
  }

  const patterns = [
    /(?:sa|să)\s+\S+\s+(.+)$/i,
    /\b(?:cu|la|in|în)\s+(.+)$/i,
    /\b(?:modifica|modific|schimba|schimb|editeaza|editez|actualizeaza|actualizez|corecteaza|corectez|selecteaza|selectez|alege|aleg|pune|pun|seteaza|setez|completeaza|completez)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) return cleanFieldValue(match[1]);
  }

  return "";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function stripLeadingValueNoise(value: string) {
  return cleanFieldValue(
    normalizeText(value)
      .replace(/^(?:cu|la|in|pe|de|este|e|sa fie|sa|valoarea|catre)\b\s*/g, "")
      .replace(/\b(?:si|apoi)\s+(?:salveaza|salvez)\b.*$/g, "")
      .trim()
  );
}

function extractRequestedValueForTarget(command: string, target: FieldTarget) {
  const normalized = normalizeText(command);
  const aliases = [...target.aliases].map(normalizeText).sort((a, b) => b.length - a.length);
  let requested = extractRequestedValue(command);

  for (const alias of aliases) {
    const index = normalized.lastIndexOf(alias);
    if (index < 0) continue;

    const afterAlias = stripLeadingValueNoise(normalized.slice(index + alias.length));
    const requestedNormalized = normalizeText(requested);
    if (
      afterAlias &&
      (!requested ||
        requestedNormalized.includes(alias) ||
        afterAlias.length < requestedNormalized.length ||
        requestedNormalized === normalized.slice(normalized.indexOf(alias)).trim())
    ) {
      requested = afterAlias;
    }
    break;
  }

  let cleanValue = stripLeadingValueNoise(requested);
  let changed = true;
  while (changed) {
    changed = false;
    const current = normalizeText(cleanValue);
    for (const alias of aliases) {
      if (current === alias) {
        cleanValue = "";
        changed = true;
        break;
      }
      if (current.startsWith(`${alias} `)) {
        cleanValue = stripLeadingValueNoise(current.slice(alias.length));
        changed = true;
        break;
      }
    }
  }

  return cleanFieldValue(cleanValue);
}

function parseSpokenNumber(value: string) {
  const normalized = normalizeText(value);
  const directMatch = normalized.match(/\b\d+(?:[.,]\d+)?\b/);
  if (directMatch) {
    const rawNumber = directMatch[0];
    const normalizedNumber = /^\d{1,3}(?:[.,]\d{3})+$/.test(rawNumber)
      ? rawNumber.replace(/[.,]/g, "")
      : rawNumber.replace(",", ".");
    const parsed = Number(normalizedNumber);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const smallNumbers: Record<string, number> = {
    zero: 0,
    un: 1,
    una: 1,
    unu: 1,
    o: 1,
    doi: 2,
    doua: 2,
    trei: 3,
    patru: 4,
    cinci: 5,
    sase: 6,
    sapte: 7,
    opt: 8,
    noua: 9,
    zece: 10,
    unsprezece: 11,
    doisprezece: 12,
    douasprezece: 12,
    treisprezece: 13,
    paisprezece: 14,
    cincisprezece: 15,
    saisprezece: 16,
    saptesprezece: 17,
    optsprezece: 18,
    nouasprezece: 19,
  };
  const tens: Record<string, number> = {
    douazeci: 20,
    treizeci: 30,
    patruzeci: 40,
    cincizeci: 50,
    saizeci: 60,
    saptezeci: 70,
    optzeci: 80,
    nouazeci: 90,
  };

  let total = 0;
  let current = 0;
  let found = false;

  for (const token of normalized.split(/\s+/)) {
    if (!token || token === "si" || token === "de") continue;
    if (smallNumbers[token] !== undefined) {
      current += smallNumbers[token];
      found = true;
      continue;
    }
    if (tens[token] !== undefined) {
      current += tens[token];
      found = true;
      continue;
    }
    if (token === "suta" || token === "sute") {
      current = Math.max(1, current) * 100;
      found = true;
      continue;
    }
    if (token === "mie" || token === "mii") {
      total += Math.max(1, current) * 1000;
      current = 0;
      found = true;
    }
  }

  if (!found) return null;
  const parsed = total + current;
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveAssistantHelpAction(command: string): AssistantAction | null {
  const normalized = normalizeText(command);
  const asksForHelp =
    includesAny(normalized, [
      "ce poti face",
      "ce pot face",
      "ce pot sa fac",
      "ce pot sa iti cer",
      "ce stii sa faci",
      "ce stie asistentul",
      "lista cu ce poti face",
      "lista functionalitati",
      "functionalitati",
      "capabilitati",
      "ce comenzi",
      "exemple comenzi",
      "scenariu",
      "ajutor asistent",
    ]) ||
    (normalized.includes("asistent") && includesAny(normalized, ["ajutor", "exemple", "comenzi", "scenariu", "functionalitati", "capabilitati"]));

  if (!asksForHelp) return null;

  const matchedSections = ASSISTANT_CAPABILITY_SECTIONS.filter((section) =>
    section.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
  );
  const sections = matchedSections.length > 0 && matchedSections.length < ASSISTANT_CAPABILITY_SECTIONS.length
    ? matchedSections
    : [...ASSISTANT_CAPABILITY_SECTIONS];

  return {
    type: "info",
    label: "Arat ce poate face asistentul.",
    result: formatCapabilitySections(sections),
  };
}

function isCreateCommand(normalized: string) {
  return /\b(creeaza|creaza|adauga|fa|fă|deschide formular|formular nou)\b/.test(normalized);
}

function extractNameAfterTerms(command: string, terms: string[]) {
  let text = command;
  const normalizedTerms = terms.map((term) => normalizeText(term)).sort((a, b) => b.length - a.length);
  const normalizedCommand = normalizeText(command);

  for (const term of normalizedTerms) {
    const index = normalizedCommand.indexOf(term);
    if (index >= 0) {
      text = command.slice(index + term.length);
      break;
    }
  }

  return cleanFieldValue(
    text
      .replace(/\b(creeaza|creaza|adauga|fa|fă|nou|noua|nouă|un|o|formular|pentru)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractProjectQueryForTimesheet(command: string) {
  const normalized = normalizeText(command);
  if (!hasTimesheetConcept(normalized) || !hasPontajStartVerb(normalized) || !hasProjectConcept(normalized)) {
    return "";
  }

  const projectMatch = normalized.match(/\b(?:proiect|poriect|proect|project)(?:ul|ului)?\b/);
  if (!projectMatch || typeof projectMatch.index !== "number") return "";

  let value = normalized.slice(projectMatch.index + projectMatch[0].length).trim();
  const stopMarkers = [
    /\bsi\s+(?:dai|da|porneste|pornesc|incepe|incep|activeaza|activez|start)\b/,
    /\bapoi\s+(?:dai|da|porneste|pornesc|incepe|incep|activeaza|activez|start)\b/,
    /\bdupa\s+(?:aceea\s+)?(?:dai|da|porneste|pornesc|incepe|incep|activeaza|activez|start)\b/,
    /\bdai\s+start\b/,
    /\bda\s+start\b/,
    /\bstart\s+ponta?aj\b/,
    /\bporneste\s+ponta?aj\b/,
    /\bincepe\s+ponta?aj\b/,
  ];

  for (const marker of stopMarkers) {
    const match = value.match(marker);
    if (match && typeof match.index === "number") {
      value = value.slice(0, match.index).trim();
    }
  }

  return cleanFieldValue(
    value
      .replace(/\b(selecteaza|selectez|alege|aleg|pune|pun|seteaza|setez|creeaza|creaza|adauga|fa|nou|noua|formular|pe|la|cu)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractCreateProjectAndStartQuery(command: string) {
  const normalized = normalizeText(command);
  if (!isCreateCommand(normalized) || !hasProjectConcept(normalized) || !hasTimesheetConcept(normalized) || !hasPontajStartVerb(normalized)) {
    return "";
  }
  return extractProjectQueryForTimesheet(command);
}

function extractMaintenanceClientDraft(command: string) {
  const explicitName = command.match(
    /\b(?:cu\s+numele|numele|numit|denumit)\s+(.+?)(?=\s+(?:si|È™i)?\s*(?:liftul|lift|lifturi|numar\s+lift|email|e-mail|mail|firma|companie|adresa|telefon|contact)\b|$)/i
  );
  const clientAfterAction = command.match(
    /\b(?:adauga|adaug|creeaza|creaza|completeaza|fa|fÄƒ)\w*\s+(?:client(?:\s+nou)?(?:\s+in\s+mentenanta|\s+mentenanta)?\s*)?(.+?)(?=\s+(?:cu\s+)?(?:liftul|lift|lifturi|numar\s+lift|email|e-mail|mail|firma|companie|adresa|telefon|contact)\b|$)/i
  );
  const name = explicitName?.[1] || clientAfterAction?.[1] || extractNameAfterTerms(command, ["client mentenanta", "client nou", "client"]);
  return cleanFieldValue(
    name
      .replace(/\b(?:si|È™i)\s+(?:liftul|lift|lifturi|numar\s+lift|email|e-mail|mail|firma|companie|adresa|telefon|contact)\b.+$/i, " ")
      .replace(/\b(?:liftul|lift|lifturi|numar\s+lift|email|e-mail|mail|firma|companie|adresa|telefon|contact)\b.+$/i, " ")
      .replace(/\b(?:du|duma|du\s+ma|pagina|formularul|formular|mentenanta|maintenance|revizie|revizii|client|adauga|adaug|creeaza|creaza|completeaza|numele|numit|denumit|cu|nou|noua|in|la|pe|pentru)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractMaintenanceClientDraftSafe(command: string) {
  const normalized = normalizeText(command);
  const explicitName = normalized.match(
    /\b(?:cu\s+numele|numele|numit|denumit)\s+(.+?)(?=\s+(?:si\s+)?(?:liftul|lift|lifturi|numar\s+lift|email|e\s+mail|mail|firma|companie|adresa|telefon|contact)\b|$)/i
  );
  const actionName = normalized.match(
    /\b(?:adauga|adaug|creeaza|creaza|completeaza|fa)\w*\s+(?:client(?:\s+nou)?(?:\s+in\s+mentenanta|\s+mentenanta)?\s*)?(.+?)(?=\s+(?:cu\s+)?(?:liftul|lift|lifturi|numar\s+lift|email|e\s+mail|mail|firma|companie|adresa|telefon|contact)\b|$)/i
  );
  const value = cleanFieldValue(explicitName?.[1] || actionName?.[1] || "");
  const cleaned = value
    .replace(/\b(?:du|duma|du\s+ma|pagina|formularul|formular|mentenanta|maintenance|revizie|revizii|client|adauga|adaug|creeaza|creaza|completeaza|numele|numit|denumit|cu|nou|noua|in|la|pe|pentru|de)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    const fallback = extractMaintenanceClientDraft(command);
    const fallbackNormalized = normalizeText(fallback);
    if (/\b(pagina|formular|mentenanta|maintenance|lift|email|firma|adresa|telefon|contact)\b/.test(fallbackNormalized)) {
      return "";
    }
    return fallback;
  }

  return cleaned;
}

function extractMaintenanceClientParams(command: string) {
  const normalized = normalizeText(command);
  const addressMatch = normalized.match(/\b(?:adresa|la adresa)\s+(.+?)(?:\s+\b(?:numar lift|liftul|lift|email|e\s+mail|firma|companie|telefon|contact)\b|$)/i);
  const liftMatch = normalized.match(/\b(?:numar lift|liftul|lift|lifturi)\s+([a-zA-Z0-9._,\s-]+?)(?:\s+\b(?:email|e\s+mail|mail|firma|companie|adresa|telefon|contact)\b|$)/i);
  const emailMatch = command.match(/\b(?:email|e-mail|mail)\s+([^\s,;]+)/i);
  const companyMatch = normalized.match(/\b(?:firma|companie)\s+(.+?)(?:\s+\b(?:adresa|numar lift|lift|email|e\s+mail|telefon|contact)\b|$)/i);
  const phoneMatch = command.match(/\b(?:telefon|tel|phone)\s+([+0-9\s.-]{6,20})/i);
  const contactMatch = normalized.match(/\b(?:persoana contact|contact)\s+(.+?)(?:\s+\b(?:telefon|tel|email|e\s+mail|mail|firma|companie|adresa|numar lift|lift)\b|$)/i);
  const liftNumbers = (liftMatch?.[1] || "")
    .split(/[,;/]|\s+si\s+|\s+și\s+/i)
    .map((item) => cleanFieldValue(item).replace(/\s+/g, ""))
    .filter(Boolean);

  return {
    name: extractMaintenanceClientDraftSafe(command),
    address: cleanFieldValue(addressMatch?.[1] || ""),
    lift: liftNumbers[0] || "",
    liftNumbers,
    email: cleanFieldValue(emailMatch?.[1] || ""),
    company: cleanFieldValue(companyMatch?.[1] || ""),
    contactPerson: cleanFieldValue(contactMatch?.[1] || ""),
    contactPhone: cleanFieldValue(phoneMatch?.[1] || ""),
  };
}

function extractVehicleDraft(command: string) {
  const normalized = normalizeText(command);
  const plateMatch = command.match(/\b([a-zA-Z]{1,2}\s*\d{2,3}\s*[a-zA-Z]{2,3})\b/);
  const brandMatch = normalized.match(/\bmarca\s+([a-z0-9 -]{2,30}?)(?:\s+model|\s+cu|\s+numar|$)/);
  const modelMatch = normalized.match(/\bmodel\s+([a-z0-9 -]{1,40}?)(?:\s+cu|\s+numar|$)/);

  return {
    plate: plateMatch?.[1]?.replace(/\s+/g, "").toUpperCase() || "",
    brand: brandMatch?.[1]?.trim() || "",
    model: modelMatch?.[1]?.trim() || "",
  };
}

function extractToolDraft(command: string) {
  const codeMatch = command.match(/\b(?:cod|codul)\s+([a-zA-Z0-9-_.]+)/i);
  const name = extractNameAfterTerms(command, ["scula", "unealta", "tool"]);
  return {
    name: name.replace(/\b(?:cod|codul)\s+[a-zA-Z0-9-_.]+/i, "").trim(),
    code: codeMatch?.[1]?.trim().toUpperCase() || "",
  };
}

function extractUserActivitySearch(command: string) {
  const normalized = normalizeText(command);
  const explicitMatch = normalized.match(
    /\b(?:a\s+lui|al\s+lui|ale\s+lui|lui|lu|pentru|userul|utilizatorul|angajatul|colegul|persoana)\s+(.+)$/
  );
  const raw = explicitMatch?.[1] || normalized;
  return cleanFieldValue(
    raw
      .replace(
        /\b(?:ce|facut|facuse|face|aratami|arata|arata mi|spunemi|spune mi|spune|zi|vezi|vreau|deschide|du|duma|du ma|merg|cauta|gaseste|ultima|ultimul|ultimele|recenta|recent|activitate|activitatea|miscare|miscarea|actiune|actiunile|istoric|istoricul|site|pagina|pagini|user|userului|utilizator|utilizatorului|angajat|angajatului|coleg|colegului|lui|lu|a|al|ale|pentru|pe)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractNotificationRequest(command: string) {
  const withoutIntro = command
    .replace(/\b(creeaza|creaza|adauga|trimite|fa|fă)\b/gi, " ")
    .replace(/\b(notificare|notificarea|speciala|specială)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const targetMatch = withoutIntro.match(/\b(?:pentru|catre|către)\s+(.+?)\s*(?:mesaj|text|cu mesajul|:|-)?\s*(.*)$/i);

  if (targetMatch?.[1]) {
    const possibleMessage = targetMatch[2]?.trim();
    return {
      target: cleanFieldValue(targetMatch[1]),
      message: cleanFieldValue(possibleMessage || withoutIntro.replace(targetMatch[0], "")) || cleanFieldValue(withoutIntro),
    };
  }

  return {
    target: "",
    message: cleanFieldValue(withoutIntro),
  };
}

type AssistantUserMatch = {
  id: string;
  uid?: string;
  fullName?: string;
  email?: string;
  themeKey?: string | null;
};

function findUserMatch(users: AssistantUserMatch[], targetText: string) {
  const normalizedTarget = normalizeText(targetText);
  if (!normalizedTarget) return null;

  return users
    .map((item) => {
      const label = normalizeText(`${item.fullName || ""} ${item.email || ""}`);
      const compactLabel = compactText(label);
      const compactTarget = compactText(normalizedTarget);
      const tokens = wordsFromText(normalizedTarget).filter((token) => token.length >= 2);
      let score = 0;
      if (label === normalizedTarget) score += 130;
      if (label.includes(normalizedTarget)) score += 90;
      if (compactTarget && compactLabel.includes(compactTarget)) score += 75;
      tokens.forEach((token) => {
        if (textMatchesToken(label, token)) score += 28;
      });
      if (tokens.length > 0 && tokens.every((token) => textMatchesToken(label, token))) score += 45;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item || null;
}

function isUserProfileCommand(normalized: string) {
  if (includesAny(normalized, ["utilizatori", "lista utilizatori", "angajati", "lista angajati"])) return false;
  return (
    includesAny(normalized, ["profilul lui", "profil lui", "profil utilizator", "profil angajat", "datele lui"]) ||
    (/\b(profil|datele)\b/.test(normalized) && hasNavigationVerb(normalized)) ||
    (/\b(userul|utilizatorul|angajatul|colegul)\b/.test(normalized) && hasNavigationVerb(normalized))
  );
}

function isUserActivityCommand(normalized: string) {
  return (
    includesAny(normalized, [
      "ultima activitate",
      "ultimul eveniment",
      "ultima miscare",
      "ultima actiune",
      "ce a facut",
      "ce face",
      "istoricul lui",
      "istoric lui",
      "activitatea userului",
      "activitatea utilizatorului",
      "miscarea userului",
      "intrarile pe site",
      "pagini accesate",
    ]) ||
    (includesAny(normalized, ["istoric", "audit", "activitate", "miscare", "actiune"]) &&
      includesAny(normalized, ["lui", "lu", "user", "utilizator", "angajat", "coleg"]))
  );
}

async function resolveUserActivityAction(command: string, currentUserId?: string): Promise<AssistantAction | null> {
  const normalized = normalizeText(command);
  if (!isUserActivityCommand(normalized) && !isUserProfileCommand(normalized)) return null;

  const users = await getAllUsers();
  const userQuery = extractUserActivitySearch(command);
  const matchedUser = userQuery ? findUserMatch(users, userQuery) : null;
  const targetUserId = matchedUser?.id || (!userQuery && currentUserId ? currentUserId : "");
  const targetLabel = matchedUser?.fullName || matchedUser?.email || userQuery || "utilizatorul cerut";

  if (isUserProfileCommand(normalized) && targetUserId) {
    return {
      type: "navigate",
      commandName: "open_user_activity",
      risk: "low",
      needsConfirmation: false,
      confidence: matchedUser ? 0.9 : 0.72,
      entityContext: {
        entityType: "user",
        entityId: targetUserId,
        label: targetLabel,
        query: userQuery,
      },
      label: `Deschid profilul lui ${targetLabel}.`,
      path: `/users/${targetUserId}#user-recent-activity`,
      result: "Am deschis profilul utilizatorului.",
    };
  }

  const params = new URLSearchParams();
  params.set("assistantLatest", "1");
  if (targetUserId) {
    params.set("assistantUserId", targetUserId);
  } else if (userQuery) {
    params.set("assistantSearch", userQuery);
  }

  return {
    type: "navigate",
    commandName: "open_user_activity",
    risk: "low",
    needsConfirmation: false,
    confidence: targetUserId ? 0.88 : 0.66,
    entityContext: targetUserId
      ? {
          entityType: "user",
          entityId: targetUserId,
          label: targetLabel,
          query: userQuery,
        }
      : undefined,
    label: targetUserId
      ? `Deschid istoricul pe ultima activitate a lui ${targetLabel}.`
      : userQuery
        ? `Nu am potrivit exact userul. Deschid istoricul cautand ${userQuery}.`
        : "Deschid ultima activitate din istoric.",
    path: `/history?${params.toString()}`,
    result: "Am deschis istoricul activitatii.",
  };
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateCandidate(day: number, month: number, year?: number) {
  const now = new Date();
  const normalizedYear = year && year < 100 ? 2000 + year : year || now.getFullYear();
  const date = new Date(normalizedYear, month - 1, day);
  if (
    date.getFullYear() !== normalizedYear ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }
  return toIsoDate(date);
}

function parseDateHints(command: string) {
  const normalized = normalizeText(command);
  const dates: string[] = [];

  if (normalized.includes("azi")) {
    dates.push(toIsoDate(new Date()));
  }

  if (normalized.includes("maine")) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dates.push(toIsoDate(tomorrow));
  }

  for (const match of normalized.matchAll(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/g)) {
    const date = parseDateCandidate(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : undefined);
    if (date) dates.push(date);
  }

  for (const match of normalized.matchAll(/\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?\b/g)) {
    const month = MONTHS_RO[match[2]];
    if (!month) continue;
    const date = parseDateCandidate(Number(match[1]), month, match[3] ? Number(match[3]) : undefined);
    if (date) dates.push(date);
  }

  return Array.from(new Set(dates));
}

type AssistantProfileContext = {
  uid: string;
  roleTitle?: string;
  department?: string;
} | null;

type ProfileQuickField = {
  key: "roleTitle" | "department";
  label: string;
  aliases: string[];
};

const PROFILE_QUICK_FIELDS: ProfileQuickField[] = [
  {
    key: "roleTitle",
    label: "functie",
    aliases: ["functie", "functia", "meserie", "post", "postul", "rol profesional"],
  },
  {
    key: "department",
    label: "departament",
    aliases: ["departament", "departamentul", "sectie", "echipa"],
  },
];

function detectProfileQuickField(normalized: string) {
  return PROFILE_QUICK_FIELDS.flatMap((field) =>
    field.aliases.map((alias) => ({ field, alias: normalizeText(alias) }))
  )
    .filter(({ alias }) => normalized.includes(alias) || wordsFromText(alias).every((token) => textMatchesToken(normalized, token)))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.field || null;
}

function normalizeProfileFieldValue(field: ProfileQuickField, value: string) {
  const normalized = normalizeText(value);

  if (field.key === "department") {
    if (includesAny(normalized, ["montaj", "montaj lift", "montaj lifturi", "instalare lift"])) {
      return "Montaj Lifturi";
    }
    if (includesAny(normalized, ["service", "intretinere", "mentenanta", "revizie"])) {
      return "Service si Intretinere Lifturi";
    }
  }

  const roleAliases: Array<{ terms: string[]; value: string }> = [
    { terms: ["electrician", "electricieni"], value: "Electrician" },
    { terms: ["montator", "montator lift", "montator lifturi"], value: "Montator lifturi" },
    { terms: ["mecanic", "mecanic utilaje", "mecanic echipamente"], value: "Mecanic utilaje" },
    { terms: ["sofer", "conducator auto"], value: "Sofer" },
    { terms: ["necalificat", "muncitor necalificat"], value: "Necalificat" },
    { terms: ["tehnician", "tehnician service"], value: "Tehnician service" },
    { terms: ["coordonator", "sef echipa"], value: "Coordonator echipa" },
    { terms: ["manager", "manager proiect"], value: "Manager proiect" },
  ];

  if (field.key === "roleTitle") {
    const match = roleAliases.find((item) => includesAny(normalized, item.terms));
    if (match) return match.value;
  }

  return cleanFieldValue(value);
}

function resolveProfileQuickUpdateAction(
  command: string,
  profile: AssistantProfileContext,
  navigateTo: (path: string) => void
): AssistantAction | null {
  const normalized = normalizeText(command);
  if (!profile?.uid || !isFieldEditCommand(normalized)) return null;

  const field = detectProfileQuickField(normalized);
  if (!field) return null;

  const hasProfileContext =
    includesAny(normalized, ["profil", "profilul meu", "datele mele", "contul meu", "functia mea", "departamentul meu"]) ||
    includesAny(normalized, field.aliases);
  if (!hasProfileContext) return null;

  const target: FieldTarget = { key: field.key, fieldLabel: field.label, aliases: field.aliases };
  const rawValue = extractRequestedValueForTarget(command, target);
  const nextValue = normalizeProfileFieldValue(field, rawValue);
  if (!nextValue) return null;

  const action: AssistantAction = {
    type: "field-update",
    commandName: "update_profile",
    risk: "medium",
    needsConfirmation: true,
    confidence: 0.9,
    entityContext: {
      entityType: "user",
      entityId: profile.uid,
      label: "profilul tau",
      query: command,
    },
    fieldsToUpdate: {
      [field.label]: nextValue,
    },
    auditBeforeData: {
      uid: profile.uid,
      roleTitle: profile.roleTitle || "",
      department: profile.department || "",
    },
    label: `Actualizez ${field.label} la ${nextValue} in profilul tau.`,
    result: `Am actualizat ${field.label} la ${nextValue}.`,
    run: async () => {
      const nextRoleTitle = field.key === "roleTitle" ? nextValue : profile.roleTitle || "";
      const nextDepartment = field.key === "department" ? nextValue : profile.department || "";
      await updateUserWorkDetails(profile.uid, {
        roleTitle: nextRoleTitle,
        department: nextDepartment,
      });
      action.auditAfterData = {
        uid: profile.uid,
        roleTitle: nextRoleTitle,
        department: nextDepartment,
      };
      navigateTo("/my-profile");
      return `Am actualizat ${field.label} la ${nextValue}.`;
    },
  };

  return action;
}

type VehicleQuickField = {
  key: keyof VehicleFormValues | "driver" | "owner";
  label: string;
  kind: "number" | "date" | "text" | "status" | "user";
  aliases: string[];
};

const VEHICLE_QUICK_FIELDS: VehicleQuickField[] = [
  {
    key: "initialRecordedKm",
    label: "km la inregistrare",
    kind: "number",
    aliases: ["km la inregistrare", "km initiali", "kilometri initiali", "kilometraj initial"],
  },
  {
    key: "currentKm",
    label: "km curenti",
    kind: "number",
    aliases: ["km curenti", "km actuali", "kilometraj actual", "kilometraj curent", "kilometraj", "kilometri", "km"],
  },
  {
    key: "nextItpDate",
    label: "data ITP",
    kind: "date",
    aliases: ["data itp", "itp pana la", "expirare itp", "itp"],
  },
  {
    key: "nextRcaDate",
    label: "data RCA",
    kind: "date",
    aliases: ["data rca", "rca pana la", "expirare rca", "rca"],
  },
  {
    key: "nextCascoDate",
    label: "data CASCO",
    kind: "date",
    aliases: ["data casco", "casco pana la", "expirare casco", "casco"],
  },
  {
    key: "nextRovinietaDate",
    label: "data rovinieta",
    kind: "date",
    aliases: ["data rovinieta", "rovinieta pana la", "expirare rovinieta", "rovinieta"],
  },
  {
    key: "serviceIntervalKm",
    label: "interval service",
    kind: "number",
    aliases: ["interval service", "revizie la fiecare", "service la fiecare"],
  },
  {
    key: "nextServiceKm",
    label: "prag service",
    kind: "number",
    aliases: ["prag service", "service la km", "urmator service", "urmatorul service"],
  },
  {
    key: "nextOilServiceKm",
    label: "revizie ulei",
    kind: "number",
    aliases: ["revizie ulei", "ulei la km", "service ulei", "schimb ulei"],
  },
  {
    key: "driver",
    label: "sofer curent",
    kind: "user",
    aliases: ["sofer", "soferul", "sofer curent", "conducator", "driver", "utilizator curent"],
  },
  {
    key: "owner",
    label: "responsabil principal",
    kind: "user",
    aliases: ["responsabil", "responsabil principal", "proprietar", "owner", "manager masina"],
  },
  {
    key: "plateNumber",
    label: "numar inmatriculare",
    kind: "text",
    aliases: ["numar inmatriculare", "numarul de inmatriculare", "nr inmatriculare", "placuta"],
  },
  { key: "brand", label: "marca", kind: "text", aliases: ["marca", "brand"] },
  { key: "model", label: "model", kind: "text", aliases: ["model"] },
  { key: "vin", label: "serie sasiu", kind: "text", aliases: ["serie sasiu", "vin", "serie vin"] },
  { key: "fuelType", label: "combustibil", kind: "text", aliases: ["combustibil", "carburant"] },
  { key: "status", label: "status", kind: "status", aliases: ["status", "stare"] },
];

function isVehicleFormFieldKey(key: VehicleQuickField["key"]): key is keyof VehicleFormValues {
  return key !== "driver" && key !== "owner";
}

function detectVehicleQuickField(normalized: string) {
  return VEHICLE_QUICK_FIELDS.flatMap((field) =>
    field.aliases.map((alias) => ({ field, alias: normalizeText(alias) }))
  )
    .filter(({ alias }) => normalized.includes(alias) || wordsFromText(alias).every((token) => textMatchesToken(normalized, token)))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.field || null;
}

function parseVehicleStatusValue(value: string): VehicleStatus | null {
  const normalized = normalizeText(value);
  if (includesAny(normalized, ["activa", "activ", "disponibila"])) return "activa";
  if (includesAny(normalized, ["service", "in service", "revizie"])) return "in_service";
  if (includesAny(normalized, ["indisponibila", "indisponibil"])) return "indisponibila";
  if (includesAny(normalized, ["avariata", "avariat", "defecta", "defect"])) return "avariata";
  return VEHICLE_STATUSES.find((status) => normalizeText(status) === normalized) || null;
}

function parseVehicleQuickValue(command: string, field: VehicleQuickField) {
  const target: FieldTarget = { key: String(field.key), fieldLabel: field.label, aliases: field.aliases };
  const rawValue = extractRequestedValueForTarget(command, target);

  if (field.kind === "date") {
    return parseDateHints(rawValue)[0] || parseDateHints(command)[0] || null;
  }

  if (field.kind === "number") {
    const numberValue = parseSpokenNumber(rawValue || command);
    return numberValue === null ? null : Math.max(0, numberValue);
  }

  if (field.kind === "status") {
    return parseVehicleStatusValue(rawValue);
  }

  if (field.kind === "user") {
    return cleanFieldValue(rawValue || command)
      .replace(/\b(?:masina|masinii|vehicul|vehiculul|sofer|soferul|responsabil|principal|cu|pe|la|in|pentru)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const textValue = cleanFieldValue(rawValue);
  if (!textValue) return null;
  if (field.key === "plateNumber") return textValue.replace(/\s+/g, "").toUpperCase();
  if (field.key === "vin") return textValue.replace(/\s+/g, "").toUpperCase();
  return textValue;
}

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

function getCurrentVehicleIdFromPath(pathname?: string) {
  const path = pathname || "";
  const match = path.match(/^\/vehicles\/([^/?#]+)(?:\/edit|\/live)?\/?$/);
  const vehicleId = match?.[1] || "";
  if (!vehicleId || vehicleId === "new" || vehicleId === "gps-map") return "";
  return vehicleId;
}

async function resolveVehicleForAssistantUpdate(command: string, userId?: string, currentPathname?: string, contextVehicleId?: string) {
  const normalized = normalizeText(command);
  const currentVehicleId = getCurrentVehicleIdFromPath(currentPathname);
  const wantsOwnVehicle =
    includesAny(normalized, ["masina mea", "vehiculul meu", "auto meu", "masina personala"]) ||
    /\b(mea|meu)\b/.test(normalized);

  if (currentVehicleId) {
    const currentVehicle = await getVehicleById(currentVehicleId);
    if (currentVehicle) {
      return {
        vehicle: currentVehicle,
        isOwnVehicle: currentVehicle.currentDriverUserId === userId || currentVehicle.ownerUserId === userId,
      };
    }
  }

  if (contextVehicleId) {
    const contextVehicle = await getVehicleById(contextVehicleId);
    if (contextVehicle) {
      return {
        vehicle: contextVehicle,
        isOwnVehicle: contextVehicle.currentDriverUserId === userId || contextVehicle.ownerUserId === userId,
      };
    }
  }

  if (wantsOwnVehicle && userId) {
    const ownVehicle = await getMyVehicleForUser(userId);
    if (ownVehicle) return { vehicle: ownVehicle, isOwnVehicle: true };
  }

  const vehicles = await getVehiclesList();
  const ranked = vehicles
    .map((vehicle) => ({ vehicle, score: vehicleScore(vehicle, command) }))
    .sort((a, b) => b.score - a.score);
  const match = ranked.find((item) => item.score >= 30)?.vehicle || null;

  if (match) {
    return { vehicle: match, isOwnVehicle: wantsOwnVehicle || match.currentDriverUserId === userId || match.ownerUserId === userId };
  }

  if (userId) {
    const genericVehicleUpdate =
      includesAny(normalized, [
        "masina",
        "masinii",
        "vehicul",
        "auto",
        "duba",
        "dubei",
        "dubita",
        "autoutilitara",
        "utilitara",
        "km",
        "kilometri",
        "kilometraj",
        "sofer",
        "responsabil",
      ]) &&
      !ranked.some((item) => item.score >= 20);
    if (genericVehicleUpdate) {
      const ownVehicle = await getMyVehicleForUser(userId);
      if (ownVehicle) return { vehicle: ownVehicle, isOwnVehicle: true };
    }
  }

  if (wantsOwnVehicle && userId) return null;
  return vehicles.length === 1 ? { vehicle: vehicles[0], isOwnVehicle: vehicles[0].currentDriverUserId === userId || vehicles[0].ownerUserId === userId } : null;
}

async function resolveVehicleQuickUpdateAction(
  command: string,
  userId: string | undefined,
  currentPathname: string | undefined,
  navigateTo: (path: string) => void,
  contextVehicleId?: string
): Promise<AssistantAction | null> {
  const normalized = normalizeText(command);
  if (!isFieldEditCommand(normalized)) return null;

  const field = detectVehicleQuickField(normalized);
  if (!field) return null;

  const hasVehicleContext =
    includesAny(normalized, [
      "masina",
      "masinii",
      "vehicul",
      "auto",
      "duba",
      "dubei",
      "dubita",
      "autoutilitara",
      "utilitara",
      "km",
      "kilometri",
      "inmatriculare",
      "kilometraj",
      "km curenti",
      "km actuali",
      "km la inregistrare",
      "itp",
      "rca",
      "casco",
      "rovinieta",
      "sofer",
      "responsabil",
      "marca",
      "model",
      "vin",
      "status",
    ]);
  if (!hasVehicleContext && !getCurrentVehicleIdFromPath(currentPathname)) return null;

  const parsedValue = parseVehicleQuickValue(command, field);
  if (parsedValue === null || parsedValue === "") return null;

  const resolved = await resolveVehicleForAssistantUpdate(command, userId, currentPathname, contextVehicleId);
  if (!resolved?.vehicle) return null;

  const label = `${resolved.vehicle.plateNumber || ""} ${resolved.vehicle.brand || ""} ${resolved.vehicle.model || ""}`
    .replace(/\s+/g, " ")
    .trim();
  const displayValue = typeof parsedValue === "number" ? parsedValue.toLocaleString("ro-RO") : String(parsedValue);
  const previousRawValue =
    field.key === "driver"
      ? resolved.vehicle.currentDriverUserName
      : field.key === "owner"
        ? resolved.vehicle.ownerUserName
        : (resolved.vehicle as unknown as Record<string, unknown>)[String(field.key)];
  const previousDisplayValue =
    typeof previousRawValue === "number" ? previousRawValue.toLocaleString("ro-RO") : String(previousRawValue || "-");

  const action: AssistantAction = {
    type: "field-update",
    commandName: "update_vehicle",
    risk: "medium",
    needsConfirmation: true,
    confidence: 0.86,
    entityContext: {
      entityType: "vehicle",
      entityId: resolved.vehicle.id,
      label: label || "masina selectata",
      query: command,
    },
    fieldsToUpdate: {
      [field.label]: displayValue,
    },
    executionPlan: [
      {
        id: "resolve-vehicle",
        type: "resolve_entity",
        label: `Identific masina: ${label || "masina selectata"}.`,
        target: resolved.vehicle.id,
      },
      {
        id: "validate-field",
        type: "validate_fields",
        label: `Validez campul ${field.label} si valoarea ${displayValue}.`,
        fields: [String(field.key)],
      },
      {
        id: "confirm",
        type: "confirm",
        label: "Astept confirmarea ta inainte de modificare.",
        requiresConfirmation: true,
      },
      {
        id: "update-vehicle",
        type: "service_update",
        label: "Actualizez masina prin serviciul vehicles.",
        target: resolved.vehicle.id,
        fields: [String(field.key)],
      },
      {
        id: "audit",
        type: "audit",
        label: "Salvez actiunea in auditul asistentului.",
      },
    ],
    changeSummaries: [
      {
        label: field.label,
        oldValue: previousDisplayValue,
        newValue: displayValue,
      },
    ],
    auditBeforeData: {
      id: resolved.vehicle.id,
      plateNumber: resolved.vehicle.plateNumber || "",
      currentKm: resolved.vehicle.currentKm || 0,
      initialRecordedKm: resolved.vehicle.initialRecordedKm || 0,
      status: resolved.vehicle.status || "",
      ownerUserId: resolved.vehicle.ownerUserId || "",
      currentDriverUserId: resolved.vehicle.currentDriverUserId || "",
      [String(field.key)]: (resolved.vehicle as unknown as Record<string, unknown>)[String(field.key)] ?? null,
    },
    label: `Am gasit ${label || "masina selectata"}. Modific ${field.label}: ${previousDisplayValue} -> ${displayValue}.`,
    result: `Am actualizat ${field.label} la ${displayValue}.`,
    run: async () => {
      const nextValues = vehicleToFormValues(resolved.vehicle);

      if (field.kind === "user") {
        const users = await getAllUsers();
        const selectedUser = findUserMatch(users, String(parsedValue));
        if (!selectedUser) {
          throw new Error(`Nu am gasit utilizatorul ${parsedValue}.`);
        }
        const selectedName = selectedUser.fullName || selectedUser.email || String(parsedValue);

        if (field.key === "driver") {
          nextValues.currentDriverUserId = selectedUser.id;
          nextValues.currentDriverUserName = selectedName;
          nextValues.currentDriverThemeKey = selectedUser.themeKey ?? null;
          nextValues.pendingDriverUserId = "";
          nextValues.pendingDriverUserName = "";
          nextValues.pendingDriverThemeKey = null;
          nextValues.pendingDriverRequestedAt = 0;
        }

        if (field.key === "owner") {
          nextValues.ownerUserId = selectedUser.id;
          nextValues.ownerUserName = selectedName;
          nextValues.ownerThemeKey = selectedUser.themeKey ?? null;
          if (!nextValues.currentDriverUserId) {
            nextValues.currentDriverUserId = selectedUser.id;
            nextValues.currentDriverUserName = selectedName;
            nextValues.currentDriverThemeKey = selectedUser.themeKey ?? null;
          }
        }
      } else if (isVehicleFormFieldKey(field.key)) {
        (nextValues[field.key] as VehicleFormValues[keyof VehicleFormValues]) = parsedValue as VehicleFormValues[keyof VehicleFormValues];
      }

      if (field.key === "currentKm") {
        const nextKm = Number(parsedValue || 0);
        if (!nextValues.initialRecordedKm || nextValues.initialRecordedKm > nextKm) {
          nextValues.initialRecordedKm = nextKm;
        }
      }

      if (field.key === "initialRecordedKm") {
        const initialKm = Number(parsedValue || 0);
        if (!nextValues.currentKm || nextValues.currentKm < initialKm) {
          nextValues.currentKm = initialKm;
        }
      }

      await updateVehicle(resolved.vehicle.id, nextValues);
      const afterValue = field.kind === "user" ? displayValue : parsedValue;
      const actionAfterData = {
        id: resolved.vehicle.id,
        plateNumber: nextValues.plateNumber,
        [String(field.key)]: afterValue as string | number | boolean | null,
      };
      action.auditAfterData = actionAfterData;
      navigateTo(resolved.isOwnVehicle ? `/vehicles/${resolved.vehicle.id}?view=my-vehicle` : `/vehicles/${resolved.vehicle.id}`);
      return `Am actualizat ${field.label} la ${displayValue} pentru ${label || "masina selectata"}.`;
    },
  };

  return action;
}

function extractMaintenanceClient(command: string) {
  const text = command
    .replace(/genereaza/gi, "")
    .replace(/raport/gi, "")
    .replace(/revizie/gi, "")
    .replace(/interventie/gi, "")
    .replace(/pentru/gi, "")
    .replace(/clientul|client/gi, "")
    .trim();
  return text || "";
}

const VEHICLE_KIND_HINTS = [
  {
    commandTerms: ["duba", "dubei", "dubita", "autoutilitara", "utilitara", "van", "furgoneta", "transport marfa"],
    identityTerms: [
      "transit",
      "custom",
      "ducato",
      "sprinter",
      "crafter",
      "daily",
      "boxer",
      "jumper",
      "transporter",
      "vivaro",
      "trafic",
      "master",
      "expert",
      "jumpy",
      "proace",
      "caddy",
      "connect",
      "doblo",
      "kangoo",
      "partner",
      "berlingo",
    ],
  },
  {
    commandTerms: ["camion", "camioneta", "basculanta", "tir", "cap tractor"],
    identityTerms: ["atego", "actros", "man", "iveco", "scania", "volvo", "daf", "renault trucks"],
  },
  {
    commandTerms: ["logan", "sandero", "spring", "turism", "autoturism", "masina mica"],
    identityTerms: ["logan", "sandero", "spring", "clio", "golf", "corolla", "focus", "octavia", "astra"],
  },
] as const;

function getVehicleKindScore(identityLabel: string, normalizedCommand: string) {
  let score = 0;

  for (const hint of VEHICLE_KIND_HINTS) {
    const commandMatches = hint.commandTerms.some((term) => textMatchesToken(normalizedCommand, normalizeText(term)));
    if (!commandMatches) continue;

    const identityMatches = hint.identityTerms.some((term) => textMatchesToken(identityLabel, normalizeText(term)));
    score += identityMatches ? 58 : 10;
  }

  return score;
}

function hasVehiclePlateCue(normalizedCommand: string) {
  return /\b(nr|numar|numarul|inmatriculare|placuta|placuta|plate)\b/.test(normalizedCommand);
}

function hasVehicleNavigationCue(normalizedCommand: string) {
  return (
    hasNavigationVerb(normalizedCommand) ||
    includesAny(normalizedCommand, ["gps", "gpsul", "tracker", "traker", "harta", "live", "pozitie", "locatie"])
  );
}

function getVehiclePlateScore(vehicle: VehicleItem, command: string) {
  const normalizedCommand = normalizeText(command);
  const compactCommand = compactText(command);
  const plate = compactText(vehicle.plateNumber);
  const plateParts = alphaNumericTokens(vehicle.plateNumber);
  const commandParts = alphaNumericTokens(command);
  const allowPartialPlate =
    hasVehiclePlateCue(normalizedCommand) ||
    hasVehicleNavigationCue(normalizedCommand) ||
    includesAny(normalizedCommand, ["masina", "vehicul", "auto", "duba", "dubei", "dubita", "autoutilitara"]);

  if (!plate) return 0;

  let score = 0;
  if (compactCommand.includes(plate)) score += 150;
  if (plate.includes(compactCommand) && compactCommand.length >= 4) score += 95;

  for (const part of commandParts) {
    if (part.length < 2) continue;

    if (plateParts.includes(part)) {
      score += /^\d+$/.test(part) ? 86 : 68;
      continue;
    }

    if (allowPartialPlate && plate.includes(part)) {
      score += /^\d+$/.test(part) ? 56 : 36;
    }
  }

  return score;
}

function vehicleScore(vehicle: VehicleItem, command: string) {
  const normalizedCommand = normalizeText(command);
  const compactCommand = compactText(command);
  const vehicleIdentityLabel = normalizeText(`${vehicle.plateNumber} ${vehicle.brand} ${vehicle.model} ${vehicle.vin}`);
  const vehiclePeopleLabel = normalizeText(
    `${vehicle.currentDriverUserName || ""} ${vehicle.ownerUserName || ""} ${vehicle.pendingDriverUserName || ""}`
  );
  const vehicleCompact = compactText(`${vehicle.plateNumber} ${vehicle.brand} ${vehicle.model} ${vehicle.vin}`);
  const isDriverSearch = includesAny(normalizedCommand, [
    "condus",
    "condusa",
    "conduse",
    "sofer",
    "soferul",
    "driver",
    "utilizator",
    "angajat",
  ]);
  const ignoredTokens = new Set([
    "deschide",
    "deschid",
    "pagina",
    "masina",
    "masinii",
    "masini",
    "duba",
    "dubei",
    "dubita",
    "autoutilitara",
    "utilitara",
    "auto",
    "vehicul",
    "vehiculul",
    "tracker",
    "traker",
    "gps",
    "gpsul",
    "harta",
    "live",
    "detalii",
    "date",
    "functionare",
    "cu",
    "numar",
    "inmatriculare",
    "condus",
    "condusa",
    "conduse",
    "condusul",
    "modifica",
    "modific",
    "schimba",
    "schimb",
    "editeaza",
    "editez",
    "actualizeaza",
    "actualizez",
    "seteaza",
    "setez",
    "pune",
    "pun",
    "campul",
    "valoarea",
    "km",
    "kilometri",
    "kilometraj",
    "curenti",
    "actuali",
    "initiali",
    "itp",
    "rca",
    "casco",
    "rovinieta",
    "status",
    "marca",
    "model",
    "vin",
    "de",
    "lui",
    "la",
    "in",
    "din",
    "pe",
    "sofer",
    "soferul",
    "catre",
    "du",
    "duc",
    "duca",
    "ma",
    "sa",
    "imi",
    "te",
    "rog",
    "vreau",
    "as",
    "vrea",
  ]);
  const usefulTokens = normalizedCommand
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !ignoredTokens.has(token) && !/^\d/.test(token));

  let score = 0;

  score += getVehiclePlateScore(vehicle, command);
  score += getVehicleKindScore(vehicleIdentityLabel, normalizedCommand);
  if (vehicleCompact && compactCommand.includes(vehicleCompact)) score += 70;

  usefulTokens.forEach((token) => {
    if (textMatchesToken(vehicleIdentityLabel, token)) score += 18;
    if (textMatchesToken(vehiclePeopleLabel, token)) score += isDriverSearch ? 32 : 16;
  });

  if (normalizeText(vehicle.brand) && normalizedCommand.includes(normalizeText(vehicle.brand))) score += 16;
  if (normalizeText(vehicle.model) && normalizedCommand.includes(normalizeText(vehicle.model))) score += 16;
  if (vehiclePeopleLabel && usefulTokens.length > 0 && usefulTokens.every((token) => textMatchesToken(vehiclePeopleLabel, token))) {
    score += isDriverSearch ? 45 : 20;
  }

  return score;
}

function extractVehicleTargetForFleetMap(command: string) {
  const normalized = normalizeText(command);
  const focusMatch = normalized.match(/\b(?:dreptul|zona|gpsul|gps|masina|vehiculul|vehicul)\s+(?:lui|lu|pentru|de\s+la|la|cu)?\s+(.+)$/);
  if (focusMatch?.[1]) {
    const value = cleanFieldValue(
      focusMatch[1]
        .replace(/\b(?:toate|toti|lista|hartile|harta|gpsurile|gps|pagina|masinile|masina|vehiculul|vehicul|in|dreptul|lui|lu|pentru|de|la|cu)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (value && value.length >= 2) return value;
  }

  const patterns = [
    /\b(?:gpsul|gps|harta|masina|vehiculul|vehicul|auto)\s+(?:lui|lu|pentru|de la|la|cu)?\s*(.+)$/i,
    /\b(?:pe|la)\s+(?:gpsul|gps|harta)\s+(?:lui|lu|pentru|de la|la|cu)?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const value = cleanFieldValue(
      match[1]
        .replace(/\b(?:toate|toti|lista|hartile|harta|gpsurile|gps|pagina|masinile|masina|vehiculul|vehicul|in|dreptul|lui|lu|pentru|de|la|cu)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (value && value.length >= 2) return value;
  }

  return "";
}

function isFleetGpsMapCommand(normalized: string) {
  return (
    includesAny(normalized, ["lista harta gps", "toate hartile", "toate gps", "toate gpsurile", "harta cu toate gps"]) ||
    (/\b(toate|toti|lista|flota)\b/.test(normalized) && /\bgps/.test(normalized)) ||
    (normalized.includes("harta") && /\b(toate|gpsurile|gps)\b/.test(normalized))
  );
}

function isLatestTimesheetCommand(normalized: string) {
  return (
    hasTimesheetConcept(normalized) &&
    /\b(ultim|ultima|recent|recente|cel\s+mai\s+nou|cea\s+mai\s+noua)\b/.test(normalized) &&
    (hasNavigationVerb(normalized) || /\b(arata|vezi|cauta|gaseste)\w*/.test(normalized))
  );
}

function extractLatestTimesheetUserQuery(command: string) {
  const normalized = normalizeText(command);
  const explicitMatch = normalized.match(/\b(?:a\s+lui|al\s+lui|ale\s+lui|lui|pentru|userul|utilizatorul|angajatul)\s+(.+)$/);

  const raw = explicitMatch?.[1] || normalized;
  return cleanFieldValue(
    raw
      .replace(/\b(?:arata|aratami|arata mi|mi|ma|vezi|cauta|gaseste|deschide|du|duma|du ma|ultimul|ultima|recent|cel|mai|nou|noua|pontaj|pontajul|pontaaj|pontaajul|lui|a|al|ale|pentru)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function maintenanceClientScore(client: MaintenanceClient, command: string) {
  const normalizedCommand = normalizeText(command);
  const label = normalizeText(
    [
      client.name,
      client.email,
      client.address,
      client.liftNumber,
      client.maintenanceCompany,
      ...(client.liftNumbers || []),
      ...(client.addresses || []).flatMap((address) => [
        address.label,
        address.street,
        ...(address.lifts || []).flatMap((lift) => [lift.label, lift.serialNumber]),
      ]),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const ignoredTokens = new Set([
    "client",
    "clientul",
    "clientului",
    "mentenanta",
    "lift",
    "liftul",
    "adauga",
    "adaug",
    "editeaza",
    "modifica",
    "schimba",
    "pentru",
    "la",
    "lui",
    "pe",
    "cu",
    "te",
    "rog",
  ]);
  const tokens = wordsFromText(normalizedCommand).filter((token) => token.length >= 2 && !ignoredTokens.has(token));
  let score = 0;

  if (label && label.includes(normalizedCommand)) score += 90;
  tokens.forEach((token) => {
    if (textMatchesToken(label, token)) score += 24;
  });
  if (tokens.length > 0 && tokens.every((token) => textMatchesToken(label, token))) score += 45;

  return score;
}

function toolScore(tool: ToolItem, command: string) {
  const normalizedCommand = normalizeText(command);
  const compactCommand = compactText(command);
  const label = normalizeText(
    [
      tool.name,
      tool.internalCode,
      tool.qrCodeValue,
      tool.status,
      tool.ownerUserName,
      tool.currentHolderUserName,
      tool.locationLabel,
      tool.description,
    ]
      .filter(Boolean)
      .join(" ")
  );
  const compactLabel = compactText(label);
  const ignoredTokens = new Set([
    "scula",
    "scule",
    "unealta",
    "unelte",
    "tool",
    "qr",
    "cod",
    "codul",
    "deschide",
    "du",
    "duma",
    "du",
    "ma",
    "editeaza",
    "modifica",
    "schimba",
    "detalii",
    "pagina",
    "lui",
    "la",
    "cu",
    "pe",
    "in",
    "din",
  ]);
  const tokens = wordsFromText(normalizedCommand).filter((token) => token.length >= 2 && !ignoredTokens.has(token));
  let score = 0;

  if (compactCommand && compactLabel.includes(compactCommand)) score += 90;
  tokens.forEach((token) => {
    if (textMatchesToken(label, token)) score += 26;
    if (compactLabel.includes(token)) score += 14;
  });
  if (tokens.length > 0 && tokens.every((token) => textMatchesToken(label, token) || compactLabel.includes(token))) score += 45;

  return score;
}

type ToolQuickField = {
  key: keyof ToolFormValues | "owner" | "holder";
  label: string;
  kind: "text" | "date" | "status" | "user";
  aliases: string[];
};

const TOOL_QUICK_FIELDS: ToolQuickField[] = [
  { key: "name", label: "nume", kind: "text", aliases: ["nume", "denumire", "numele sculei"] },
  { key: "internalCode", label: "cod intern", kind: "text", aliases: ["cod", "cod intern", "codul intern"] },
  { key: "qrCodeValue", label: "cod QR", kind: "text", aliases: ["qr", "cod qr", "codul qr"] },
  { key: "status", label: "status", kind: "status", aliases: ["status", "stare", "situatie"] },
  { key: "owner", label: "responsabil principal", kind: "user", aliases: ["responsabil", "responsabil principal", "proprietar", "owner"] },
  { key: "holder", label: "detinator curent", kind: "user", aliases: ["detinator", "detinator curent", "la cine este", "utilizator curent"] },
  { key: "locationLabel", label: "locatie", kind: "text", aliases: ["locatie", "unde este", "pozitie"] },
  { key: "description", label: "observatii", kind: "text", aliases: ["observatii", "descriere", "note"] },
  { key: "warrantyUntil", label: "garantie pana la", kind: "date", aliases: ["garantie", "data garantie", "expirare garantie"] },
];

function isToolFormFieldKey(key: ToolQuickField["key"]): key is keyof ToolFormValues {
  return key !== "owner" && key !== "holder";
}

function detectToolQuickField(normalized: string) {
  return TOOL_QUICK_FIELDS.flatMap((field) =>
    field.aliases.map((alias) => ({ field, alias: normalizeText(alias) }))
  )
    .filter(({ alias }) => normalized.includes(alias) || wordsFromText(alias).every((token) => textMatchesToken(normalized, token)))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.field || null;
}

function parseToolStatusValue(value: string): ToolStatus | null {
  const normalized = normalizeText(value);
  if (includesAny(normalized, ["depozit", "disponibila", "disponibil", "available", "libera", "liber"])) return "depozit";
  if (includesAny(normalized, ["atribuita", "folosita", "in lucru", "la user", "in_use", "utilizator"])) return "atribuita";
  if (includesAny(normalized, ["defecta", "defect", "stricata", "broken", "service"])) return "defecta";
  if (includesAny(normalized, ["pierduta", "pierdut", "lost"])) return "pierduta";
  return ["depozit", "atribuita", "defecta", "pierduta"].find((status) => normalizeText(status) === normalized) as ToolStatus | undefined || null;
}

function parseToolQuickValue(command: string, field: ToolQuickField) {
  const target: FieldTarget = { key: String(field.key), fieldLabel: field.label, aliases: field.aliases };
  const rawValue = extractRequestedValueForTarget(command, target);

  if (field.kind === "date") {
    return parseDateHints(rawValue)[0] || parseDateHints(command)[0] || null;
  }

  if (field.kind === "status") {
    return parseToolStatusValue(rawValue || command);
  }

  if (field.kind === "user") {
    return cleanFieldValue(rawValue || command)
      .replace(/\b(?:scula|scule|unealta|unelte|responsabil|detinator|curent|principal|cu|pe|la|in|pentru)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const textValue = cleanFieldValue(rawValue);
  if (!textValue) return null;
  if (field.key === "internalCode" || field.key === "qrCodeValue") return textValue.replace(/\s+/g, "").toUpperCase();
  return textValue;
}

function toolToFormValues(tool: ToolItem): ToolFormValues {
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

async function resolveToolForAssistant(command: string, contextToolId?: string) {
  if (contextToolId) {
    const tools = await getToolsList();
    const contextTool = tools.find((tool) => tool.id === contextToolId);
    if (contextTool) return { tool: contextTool, ambiguous: [] as ToolItem[] };
  }

  const tools = await getToolsList();
  const ranked = tools
    .map((tool) => ({ tool, score: toolScore(tool, command) }))
    .filter((entry) => entry.score >= 28)
    .sort((a, b) => b.score - a.score);

  if (ranked.length > 1 && ranked[1].score >= ranked[0].score - 8) {
    return { tool: null, ambiguous: ranked.slice(0, 5).map((entry) => entry.tool) };
  }

  return { tool: ranked[0]?.tool || null, ambiguous: [] as ToolItem[] };
}

async function resolveToolQuickUpdateAction(
  command: string,
  userId: string | undefined,
  userRole: string,
  contextToolId?: string
): Promise<AssistantAction | null> {
  const normalized = normalizeText(command);
  if (!isFieldEditCommand(normalized) || !includesAny(normalized, ["scula", "scule", "unealta", "unelte", "tool", "qr", "cod"])) {
    return null;
  }

  const field = detectToolQuickField(normalized);
  if (!field) return null;
  const parsedValue = parseToolQuickValue(command, field);
  if (parsedValue === null || parsedValue === "") return null;

  const resolved = await resolveToolForAssistant(command, contextToolId);
  if (resolved.ambiguous.length > 0) {
    return {
      type: "info",
      commandName: "clarify",
      label: "Am gasit mai multe scule posibile.",
      result: [
        "Am gasit mai multe scule posibile. Spune codul sau numele complet:",
        ...resolved.ambiguous.map((tool, index) => `${index + 1}. ${tool.name || "-"} (${tool.internalCode || tool.qrCodeValue || "fara cod"})`),
      ].join("\n"),
    };
  }
  if (!resolved.tool) return null;

  const label = `${resolved.tool.name || ""} ${resolved.tool.internalCode || ""}`.replace(/\s+/g, " ").trim();
  const displayValue = String(parsedValue);
  const action: AssistantAction = {
    type: "field-update",
    commandName: "update_tool",
    risk: "medium",
    needsConfirmation: true,
    confidence: 0.84,
    entityContext: {
      entityType: "tool",
      entityId: resolved.tool.id,
      label: label || "scula selectata",
      query: command,
    },
    fieldsToUpdate: {
      [field.label]: displayValue,
    },
    auditBeforeData: {
      id: resolved.tool.id,
      name: resolved.tool.name || "",
      internalCode: resolved.tool.internalCode || "",
      status: resolved.tool.status || "",
      ownerUserId: resolved.tool.ownerUserId || "",
      currentHolderUserId: resolved.tool.currentHolderUserId || "",
      [String(field.key)]: (resolved.tool as unknown as Record<string, unknown>)[String(field.key)] ?? null,
    },
    label: `Actualizez ${field.label} la ${displayValue} pentru ${label || "scula selectata"}.`,
    result: `Am actualizat ${field.label} la ${displayValue}.`,
    run: async () => {
      if (!userId) throw new Error("Trebuie sa fii autentificat.");
      if (userRole !== "admin" && resolved.tool.ownerUserId !== userId) {
        throw new Error("Doar responsabilul principal sau adminul poate modifica aceasta scula.");
      }

      const nextValues = toolToFormValues(resolved.tool);

      if (field.kind === "user") {
        const users = await getAllUsers();
        const selectedUser = findUserMatch(users, String(parsedValue));
        if (!selectedUser) {
          throw new Error(`Nu am gasit utilizatorul ${parsedValue}.`);
        }
        const selectedName = selectedUser.fullName || selectedUser.email || String(parsedValue);

        if (field.key === "owner") {
          nextValues.ownerUserId = selectedUser.id;
          nextValues.ownerUserName = selectedName;
          nextValues.ownerThemeKey = selectedUser.themeKey ?? null;
          if (!nextValues.currentHolderUserId) {
            nextValues.currentHolderUserId = selectedUser.id;
            nextValues.currentHolderUserName = selectedName;
            nextValues.currentHolderThemeKey = selectedUser.themeKey ?? null;
          }
        }

        if (field.key === "holder") {
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
      } else if (isToolFormFieldKey(field.key)) {
        (nextValues[field.key] as ToolFormValues[keyof ToolFormValues]) = parsedValue as ToolFormValues[keyof ToolFormValues];
      }

      if (field.key === "status" && parsedValue === "depozit" && !nextValues.locationLabel) {
        nextValues.locationType = "depozit";
        nextValues.locationLabel = "Depozit";
      }

      await updateTool(resolved.tool.id, nextValues);
      action.auditAfterData = {
        id: resolved.tool.id,
        name: nextValues.name,
        [String(field.key)]: parsedValue as string | number | boolean | null,
      };
      return `Am actualizat ${field.label} la ${displayValue} pentru ${label || "scula selectata"}.`;
    },
  };

  return action;
}

function isToolNavigationCommand(normalized: string) {
  return (
    includesAny(normalized, ["scula", "scule", "unealta", "unelte", "tool", "qr"]) &&
    (hasNavigationVerb(normalized) || /\b(editeaz|modific|schimb|detalii|cauta|gaseste)\w*/.test(normalized))
  );
}

async function resolveToolNavigation(command: string): Promise<AssistantAction | null> {
  const normalized = normalizeText(command);
  if (!isToolNavigationCommand(normalized)) return null;

  if (includesAny(normalized, ["scanare qr", "scaneaza", "scanner"])) {
    return {
      type: "navigate",
      label: "Deschid scanarea QR pentru scule.",
      path: "/tools/scan",
      result: "Am deschis scanarea de scule.",
    };
  }

  const tools = await getToolsList();
  const ranked = tools
    .map((tool) => ({ tool, score: toolScore(tool, command) }))
    .filter((entry) => entry.score >= 28)
    .sort((a, b) => b.score - a.score);
  const ambiguous = ranked.length > 1 && ranked[1].score >= ranked[0].score - 8
    ? ranked.slice(0, 5).map((entry) => entry.tool)
    : [];
  const match = ambiguous.length > 0 ? null : ranked[0]?.tool || null;

  if (ambiguous.length > 0) {
    return {
      type: "info",
      commandName: "clarify",
      label: "Am gasit mai multe scule posibile.",
      result: [
        "Am gasit mai multe scule posibile. Spune codul sau numele complet:",
        ...ambiguous.map((tool, index) => `${index + 1}. ${tool.name || "-"} (${tool.internalCode || tool.qrCodeValue || "fara cod"})`),
      ].join("\n"),
    };
  }

  if (!match) {
    return {
      type: "navigate",
      label: "Nu am gasit exact scula ceruta. Deschid lista de scule.",
      path: "/tools",
      result: "Am deschis Scule.",
    };
  }

  const wantsEdit = /\b(editeaz|modific|schimb|actualizeaz|corecteaz)\w*/.test(normalized);
  return {
    type: "navigate",
    commandName: "open_page",
    risk: "low",
    needsConfirmation: false,
    confidence: 0.86,
    entityContext: {
      entityType: "tool",
      entityId: match.id,
      label: match.name || match.internalCode || "scula selectata",
      query: command,
    },
    label: wantsEdit ? `Deschid editarea pentru scula ${match.name || match.internalCode}.` : `Deschid scula ${match.name || match.internalCode}.`,
    path: wantsEdit ? `/tools/${match.id}/edit` : `/tools/${match.id}`,
    result: wantsEdit ? "Am deschis editarea sculei." : "Am deschis scula.",
  };
}

async function resolveBrowserLocation(): Promise<TimesheetLocation> {
  if (!navigator.geolocation) {
    return { lat: null, lng: null, label: "Locatie indisponibila" };
  }

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (result) => resolve(result),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 15_000 }
    );
  });

  if (!position) {
    return { lat: null, lng: null, label: "Locatie neconfirmata" };
  }

  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  let label = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  try {
    label = await reverseGeocode(lat, lng);
  } catch {
    // Coordonatele raman disponibile chiar daca adresa nu se poate citi.
  }

  return { lat, lng, label };
}

async function resolvePreferredProject(userId: string): Promise<ProjectItem | null> {
  const preferredProjectId = await getUserTimesheetProjectPreference(userId);
  if (preferredProjectId) {
    const preferredProject = await getProjectById(preferredProjectId);
    if (preferredProject) return preferredProject;
  }
  return getLatestTimesheetProjectForUser(userId);
}

function scoreProject(project: ProjectItem, queryText: string) {
  const normalizedQuery = normalizeText(queryText);
  if (!normalizedQuery) return 0;

  const label = normalizeText(`${project.name || ""} ${project.code || ""}`);
  const tokens = wordsFromText(normalizedQuery).filter((token) => token.length >= 2);
  let score = 0;

  if (label === normalizedQuery) score += 130;
  if (label.includes(normalizedQuery)) score += 95;
  tokens.forEach((token) => {
    if (textMatchesToken(label, token)) score += 24;
  });
  if (tokens.length > 0 && tokens.every((token) => textMatchesToken(label, token))) score += 45;

  return score;
}

async function resolveProjectForTimesheet(userId: string, projectQuery?: string): Promise<ProjectItem | null> {
  const cleanProjectQuery = cleanFieldValue(projectQuery || "");
  if (cleanProjectQuery) {
    const projects = await getActiveProjectsList();
    const match = projects
      .map((project) => ({ project, score: scoreProject(project, cleanProjectQuery) }))
      .filter((entry) => entry.score >= 35)
      .sort((a, b) => b.score - a.score)[0]?.project || null;

    if (match) {
      await saveUserTimesheetProjectPreference(userId, match.id).catch((error) => {
        console.warn("[VoiceCommandAssistant][saveUserTimesheetProjectPreference]", error);
      });
    }

    return match;
  }

  return resolvePreferredProject(userId);
}

async function createActiveProjectForTimesheet(userId: string, projectName: string): Promise<ProjectItem | null> {
  const cleanName = cleanFieldValue(projectName);
  if (!cleanName) return null;

  const projectId = await createProject({ name: cleanName, status: "activ" });
  await saveUserTimesheetProjectPreference(userId, projectId).catch((error) => {
    console.warn("[VoiceCommandAssistant][saveUserTimesheetProjectPreference]", error);
  });

  const createdProject = await getProjectById(projectId);
  return (
    createdProject || {
      id: projectId,
      code: "",
      name: cleanName,
      status: "activ",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );
}

async function resolveVehicleNavigation(targetText: string, wantsDiagnostics: boolean): Promise<AssistantAction> {
  const vehicles = await getVehiclesList();
  const ranked = vehicles
    .map((vehicle) => ({ vehicle, score: vehicleScore(vehicle, targetText) }))
    .sort((a, b) => b.score - a.score);
  const ambiguous = ranked.filter((item) => item.score >= 30).slice(0, 5);
  if (ambiguous.length > 1 && ambiguous[1].score >= ambiguous[0].score - 8) {
    return {
      type: "info",
      commandName: "clarify",
      label: "Am gasit mai multe masini posibile.",
      result: [
        "Am gasit mai multe masini posibile. Spune numarul complet sau soferul:",
        ...ambiguous.map(({ vehicle }, index) =>
          `${index + 1}. ${[vehicle.plateNumber, vehicle.brand, vehicle.model, vehicle.currentDriverUserName].filter(Boolean).join(" ")}`
        ),
      ].join("\n"),
    };
  }
  const match = ranked.find((item) => item.score >= 30);

  if (!match) {
    return {
      type: "navigate",
      label: "Nu am gasit exact masina ceruta. Deschid lista de masini.",
      path: "/vehicles",
      result: "Am deschis lista de masini.",
    };
  }

  const label = `${match.vehicle.plateNumber || ""} ${match.vehicle.brand || ""} ${match.vehicle.model || ""}`
    .replace(/\s+/g, " ")
    .trim();

  return {
    type: "navigate",
    commandName: wantsDiagnostics ? "open_vehicle_live" : "open_vehicle_tracker",
    risk: "low",
    needsConfirmation: false,
    confidence: 0.88,
    entityContext: {
      entityType: "vehicle",
      entityId: match.vehicle.id,
      label: label || "masina selectata",
      query: targetText,
    },
    label: wantsDiagnostics ? `Deschid detaliile live pentru ${label}.` : `Deschid trackerul pentru ${label}.`,
    path: wantsDiagnostics ? `/vehicles/${match.vehicle.id}/live` : `/vehicles/${match.vehicle.id}#vehicle-tracker-live-section`,
    result: wantsDiagnostics ? "Am deschis detaliile live." : "Am deschis trackerul live.",
  };
}

async function resolveOwnVehicleTrackerNavigation(
  userId: string | undefined,
  wantsDiagnostics: boolean,
  targetText: string
): Promise<AssistantAction> {
  if (!userId) {
    return resolveVehicleNavigation(targetText, wantsDiagnostics);
  }

  const ownVehicle = await getMyVehicleForUser(userId);
  if (!ownVehicle) {
    return resolveVehicleNavigation(targetText, wantsDiagnostics);
  }

  const label = `${ownVehicle.plateNumber || ""} ${ownVehicle.brand || ""} ${ownVehicle.model || ""}`
    .replace(/\s+/g, " ")
    .trim();

  return {
    type: "navigate",
    commandName: wantsDiagnostics ? "open_vehicle_live" : "open_vehicle_tracker",
    risk: "low",
    needsConfirmation: false,
    confidence: 0.92,
    entityContext: {
      entityType: "vehicle",
      entityId: ownVehicle.id,
      label: label || "masina ta",
      query: targetText,
    },
    label: wantsDiagnostics ? `Deschid detaliile live pentru ${label}.` : `Deschid trackerul live pentru ${label}.`,
    path: wantsDiagnostics
      ? `/vehicles/${ownVehicle.id}/live`
      : `/vehicles/${ownVehicle.id}?view=my-vehicle#vehicle-tracker-live-section`,
    result: wantsDiagnostics ? "Am deschis detaliile live." : "Am deschis trackerul live.",
  };
}

async function resolveFleetGpsMapNavigation(command: string): Promise<AssistantAction> {
  const target = extractVehicleTargetForFleetMap(command);

  if (!target) {
    return {
      type: "navigate",
      commandName: "open_gps_maps",
      risk: "low",
      needsConfirmation: false,
      label: "Deschid pagina cu toate hartile GPS.",
      path: "/vehicles/gps-map",
      result: "Am deschis hartile GPS.",
    };
  }

  const vehicles = await getVehiclesList();
  const match = vehicles
    .map((vehicle) => ({ vehicle, score: vehicleScore(vehicle, target) }))
    .filter((entry) => entry.score >= 25)
    .sort((a, b) => b.score - a.score)[0]?.vehicle || null;

  const params = new URLSearchParams();
  if (match) {
    params.set("focusVehicleId", match.id);
  } else {
    params.set("assistantVehicle", target);
  }

  const label = match
    ? `${match.plateNumber || ""} ${match.brand || ""} ${match.model || ""}`.replace(/\s+/g, " ").trim()
    : target;

  return {
    type: "navigate",
    commandName: "open_gps_maps",
    risk: "low",
    needsConfirmation: false,
    confidence: match ? 0.86 : 0.68,
    entityContext: match
      ? {
          entityType: "vehicle",
          entityId: match.id,
          label,
          query: target,
        }
      : undefined,
    label: `Deschid toate hartile GPS si caut ${label}.`,
    path: `/vehicles/gps-map?${params.toString()}`,
    result: "Am deschis hartile GPS.",
  };
}

async function resolveLatestTimesheetAction(command: string, currentUserId?: string): Promise<AssistantAction | null> {
  const normalized = normalizeText(command);
  if (!isLatestTimesheetCommand(normalized)) return null;

  const userQuery = extractLatestTimesheetUserQuery(command);
  const params = new URLSearchParams();
  params.set("assistantLatest", "1");
  params.set("assistantOpenLatest", "1");
  if (userQuery) {
    params.set("assistantSearch", userQuery);
  } else if (currentUserId) {
    params.set("assistantUserId", currentUserId);
  }

  return {
    type: "navigate",
    commandName: "open_latest_timesheet",
    risk: "low",
    needsConfirmation: false,
    label: userQuery ? `Deschid ultimul pontaj pentru ${userQuery}.` : "Deschid ultimul pontaj.",
    path: `/timesheets?${params.toString()}`,
    result: "Am deschis pontajele.",
  };
}

async function resolveVehicleEditNavigation(targetText: string): Promise<AssistantAction> {
  const vehicles = await getVehiclesList();
  const ranked = vehicles
    .map((vehicle) => ({ vehicle, score: vehicleScore(vehicle, targetText) }))
    .sort((a, b) => b.score - a.score);
  const match = ranked.find((item) => item.score >= 30);

  if (!match) {
    return {
      type: "navigate",
      label: "Nu am gasit exact masina ceruta. Deschid lista de masini.",
      path: "/vehicles",
      result: "Am deschis lista de masini.",
    };
  }

  const label = `${match.vehicle.plateNumber || ""} ${match.vehicle.brand || ""} ${match.vehicle.model || ""}`
    .replace(/\s+/g, " ")
    .trim();
  const field = detectVehicleQuickField(normalizeText(targetText));
  const params = new URLSearchParams();
  if (field) params.set("assistantField", String(field.key));

  return {
    type: "navigate",
    commandName: "open_page",
    risk: "low",
    needsConfirmation: false,
    entityContext: {
      entityType: "vehicle",
      entityId: match.vehicle.id,
      label,
      query: targetText,
    },
    label: field ? `Deschid editarea pentru ${label} la campul ${field.label}.` : `Deschid editarea pentru ${label}.`,
    path: `/vehicles/${match.vehicle.id}/edit${params.toString() ? `?${params.toString()}` : ""}`,
    result: "Am deschis formularul de editare masina.",
  };
}

async function resolveMaintenanceClientNavigation(targetText: string): Promise<AssistantAction> {
  const clients = await getMaintenanceClients();
  const ranked = clients
    .map((client) => ({ client, score: maintenanceClientScore(client, targetText) }))
    .sort((a, b) => b.score - a.score);
  const match = ranked.find((item) => item.score >= 30);

  if (!match) {
    return {
      type: "navigate",
      label: "Nu am gasit exact clientul de mentenanta. Deschid lista de clienti.",
      path: "/maintenance?tab=clients",
      result: "Am deschis gestiunea de mentenanta.",
    };
  }

  return {
    type: "navigate",
    commandName: "open_page",
    risk: "low",
    needsConfirmation: false,
    entityContext: {
      entityType: "maintenanceClient",
      entityId: match.client.id,
      label: match.client.name,
      query: targetText,
    },
    label: `Deschid clientul ${match.client.name}.`,
    path: `/maintenance/${match.client.id}`,
    result: "Am deschis clientul de mentenanta.",
  };
}

async function actionFromAiInterpretation(
  interpretation: AssistantCommandInterpretation | null,
  originalCommand: string
): Promise<AssistantAction | null> {
  if (!interpretation || interpretation.intent === "unknown" || interpretation.confidence < 0.5) {
    return null;
  }

  const classification = classifyAssistantCommand(originalCommand);
  const blocksUnsafeCurrentPageWrite =
    hasAssistantNavigationSafetyIntent(originalCommand) &&
    classification.type !== "form_fill" &&
    classification.type !== "create_entity";

  if (interpretation.commandType === "navigation" || classification.type === "navigation") {
    if (interpretation.targetPage) {
      return {
        type: "navigate",
        commandName: "open_page",
        risk: "low",
        needsConfirmation: false,
        confidence: Math.max(interpretation.confidence, classification.confidence),
        label: interpretation.spokenSummary || "Deschid pagina ceruta.",
        path: interpretation.targetPage,
        result: "Am deschis pagina ceruta.",
      };
    }
    const knownNavigation = resolveKnownPageNavigation(normalizeText(originalCommand));
    if (knownNavigation) return knownNavigation;
    if (["fill_current_page", "update_current_page_field", "submit_current_form"].includes(interpretation.intent)) {
      return null;
    }
  }

  switch (interpretation.intent) {
    case "open_vehicle":
      return resolveVehicleNavigation(interpretation.entityQuery || interpretation.targetText || originalCommand, false);
    case "open_tool":
      return resolveToolNavigation(`deschide scula ${interpretation.entityQuery || interpretation.targetText || originalCommand}`);
    case "open_project": {
      const params = new URLSearchParams();
      if (interpretation.entityQuery) params.set("assistantSearch", interpretation.entityQuery);
      return {
        type: "navigate",
        commandName: "open_page",
        risk: "low",
        needsConfirmation: false,
        confidence: interpretation.confidence,
        label: interpretation.spokenSummary || "Deschid proiectele.",
        path: `/projects${params.toString() ? `?${params.toString()}` : ""}`,
        result: "Am deschis Proiecte.",
      };
    }
    case "open_page": {
      if (interpretation.targetPage) {
        return {
          type: "navigate",
          commandName: "open_page",
          risk: "low",
          needsConfirmation: false,
          confidence: interpretation.confidence,
          label: interpretation.spokenSummary || "Deschid pagina ceruta.",
          path: interpretation.targetPage,
          result: "Am deschis pagina ceruta.",
        };
      }
      const pageText = interpretation.pageHint || interpretation.targetText || interpretation.entityQuery || originalCommand;
      const knownPageAction = resolveKnownPageNavigation(normalizeText(pageText));
      if (knownPageAction) return knownPageAction;
      return null;
    }
    case "click_button":
      return null;
    case "fill_current_page": {
      return buildAgentClarificationAction("Nu completez campuri arbitrar. Pagina trebuie sa aiba schema AI si executor controlat.", interpretation.confidence);
    }
    case "update_vehicle_field":
    case "update_profile_field":
    case "update_current_page_field":
      if (blocksUnsafeCurrentPageWrite) return null;
      return buildAgentClarificationAction("Nu modific pagina curenta prin DOM. Foloseste o comanda pe entitate sau o pagina cu schema AI.", interpretation.confidence);
    case "open_dashboard":
      return {
        type: "navigate",
        label: interpretation.response || "Deschid dashboard-ul.",
        path: "/dashboard",
        result: "Am deschis dashboard-ul.",
      };
    case "open_my_vehicle":
      return {
        type: "navigate",
        label: interpretation.response || "Deschid pagina Masina mea.",
        path: "/my-vehicle",
        result: "Am deschis Masina mea.",
      };
    case "open_my_timesheets":
      return {
        type: "navigate",
        label: interpretation.response || "Deschid pagina Pontajul meu.",
        path: "/my-timesheets",
        result: "Am deschis Pontajul meu.",
      };
    case "open_gps_maps":
      return resolveFleetGpsMapNavigation(interpretation.entityQuery || interpretation.targetText || originalCommand);
    case "open_expense_scan":
      return {
        type: "navigate",
        label: interpretation.response || "Deschid scanarea de bonuri.",
        path: "/expenses/scan?assistant=upload",
        result: "Am deschis scanarea bonurilor.",
        note: "Din motive de securitate, browserul cere sa alegi manual poza din telefon.",
      };
    case "open_expense_invoices":
      return {
        type: "navigate",
        label: interpretation.response || "Deschid pagina de facturi.",
        path: "/expenses/invoices",
        result: "Am deschis Facturi.",
      };
    case "open_leave": {
      const dates = parseDateHints(originalCommand);
      const start = interpretation.startDate || dates[0] || "";
      const end = interpretation.endDate || dates[1] || start;
      const params = new URLSearchParams({ assistant: "leave" });
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      return {
        type: "navigate",
        label: interpretation.response || "Deschid cererea de concediu.",
        path: `/my-leave?${params.toString()}#leave-form`,
        result: "Am deschis formularul de concediu.",
      };
    }
    case "open_maintenance_report": {
      const type = interpretation.reportType || (normalizeText(originalCommand).includes("interventie") ? "interventie" : "revizie");
      const params = new URLSearchParams({ assistant: "report", type });
      if (interpretation.targetText) params.set("client", interpretation.targetText);
      return {
        type: "navigate",
        commandName: "open_maintenance_report",
        risk: "low",
        needsConfirmation: false,
        confidence: interpretation.confidence,
        entityContext: interpretation.targetText
          ? {
              entityType: "report",
              entityId: "",
              label: interpretation.targetText,
              query: originalCommand,
            }
          : undefined,
        label: interpretation.response || `Deschid generatorul de raport ${type}.`,
        path: `/maintenance?${params.toString()}#maintenance-report-generator`,
        result: "Am deschis generatorul de raport.",
        note: "Verifica datele clientului inainte de trimiterea emailului.",
      };
    }
    case "open_vehicle_tracker":
      return resolveVehicleNavigation(interpretation.targetText || originalCommand, false);
    case "open_vehicle_live":
      return resolveVehicleNavigation(interpretation.targetText || originalCommand, true);
    case "start_timesheet":
    {
      const startFields = { ...(interpretation.fieldsToUpdate || {}), ...(interpretation.fields || {}) } as Record<string, unknown>;
      const projectQuery =
        String(startFields.project || startFields.proiect || interpretation.targetText || "").trim() ||
        extractProjectQueryForTimesheet(originalCommand) ||
        undefined;
      const createProjectIfMissing = Boolean(startFields.createProjectIfMissing || startFields.creeazaDacaLipseste);
      return {
        type: "start-timesheet",
        commandName: "start_timesheet",
        risk: "medium",
        needsConfirmation: true,
        confidence: interpretation.confidence,
        label: projectQuery
          ? `Pornesc pontajul pe proiectul ${projectQuery}${createProjectIfMissing ? " si il creez daca lipseste" : ""}.`
          : interpretation.response || "Pornesc pontajul cu proiectul tau implicit sau ultimul proiect folosit.",
        result: "Pontaj pornit.",
        projectQuery,
        createProjectIfMissing,
      };
    }
    case "stop_timesheet":
      return {
        type: "stop-timesheet",
        commandName: "stop_timesheet",
        risk: "medium",
        needsConfirmation: true,
        confidence: interpretation.confidence,
        label: interpretation.response || "Opresc pontajul activ.",
        result: "Pontaj oprit.",
      };
    case "create_project": {
      const projectName = interpretation.targetText || extractNameAfterTerms(originalCommand, ["proiect", "project"]);
      if (!projectName) return null;
      return {
        type: "field-update",
        commandName: "create_project",
        risk: "medium",
        needsConfirmation: true,
        confidence: interpretation.confidence,
        entityContext: {
          entityType: "project",
          entityId: "",
          label: projectName,
          query: originalCommand,
        },
        fieldsToUpdate: {
          name: projectName,
          status: "activ",
        },
        label: interpretation.response || `Creez proiectul ${projectName} ca proiect activ.`,
        result: `Am creat proiectul ${projectName}.`,
        run: async () => {
          await createProject({ name: projectName, status: "activ" });
          return `Am creat proiectul ${projectName}.`;
        },
      };
    }
    case "create_vehicle": {
      const draft = extractVehicleDraft(originalCommand);
      const params = new URLSearchParams({ assistantCreate: "vehicle" });
      if (draft.plate) params.set("plate", draft.plate);
      if (draft.brand) params.set("brand", draft.brand);
      if (draft.model) params.set("model", draft.model);
      return {
        type: "navigate",
        commandName: "create_vehicle",
        risk: "medium",
        needsConfirmation: true,
        confidence: interpretation.confidence,
        label: interpretation.response || "Deschid formularul de masina noua.",
        path: `/vehicles/new?${params.toString()}`,
        result: "Am deschis formularul de masina noua.",
      };
    }
    case "create_tool": {
      const draft = extractToolDraft(originalCommand);
      const params = new URLSearchParams({ assistantCreate: "tool" });
      if (draft.name || interpretation.targetText) params.set("name", draft.name || interpretation.targetText);
      if (draft.code) params.set("code", draft.code);
      return {
        type: "navigate",
        commandName: "create_tool",
        risk: "medium",
        needsConfirmation: true,
        confidence: interpretation.confidence,
        label: interpretation.response || "Deschid formularul de scula noua.",
        path: `/tools/new?${params.toString()}`,
        result: "Am deschis formularul de scula noua.",
      };
    }
    case "open_user_activity": {
      return resolveUserActivityAction(
        interpretation.targetText ? `ultima activitate a lui ${interpretation.targetText}` : originalCommand
      );
    }
    default:
      return null;
  }
}

export default function VoiceCommandAssistant() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const heardSpeechRef = useRef(false);
  const holdActiveRef = useRef(false);
  const processedSpeechRef = useRef(false);
  const latestSpeechTextRef = useRef("");
  const speechSegmentsRef = useRef<string[]>([]);
  const listenTimerRef = useRef<number | null>(null);
  const conversationContextRef = useRef<AssistantConversationContext>({});
  const conversationMemoryRef = useRef(createAssistantConversationMemory());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AssistantState>("idle");
  const [transcript, setTranscript] = useState("");
  const [manualCommand, setManualCommand] = useState("");
  const [message, setMessage] = useState("Spune-mi ce vrei sa fac in WorkControl.");
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null);
  const [parsedIntent, setParsedIntent] = useState<StructuredAssistantIntent | null>(null);
  const [choiceOptions, setChoiceOptions] = useState<AssistantChoiceOption[]>([]);
  const [recentCommands, setRecentCommands] = useState<AssistantCommandHistoryItem[]>([]);
  const [assistantDebug, setAssistantDebug] = useState<AssistantDebugInfo | null>(null);
  const pendingChoiceCommandRef = useRef("");

  const speechSupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );

  const rememberAssistantContext = useCallback((action: AssistantAction) => {
    const entity = action.entityContext;
    if (!entity?.entityId) return;

    const memoryEntityType =
      entity.entityType === "vehicle" ||
      entity.entityType === "tool" ||
      entity.entityType === "project" ||
      entity.entityType === "user" ||
      entity.entityType === "page" ||
      entity.entityType === "currentPage"
        ? entity.entityType
        : "none";
    conversationMemoryRef.current.rememberEntity({
      entityType: memoryEntityType,
      entityId: entity.entityId,
      label: entity.label,
      query: entity.query,
    });
    conversationContextRef.current.lastEntity = entity;
    if (entity.entityType === "vehicle") {
      conversationContextRef.current.lastVehicleId = entity.entityId;
    }
    if (entity.entityType === "tool") {
      conversationContextRef.current.lastToolId = entity.entityId;
    }
    if (entity.entityType === "project") {
      conversationContextRef.current.lastProjectId = entity.entityId;
    }
    if (entity.entityType === "user") {
      conversationContextRef.current.lastUserId = entity.entityId;
    }
  }, []);

  const pushCommandHistory = useCallback((item: Omit<AssistantCommandHistoryItem, "id" | "createdAt">) => {
    setRecentCommands((current) => [
      {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      },
      ...current,
    ].slice(0, 5));
  }, []);

  const writeAiCommandLog = useCallback(
    async (params: {
      transcript: string;
      action?: AssistantAction | null;
      status: "success" | "failed" | "cancelled" | "executed" | "needs_clarification";
      errorMessage?: string;
      result?: string;
    }) => {
      if (!user?.uid) return;

      await logAssistantAudit({
        userId: user.uid,
        userName: user.displayName || user.email || "Utilizator",
        transcript: params.transcript,
        parsedIntent: params.action?.structuredIntent || null,
        resolvedEntity: params.action?.entityContext || null,
        fieldsToUpdate: params.action?.fieldsToUpdate || null,
        beforeData: params.action?.auditBeforeData || null,
        afterData: params.action?.auditAfterData || null,
        status: params.status,
        result: params.result || "",
        errorMessage: params.errorMessage || "",
      });
    },
    [user?.displayName, user?.email, user?.uid]
  );

  const canExecuteAssistantAction = useCallback(
    (action: AssistantAction) => {
      if (!user?.uid) return { ok: false, message: "Trebuie sa fii autentificat." };
      if (action.commandName === "delete_entity") {
        return role === "admin"
          ? { ok: true, message: "" }
          : { ok: false, message: "Doar adminul poate executa comenzi de stergere." };
      }
      if (action.commandName === "update_tool" && role !== "admin") {
        const ownerId = String(action.auditBeforeData?.ownerUserId || "");
        if (ownerId && ownerId !== user.uid) {
          return { ok: false, message: "Doar responsabilul principal sau adminul poate modifica aceasta scula." };
        }
      }
      return { ok: true, message: "" };
    },
    [role, user?.uid]
  );

  useEffect(() => {
    return () => {
      if (listenTimerRef.current) {
        window.clearTimeout(listenTimerRef.current);
      }
      holdActiveRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [navigate, user]);

  useEffect(() => {
    conversationMemoryRef.current.syncPath(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("assistant") && !params.has("assistantField")) return;
    scheduleAssistantNextStepHighlight(location.pathname, location.search, 250);
  }, [location.pathname, location.search]);

  const resolveCommand = useCallback(async (command: string, allowSequence = true): Promise<AssistantAction | null> => {
    const normalized = normalizeText(command);

    if (!normalized) return null;

    const helpAction = resolveAssistantHelpAction(command);
    if (helpAction) return helpAction;

    const classification = classifyAssistantCommand(command);
    const agentPipelineRequired = isMutationLikeAssistantCommand(classification, normalized);
    let structuredInterpretationTried = false;
    const resolveControlledServiceBackedAction = async () => {
      const profileQuickUpdateAction = resolveProfileQuickUpdateAction(command, user, (path) => navigate(path));
      if (profileQuickUpdateAction) return profileQuickUpdateAction;

      const vehicleQuickUpdateAction = await resolveVehicleQuickUpdateAction(
        command,
        user?.uid,
        location.pathname,
        (path) => navigate(path),
        conversationContextRef.current.lastVehicleId
      );
      if (vehicleQuickUpdateAction) return vehicleQuickUpdateAction;

      return null;
    };

    const resolveStructuredAction = async () => {
      structuredInterpretationTried = true;
      const rawInterpretation = await interpretAssistantCommand(command, {
        currentPathname: location.pathname,
        currentSearch: location.search,
        currentHash: location.hash,
        userRole: role,
        memory: conversationMemoryRef.current.getSnapshot(),
      });
      const interpretation = normalizeAssistantInterpretation(command, rawInterpretation);
      const structuredIsMutation = agentPipelineRequired || isMutationLikeAssistantCommand(
        {
          type: interpretation.commandType || "unknown",
          confidence: interpretation.confidence,
          reason: interpretation.reasoning || "Interpretare OpenAI.",
        },
        normalized
      );

      if (structuredIsMutation && interpretation.confidence < ASSISTANT_AGENT_CONFIDENCE_THRESHOLD) {
        const serviceBackedAction = await resolveControlledServiceBackedAction();
        if (serviceBackedAction) return serviceBackedAction;

        return buildAgentClarificationAction(
          "Nu sunt destul de sigur ca am inteles corect. Spune comanda mai concret, cu entitatea si valoarea exacta.",
          interpretation.confidence
        );
      }

      if (classification.type === "navigation" || interpretation.commandType === "navigation") {
        if (interpretation.targetPage) {
          return {
            type: "navigate" as const,
            commandName: "open_page" as const,
            risk: "low" as const,
            needsConfirmation: false,
            confidence: Math.max(interpretation.confidence, classification.confidence),
            structuredIntent: buildStructuredAssistantIntent({
              intent: "open_page",
              entityType: "page",
              entityQuery: interpretation.entityQuery || interpretation.pageHint || interpretation.targetPage,
              fieldsToUpdate: {},
              confidence: Math.max(interpretation.confidence, classification.confidence),
              spokenSummary: interpretation.spokenSummary || "Deschid pagina ceruta.",
            }),
            label: interpretation.spokenSummary || "Deschid pagina ceruta.",
            path: interpretation.targetPage,
            result: "Am deschis pagina ceruta.",
          };
        }
        const knownNavigation = resolveKnownPageNavigation(normalized);
        if (knownNavigation) return knownNavigation;
      }

      const runtimePlan = await buildAssistantRuntimePlan(interpretation, {
        currentPathname: location.pathname,
        memory: conversationMemoryRef.current.getSnapshot(),
        user: user?.uid
          ? {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              themeKey: user.themeKey ?? null,
              role,
            }
          : null,
      });

      if (runtimePlan) {
        return actionFromRuntimePlan(runtimePlan);
      }

      const aiAction = await actionFromAiInterpretation(interpretation, command);
      if (!aiAction && interpretation.intent === "create_manual_notification") {
        const fields = { ...(interpretation.fieldsToUpdate || {}), ...(interpretation.fields || {}) } as Record<string, unknown>;
        const messageText = String(fields.message || fields.mesaj || interpretation.targetText || "").trim();
        const targetText = String(fields.target || fields.destinatar || interpretation.entityQuery || "").trim();
        if (!messageText) {
          return buildAgentClarificationAction("Spune mesajul notificarii speciale.", interpretation.confidence);
        }
        return {
          type: "field-update" as const,
          commandName: "create_notification" as const,
          risk: "medium" as const,
          needsConfirmation: true,
          confidence: interpretation.confidence,
          entityContext: {
            entityType: "notification" as const,
            entityId: "",
            label: targetText || "notificare pentru tine",
            query: command,
          },
          fieldsToUpdate: {
            message: messageText,
            target: targetText || "eu",
          },
          executionPlan: [
            { id: "validate", type: "validate_fields" as const, label: "Validez destinatarul si mesajul.", fields: ["message", "target"] },
            { id: "confirm", type: "confirm" as const, label: "Astept confirmarea utilizatorului.", requiresConfirmation: true },
            { id: "create", type: "service_update" as const, label: "Creez notificarea prin Firestore.", fields: ["message", "target"] },
            { id: "audit", type: "audit" as const, label: "Scriu auditul comenzii AI." },
          ],
          label: targetText ? `Creez notificarea pentru ${targetText}: ${messageText}.` : `Creez notificarea pentru tine: ${messageText}.`,
          result: "Am creat notificarea.",
          run: async () => {
            if (!user?.uid) throw new Error("Trebuie sa fii autentificat.");
            const users = await getAllUsers();
            const targetUser = targetText ? findUserMatch(users, targetText) : null;
            const recipientId = targetUser?.id || user.uid;
            const recipientName = targetUser?.fullName || targetUser?.email || user.displayName || user.email || "Utilizator";

            await addDoc(collection(db, "notifications"), {
              userId: recipientId,
              targetUserThemeKey: targetUser?.themeKey ?? null,
              actorUserId: user.uid,
              actorUserName: user.displayName || user.email || "WorkControl",
              actorUserThemeKey: user.themeKey ?? null,
              title: "Notificare speciala",
              message: messageText,
              module: "notifications",
              eventType: "notification_created",
              entityId: "",
              notificationPath: "/notifications",
              soundEnabled: true,
              read: false,
              createdAt: Date.now(),
              createdAtServer: serverTimestamp(),
            });

            navigate("/notifications");
            return `Am creat notificarea pentru ${recipientName}.`;
          },
        };
      }
      if (!aiAction && structuredIsMutation) {
        return buildAgentClarificationAction(
          "Nu am putut genera un plan sigur pentru comanda asta. Nu execut nimic fara plan valid.",
          interpretation.confidence
        );
      }
      return aiAction;
    };

    if (classification.type !== "question" && classification.type !== "unknown") {
      try {
        const structuredAction = await resolveStructuredAction();
        if (structuredAction) return structuredAction;
      } catch (error) {
        console.warn("[VoiceCommandAssistant][structured interpret]", error);
        if (agentPipelineRequired) {
          const serviceBackedAction = await resolveControlledServiceBackedAction();
          if (serviceBackedAction) return serviceBackedAction;

          return buildAgentClarificationAction(
            "Nu pot verifica sigur comanda cu agentul acum. Nu execut modificari sau completari fara interpretare structurata.",
            classification.confidence
          );
        }
      }
    }

    if (classification.type === "navigation") {
      const runtimeKnownNavigation = resolveAssistantKnownPageNavigation(command);
      if (runtimeKnownNavigation) {
        return {
          type: "navigate",
          label: runtimeKnownNavigation.label,
          path: runtimeKnownNavigation.path,
          result: runtimeKnownNavigation.result,
          needsConfirmation: false,
          confidence: 0.9,
        };
      }

      const knownPageAction = resolveKnownPageNavigation(normalized);
      if (knownPageAction) return knownPageAction;
      return null;
    }

    if (agentPipelineRequired) {
      const serviceBackedAction = await resolveControlledServiceBackedAction();
      if (serviceBackedAction) return serviceBackedAction;

      return buildAgentClarificationAction(
        "Comanda pare sa modifice sau sa completeze date. Am oprit executia fiindca nu exista un plan valid confirmat.",
        classification.confidence
      );
    }

    const shouldPreferDetailedResolver =
      (includesAny(normalized, ["concediu", "concedii", "zi libera", "liber"]) &&
        (/\b(azi|maine|poimaine)\b|\d/.test(normalized) || includesAny(normalized, ["programeaza", "completeaza"]))) ||
      (includesAny(normalized, ["mentenanta", "maintenance"]) &&
        includesAny(normalized, ["client", "clienti", "lift", "lifturi"]) &&
        includesAny(normalized, ["adauga", "creeaza", "creaza", "completeaza", "formular"])) ||
      includesAny(normalized, ["raport revizie", "raport interventie", "genereaza raport"]);
    const runtimeKnownNavigation = shouldPreferDetailedResolver ? null : resolveAssistantKnownPageNavigation(command);
    if (runtimeKnownNavigation) {
      return {
        type: "navigate",
        label: runtimeKnownNavigation.label,
        path: runtimeKnownNavigation.path,
        result: runtimeKnownNavigation.result,
        needsConfirmation: false,
        confidence: 0.86,
      };
    }

    const profileQuickUpdateAction = resolveProfileQuickUpdateAction(command, user, (path) => navigate(path));
    if (profileQuickUpdateAction) return profileQuickUpdateAction;

    if (isFleetGpsMapCommand(normalized)) {
      return resolveFleetGpsMapNavigation(command);
    }

    const vehicleQuickUpdateAction = await resolveVehicleQuickUpdateAction(
      command,
      user?.uid,
      location.pathname,
      (path) => navigate(path),
      conversationContextRef.current.lastVehicleId
    );
    if (vehicleQuickUpdateAction) return vehicleQuickUpdateAction;

    const userActivityAction = await resolveUserActivityAction(command, user?.uid);
    if (userActivityAction) return userActivityAction;

    const createProjectAndStartQuery = extractCreateProjectAndStartQuery(command);
    if (createProjectAndStartQuery) {
      return {
        type: "start-timesheet",
        label: `Creez proiectul ${createProjectAndStartQuery} daca nu exista si pornesc pontajul pe el.`,
        result: "Pontaj pornit.",
        projectQuery: createProjectAndStartQuery,
        createProjectIfMissing: true,
      };
    }

    const projectQueryForStart = extractProjectQueryForTimesheet(command);

    if (projectQueryForStart && hasPontajStartVerb(normalized)) {
      return {
        type: "start-timesheet",
        label: `Pornesc pontajul pe proiectul ${projectQueryForStart}.`,
        result: "Pontaj pornit.",
        projectQuery: projectQueryForStart,
      };
    }

    const latestTimesheetAction = await resolveLatestTimesheetAction(command, user?.uid);
    if (latestTimesheetAction) return latestTimesheetAction;

    const toolQuickUpdateAction = await resolveToolQuickUpdateAction(command, user?.uid, role, conversationContextRef.current.lastToolId);
    if (toolQuickUpdateAction) return toolQuickUpdateAction;

    const toolNavigationAction = await resolveToolNavigation(command);
    if (toolNavigationAction) return toolNavigationAction;

    if (allowSequence) {
      const segments = splitCompoundCommands(command);
      if (segments.length > 1 && segments.every(isActionLikeSegment)) {
        const actions: AssistantAction[] = [];
        for (const segment of segments) {
          const action = await resolveCommand(segment, false);
          if (!action) {
            actions.length = 0;
            break;
          }
          actions.push(action);
        }

        if (actions.length > 1) {
          return {
            type: "sequence",
            label: `Execut ${actions.length} pasi: ${actions.map((action) => action.label).join(" Apoi ")}.`,
            result: "Am executat pasii ceruti.",
            actions,
          };
        }
      }
    }

    if (hasTimesheetConcept(normalized) && hasPontajStopVerb(normalized)) {
      return {
        type: "stop-timesheet",
        label: "Opresc pontajul activ.",
        result: "Pontaj oprit.",
      };
    }

    if (hasTimesheetConcept(normalized) && hasPontajStartVerb(normalized)) {
      return {
        type: "start-timesheet",
        label: "Pornesc pontajul cu proiectul tau implicit sau ultimul proiect folosit.",
        result: "Pontaj pornit.",
      };
    }

    if (
      hasPontajWord(normalized) &&
      (hasNavigationVerb(normalized) ||
        includesAny(normalized, ["pontajul meu", "pontaajul meu", "pontaj meu", "pontajele mele", "pagina pontaj"]))
    ) {
      return {
        type: "navigate",
        label: "Deschid pagina Pontajul meu.",
        path: "/my-timesheets",
        result: "Am deschis Pontajul meu.",
      };
    }

    if (isCreateCommand(normalized) && hasProjectConcept(normalized)) {
      const projectName = extractNameAfterTerms(command, PROJECT_TERMS);
      return {
        type: "field-update",
        commandName: "create_project",
        risk: "medium",
        needsConfirmation: true,
        confidence: projectName ? 0.88 : 0.64,
        entityContext: projectName
          ? {
              entityType: "project",
              entityId: "",
              label: projectName,
              query: command,
            }
          : undefined,
        fieldsToUpdate: projectName ? { name: projectName, status: "activ" } : {},
        label: projectName ? `Creez proiectul ${projectName} ca proiect activ.` : "Deschid pagina de proiecte pentru creare.",
        result: projectName ? `Am creat proiectul ${projectName}.` : "Am deschis pagina de proiecte.",
        note: projectName ? undefined : "Spune numele proiectului daca vrei sa il creez direct.",
        run: async () => {
          if (!projectName) {
            navigate("/projects");
            return "Am deschis pagina de proiecte.";
          }
          const projectId = await createProject({ name: projectName, status: "activ" });
          if (user?.uid) {
            await saveUserTimesheetProjectPreference(user.uid, projectId).catch((error) => {
              console.warn("[VoiceCommandAssistant][saveUserTimesheetProjectPreference]", error);
            });
          }
          navigate("/projects");
          return `Am creat proiectul ${projectName}.`;
        },
      };
    }

    if (
      isCreateCommand(normalized) &&
      includesAny(normalized, ["client", "clienti"]) &&
      includesAny(normalized, ["mentenanta", "maintenance", "lift", "lifturi", "revizie", "revizii"]) &&
      !includesAny(normalized, ["lift", "lifturi", "email", "mail", "adresa", "firma", "expira", "numar"])
    ) {
      const clientDraft = extractMaintenanceClientParams(command);
      const params = new URLSearchParams({ assistant: "client" });
      if (clientDraft.name) params.set("name", clientDraft.name);
      if (clientDraft.email) params.set("email", clientDraft.email);
      if (clientDraft.company) params.set("company", clientDraft.company);
      if (clientDraft.address) params.set("address", clientDraft.address);
      if (clientDraft.lift) params.set("lift", clientDraft.lift);

      return {
        type: "navigate",
        commandName: "create_maintenance_client",
        risk: "medium",
        needsConfirmation: true,
        confidence: clientDraft.name ? 0.82 : 0.66,
        entityContext: clientDraft.name
          ? {
              entityType: "maintenanceClient",
              entityId: "",
              label: clientDraft.name,
              query: command,
            }
          : undefined,
        fieldsToUpdate: {
          ...(clientDraft.name ? { name: clientDraft.name } : {}),
          ...(clientDraft.address ? { address: clientDraft.address } : {}),
          ...(clientDraft.lift ? { lift: clientDraft.lift } : {}),
        },
        label: clientDraft.name
          ? `Deschid formularul de client mentenanta si completez numele ${clientDraft.name}.`
          : "Deschid formularul de client mentenanta.",
        path: `/maintenance?tab=clients&${params.toString()}#maintenance-client-form`,
        result: "Am deschis formularul de client mentenanta.",
        note: "Completeaza adresa si lifturile, apoi salveaza.",
      };
    }

    if (isCreateCommand(normalized) && includesAny(normalized, ["masina", "auto", "vehicul"])) {
      const draft = extractVehicleDraft(command);
      const params = new URLSearchParams({ assistantCreate: "vehicle" });
      if (draft.plate) params.set("plate", draft.plate);
      if (draft.brand) params.set("brand", draft.brand);
      if (draft.model) params.set("model", draft.model);

      return {
        type: "navigate",
        commandName: "create_vehicle",
        risk: "medium",
        needsConfirmation: true,
        confidence: 0.78,
        fieldsToUpdate: {
          ...(draft.plate ? { plateNumber: draft.plate } : {}),
          ...(draft.brand ? { brand: draft.brand } : {}),
          ...(draft.model ? { model: draft.model } : {}),
        },
        label: "Deschid formularul de masina noua si completez ce pot din comanda.",
        path: `/vehicles/new?${params.toString()}`,
        result: "Am deschis formularul de masina noua.",
        note: "Verifica marca, modelul si numarul, apoi salveaza.",
      };
    }

    if (isCreateCommand(normalized) && includesAny(normalized, ["scula", "scule", "unealta", "tool"])) {
      const draft = extractToolDraft(command);
      const params = new URLSearchParams({ assistantCreate: "tool" });
      if (draft.name) params.set("name", draft.name);
      if (draft.code) params.set("code", draft.code);

      return {
        type: "navigate",
        commandName: "create_tool",
        risk: "medium",
        needsConfirmation: true,
        confidence: 0.78,
        fieldsToUpdate: {
          ...(draft.name ? { name: draft.name } : {}),
          ...(draft.code ? { internalCode: draft.code } : {}),
        },
        label: "Deschid formularul de scula noua si completez ce pot din comanda.",
        path: `/tools/new?${params.toString()}`,
        result: "Am deschis formularul de scula noua.",
        note: "Verifica numele si codul intern, apoi salveaza.",
      };
    }

    if (includesAny(normalized, ["ultima activitate", "activitatea userului", "activitatea utilizatorului"])) {
      const action = await resolveUserActivityAction(command, user?.uid);
      if (action) return action;
    }

    if (isCreateCommand(normalized) && includesAny(normalized, ["notificare", "notificarea"])) {
      const notificationRequest = extractNotificationRequest(command);
      const messageText = notificationRequest.message || "Notificare speciala";
      return {
        type: "field-update",
        commandName: "create_notification",
        risk: "medium",
        needsConfirmation: true,
        confidence: 0.86,
        entityContext: {
          entityType: "notification",
          entityId: "",
          label: notificationRequest.target || "notificare pentru tine",
          query: command,
        },
        fieldsToUpdate: {
          message: messageText,
          target: notificationRequest.target || "eu",
        },
        label: notificationRequest.target
          ? `Creez notificarea pentru ${notificationRequest.target}: ${messageText}.`
          : `Creez notificarea pentru tine: ${messageText}.`,
        result: "Am creat notificarea.",
        run: async () => {
          if (!user?.uid) throw new Error("Trebuie sa fii autentificat.");
          const users = await getAllUsers();
          const targetUser = notificationRequest.target ? findUserMatch(users, notificationRequest.target) : null;
          const recipientId = targetUser?.id || user.uid;
          const recipientName = targetUser?.fullName || targetUser?.email || user.displayName || user.email || "Utilizator";

          await addDoc(collection(db, "notifications"), {
            userId: recipientId,
            targetUserThemeKey: targetUser?.themeKey ?? null,
            actorUserId: user.uid,
            actorUserName: user.displayName || user.email || "WorkControl",
            actorUserThemeKey: user.themeKey ?? null,
            title: "Notificare speciala",
            message: messageText,
            module: "notifications",
            eventType: "notification_created",
            entityId: "",
            notificationPath: "/notifications",
            soundEnabled: true,
            read: false,
            createdAt: Date.now(),
            createdAtServer: serverTimestamp(),
          });

          navigate("/notifications");
          return `Am creat notificarea pentru ${recipientName}.`;
        },
      };
    }

    if (!structuredInterpretationTried) {
      try {
        const structuredAction = await resolveStructuredAction();
        if (structuredAction) return structuredAction;
      } catch (error) {
        console.warn("[VoiceCommandAssistant][interpretAssistantCommand]", error);
      }
    }

    const controlledPageAction = resolveAssistantControlledPageAction(command, location.pathname);
    if (controlledPageAction) {
      return {
        type: "field-update",
        commandName: "click_button",
        risk: controlledPageAction.actionType === "file" ? "low" : "medium",
        needsConfirmation: controlledPageAction.actionType !== "file",
        confidence: Math.max(0.72, controlledPageAction.score),
        fieldsToUpdate: {
          pageAction: controlledPageAction.id,
        },
        label: controlledPageAction.label,
        result: controlledPageAction.result,
        note: controlledPageAction.note,
        run: controlledPageAction.run,
      };
    }

    if (
      includesAny(normalized, ["client", "clientul", "clientului", "lift", "liftul"]) &&
      includesAny(normalized, ["mentenanta", "editeaza", "modifica", "schimba", "adauga lift", "adaug lift"])
    ) {
      return resolveMaintenanceClientNavigation(command);
    }

    if (
      includesAny(normalized, ["masina", "vehicul", "duba", "dubei", "dubita", "autoutilitara", "utilitara", "inmatriculare"]) &&
      /\b(editeaz|modific|schimb|actualizeaz|corecteaz)\w*/.test(normalized)
    ) {
      return resolveVehicleEditNavigation(command);
    }

    if (
      includesAny(normalized, ["masina mea", "masina personala", "vehiculul meu"]) &&
      includesAny(normalized, ["tracker", "traker", "gps", "harta", "live", "detalii live", "obd"])
    ) {
      return resolveOwnVehicleTrackerNavigation(
        user?.uid,
        includesAny(normalized, ["detalii live", "date live", "obd", "functionare", "senzori"]),
        command
      );
    }

    if (includesAny(normalized, ["masina mea", "masina personala", "vehiculul meu"])) {
      return {
        type: "navigate",
        label: "Deschid pagina Masina mea.",
        path: "/my-vehicle",
        result: "Am deschis Masina mea.",
      };
    }

    if (isFleetGpsMapCommand(normalized)) {
      return resolveFleetGpsMapNavigation(command);
    }

    const knownPageAction = resolveKnownPageNavigation(normalized);
    if (knownPageAction) return knownPageAction;

    if (includesAny(normalized, ["scanare bon", "scaneaza bon", "incarca ultima poza", "incarca poza", "bonuri"])) {
      return {
        type: "navigate",
        label: "Deschid scanarea de bonuri si scot in fata zona de upload.",
        path: "/expenses/scan?assistant=upload",
        result: "Am deschis scanarea bonurilor.",
        note: "Din motive de securitate, browserul cere sa alegi manual poza din telefon.",
      };
    }

    if (includesAny(normalized, ["facturi", "factura"])) {
      return {
        type: "navigate",
        label: "Deschid pagina de facturi.",
        path: "/expenses/invoices",
        result: "Am deschis Facturi.",
      };
    }

    if (includesAny(normalized, ["concediu", "concedii", "zi libera", "liber"])) {
      const dates = parseDateHints(command);
      const params = new URLSearchParams({ assistant: "leave" });
      if (dates[0]) params.set("start", dates[0]);
      if (dates[1] || dates[0]) params.set("end", dates[1] || dates[0]);

      return {
        type: "navigate",
        label: dates[0]
          ? `Deschid cererea de concediu si completez perioada ${dates[0]} - ${dates[1] || dates[0]}.`
          : "Deschid cererea de concediu.",
        path: `/my-leave?${params.toString()}#leave-form`,
        result: "Am deschis formularul de concediu.",
      };
    }

    if (includesAny(normalized, ["raport revizie", "raport interventie", "genereaza raport"])) {
      const type = normalized.includes("interventie") ? "interventie" : "revizie";
      const client = extractMaintenanceClient(command);
      const params = new URLSearchParams({ assistant: "report", type });
      if (client) params.set("client", client);

      return {
        type: "navigate",
        label: client
          ? `Deschid generatorul de raport ${type} pentru ${client}.`
          : `Deschid generatorul de raport ${type}.`,
        path: `/maintenance?${params.toString()}#maintenance-report-generator`,
        result: "Am deschis generatorul de raport.",
        note: "Verifica datele clientului inainte de trimiterea emailului.",
      };
    }

    if (includesAny(normalized, ["masina", "vehicul", "duba", "dubei", "dubita", "autoutilitara", "utilitara", "tracker", "traker", "gps", "detalii live", "obd"])) {
      return resolveVehicleNavigation(
        command,
        includesAny(normalized, ["detalii live", "date live", "obd", "functionare", "senzori"])
      );
    }

    return null;
  }, [location.pathname, navigate, role, user]);

  const runAssistantAction = useCallback(
    async (action: AssistantAction): Promise<string> => {
      const runOne = async (currentAction: AssistantAction): Promise<string> => {
        if (currentAction.type === "info") {
          return currentAction.result;
        }

        if (currentAction.type === "sequence") {
          let lastResult = currentAction.result;
          for (const childAction of currentAction.actions) {
            lastResult = await runOne(childAction);
            await delay(childAction.type === "navigate" ? 280 : 120);
          }
          return currentAction.result || lastResult;
        }

        if (currentAction.type === "navigate") {
          navigate(currentAction.path);
          const target = parseAssistantNavigationTarget(currentAction.path);
          scheduleAssistantNextStepHighlight(target.pathname, target.search);
          const nextStepMessage = getAssistantNextStepMessage(target.pathname, target.search);
          return nextStepMessage ? `${currentAction.result} ${nextStepMessage}` : currentAction.result;
        }

        if (currentAction.type === "field-update") {
          const result = await currentAction.run();
          return result || currentAction.result;
        }

        if (!user?.uid) {
          throw new Error("Trebuie sa fii autentificat.");
        }

        const userName = user.displayName || user.email || "Utilizator";

        if (currentAction.type === "start-timesheet") {
          const activeTimesheet = await getActiveTimesheetForUser(user.uid);
          if (activeTimesheet) {
            navigate("/my-timesheets");
            return "Ai deja un pontaj activ. Am deschis pagina de pontaj.";
          }

          let project = await resolveProjectForTimesheet(user.uid, currentAction.projectQuery);
          if (!project && currentAction.createProjectIfMissing && currentAction.projectQuery) {
            project = await createActiveProjectForTimesheet(user.uid, currentAction.projectQuery);
          }

          if (!project) {
            navigate("/my-timesheets");
            return currentAction.projectQuery
              ? `Nu am gasit proiectul ${currentAction.projectQuery}. Am deschis pagina de pontaj.`
              : "Nu am gasit un proiect implicit. Alege un proiect in pagina de pontaj.";
          }

          const startLocation = await resolveBrowserLocation();
          await startTimesheet({
            userId: user.uid,
            userName,
            userThemeKey: user.themeKey ?? null,
            projectId: project.id,
            projectCode: project.code || "",
            projectName: project.name || "Proiect",
            startLocation,
            startExplanation: "Pornit din asistentul vocal.",
          });
          notifyTimesheetsChanged(user.uid, "assistant-start");
          navigate("/my-timesheets");
          return `Pontaj pornit pe ${project.name || project.code || "proiect"}.`;
        }

        if (currentAction.type === "stop-timesheet") {
          const activeTimesheet = await getActiveTimesheetForUser(user.uid);
          if (!activeTimesheet) {
            navigate("/my-timesheets");
            return "Nu exista pontaj activ de oprit.";
          }

          const stopLocation = await resolveBrowserLocation();
          await stopTimesheet({
            timesheetId: activeTimesheet.id,
            explanation: "Oprit din asistentul vocal.",
            stopLocation,
          });
          notifyTimesheetsChanged(user.uid, "assistant-stop");
          navigate("/my-timesheets");
          return "Pontaj oprit.";
        }

        return "";
      };

      return runOne(action);
    },
    [navigate, user?.displayName, user?.email, user?.themeKey, user?.uid]
  );

  const prepareCommand = useCallback(
    async (command: string) => {
      const cleanCommand = collapseRepeatedSpeech(command);
      if (!cleanCommand) {
        setMessage("Scrie sau dicteaza o comanda.");
        return;
      }

      const selectedChoice = resolveAssistantChoiceFromText(cleanCommand, choiceOptions);
      if (selectedChoice && pendingChoiceCommandRef.current) {
        const baseCommand = pendingChoiceCommandRef.current;
        setChoiceOptions([]);
        pendingChoiceCommandRef.current = "";
        await prepareCommand(`${baseCommand} ${selectedChoice.label}`);
        return;
      }

      setTranscript(cleanCommand);
      const classification = classifyAssistantCommand(cleanCommand);
      setAssistantDebug({
        transcript: cleanCommand,
        commandType: classification.type,
        reason: classification.reason,
        intent: "",
        entityType: "",
        entityQuery: "",
        fieldsToUpdate: {},
        targetPage: "",
        confidence: classification.confidence,
        nextAction: "Se interpreteaza comanda.",
        executionPlan: [],
      });
      conversationMemoryRef.current.rememberCommand(cleanCommand);
      setPendingAction(null);
      setChoiceOptions([]);
      pendingChoiceCommandRef.current = "";
      setState("thinking");
      setMessage("Inteleg comanda...");

      try {
        const rawAction = await resolveCommand(cleanCommand);
        const action = rawAction ? attachAssistantIntent(cleanCommand, rawAction) : null;
        setAssistantDebug((current) => ({
          transcript: cleanCommand,
          commandType: current?.commandType || classification.type,
          reason: current?.reason || classification.reason,
          intent: action?.structuredIntent?.intent || action?.commandName || "",
          entityType: action?.structuredIntent?.entityType || action?.entityContext?.entityType || "",
          entityQuery: action?.structuredIntent?.entityQuery || action?.entityContext?.query || "",
          fieldsToUpdate: action?.fieldsToUpdate || {},
          targetPage: action?.type === "navigate" ? action.path : action?.type === "sequence" ? action.actions.find((item) => item.type === "navigate")?.path || "" : "",
          confidence: action?.confidence ?? current?.confidence ?? classification.confidence,
          nextAction: action?.label || "Nu exista actiune sigura.",
          executionPlan: action?.executionPlan || [],
        }));
        if (!action) {
          setState("idle");
          setParsedIntent(null);
          pushCommandHistory({
            transcript: cleanCommand,
            summary: "Comanda neinteleasa.",
            status: "failed",
          });
          await writeAiCommandLog({
            transcript: cleanCommand,
            status: "failed",
            errorMessage: "Comanda nu a fost inteleasa destul de sigur.",
          }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));
          if (isFieldEditCommand(normalizeText(cleanCommand))) {
            setMessage(
              "Nu gasesc campul sau valoarea pe pagina curenta. Incearca: selecteaza proiectul X, schimba soferul cu X, sau deschide mai intai formularul masinii."
            );
            return;
          }
          setMessage("Nu am inteles destul de sigur. Incearca mai concret: deschide masina B 33 LGR cu tracker live.");
          return;
        }
        if (action.type === "info") {
          setState("idle");
          setPendingAction(null);
          setParsedIntent(action.structuredIntent || null);
          setChoiceOptions(action.choices || []);
          pendingChoiceCommandRef.current = action.choices?.length ? cleanCommand : "";
          setMessage(action.result);
          pushCommandHistory({
            transcript: cleanCommand,
            summary: action.result.split("\n")[0] || action.label,
            status: "success",
          });
          await writeAiCommandLog({
            transcript: cleanCommand,
            action,
            status: action.commandName === "clarify" ? "needs_clarification" : "success",
            result: action.result,
          }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));
          return;
        }

        const permission = canExecuteAssistantAction(action);
        if (!permission.ok) {
          setState("idle");
          setPendingAction(null);
          setParsedIntent(action.structuredIntent || null);
          setMessage(permission.message);
          pushCommandHistory({
            transcript: cleanCommand,
            summary: permission.message,
            status: "failed",
          });
          await writeAiCommandLog({
            transcript: cleanCommand,
            action,
            status: "failed",
            errorMessage: permission.message,
          }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));
          return;
        }

        if (action.needsConfirmation === false) {
          setState("executing");
          setPendingAction(null);
          setParsedIntent(action.structuredIntent || null);
          setMessage("Execut comanda...");
          const result = await runAssistantAction(action);
          rememberAssistantContext(action);
          setState("idle");
          setMessage(result);
          pushCommandHistory({
            transcript: cleanCommand,
            summary: result,
            status: "success",
          });
          await writeAiCommandLog({
            transcript: cleanCommand,
            action,
            status: "executed",
            result,
          }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));
          if (action.type === "navigate") setOpen(false);
          return;
        }

        setPendingAction(action);
        setParsedIntent(action.structuredIntent || null);
        setChoiceOptions([]);
        pendingChoiceCommandRef.current = "";
        setState("confirming");
        setMessage(getAssistantPreview(action));
        pushCommandHistory({
          transcript: cleanCommand,
          summary: action.label,
          status: "pending",
        });
      } catch (error) {
        console.error("[VoiceCommandAssistant][resolve]", error);
        setState("idle");
        setMessage("Nu am putut interpreta comanda acum.");
        pushCommandHistory({
          transcript: cleanCommand,
          summary: error instanceof Error ? error.message : "Eroare la interpretare.",
          status: "failed",
        });
      }
    },
    [canExecuteAssistantAction, choiceOptions, pushCommandHistory, rememberAssistantContext, resolveCommand, runAssistantAction, writeAiCommandLog]
  );

  const startListening = useCallback(() => {
    if (!speechSupported) {
      setMessage("Comenzile vocale nu sunt disponibile in browserul acesta. Poti scrie comanda mai jos.");
      setOpen(true);
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;

    recognitionRef.current?.abort();
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }

    heardSpeechRef.current = false;
    holdActiveRef.current = true;
    processedSpeechRef.current = false;
    latestSpeechTextRef.current = "";
    speechSegmentsRef.current = [];

    const recognition = new Recognition();
    recognition.lang = "ro-RO";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setState("listening");
      setMessage("Tine apasat si vorbeste. Procesez cand eliberezi butonul.");
    };
    recognition.onaudiostart = () => {
      setMessage("Microfon activ. Tine apasat cat vorbesti...");
    };
    recognition.onspeechstart = () => {
      heardSpeechRef.current = true;
      setMessage("Te aud, continua...");
    };
    recognition.onresult = (event) => {
      const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;

      for (let index = startIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = cleanSpeechText(result?.[0]?.transcript || "");
        if (!text.trim()) continue;
        speechSegmentsRef.current[index] = text;
      }

      const visibleText = collapseRepeatedSpeech(speechSegmentsRef.current.filter(Boolean).join(" "));
      if (visibleText) {
        heardSpeechRef.current = true;
        latestSpeechTextRef.current = visibleText;
        setTranscript(visibleText);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      holdActiveRef.current = false;
      if (listenTimerRef.current) {
        window.clearTimeout(listenTimerRef.current);
        listenTimerRef.current = null;
      }

      if (heardSpeechRef.current && latestSpeechTextRef.current.trim()) {
        processedSpeechRef.current = true;
        void prepareCommand(latestSpeechTextRef.current.trim());
        return;
      }

      setState("idle");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMessage("Microfonul este blocat pentru site. Permite accesul la microfon din browser si incearca din nou.");
        return;
      }
      if (event.error === "audio-capture") {
        setMessage("Browserul nu gaseste microfonul. Verifica microfonul telefonului/calculatorului.");
        return;
      }
      if (event.error === "network") {
        setMessage("Serviciul vocal al browserului nu raspunde acum. Poti scrie comanda in caseta.");
        return;
      }
      setMessage("Nu am auzit destul de clar. Apasa din nou si vorbeste aproape de microfon.");
    };
    recognition.onspeechend = () => {
      if (holdActiveRef.current) {
        setMessage("Te-am auzit. Elibereaza butonul cand ai terminat.");
      }
    };
    recognition.onnomatch = () => {
      setMessage("Nu am recunoscut comanda. Incearca mai scurt sau scrie comanda.");
    };
    recognition.onend = () => {
      if (listenTimerRef.current) {
        window.clearTimeout(listenTimerRef.current);
        listenTimerRef.current = null;
      }

      recognitionRef.current = null;
      if (!processedSpeechRef.current && latestSpeechTextRef.current.trim()) {
        processedSpeechRef.current = true;
        void prepareCommand(latestSpeechTextRef.current.trim());
        return;
      }

      setState((current) => (current === "listening" ? "idle" : current));
      if (!processedSpeechRef.current && !latestSpeechTextRef.current.trim()) {
        setMessage("Nu am auzit nimic. Apasa microfonul si spune comanda dupa semnalul browserului.");
      }
    };

    recognitionRef.current = recognition;
    setOpen(true);
    setTranscript("");
    setPendingAction(null);
    setChoiceOptions([]);
    pendingChoiceCommandRef.current = "";
    setState("listening");
    setMessage("Pornesc microfonul. Tine apasat...");

    listenTimerRef.current = window.setTimeout(() => {
      if (!heardSpeechRef.current && !processedSpeechRef.current) {
        setMessage("Microfonul este pornit, dar nu aud voce. Tine apasat si vorbeste mai aproape.");
      }
    }, 5_000);

    try {
      recognition.start();
    } catch (error) {
      console.warn("[VoiceCommandAssistant][speech start]", error);
      holdActiveRef.current = false;
      setState("idle");
      setMessage("Nu am putut porni microfonul. Apasa din nou sau scrie comanda.");
    }
  }, [prepareCommand, speechSupported]);

  const stopListening = useCallback(() => {
    holdActiveRef.current = false;
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      if (!processedSpeechRef.current && latestSpeechTextRef.current.trim()) {
        processedSpeechRef.current = true;
        void prepareCommand(latestSpeechTextRef.current.trim());
      }
      return;
    }

    setMessage(latestSpeechTextRef.current.trim() ? "Procesez ce ai spus..." : "Microfon oprit. Nu am auzit comanda.");
    try {
      recognition.stop();
    } catch (error) {
      console.warn("[VoiceCommandAssistant][speech stop]", error);
      recognition.abort();
      recognitionRef.current = null;
      setState("idle");
    }
  }, [prepareCommand]);

  const executePendingAction = useCallback(async () => {
    if (!pendingAction) return;
    setState("executing");
    setMessage("Execut comanda...");

    try {
      const permission = canExecuteAssistantAction(pendingAction);
      if (!permission.ok) {
        throw new Error(permission.message);
      }

      const result = await runAssistantAction(pendingAction);
      rememberAssistantContext(pendingAction);
      setMessage(result);
      pushCommandHistory({
        transcript,
        summary: result,
        status: "success",
      });
      await writeAiCommandLog({
        transcript,
        action: pendingAction,
        status: "executed",
        result,
      }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));

      setState("idle");
      setPendingAction(null);
      setParsedIntent(null);
      setChoiceOptions([]);
      pendingChoiceCommandRef.current = "";
      setOpen(false);
    } catch (error) {
      console.error("[VoiceCommandAssistant][execute]", error);
      setState("idle");
      const errorMessage = error instanceof Error ? error.message : "Nu am putut executa comanda.";
      setMessage(errorMessage);
      pushCommandHistory({
        transcript,
        summary: errorMessage,
        status: "failed",
      });
      await writeAiCommandLog({
        transcript,
        action: pendingAction,
        status: "failed",
        errorMessage,
      }).catch((logError) => console.warn("[VoiceCommandAssistant][ai log]", logError));
    }
  }, [canExecuteAssistantAction, pendingAction, pushCommandHistory, rememberAssistantContext, runAssistantAction, transcript, writeAiCommandLog]);

  function cancelPendingAction() {
    if (pendingAction) {
      pushCommandHistory({
        transcript,
        summary: "Comanda anulata.",
        status: "cancelled",
      });
      void writeAiCommandLog({
        transcript,
        action: pendingAction,
        status: "cancelled",
        errorMessage: "Anulat de utilizator.",
      }).catch((error) => console.warn("[VoiceCommandAssistant][ai log]", error));
    }
    setPendingAction(null);
    setParsedIntent(null);
    setChoiceOptions([]);
    pendingChoiceCommandRef.current = "";
    setState("idle");
    setMessage("Am anulat. Spune-mi alta comanda cand vrei.");
  }

  function chooseAssistantOption(option: AssistantChoiceOption) {
    const baseCommand = pendingChoiceCommandRef.current || transcript;
    if (!baseCommand) return;
    setChoiceOptions([]);
    pendingChoiceCommandRef.current = "";
    void prepareCommand(`${baseCommand} ${option.label}`);
  }

  function submitManualCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void prepareCommand(manualCommand);
    setManualCommand("");
  }

  const busy = state === "listening" || state === "thinking" || state === "executing";
  const canHoldToTalk = state !== "thinking" && state !== "executing";

  function handleVoiceHoldStart(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!canHoldToTalk) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Unele browsere pot ignora pointer capture pe butoane.
    }
    startListening();
  }

  function handleVoiceHoldEnd(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture poate fi deja eliberat de browser.
    }
    if (holdActiveRef.current || state === "listening") {
      stopListening();
    }
  }

  function handleVoiceHoldMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (holdActiveRef.current || state === "listening") {
      event.preventDefault();
    }
  }

  function handleVoiceKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.repeat) return;
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!canHoldToTalk) return;
    startListening();
  }

  function handleVoiceKeyUp(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (holdActiveRef.current || state === "listening") {
      stopListening();
    }
  }

  function closeAssistant() {
    holdActiveRef.current = false;
    processedSpeechRef.current = true;
    latestSpeechTextRef.current = "";
    speechSegmentsRef.current = [];
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setState("idle");
    setOpen(false);
  }

  return (
    <div className={`voice-assistant ${open ? "voice-assistant--open" : ""}`}>
      <button
        type="button"
        className={`voice-assistant__fab voice-assistant__hold-target ${busy ? "is-busy" : ""}`}
        onPointerDown={handleVoiceHoldStart}
        onPointerMove={handleVoiceHoldMove}
        onPointerUp={handleVoiceHoldEnd}
        onPointerCancel={handleVoiceHoldEnd}
        onKeyDown={handleVoiceKeyDown}
        onKeyUp={handleVoiceKeyUp}
        onClick={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Tine apasat pentru comanda vocala"
        aria-pressed={state === "listening"}
      >
        {state === "listening" ? <Mic size={22} /> : <Bot size={22} />}
      </button>

      {open ? (
        <section className="voice-assistant__panel" aria-live="polite">
          <div className="voice-assistant__header">
            <div>
              <strong>ChatGPT WorkControl</strong>
              <span>Comenzi vocale cu confirmare</span>
            </div>
            <button
              type="button"
              className="voice-assistant__icon-btn"
              onClick={closeAssistant}
              aria-label="Inchide asistentul"
            >
              <X size={17} />
            </button>
          </div>

          <div className="voice-assistant__body">
            {transcript ? (
              <div className="voice-assistant__transcript">
                <span>Ai spus</span>
                <p>{transcript}</p>
              </div>
            ) : null}
            <p className="voice-assistant__message">{message}</p>
            {parsedIntent ? (
              <div className="voice-assistant__intent-card">
                <div className="voice-assistant__intent-head">
                  <span>{parsedIntent.intent}</span>
                  <b className={`voice-assistant__risk voice-assistant__risk--${parsedIntent.risk}`}>
                    {parsedIntent.risk}
                  </b>
                </div>
                <div className="voice-assistant__intent-meta">
                  <span>{parsedIntent.module}</span>
                  <span>{Math.round(parsedIntent.confidence * 100)}%</span>
                </div>
                {parsedIntent.entityQuery ? <p>{parsedIntent.entityQuery}</p> : null}
              </div>
            ) : null}
            {role === "admin" && assistantDebug ? (
              <details className="voice-assistant__debug">
                <summary>AI Debug</summary>
                <dl>
                  <div>
                    <dt>Transcript</dt>
                    <dd>{assistantDebug.transcript || "-"}</dd>
                  </div>
                  <div>
                    <dt>commandType</dt>
                    <dd>{assistantDebug.commandType}</dd>
                  </div>
                  <div>
                    <dt>intent</dt>
                    <dd>{assistantDebug.intent || "-"}</dd>
                  </div>
                  <div>
                    <dt>entityType</dt>
                    <dd>{assistantDebug.entityType || "-"}</dd>
                  </div>
                  <div>
                    <dt>entityQuery</dt>
                    <dd>{assistantDebug.entityQuery || "-"}</dd>
                  </div>
                  <div>
                    <dt>targetPage</dt>
                    <dd>{assistantDebug.targetPage || "-"}</dd>
                  </div>
                  <div>
                    <dt>confidence</dt>
                    <dd>{Math.round(assistantDebug.confidence * 100)}%</dd>
                  </div>
                  <div>
                    <dt>fieldsToUpdate</dt>
                    <dd>{Object.keys(assistantDebug.fieldsToUpdate).length ? JSON.stringify(assistantDebug.fieldsToUpdate) : "-"}</dd>
                  </div>
                  <div>
                    <dt>Actiune</dt>
                    <dd>{assistantDebug.nextAction || "-"}</dd>
                  </div>
                  <div>
                    <dt>Execution plan</dt>
                    <dd>
                      {assistantDebug.executionPlan?.length
                        ? assistantDebug.executionPlan.map((step, index) => `${index + 1}. ${step.label}`).join("\n")
                        : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt>Motiv</dt>
                    <dd>{assistantDebug.reason || "-"}</dd>
                  </div>
                </dl>
              </details>
            ) : null}
            {state === "confirming" && pendingAction ? (
              <div className="voice-assistant__confirmation-card">
                <strong>Confirmare actiune</strong>
                <dl>
                  {getAssistantConfirmationRows(pendingAction).map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {choiceOptions.length > 0 ? (
              <div className="voice-assistant__choices" aria-label="Alege rezultatul corect">
                <strong>Alege varianta corecta</strong>
                {choiceOptions.map((choice, index) => (
                  <button key={choice.id || choice.label} type="button" onClick={() => chooseAssistantOption(choice)}>
                    <span>{index + 1}</span>
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : null}
            {recentCommands.length > 0 ? (
              <div className="voice-assistant__history" aria-label="Ultimele comenzi AI">
                {recentCommands.slice(0, 3).map((item) => (
                  <div key={item.id} className={`voice-assistant__history-item is-${item.status}`}>
                    <span>{item.status}</span>
                    <p>{item.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {state === "confirming" && pendingAction ? (
            <div className="voice-assistant__actions">
              <button type="button" className="primary-btn" onClick={() => void executePendingAction()}>
                <Check size={16} />
                Confirma
              </button>
              <button type="button" className="secondary-btn" onClick={cancelPendingAction}>
                <X size={16} />
                Anuleaza
              </button>
            </div>
          ) : (
            <div className="voice-assistant__actions">
              <button
                type="button"
                className="primary-btn voice-assistant__hold-target"
                onPointerDown={handleVoiceHoldStart}
                onPointerMove={handleVoiceHoldMove}
                onPointerUp={handleVoiceHoldEnd}
                onPointerCancel={handleVoiceHoldEnd}
                onKeyDown={handleVoiceKeyDown}
                onKeyUp={handleVoiceKeyUp}
                onClick={(event) => event.preventDefault()}
                onContextMenu={(event) => event.preventDefault()}
                disabled={state === "thinking" || state === "executing"}
                aria-pressed={state === "listening"}
              >
                {busy ? <Loader2 size={16} className="voice-assistant__spin" /> : <Mic size={16} />}
                {state === "listening" ? "Ascult..." : "Tine apasat"}
              </button>
            </div>
          )}

          <form className="voice-assistant__manual" onSubmit={submitManualCommand}>
            <input
              value={manualCommand}
              onChange={(event) => setManualCommand(event.target.value)}
              placeholder="Sau scrie comanda..."
              disabled={state === "thinking" || state === "executing"}
            />
            <button type="submit" aria-label="Trimite comanda" disabled={state === "thinking" || state === "executing"}>
              <Send size={16} />
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

