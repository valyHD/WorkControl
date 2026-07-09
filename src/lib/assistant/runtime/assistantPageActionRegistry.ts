import { normalizeAssistantText, scoreAssistantText } from "./assistantFuzzy";

export type AssistantPageActionType = "button" | "file" | "field" | "section" | "link" | "search";

export type AssistantPageAction = {
  id: string;
  label: string;
  aliases: string[];
  selector: string;
  priority: number;
  actionType: AssistantPageActionType;
  pagePattern: string;
  nextActionIds?: string[];
};

export type AssistantPageActionMatch = AssistantPageAction & {
  score: number;
};

export const ASSISTANT_PAGE_ACTION_REGISTRY: AssistantPageAction[] = [
  {
    pagePattern: "/expenses/scan",
    id: "upload-receipt",
    label: "Incarca poza bon",
    aliases: ["incarca poza", "alege bon", "upload bon", "pune poza la bon", "fisier bon", "poza bon"],
    selector: "[data-assistant-action='upload-receipt']",
    priority: 1,
    actionType: "file",
    nextActionIds: ["scan-receipt"],
  },
  {
    pagePattern: "/expenses/scan",
    id: "scan-receipt",
    label: "Scaneaza si salveaza bon",
    aliases: ["scaneaza bon", "salveaza bon", "scanare bon", "citeste bon", "scaneaza si salveaza"],
    selector: "[data-assistant-action='scan-receipt']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/expenses/scan",
    id: "expense-project",
    label: "Proiect cheltuiala",
    aliases: ["proiect bon", "proiect cheltuiala", "alege proiect"],
    selector: "[data-assistant-field='expense-project']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/expenses/scan",
    id: "expense-history",
    label: "Istoric bonuri scanate",
    aliases: ["istoric bonuri", "cheltuieli scanate", "vezi istoric"],
    selector: "[data-assistant-section='expense-history']",
    priority: 4,
    actionType: "section",
  },
  {
    pagePattern: "/my-leave",
    id: "leave-form",
    label: "Formular cerere concediu",
    aliases: ["formular concediu", "programare concediu", "cerere concediu", "concediu maine"],
    selector: "[data-assistant-section='leave-form']",
    priority: 1,
    actionType: "section",
    nextActionIds: ["submit-leave-request"],
  },
  {
    pagePattern: "/my-leave",
    id: "submit-leave-request",
    label: "Trimite cererea de concediu",
    aliases: ["trimite cerere", "programeaza concediu", "depune concediu", "trimite concediu"],
    selector: "[data-assistant-section='leave-form'] [data-assistant-action='submit-leave-request'], [data-assistant-action='submit-leave-request']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/my-leave",
    id: "leave-start-date",
    label: "Data inceput concediu",
    aliases: ["data inceput", "perioada concediu", "alege perioada"],
    selector: "[data-assistant-field='leave-start-date']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/my-leave",
    id: "leave-end-date",
    label: "Data sfarsit concediu",
    aliases: ["data sfarsit", "final concediu", "sfarsit concediu"],
    selector: "[data-assistant-field='leave-end-date']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/my-leave",
    id: "leave-reason",
    label: "Motiv concediu",
    aliases: ["motiv", "motiv concediu", "completeaza motiv"],
    selector: "[data-assistant-field='leave-reason']",
    priority: 4,
    actionType: "field",
  },
  {
    pagePattern: "/my-leave",
    id: "leave-signature",
    label: "Semnatura concediu",
    aliases: ["semnatura", "semneaza", "semnatura cerere"],
    selector: "[data-assistant-field='leave-signature']",
    priority: 5,
    actionType: "field",
  },
  {
    pagePattern: "/my-leave",
    id: "my-leave-requests",
    label: "Cererile mele",
    aliases: ["cererile mele", "istoric concedii", "cereri depuse"],
    selector: "[data-assistant-section='my-leave-requests']",
    priority: 6,
    actionType: "section",
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "fullName",
    label: "Nume complet",
    aliases: ["nume", "nume complet", "utilizator"],
    selector: "[data-assistant-field='fullName']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "role",
    label: "Rol utilizator",
    aliases: ["rol", "rol utilizator", "admin", "manager"],
    selector: "[data-assistant-field='role']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "roleTitle",
    label: "Functie / post",
    aliases: ["functie", "post", "meserie", "completeaza functia"],
    selector: "[data-assistant-field='roleTitle']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "department",
    label: "Departament",
    aliases: ["departament", "echipa", "completeaza departament"],
    selector: "[data-assistant-field='department']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "save-user",
    label: "Salveaza utilizatorul",
    aliases: ["salveaza utilizator", "salveaza user", "salveaza modificarile"],
    selector: "[data-assistant-action='save-user']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/users/:userId/edit",
    id: "active",
    label: "Status activ",
    aliases: ["activ", "inactiv", "status utilizator"],
    selector: "[data-assistant-field='active']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/new",
    id: "plateNumber",
    label: "Numar inmatriculare",
    aliases: ["numar", "inmatriculare", "placa", "numar masina"],
    selector: "[data-assistant-field='plateNumber']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/new",
    id: "currentKm",
    label: "Km curenti",
    aliases: ["km curenti", "kilometraj", "kilometri"],
    selector: "[data-assistant-field='currentKm']",
    priority: 2,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/new",
    id: "nextItpDate",
    label: "ITP pana la",
    aliases: ["itp", "data itp", "itp pana la"],
    selector: "[data-assistant-field='nextItpDate']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/new",
    id: "save-vehicle",
    label: "Salveaza masina",
    aliases: ["salveaza masina", "creeaza masina", "salveaza vehicul"],
    selector: "[data-assistant-action='save-vehicle']",
    priority: 4,
    actionType: "button",
  },
  {
    pagePattern: "/vehicles/:vehicleId/edit",
    id: "currentKm",
    label: "Km curenti",
    aliases: ["km curenti", "kilometraj", "kilometri"],
    selector: "[data-assistant-field='currentKm']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/:vehicleId/edit",
    id: "nextItpDate",
    label: "ITP pana la",
    aliases: ["itp", "data itp", "itp pana la"],
    selector: "[data-assistant-field='nextItpDate']",
    priority: 2,
    actionType: "field",
  },
  {
    pagePattern: "/vehicles/:vehicleId/edit",
    id: "save-vehicle",
    label: "Salveaza masina",
    aliases: ["salveaza masina", "salveaza vehicul"],
    selector: "[data-assistant-action='save-vehicle']",
    priority: 3,
    actionType: "button",
  },
  {
    pagePattern: "/tools/new",
    id: "name",
    label: "Nume scula",
    aliases: ["nume scula", "scula", "denumire"],
    selector: "[data-assistant-field='name']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/tools/new",
    id: "internalCode",
    label: "Cod intern",
    aliases: ["cod intern", "cod scula"],
    selector: "[data-assistant-field='internalCode']",
    priority: 2,
    actionType: "field",
  },
  {
    pagePattern: "/tools/new",
    id: "save-tool",
    label: "Salveaza scula",
    aliases: ["salveaza scula", "creeaza scula"],
    selector: "[data-assistant-action='save-tool']",
    priority: 3,
    actionType: "button",
  },
  {
    pagePattern: "/tools/:toolId/edit",
    id: "currentHolderUserId",
    label: "Detinator curent",
    aliases: ["detinator", "cine o are", "utilizator scula"],
    selector: "[data-assistant-field='currentHolderUserId']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/tools/:toolId/edit",
    id: "save-tool",
    label: "Salveaza scula",
    aliases: ["salveaza scula", "salveaza modificarile"],
    selector: "[data-assistant-action='save-tool']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/users/new",
    id: "fullName",
    label: "Nume complet",
    aliases: ["nume", "nume complet", "utilizator"],
    selector: "[data-assistant-field='fullName']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/users/new",
    id: "role",
    label: "Rol utilizator",
    aliases: ["rol", "rol utilizator", "admin", "manager"],
    selector: "[data-assistant-field='role']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/users/new",
    id: "roleTitle",
    label: "Functie / post",
    aliases: ["functie", "post", "meserie", "completeaza functia"],
    selector: "[data-assistant-field='roleTitle']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/users/new",
    id: "department",
    label: "Departament",
    aliases: ["departament", "echipa", "completeaza departament"],
    selector: "[data-assistant-field='department']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/users/new",
    id: "save-user",
    label: "Salveaza utilizatorul",
    aliases: ["creeaza utilizator", "salveaza utilizator", "salveaza user"],
    selector: "[data-assistant-action='save-user']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/my-profile",
    id: "roleTitle",
    label: "Functie / post",
    aliases: ["functie", "post", "meserie", "completeaza functia"],
    selector: "[data-assistant-field='roleTitle']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/my-profile",
    id: "department",
    label: "Departament",
    aliases: ["departament", "echipa", "completeaza departament"],
    selector: "[data-assistant-field='department']",
    priority: 1,
    actionType: "field",
    nextActionIds: ["save-user"],
  },
  {
    pagePattern: "/my-profile",
    id: "save-user",
    label: "Salveaza profilul",
    aliases: ["salveaza profil", "salveaza utilizator", "salveaza user"],
    selector: "[data-assistant-action='save-user']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-generator",
    label: "Generator raport mentenanta",
    aliases: ["raport revizie", "raport interventie", "genereaza raport", "generator raport"],
    selector: "[data-assistant-section='maintenance-report-generator']",
    priority: 1,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-client",
    label: "Client raport mentenanta",
    aliases: ["client raport", "cauta client", "alege client raport"],
    selector: "[data-assistant-field='maintenance-report-client']",
    priority: 1,
    actionType: "field",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-address",
    label: "Adresa raport mentenanta",
    aliases: ["adresa raport", "alege adresa"],
    selector: "[data-assistant-field='maintenance-report-address']",
    priority: 2,
    actionType: "field",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-lift",
    label: "Lift raport mentenanta",
    aliases: ["lift raport", "alege lift", "numar lift"],
    selector: "[data-assistant-field='maintenance-report-lift']",
    priority: 3,
    actionType: "field",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-technician",
    label: "Tehnician raport mentenanta",
    aliases: ["tehnician", "alege tehnician"],
    selector: "[data-assistant-field='maintenance-report-technician']",
    priority: 4,
    actionType: "field",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-report-photos",
    label: "Poze raport mentenanta",
    aliases: ["poze raport", "incarca poze", "fotografii raport"],
    selector: "[data-assistant-field='maintenance-report-photos']",
    priority: 5,
    actionType: "file",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-generate-review-report",
    label: "Genereaza raport revizie",
    aliases: ["genereaza raport revizie", "trimite raport revizie", "genereaza pdf"],
    selector: "[data-assistant-action='maintenance-generate-review-report']",
    priority: 6,
    actionType: "button",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-add-client",
    label: "Adauga client mentenanta",
    aliases: ["adauga client", "client mentenanta", "formular client", "client nou"],
    selector: "[data-assistant-action='maintenance-add-client']",
    priority: 1,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-save-client",
    label: "Salveaza client mentenanta",
    aliases: ["salveaza client", "salveaza client mentenanta", "trimite client"],
    selector: "[data-assistant-action='maintenance-save-client']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-parts",
    label: "Piese mentenanta",
    aliases: ["piese", "comenzi piese", "piese lift", "mentenanta piese"],
    selector: "[data-assistant-action='maintenance-parts']",
    priority: 2,
    actionType: "link",
  },
  {
    pagePattern: "/maintenance/orders",
    id: "maintenance-parts",
    label: "Comenzi piese mentenanta",
    aliases: ["piese", "comenzi piese", "piese lift", "comanda noua"],
    selector: "[data-assistant-action='maintenance-parts']",
    priority: 1,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance/parts",
    id: "maintenance-parts",
    label: "Comenzi piese mentenanta",
    aliases: ["piese", "comenzi piese", "piese lift", "comanda noua"],
    selector: "[data-assistant-action='maintenance-parts']",
    priority: 1,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-branding",
    label: "Firme si branding mentenanta",
    aliases: ["firme mentenanta", "branding", "logo firma", "stampila firma"],
    selector: "[data-assistant-action='maintenance-branding']",
    priority: 2,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-history",
    label: "Istoric clienti mentenanta",
    aliases: ["istoric rapoarte", "istoric mentenanta", "lista clienti", "rapoarte mentenanta"],
    selector: "[data-assistant-action='maintenance-history']",
    priority: 3,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance",
    id: "maintenance-checks",
    label: "Verificari lunare mentenanta",
    aliases: ["verificari lunare", "verifica revizii", "revizii lunare", "luna curenta"],
    selector: "[data-assistant-action='maintenance-checks']",
    priority: 4,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance/manage",
    id: "maintenance-add-client",
    label: "Adauga client mentenanta",
    aliases: ["adauga client", "client mentenanta", "formular client", "client nou"],
    selector: "[data-assistant-action='maintenance-add-client']",
    priority: 1,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance/manage",
    id: "maintenance-save-client",
    label: "Salveaza client mentenanta",
    aliases: ["salveaza client", "salveaza client mentenanta", "trimite client"],
    selector: "[data-assistant-action='maintenance-save-client']",
    priority: 2,
    actionType: "button",
  },
  {
    pagePattern: "/maintenance/manage",
    id: "maintenance-branding",
    label: "Firme si branding mentenanta",
    aliases: ["firme mentenanta", "branding", "logo firma", "stampila firma"],
    selector: "[data-assistant-action='maintenance-branding']",
    priority: 2,
    actionType: "section",
  },
  {
    pagePattern: "/maintenance/manage",
    id: "maintenance-history",
    label: "Istoric clienti mentenanta",
    aliases: ["istoric rapoarte", "istoric mentenanta", "lista clienti", "rapoarte mentenanta"],
    selector: "[data-assistant-action='maintenance-history']",
    priority: 3,
    actionType: "section",
  },
];

export function assistantPathMatchesPattern(pagePattern: string, pathname: string) {
  const patternParts = pagePattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => part.startsWith(":") || normalizeAssistantText(part) === normalizeAssistantText(pathParts[index]));
}

export function getAssistantPageActions(pathname: string) {
  return ASSISTANT_PAGE_ACTION_REGISTRY
    .filter((action) => assistantPathMatchesPattern(action.pagePattern, pathname))
    .sort((left, right) => left.priority - right.priority);
}

export function getAssistantPageActionById(pathname: string, actionId: string) {
  const normalizedId = normalizeAssistantText(actionId);
  return getAssistantPageActions(pathname).find((action) => normalizeAssistantText(action.id) === normalizedId) || null;
}

export function resolveAssistantPageActionFromText(pathname: string, text: string): AssistantPageActionMatch | null {
  const normalized = normalizeAssistantText(text);
  if (!normalized) return null;

  return getAssistantPageActions(pathname)
    .map((action) => {
      const aliasScore = Math.max(
        scoreAssistantText(action.label, normalized),
        ...action.aliases.map((alias) => scoreAssistantText(alias, normalized)),
        scoreAssistantText(action.id, normalized)
      );
      const directScore = [action.id, action.label, ...action.aliases].some((value) =>
        normalized.includes(normalizeAssistantText(value))
      )
        ? 1
        : aliasScore;
      return { ...action, score: directScore };
    })
    .filter((action) => action.score >= 0.42)
    .sort((left, right) => right.score - left.score || left.priority - right.priority)[0] || null;
}
