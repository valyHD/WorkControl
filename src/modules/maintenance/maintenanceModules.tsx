import type { ComponentType, ReactNode } from "react";
import {
  ArrowUpDown,
  Building2,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  PackageSearch,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { MaintenanceDashboardModule } from "./dashboard";
import { MaintenanceReportsModule } from "./reports";
import { MaintenanceClientsModule } from "./clients";
import { MaintenanceLiftsModule } from "./lifts";
import { MaintenancePartsModule } from "./parts";
import { MaintenanceCompaniesModule } from "./companies";
import { MaintenanceHistoryModule } from "./history";
import { MaintenanceChecksModule } from "./checks";

export type MaintenanceTab =
  "dashboard" | "report" | "parts" | "clients" | "lifts" | "companies" | "history" | "checks";

export type MaintenanceModuleDefinition = {
  id: MaintenanceTab;
  title: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType<{ children: ReactNode }>;
};

export const MAINTENANCE_MODULES: MaintenanceModuleDefinition[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Privire rapida peste clienti, lifturi si atentionari.",
    icon: LayoutDashboard,
    component: MaintenanceDashboardModule,
  },
  {
    id: "report",
    title: "Genereaza raport",
    description: "Raport PDF cu poze si trimitere Gmail.",
    icon: FileText,
    component: MaintenanceReportsModule,
  },
  {
    id: "parts",
    title: "Piese",
    description: "Comenzi piese, oferte si status montaj.",
    icon: PackageSearch,
    component: MaintenancePartsModule,
  },
  {
    id: "clients",
    title: "Clienti",
    description: "Adauga, cauta si gestioneaza clienti/lifturi.",
    icon: UsersRound,
    component: MaintenanceClientsModule,
  },
  {
    id: "lifts",
    title: "Lifturi",
    description: "Inventar, adresa, revizie si expirare.",
    icon: ArrowUpDown,
    component: MaintenanceLiftsModule,
  },
  {
    id: "companies",
    title: "Firme / Branding",
    description: "Logo si stampila pe firma de mentenanta.",
    icon: Building2,
    component: MaintenanceCompaniesModule,
  },
  {
    id: "history",
    title: "Istoric rapoarte",
    description: "Cauta rapoarte, descarca PDF-uri si vezi poze.",
    icon: History,
    component: MaintenanceHistoryModule,
  },
  {
    id: "checks",
    title: "Verificari lunare",
    description: "Revizii lipsa si lifturi expirate.",
    icon: ClipboardCheck,
    component: MaintenanceChecksModule,
  },
];

const VALID_MAINTENANCE_TABS = new Set(MAINTENANCE_MODULES.map((module) => module.id));

export function getMaintenanceTabFromLocation(
  pathname: string,
  params: URLSearchParams
): MaintenanceTab {
  const tab = params.get("tab") as MaintenanceTab | null;
  if (tab && VALID_MAINTENANCE_TABS.has(tab)) return tab;
  if (pathname === "/maintenance/manage") return "clients";
  if (pathname === "/maintenance/parts" || pathname === "/maintenance/orders") return "parts";
  return "dashboard";
}

export function getMaintenanceModule(tab: MaintenanceTab) {
  return MAINTENANCE_MODULES.find((module) => module.id === tab) || MAINTENANCE_MODULES[0];
}
