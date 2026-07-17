import {
  Building2,
  FileClock,
  FilePlus2,
  ListChecks,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";
import {
  NAVIGATION_ITEMS,
  canAccessNavigationItem,
  type NavigationRole,
} from "../../config/navigation";
import { normalizeAssistantText, scoreAssistantText } from "./runtime/assistantFuzzy";

export const ASSISTANT_ACTION_IDS = {
  openGlobalSearch: "open-global-search",
  uploadReceipt: "upload-receipt",
  scanReceipt: "scan-receipt",
  submitLeaveRequest: "submit-leave-request",
  saveUser: "save-user",
  saveVehicle: "save-vehicle",
  saveTool: "save-tool",
  maintenanceReport: "maintenance-report-generator",
  maintenanceAddClient: "maintenance-add-client",
  maintenanceParts: "maintenance-parts",
  maintenanceBranding: "maintenance-branding",
  maintenanceHistory: "maintenance-history",
  maintenanceChecks: "maintenance-checks",
} as const;

export type AssistantNavigationAction = {
  id: string;
  label: string;
  description: string;
  path: string;
  aliases: string[];
  keywords: string[];
  icon: LucideIcon;
  requiredRole?: NavigationRole | NavigationRole[];
  source: "navigation" | "workflow";
  spokenOpenLabel: string;
  spokenResult: string;
};

const WORKFLOW_ACTIONS: AssistantNavigationAction[] = [
  {
    id: "maintenance-report",
    label: "Genereaza raport mentenanta",
    description: "Deschide pasii pentru raport de revizie sau interventie.",
    path: "/maintenance?tab=report&assistant=report#maintenance-report-generator",
    aliases: ["generare raport", "genereaza raport", "raport revizie", "raport interventie"],
    keywords: ["mentenanta", "pdf", "email"],
    icon: FilePlus2,
    source: "workflow",
    spokenOpenLabel: "Deschid generarea de raport.",
    spokenResult: "Am deschis generarea de raport.",
  },
  {
    id: "maintenance-parts",
    label: "Piese mentenanta",
    description: "Deschide comenzile de piese pentru lifturi.",
    path: "/maintenance?tab=parts",
    aliases: ["mentenanta piese", "piese mentenanta", "comenzi piese", "piese lift"],
    keywords: ["service", "furnizori", "comanda"],
    icon: PackageSearch,
    source: "workflow",
    spokenOpenLabel: "Deschid comenzile de piese.",
    spokenResult: "Am deschis comenzile de piese.",
  },
  {
    id: "maintenance-add-client",
    label: "Adauga client mentenanta",
    description: "Deschide formularul controlat pentru un client nou.",
    path: "/maintenance?tab=clients&assistant=client#maintenance-client-form",
    aliases: ["adauga client mentenanta", "client nou mentenanta", "creeaza client mentenanta"],
    keywords: ["lift", "adresa", "email"],
    icon: Building2,
    source: "workflow",
    spokenOpenLabel: "Deschid formularul de client mentenanta.",
    spokenResult: "Am deschis formularul de client mentenanta.",
  },
  {
    id: "maintenance-clients",
    label: "Clienti mentenanta",
    description: "Lista clientilor si lifturilor.",
    path: "/maintenance?tab=clients",
    aliases: ["clienti mentenanta", "lista clienti mentenanta"],
    keywords: ["service", "lifturi", "contracte"],
    icon: Building2,
    source: "workflow",
    spokenOpenLabel: "Deschid clientii de mentenanta.",
    spokenResult: "Am deschis clientii de mentenanta.",
  },
  {
    id: "maintenance-branding",
    label: "Firme mentenanta",
    description: "Branding, logo si stampila pentru rapoarte.",
    path: "/maintenance?tab=companies",
    aliases: ["firme mentenanta", "branding mentenanta", "logo mentenanta"],
    keywords: ["stampila", "raport", "companie"],
    icon: Building2,
    source: "workflow",
    spokenOpenLabel: "Deschid firmele de mentenanta.",
    spokenResult: "Am deschis firmele de mentenanta.",
  },
  {
    id: "maintenance-history",
    label: "Istoric rapoarte mentenanta",
    description: "Rapoarte de revizie si interventie.",
    path: "/maintenance?tab=history",
    aliases: ["istoric rapoarte", "istoricul rapoartelor", "rapoarte mentenanta"],
    keywords: ["pdf", "revizie", "interventie"],
    icon: FileClock,
    source: "workflow",
    spokenOpenLabel: "Deschid istoricul rapoartelor.",
    spokenResult: "Am deschis istoricul rapoartelor.",
  },
  {
    id: "maintenance-checks",
    label: "Verificari lunare",
    description: "Revizii lipsa sau care expira.",
    path: "/maintenance?tab=checks",
    aliases: ["verifica reviziile lunare", "verificari lunare", "verifica luna curenta"],
    keywords: ["expirari", "revizii", "lifturi"],
    icon: ListChecks,
    source: "workflow",
    spokenOpenLabel: "Deschid verificarile lunare.",
    spokenResult: "Am deschis verificarile lunare.",
  },
];

export const ASSISTANT_NAVIGATION_ACTIONS: AssistantNavigationAction[] = [
  ...WORKFLOW_ACTIONS,
  ...NAVIGATION_ITEMS.map<AssistantNavigationAction>((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    path: item.path,
    aliases: item.aliases,
    keywords: item.keywords,
    icon: item.icon,
    requiredRole: item.requiredRole,
    source: "navigation",
    spokenOpenLabel: `Deschid ${item.label}.`,
    spokenResult: `Am deschis ${item.label}.`,
  })),
];

export function getAssistantNavigationActions(role: NavigationRole) {
  return ASSISTANT_NAVIGATION_ACTIONS.filter((action) => {
    if (action.source === "navigation") {
      const item = NAVIGATION_ITEMS.find((candidate) => candidate.id === action.id);
      return item ? canAccessNavigationItem(item, role) : false;
    }
    if (!action.requiredRole) return true;
    const roles = Array.isArray(action.requiredRole) ? action.requiredRole : [action.requiredRole];
    return roles.includes(role);
  });
}

export function resolveAssistantNavigationAction(text: string, role: NavigationRole = "angajat") {
  const normalized = normalizeAssistantText(text);
  if (!normalized) return null;

  const ignoredWords = new Set([
    "acceseaza",
    "am",
    "arata",
    "aratami",
    "as",
    "avea",
    "deschide",
    "du",
    "duma",
    "gasesc",
    "gaseste",
    "gasesti",
    "hai",
    "intra",
    "la",
    "ma",
    "mergi",
    "mi",
    "nevoie",
    "pagina",
    "pe",
    "te",
    "rog",
    "spune",
    "trebuie",
    "vreau",
    "sa",
    "unde",
    "vad",
    "vezi",
  ]);
  const normalizeTargetToken = (token: string) => {
    const frequentTypos: Record<string, string> = {
      masni: "masini",
      notficari: "notificari",
      ponta: "pontaj",
      scul: "scule",
    };
    if (frequentTypos[token]) return frequentTypos[token];
    const endings = ["ului", "lor", "ul", "le", "u"];
    const ending = endings.find(
      (candidate) => token.endsWith(candidate) && token.length - candidate.length >= 4
    );
    return ending ? token.slice(0, -ending.length) : token;
  };
  const target =
    normalized
      .split(" ")
      .filter((token) => token && !ignoredWords.has(token))
      .map(normalizeTargetToken)
      .join(" ")
      .trim() || normalized;
  const normalizeCandidate = (value: string) =>
    normalizeAssistantText(value).split(" ").map(normalizeTargetToken).join(" ");

  const ranked = getAssistantNavigationActions(role)
    .map((action) => {
      const terms = [
        { value: action.label, weight: 1, primary: true },
        ...action.aliases.map((value) => ({ value, weight: 0.98, primary: true })),
        ...action.keywords.map((value) => ({ value, weight: 0.72, primary: false })),
      ];
      const exactPrimary = terms.some(
        (term) => term.primary && normalizeCandidate(term.value) === target
      );
      const score = Math.max(
        ...terms.map((term) => {
          const candidate = normalizeCandidate(term.value);
          if (!candidate) return 0;
          if (candidate === target) return term.weight;
          if (target.includes(candidate) && candidate.length >= 4) return 0.94 * term.weight;
          return Math.min(0.92, scoreAssistantText(candidate, target)) * term.weight;
        })
      );
      return { action, score, exactPrimary };
    })
    .filter(({ score }) => score >= 0.42)
    .sort((left, right) => right.score - left.score);

  const first = ranked[0];
  const second = ranked[1];
  if (!first) return null;
  const shortTarget = target.split(" ").length === 1;
  if (
    second &&
    first.action.path !== second.action.path &&
    first.score - second.score < 0.08 &&
    !first.exactPrimary &&
    (first.score < 0.9 || shortTarget)
  ) {
    return null;
  }
  return first.action;
}
