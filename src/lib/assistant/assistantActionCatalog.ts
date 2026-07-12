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
import { normalizeAssistantText } from "./runtime/assistantFuzzy";

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
  return getAssistantNavigationActions(role).find((action) =>
    [action.label, ...action.aliases, ...action.keywords]
      .map(normalizeAssistantText)
      .some((term) => term && normalized.includes(term))
  ) || null;
}
