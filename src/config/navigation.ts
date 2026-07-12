import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Inbox,
  BellRing,
  Briefcase,
  Building2,
  CalendarDays,
  CarFront,
  Clock3,
  Clock4,
  FlaskConical,
  History,
  LayoutDashboard,
  MapPinned,
  PackageSearch,
  ReceiptText,
  User,
  Users,
  Wrench,
} from "lucide-react";

export type NavigationRole = "admin" | "manager" | "angajat" | string;
export type NavigationSectionId =
  | "overview"
  | "team"
  | "operations"
  | "maintenance"
  | "communication"
  | "administration";

export type NavigationColorClass =
  | "menu-icon-blue"
  | "menu-icon-violet"
  | "menu-icon-cyan"
  | "menu-icon-orange"
  | "menu-icon-green"
  | "menu-icon-rose";

export type NavigationItem = {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  section: NavigationSectionId;
  requiredRole?: NavigationRole | NavigationRole[];
  requiredPermission?: string | string[];
  aliases: string[];
  keywords: string[];
  quickAction?: boolean;
  mobilePriority: number;
  colorClass: NavigationColorClass;
  description: string;
  compact?: boolean;
};

export type NavigationSection = {
  id: NavigationSectionId;
  label: string;
  compact?: boolean;
};

export const NAVIGATION_SECTIONS: NavigationSection[] = [
  { id: "overview", label: "Prezentare" },
  { id: "team", label: "Echipa si pontaje" },
  { id: "operations", label: "Active si financiar" },
  { id: "maintenance", label: "Service lifturi" },
  { id: "communication", label: "Comunicare" },
  { id: "administration", label: "Administrare", compact: true },
];

export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
    section: "overview",
    aliases: ["acasa", "pagina principala", "command center"],
    keywords: ["overview", "activitate", "firma"],
    quickAction: true,
    mobilePriority: 1,
    colorClass: "menu-icon-blue",
    description: "Privire de ansamblu asupra activitatii firmei.",
  },
  {
    id: "my-profile",
    label: "Profilul meu",
    path: "/my-profile",
    icon: User,
    section: "overview",
    aliases: ["profil personal", "contul meu", "datele mele"],
    keywords: ["profil", "functie", "departament"],
    mobilePriority: 4,
    colorClass: "menu-icon-violet",
    description: "Date personale, firma, documente si activitate.",
  },
  {
    id: "my-leave",
    label: "Concedii",
    path: "/my-leave",
    icon: CalendarDays,
    section: "overview",
    aliases: ["concediul meu", "cerere concediu", "zi libera", "vacanta"],
    keywords: ["calendar", "liber", "programare"],
    quickAction: true,
    mobilePriority: 5,
    colorClass: "menu-icon-orange",
    description: "Calendar si cereri de concediu.",
  },
  {
    id: "users",
    label: "Utilizatori",
    path: "/users",
    icon: Users,
    section: "overview",
    requiredRole: ["admin", "manager"],
    requiredPermission: "users:read",
    aliases: ["angajati", "echipa", "colegi"],
    keywords: ["roluri", "permisiuni", "personal"],
    mobilePriority: 12,
    colorClass: "menu-icon-cyan",
    description: "Echipa, roluri si permisiuni.",
  },
  {
    id: "timesheets",
    label: "Dashboard Pontaje",
    path: "/timesheets",
    icon: Clock3,
    section: "team",
    requiredPermission: "timesheets:read",
    aliases: ["pontaje", "pontaje echipa", "toate pontajele"],
    keywords: ["ore", "raport", "prezenta"],
    mobilePriority: 7,
    colorClass: "menu-icon-blue",
    description: "Pontajele echipei, filtre si rapoarte.",
  },
  {
    id: "my-timesheets",
    label: "Pontajul meu",
    path: "/my-timesheets",
    icon: Clock4,
    section: "team",
    aliases: ["pontaj personal", "orele mele", "cronometru"],
    keywords: ["start", "stop", "program"],
    quickAction: true,
    mobilePriority: 2,
    colorClass: "menu-icon-violet",
    description: "Pornire, oprire si istoric personal.",
  },
  {
    id: "projects",
    label: "Proiecte",
    path: "/projects",
    icon: Briefcase,
    section: "team",
    requiredPermission: "projects:read",
    aliases: ["lucrari", "santiere", "lista proiecte"],
    keywords: ["pontaj", "activ", "client"],
    mobilePriority: 9,
    colorClass: "menu-icon-cyan",
    description: "Proiectele disponibile pentru pontaj.",
  },
  {
    id: "expense-scan",
    label: "Scanare bonuri",
    path: "/expenses/scan",
    icon: ReceiptText,
    section: "operations",
    aliases: ["bonuri", "incarca bon", "scanare factura"],
    keywords: ["ocr", "cheltuieli", "poza"],
    quickAction: true,
    mobilePriority: 6,
    colorClass: "menu-icon-rose",
    description: "Incarcare, OCR si verificarea documentelor.",
  },
  {
    id: "expense-invoices",
    label: "Facturi",
    path: "/expenses/invoices",
    icon: ReceiptText,
    section: "operations",
    aliases: ["facturi", "documente fiscale"],
    keywords: ["cheltuieli", "furnizor", "plata"],
    mobilePriority: 15,
    colorClass: "menu-icon-cyan",
    description: "Documente scanate si verificarea facturilor.",
  },
  {
    id: "expense-reports",
    label: "Rapoarte",
    path: "/expenses/reports",
    icon: BarChart3,
    section: "operations",
    aliases: ["rapoarte cheltuieli", "raport financiar"],
    keywords: ["costuri", "furnizori", "proiecte"],
    mobilePriority: 16,
    colorClass: "menu-icon-green",
    description: "Analiza cheltuielilor pe perioade si categorii.",
  },
  {
    id: "companies",
    label: "Firme",
    path: "/companies",
    icon: Building2,
    section: "operations",
    requiredRole: ["admin", "manager"],
    aliases: ["companii", "firmele mele"],
    keywords: ["branding", "angajator"],
    mobilePriority: 17,
    colorClass: "menu-icon-violet",
    description: "Firmele folosite in WorkControl.",
  },
  {
    id: "tools",
    label: "Scule",
    path: "/tools",
    icon: Wrench,
    section: "operations",
    requiredPermission: "tools:read",
    aliases: ["unelte", "echipamente", "inventar scule"],
    keywords: ["qr", "detinator", "depozit"],
    mobilePriority: 10,
    colorClass: "menu-icon-orange",
    description: "Inventar, responsabil si transferuri.",
  },
  {
    id: "vehicles",
    label: "Masini",
    path: "/vehicles",
    icon: CarFront,
    section: "operations",
    requiredPermission: "vehicles:read",
    aliases: ["vehicule", "flota", "lista masini"],
    keywords: ["auto", "documente", "sofer"],
    mobilePriority: 8,
    colorClass: "menu-icon-green",
    description: "Flota, documente si responsabilitate.",
  },
  {
    id: "fleet-gps",
    label: "Toate GPS-urile",
    path: "/vehicles/gps-map",
    icon: MapPinned,
    section: "operations",
    requiredPermission: "vehicles:read",
    aliases: ["harta gps", "toate gps", "harta flotei"],
    keywords: ["trackere", "trasee", "pozitii live"],
    quickAction: true,
    mobilePriority: 11,
    colorClass: "menu-icon-cyan",
    description: "Pozitii si trasee pentru intreaga flota.",
  },
  {
    id: "my-vehicle",
    label: "Masina mea",
    path: "/my-vehicle",
    icon: CarFront,
    section: "operations",
    requiredPermission: "vehicles:read",
    aliases: ["auto meu", "gpsul meu", "vehiculul meu"],
    keywords: ["tracker", "documente", "kilometri"],
    quickAction: true,
    mobilePriority: 3,
    colorClass: "menu-icon-blue",
    description: "Vehiculul atribuit si trackerul live.",
  },
  {
    id: "maintenance",
    label: "Mentenanta",
    path: "/maintenance",
    icon: Building2,
    section: "maintenance",
    requiredPermission: "maintenance:read",
    aliases: ["service lifturi", "revizii", "clienti mentenanta"],
    keywords: ["lifturi", "rapoarte", "interventii"],
    quickAction: true,
    mobilePriority: 13,
    colorClass: "menu-icon-violet",
    description: "Clienti, lifturi, revizii si rapoarte.",
  },
  {
    id: "maintenance-orders",
    label: "Comenzi piese",
    path: "/maintenance/orders",
    icon: PackageSearch,
    section: "maintenance",
    requiredPermission: "maintenance:read",
    aliases: ["piese", "comenzi piese", "piese lift"],
    keywords: ["furnizori", "necesar", "livrare"],
    mobilePriority: 18,
    colorClass: "menu-icon-orange",
    description: "Piese solicitate pentru interventii.",
  },
  {
    id: "operational-inbox",
    label: "Inbox operational",
    path: "/inbox",
    icon: Inbox,
    section: "communication",
    aliases: ["inbox", "ce necesita atentie", "alerte importante"],
    keywords: ["critic", "actiuni", "prioritati"],
    quickAction: true,
    mobilePriority: 13,
    colorClass: "menu-icon-rose",
    description: "Alerte prioritizate si actiuni care necesita atentie.",
  },
  {
    id: "notifications",
    label: "Notificari",
    path: "/notifications",
    icon: Bell,
    section: "communication",
    aliases: ["alerte", "mesaje"],
    keywords: ["necitite", "informari"],
    mobilePriority: 14,
    colorClass: "menu-icon-orange",
    description: "Alerte si informari personale.",
  },
  {
    id: "notification-rules",
    label: "Reguli notificari",
    path: "/notification-rules",
    icon: BellRing,
    section: "communication",
    requiredRole: ["admin", "manager"],
    aliases: ["automatizari notificari", "reguli alerte"],
    keywords: ["program", "push", "email"],
    mobilePriority: 22,
    colorClass: "menu-icon-blue",
    description: "Reguli automate pentru comunicare.",
  },
  {
    id: "control-panel",
    label: "Control Panel",
    path: "/control-panel",
    icon: BarChart3,
    section: "administration",
    requiredRole: "admin",
    requiredPermission: "admin",
    aliases: ["panou control", "administrare sistem"],
    keywords: ["firebase", "costuri", "server", "billing"],
    mobilePriority: 30,
    colorClass: "menu-icon-cyan",
    description: "Sanatatea sistemului, costuri si configurare.",
    compact: true,
  },
  {
    id: "history",
    label: "Istoric",
    path: "/history",
    icon: History,
    section: "administration",
    requiredRole: ["admin", "manager"],
    requiredPermission: "history:read",
    aliases: ["activitate", "audit", "ultima activitate"],
    keywords: ["evenimente", "modificari", "utilizatori"],
    mobilePriority: 31,
    colorClass: "menu-icon-orange",
    description: "Auditul actiunilor importante din aplicatie.",
    compact: true,
  },
  {
    id: "ui-lab",
    label: "UI Lab",
    path: "/control-panel/ui-lab",
    icon: FlaskConical,
    section: "administration",
    requiredRole: "admin",
    requiredPermission: "admin",
    aliases: ["laborator ui", "design system", "componente"],
    keywords: ["developer", "tokens", "stari", "accesibilitate"],
    mobilePriority: 32,
    colorClass: "menu-icon-violet",
    description: "Catalog intern pentru componente si stari UI.",
    compact: true,
  },
];

const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set(["*"]),
  manager: new Set([
    "authenticated",
    "users:read",
    "vehicles:read",
    "tools:read",
    "projects:read",
    "timesheets:read",
    "maintenance:read",
    "history:read",
  ]),
  angajat: new Set([
    "authenticated",
    "vehicles:read",
    "tools:read",
    "projects:read",
    "timesheets:read",
    "maintenance:read",
  ]),
};

function roleMatches(requiredRole: NavigationItem["requiredRole"], role: NavigationRole) {
  if (!requiredRole) return true;
  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  return roles.includes(role);
}

function permissionMatches(requiredPermission: NavigationItem["requiredPermission"], role: NavigationRole) {
  if (!requiredPermission) return true;
  const permissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  const rolePermissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.angajat;
  return rolePermissions.has("*") || permissions.every((permission) => rolePermissions.has(permission));
}

export function canAccessNavigationItem(item: NavigationItem, role: NavigationRole) {
  return roleMatches(item.requiredRole, role) && permissionMatches(item.requiredPermission, role);
}

export function getNavigationItemsForRole(role: NavigationRole) {
  return NAVIGATION_ITEMS.filter((item) => canAccessNavigationItem(item, role));
}

export function getNavigationSectionsForRole(role: NavigationRole) {
  const visibleItems = getNavigationItemsForRole(role);
  return NAVIGATION_SECTIONS.map((section) => ({
    ...section,
    items: visibleItems.filter((item) => item.section === section.id),
  })).filter((section) => section.items.length > 0);
}

export function cleanNavigationPath(path: string) {
  return String(path || "").split("?")[0].split("#")[0].trim();
}

export function navigationPathMatches(pathname: string, itemPath: string) {
  const currentPath = cleanNavigationPath(pathname);
  const targetPath = cleanNavigationPath(itemPath);
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

export function getNavigationItemForPath(pathname: string) {
  return [...NAVIGATION_ITEMS]
    .sort((left, right) => cleanNavigationPath(right.path).length - cleanNavigationPath(left.path).length)
    .find((item) => navigationPathMatches(pathname, item.path)) || null;
}
