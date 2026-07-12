import type { NavigationRole } from "./navigation";
import { NAVIGATION_ITEMS, canAccessNavigationItem, cleanNavigationPath } from "./navigation";

export type PageBreadcrumbDefinition = {
  label: string;
  path?: string;
};

export type PageExperienceDefinition = {
  id: string;
  pathPattern: string;
  title: string;
  section: string;
  description: string;
  breadcrumbs: PageBreadcrumbDefinition[];
  primaryActionIds?: string[];
  requiredRole?: NavigationRole | NavigationRole[];
  requiredPermission?: string | string[];
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

const PAGE_EXPERIENCES: PageExperienceDefinition[] = [
  { id: "dashboard", pathPattern: "/dashboard", title: "Dashboard", section: "Prezentare", description: "Activitatea firmei pe scurt.", breadcrumbs: [{ label: "Dashboard" }], loadingLabel: "Se pregateste dashboard-ul" },
  { id: "profile", pathPattern: "/my-profile", title: "Profilul meu", section: "Prezentare", description: "Date personale si activitate.", breadcrumbs: [{ label: "Profilul meu" }] },
  { id: "leave", pathPattern: "/my-leave", title: "Concedii", section: "Prezentare", description: "Calendar si cereri de concediu.", breadcrumbs: [{ label: "Concedii" }] },
  { id: "notification-rules", pathPattern: "/notification-rules", title: "Reguli notificari", section: "Comunicare", description: "Automatizari pentru notificari.", breadcrumbs: [{ label: "Notificari", path: "/notifications" }, { label: "Reguli" }], requiredRole: ["admin", "manager"] },
  { id: "users-new", pathPattern: "/users/new", title: "Utilizator nou", section: "Echipa", description: "Creeaza un cont nou.", breadcrumbs: [{ label: "Utilizatori", path: "/users" }, { label: "Utilizator nou" }], requiredRole: ["admin", "manager"] },
  { id: "users-edit", pathPattern: "/users/:userId/edit", title: "Editeaza utilizator", section: "Echipa", description: "Rol, functie, departament si status.", breadcrumbs: [{ label: "Utilizatori", path: "/users" }, { label: "Profil", path: "/users/:userId" }, { label: "Editare" }], requiredRole: ["admin", "manager"] },
  { id: "users-details", pathPattern: "/users/:userId", title: "Profil utilizator", section: "Echipa", description: "Activitate si resurse atribuite.", breadcrumbs: [{ label: "Utilizatori", path: "/users" }, { label: "Profil utilizator" }], requiredRole: ["admin", "manager"] },
  { id: "users", pathPattern: "/users", title: "Utilizatori", section: "Echipa", description: "Echipa, roluri si permisiuni.", breadcrumbs: [{ label: "Utilizatori" }], requiredRole: ["admin", "manager"] },
  { id: "tools-new", pathPattern: "/tools/new", title: "Scula noua", section: "Active", description: "Inregistreaza o scula.", breadcrumbs: [{ label: "Scule", path: "/tools" }, { label: "Scula noua" }] },
  { id: "tools-scan", pathPattern: "/tools/scan", title: "Scaneaza scula", section: "Active", description: "Citeste codul QR al unei scule.", breadcrumbs: [{ label: "Scule", path: "/tools" }, { label: "Scanare" }] },
  { id: "tools-edit", pathPattern: "/tools/:toolId/edit", title: "Editeaza scula", section: "Active", description: "Actualizeaza scula si responsabilitatea.", breadcrumbs: [{ label: "Scule", path: "/tools" }, { label: "Detalii", path: "/tools/:toolId" }, { label: "Editare" }] },
  { id: "tools-details", pathPattern: "/tools/:toolId", title: "Detalii scula", section: "Active", description: "Status, detinator si istoric.", breadcrumbs: [{ label: "Scule", path: "/tools" }, { label: "Detalii" }] },
  { id: "tools", pathPattern: "/tools", title: "Scule", section: "Active", description: "Inventar si transferuri.", breadcrumbs: [{ label: "Scule" }] },
  { id: "vehicles-gps", pathPattern: "/vehicles/gps-map", title: "Toate GPS-urile", section: "Flota", description: "Pozitii si trasee live.", breadcrumbs: [{ label: "Masini", path: "/vehicles" }, { label: "Toate GPS-urile" }] },
  { id: "my-vehicle", pathPattern: "/my-vehicle", title: "Masina mea", section: "Flota", description: "Vehicul atribuit si tracker live.", breadcrumbs: [{ label: "Masina mea" }] },
  { id: "vehicles-new", pathPattern: "/vehicles/new", title: "Masina noua", section: "Flota", description: "Inregistreaza un vehicul.", breadcrumbs: [{ label: "Masini", path: "/vehicles" }, { label: "Masina noua" }] },
  { id: "vehicles-live", pathPattern: "/vehicles/:vehicleId/live", title: "Detalii live", section: "Flota", description: "Date GPS, AVL si OBD disponibile.", breadcrumbs: [{ label: "Masini", path: "/vehicles" }, { label: "Detalii", path: "/vehicles/:vehicleId" }, { label: "Date live" }] },
  { id: "vehicles-edit", pathPattern: "/vehicles/:vehicleId/edit", title: "Editeaza masina", section: "Flota", description: "Date, documente si mentenanta auto.", breadcrumbs: [{ label: "Masini", path: "/vehicles" }, { label: "Detalii", path: "/vehicles/:vehicleId" }, { label: "Editare" }] },
  { id: "vehicles-details", pathPattern: "/vehicles/:vehicleId", title: "Detalii masina", section: "Flota", description: "Documente, sofer, mentenanta si tracker.", breadcrumbs: [{ label: "Masini", path: "/vehicles" }, { label: "Detalii masina" }] },
  { id: "vehicles", pathPattern: "/vehicles", title: "Masini", section: "Flota", description: "Flota si responsabilitate.", breadcrumbs: [{ label: "Masini" }] },
  { id: "timesheet-details", pathPattern: "/timesheets/:timesheetId", title: "Detalii pontaj", section: "Pontaje", description: "Interval, proiect si locatie.", breadcrumbs: [{ label: "Pontaje", path: "/timesheets" }, { label: "Detalii pontaj" }] },
  { id: "timesheets", pathPattern: "/timesheets", title: "Dashboard Pontaje", section: "Pontaje", description: "Orele si prezenta echipei.", breadcrumbs: [{ label: "Pontaje" }] },
  { id: "my-timesheets", pathPattern: "/my-timesheets", title: "Pontajul meu", section: "Pontaje", description: "Start, stop si istoric personal.", breadcrumbs: [{ label: "Pontajul meu" }] },
  { id: "projects", pathPattern: "/projects", title: "Proiecte", section: "Pontaje", description: "Proiectele disponibile pentru pontaj.", breadcrumbs: [{ label: "Proiecte" }] },
  { id: "notifications", pathPattern: "/notifications", title: "Notificari", section: "Comunicare", description: "Alerte si informari.", breadcrumbs: [{ label: "Notificari" }] },
  { id: "control-backup", pathPattern: "/control-panel/backup-preview", title: "Previzualizare backup", section: "Administrare", description: "Verifica exportul inainte de descarcare.", breadcrumbs: [{ label: "Control Panel", path: "/control-panel" }, { label: "Backup" }], requiredRole: "admin" },
  { id: "ui-lab", pathPattern: "/control-panel/ui-lab", title: "UI Lab", section: "Administrare", description: "Componente, stari si tokenuri WorkControl.", breadcrumbs: [{ label: "Control Panel", path: "/control-panel" }, { label: "UI Lab" }], requiredRole: "admin" },
  { id: "control-panel", pathPattern: "/control-panel", title: "Control Panel", section: "Administrare", description: "Sanatatea si configurarea sistemului.", breadcrumbs: [{ label: "Control Panel" }], requiredRole: "admin" },
  { id: "maintenance-orders", pathPattern: "/maintenance/orders", title: "Comenzi piese", section: "Mentenanta", description: "Piese solicitate si livrari.", breadcrumbs: [{ label: "Mentenanta", path: "/maintenance" }, { label: "Comenzi piese" }] },
  { id: "maintenance-parts", pathPattern: "/maintenance/parts", title: "Comenzi piese", section: "Mentenanta", description: "Piese solicitate si livrari.", breadcrumbs: [{ label: "Mentenanta", path: "/maintenance" }, { label: "Comenzi piese" }] },
  { id: "maintenance-manage", pathPattern: "/maintenance/manage", title: "Administrare mentenanta", section: "Mentenanta", description: "Clienti si branding.", breadcrumbs: [{ label: "Mentenanta", path: "/maintenance" }, { label: "Administrare" }] },
  { id: "maintenance-client", pathPattern: "/maintenance/:clientId", title: "Client mentenanta", section: "Mentenanta", description: "Lifturi, rapoarte si date client.", breadcrumbs: [{ label: "Mentenanta", path: "/maintenance" }, { label: "Client" }] },
  { id: "maintenance", pathPattern: "/maintenance", title: "Mentenanta", section: "Mentenanta", description: "Clienti, lifturi, revizii si rapoarte.", breadcrumbs: [{ label: "Mentenanta" }] },
  { id: "expenses-scan", pathPattern: "/expenses/scan", title: "Scanare bonuri", section: "Cheltuieli", description: "Incarcare, OCR si verificare.", breadcrumbs: [{ label: "Cheltuieli" }, { label: "Scanare" }] },
  { id: "expenses-reports", pathPattern: "/expenses/reports", title: "Rapoarte cheltuieli", section: "Cheltuieli", description: "Analiza costurilor.", breadcrumbs: [{ label: "Cheltuieli", path: "/expenses/scan" }, { label: "Rapoarte" }] },
  { id: "expenses-invoices", pathPattern: "/expenses/invoices", title: "Facturi", section: "Cheltuieli", description: "Documente si statusuri.", breadcrumbs: [{ label: "Cheltuieli", path: "/expenses/scan" }, { label: "Facturi" }] },
  { id: "companies", pathPattern: "/companies", title: "Firme", section: "Administrare", description: "Firme si asocierea utilizatorilor.", breadcrumbs: [{ label: "Firme" }], requiredRole: ["admin", "manager"] },
  { id: "history", pathPattern: "/history", title: "Istoric", section: "Administrare", description: "Auditul activitatii.", breadcrumbs: [{ label: "Istoric" }], requiredRole: ["admin", "manager"] },
];

function matchPattern(pattern: string, pathname: string) {
  const patternParts = cleanNavigationPath(pattern).split("/").filter(Boolean);
  const pathParts = cleanNavigationPath(pathname).split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

export function getPageExperience(pathname: string) {
  return PAGE_EXPERIENCES.find((definition) => matchPattern(definition.pathPattern, pathname)) || null;
}

export function canAccessPageExperience(definition: PageExperienceDefinition, role: NavigationRole) {
  const navigationItem = NAVIGATION_ITEMS.find((item) => item.id === definition.id || item.path === definition.pathPattern);
  if (navigationItem) return canAccessNavigationItem(navigationItem, role);
  if (!definition.requiredRole) return true;
  const roles = Array.isArray(definition.requiredRole) ? definition.requiredRole : [definition.requiredRole];
  return roles.includes(role);
}

export function getPageExperiences() {
  return PAGE_EXPERIENCES;
}
